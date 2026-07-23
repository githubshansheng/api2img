import { Router, type Response as ExpressResponse } from "express";
import { PNG } from "pngjs";
import { createGenerationError } from "../src/services/error-service";

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const DEFAULT_ANALYSIS_MODEL = "gpt-5.5";
const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const DEFAULT_OUTPUT_SIZE = "2048x2048";
const MAX_OUTPUT_EDGE = 3840;
const MIN_OUTPUT_PIXELS = 655_360;
const MAX_OUTPUT_PIXELS = 8_294_400;
const MAX_OUTPUT_ASPECT_RATIO = 3;
const ANALYSIS_TIMEOUT_MS = 120_000;
const IMAGE_TIMEOUT_MS = 300_000;
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
]);

type CanvasOutpaintPayload = {
  requestId?: string;
  original_image?: string;
  base_image?: string;
  mask_image?: string;
  user_prompt?: string;
  api_key?: string;
  analysis_model?: string;
  image_model?: string;
  output_size?: string;
  endpoint_override?: {
    baseURL?: string;
    editURL?: string;
    headers?: Record<string, string>;
  };
};

type ParsedDataImage = {
  mimeType: string;
  buffer: Buffer;
  dataUrl: string;
};

type OutpaintAnalysis = {
  optimizedPrompt: string;
  visualSummary: string;
  extensionPlan: string;
};

type UpstreamJson = Record<string, unknown>;

export function createCanvasOutpaintRouter() {
  const router = Router();

  router.post("/", async (req, res) => {
    const input = req.body as CanvasOutpaintPayload;
    const requestId = input.requestId?.trim() || crypto.randomUUID();
    const startedAt = Date.now();

    try {
      const apiKey = requireText(input.api_key, "API_KEY_REQUIRED", "请先在设置中保存 API Key。");
      const originalImage = parseDataImage(input.original_image, "original_image");
      const baseImage = parseDataImage(input.base_image, "base_image", "image/png");
      const debugMask = parseDataImage(input.mask_image, "mask_image", "image/png");
      const analysisModel = optionalText(input.analysis_model) ?? DEFAULT_ANALYSIS_MODEL;
      const imageModel = optionalText(input.image_model) ?? DEFAULT_IMAGE_MODEL;
      const outputSize = normalizeOutputSize(input.output_size);
      const responseURL = buildUpstreamURL(input.endpoint_override?.baseURL, "v1/responses");
      const imageEditURL = input.endpoint_override?.editURL
        ? normalizeExplicitURL(input.endpoint_override.editURL)
        : buildUpstreamURL(input.endpoint_override?.baseURL, "v1/images/edits");
      const headers = buildHeaders(apiKey, input.endpoint_override?.headers);

      const convertedMask = convertDebugMaskToEditMask(
        baseImage.buffer,
        debugMask.buffer
      );
      const analysisStartedAt = Date.now();
      const analysis = await requestOutpaintAnalysis({
        url: responseURL,
        headers,
        model: analysisModel,
        originalImage,
        baseImage,
        userPrompt: optionalText(input.user_prompt) ?? ""
      });
      const analysisMs = Date.now() - analysisStartedAt;
      const generationStartedAt = Date.now();
      const generatedImage = await requestOutpaintImage({
        url: imageEditURL,
        headers,
        model: imageModel,
        prompt: analysis.optimizedPrompt,
        baseImage,
        maskBuffer: convertedMask.buffer,
        outputSize
      });
      const imageGenerationMs = Date.now() - generationStartedAt;

      res.json({
        success: true,
        data: {
          requestId,
          status: "success",
          image: generatedImage,
          analysis,
          timings: {
            analysisMs,
            imageGenerationMs,
            totalMs: Date.now() - startedAt
          }
        },
        requestId,
        serverTime: new Date().toISOString()
      });
    } catch (error) {
      sendOutpaintFailure(res, requestId, error);
    }
  });

  return router;
}

export function convertDebugMaskToEditMask(
  baseImageBuffer: Buffer,
  debugMaskBuffer: Buffer
) {
  let baseImage: PNG;
  let debugMask: PNG;

  try {
    baseImage = PNG.sync.read(baseImageBuffer);
    debugMask = PNG.sync.read(debugMaskBuffer);
  } catch {
    throw createOutpaintError(
      400,
      "OUTPAINT_PNG_DECODE_FAILED",
      "底图或遮罩不是有效的 PNG 图片。"
    );
  }

  if (
    baseImage.width !== debugMask.width ||
    baseImage.height !== debugMask.height
  ) {
    throw createOutpaintError(
      400,
      "OUTPAINT_MASK_DIMENSION_MISMATCH",
      "底图与遮罩尺寸必须完全一致。"
    );
  }

  const output = new PNG({
    width: debugMask.width,
    height: debugMask.height
  });

  for (let offset = 0; offset < debugMask.data.length; offset += 4) {
    const luminance = Math.round(
      debugMask.data[offset]! * 0.2126 +
        debugMask.data[offset + 1]! * 0.7152 +
        debugMask.data[offset + 2]! * 0.0722
    );
    const alpha = luminance >= 128 ? 0 : 255;

    output.data[offset] = 255;
    output.data[offset + 1] = 255;
    output.data[offset + 2] = 255;
    output.data[offset + 3] = alpha;
  }

  return {
    buffer: PNG.sync.write(output),
    width: output.width,
    height: output.height
  };
}

async function requestOutpaintAnalysis(input: {
  url: string;
  headers: Record<string, string>;
  model: string;
  originalImage: ParsedDataImage;
  baseImage: ParsedDataImage;
  userPrompt: string;
}): Promise<OutpaintAnalysis> {
  const instruction = [
    "Analyze the original image and the rotated base canvas for a seamless outpainting operation.",
    "Identify the central subject, artistic medium, composition, perspective, materials, color palette, lighting direction, depth of field, texture, and edge continuity.",
    "Plan only the content needed in the exposed border regions. The existing rotated image content must remain unchanged.",
    `The user's short intent is: ${input.userPrompt || "(no extra preference; continue the visible scene naturally)"}.`,
    "Write optimized_prompt in English for an image editing model. Explicitly preserve all existing pixels and subjects, fill only the masked border area, continue lines and textures across each seam, and avoid frames, text, watermarks, duplicated subjects, or new focal objects."
  ].join("\n");
  const body = {
    model: input.model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: instruction
          },
          {
            type: "input_image",
            image_url: input.originalImage.dataUrl,
            detail: "high"
          },
          {
            type: "input_image",
            image_url: input.baseImage.dataUrl,
            detail: "high"
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "canvas_outpaint_analysis",
        strict: true,
        schema: {
          type: "object",
          properties: {
            optimized_prompt: {
              type: "string",
              description: "High-fidelity English image editing prompt."
            },
            visual_summary: {
              type: "string",
              description: "Concise summary of style, subject, palette, and lighting."
            },
            extension_plan: {
              type: "string",
              description: "Concise plan for filling the exposed border regions."
            }
          },
          required: [
            "optimized_prompt",
            "visual_summary",
            "extension_plan"
          ],
          additionalProperties: false
        }
      }
    },
    max_output_tokens: 1800
  };
  const response = await fetchWithTimeout(
    input.url,
    {
      method: "POST",
      headers: {
        ...input.headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    },
    ANALYSIS_TIMEOUT_MS
  );
  const responseBody = await readUpstreamJson(response);

  if (!response.ok) {
    throw createUpstreamError(
      response.status,
      "OUTPAINT_ANALYSIS_FAILED",
      "GPT 视觉分析失败",
      responseBody
    );
  }

  const outputText = extractResponsesOutputText(responseBody);

  if (!outputText) {
    throw createOutpaintError(
      502,
      "OUTPAINT_ANALYSIS_EMPTY",
      "视觉分析模型没有返回结构化提示词。"
    );
  }

  try {
    const parsed = JSON.parse(outputText) as Record<string, unknown>;
    const optimizedPrompt = requireText(
      parsed.optimized_prompt,
      "OUTPAINT_PROMPT_EMPTY",
      "视觉分析模型没有返回 optimized_prompt。"
    );

    return {
      optimizedPrompt: optimizedPrompt.slice(0, 8000),
      visualSummary: String(parsed.visual_summary ?? "").trim(),
      extensionPlan: String(parsed.extension_plan ?? "").trim()
    };
  } catch (error) {
    if (isOutpaintError(error)) {
      throw error;
    }

    throw createOutpaintError(
      502,
      "OUTPAINT_ANALYSIS_INVALID_JSON",
      "视觉分析模型返回的 JSON 无法解析。"
    );
  }
}

async function requestOutpaintImage(input: {
  url: string;
  headers: Record<string, string>;
  model: string;
  prompt: string;
  baseImage: ParsedDataImage;
  maskBuffer: Buffer;
  outputSize: string;
}) {
  const form = new FormData();
  form.set("model", input.model);
  form.set("prompt", input.prompt);
  form.set("size", input.outputSize);
  form.set("quality", "high");
  form.set("output_format", "png");
  form.set("n", "1");
  form.append(
    "image[]",
    new Blob([new Uint8Array(input.baseImage.buffer)], {
      type: input.baseImage.mimeType
    }),
    "rotated-base.png"
  );
  form.set(
    "mask",
    new Blob([new Uint8Array(input.maskBuffer)], {
      type: "image/png"
    }),
    "outpaint-mask.png"
  );
  const response = await fetchWithTimeout(
    input.url,
    {
      method: "POST",
      headers: input.headers,
      body: form
    },
    IMAGE_TIMEOUT_MS
  );
  const responseBody = await readUpstreamJson(response);

  if (!response.ok) {
    throw createUpstreamError(
      response.status,
      "OUTPAINT_IMAGE_EDIT_FAILED",
      "GPT 图像扩图失败",
      responseBody
    );
  }

  const encodedImage = extractGeneratedImage(responseBody);

  if (!encodedImage) {
    throw createOutpaintError(
      502,
      "OUTPAINT_IMAGE_EMPTY",
      "图像模型没有返回可显示的图片。"
    );
  }

  if (encodedImage.startsWith("http://") || encodedImage.startsWith("https://")) {
    return {
      dataUrl: encodedImage,
      mimeType: "image/png"
    };
  }

  return {
    dataUrl: encodedImage.startsWith("data:")
      ? encodedImage
      : `data:image/png;base64,${encodedImage}`,
    mimeType: "image/png",
    ...parseSize(input.outputSize)
  };
}

function parseDataImage(
  value: unknown,
  fieldName: string,
  requiredMimeType?: string
): ParsedDataImage {
  const dataUrl = requireText(
    value,
    "OUTPAINT_IMAGE_REQUIRED",
    `缺少 ${fieldName}。`
  );
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(dataUrl);

  if (!match) {
    throw createOutpaintError(
      400,
      "OUTPAINT_IMAGE_DATA_URL_INVALID",
      `${fieldName} 必须是 Base64 Data URL。`
    );
  }

  const mimeType = match[1]!.toLowerCase();

  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw createOutpaintError(
      400,
      "OUTPAINT_IMAGE_FORMAT_UNSUPPORTED",
      `${fieldName} 的图片格式不受支持。`
    );
  }

  if (requiredMimeType && mimeType !== requiredMimeType) {
    throw createOutpaintError(
      400,
      "OUTPAINT_IMAGE_FORMAT_INVALID",
      `${fieldName} 必须是 ${requiredMimeType}。`
    );
  }

  let buffer: Buffer;

  try {
    buffer = Buffer.from(match[2]!.replace(/\s/g, ""), "base64");
  } catch {
    throw createOutpaintError(
      400,
      "OUTPAINT_IMAGE_BASE64_INVALID",
      `${fieldName} 的 Base64 内容无效。`
    );
  }

  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
    throw createOutpaintError(
      400,
      "OUTPAINT_IMAGE_SIZE_INVALID",
      `${fieldName} 必须小于 30 MB。`
    );
  }

  return {
    mimeType,
    buffer,
    dataUrl
  };
}

function extractResponsesOutputText(body: UpstreamJson) {
  if (typeof body.output_text === "string" && body.output_text.trim()) {
    return body.output_text.trim();
  }

  const output = Array.isArray(body.output) ? body.output : [];

  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content) {
      if (
        isRecord(content) &&
        typeof content.text === "string" &&
        content.text.trim()
      ) {
        return content.text.trim();
      }
    }
  }

  return "";
}

function extractGeneratedImage(body: UpstreamJson) {
  const data = Array.isArray(body.data) ? body.data : [];
  const first = data[0];

  if (isRecord(first)) {
    if (typeof first.b64_json === "string" && first.b64_json.trim()) {
      return first.b64_json.trim();
    }

    if (typeof first.url === "string" && first.url.trim()) {
      return first.url.trim();
    }
  }

  const output = Array.isArray(body.output) ? body.output : [];

  for (const item of output) {
    if (!isRecord(item)) {
      continue;
    }

    if (typeof item.result === "string" && item.result.trim()) {
      return item.result.trim();
    }

    if (typeof item.b64_json === "string" && item.b64_json.trim()) {
      return item.b64_json.trim();
    }
  }

  return "";
}

export function normalizeOutputSize(value: unknown) {
  const outputSize = optionalText(value) ?? DEFAULT_OUTPUT_SIZE;
  const match = /^(\d{2,5})x(\d{2,5})$/i.exec(outputSize);

  if (!match) {
    throw createOutpaintError(
      400,
      "OUTPAINT_OUTPUT_SIZE_INVALID",
      "输出尺寸必须使用 WIDTHxHEIGHT 格式。"
    );
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  const totalPixels = width * height;
  const aspectRatio = Math.max(width / height, height / width);

  if (
    width > MAX_OUTPUT_EDGE ||
    height > MAX_OUTPUT_EDGE ||
    width % 16 !== 0 ||
    height % 16 !== 0 ||
    totalPixels < MIN_OUTPUT_PIXELS ||
    totalPixels > MAX_OUTPUT_PIXELS ||
    aspectRatio > MAX_OUTPUT_ASPECT_RATIO
  ) {
    throw createOutpaintError(
      400,
      "OUTPAINT_OUTPUT_SIZE_INVALID",
      "输出宽高必须是 16 的倍数且不超过 3840，总像素需在 655360 到 8294400 之间，宽高比不能超过 3:1。"
    );
  }

  return `${width}x${height}`;
}

function parseSize(value: string) {
  const [width, height] = value.split("x").map(Number);

  return {
    width,
    height
  };
}

function buildUpstreamURL(baseURL: string | undefined, path: string) {
  const root = optionalText(baseURL) ?? "https://api.openai.com";
  const normalized = normalizeExplicitURL(root)
    .replace(/\/v1\/responses$/i, "")
    .replace(/\/v1\/images\/(?:generations|edits)$/i, "")
    .replace(/\/+$/, "");

  if (/\/v1$/i.test(normalized)) {
    return `${normalized}/${path.replace(/^v1\//, "")}`;
  }

  return `${normalized}/${path}`;
}

function normalizeExplicitURL(value: string) {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw createOutpaintError(
      400,
      "OUTPAINT_ENDPOINT_INVALID",
      "API 端点不是有效 URL。"
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw createOutpaintError(
      400,
      "OUTPAINT_ENDPOINT_INVALID",
      "API 端点必须使用 HTTP 或 HTTPS。"
    );
  }

  return parsed.toString().replace(/\/$/, "");
}

function buildHeaders(apiKey: string, customHeaders?: Record<string, string>) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`
  };

  for (const [name, value] of Object.entries(customHeaders ?? {})) {
    if (
      typeof value === "string" &&
      value.trim() &&
      name.toLowerCase() !== "content-type" &&
      name.toLowerCase() !== "authorization"
    ) {
      headers[name] = value.trim();
    }
  }

  return headers;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw createOutpaintError(
        504,
        "OUTPAINT_UPSTREAM_TIMEOUT",
        "上游模型请求超时。"
      );
    }

    throw createOutpaintError(
      502,
      "OUTPAINT_UPSTREAM_UNREACHABLE",
      error instanceof Error ? error.message : "无法连接上游模型服务。"
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function readUpstreamJson(response: Response): Promise<UpstreamJson> {
  const text = await response.text();

  if (!text.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(text) as unknown;

    return isRecord(parsed) ? parsed : { value: parsed };
  } catch {
    return {
      rawText: text.slice(0, 1000)
    };
  }
}

function createUpstreamError(
  statusCode: number,
  code: string,
  title: string,
  body: UpstreamJson
) {
  const message = extractUpstreamErrorMessage(body) || title;

  return createOutpaintError(
    statusCode >= 400 && statusCode < 600 ? statusCode : 502,
    code,
    message,
    title
  );
}

function extractUpstreamErrorMessage(body: UpstreamJson) {
  if (isRecord(body.error) && typeof body.error.message === "string") {
    return body.error.message;
  }

  if (typeof body.message === "string") {
    return body.message;
  }

  if (typeof body.rawText === "string") {
    return body.rawText.slice(0, 300);
  }

  return "";
}

function createOutpaintError(
  statusCode: number,
  code: string,
  message: string,
  title = "画布扩图失败"
) {
  return Object.assign(new Error(message), {
    statusCode,
    code,
    title
  });
}

function isOutpaintError(error: unknown): error is Error & {
  statusCode: number;
  code: string;
  title: string;
} {
  return (
    error instanceof Error &&
    "statusCode" in error &&
    "code" in error &&
    "title" in error
  );
}

function sendOutpaintFailure(
  res: ExpressResponse,
  requestId: string,
  error: unknown
) {
  const statusCode = isOutpaintError(error) ? error.statusCode : 500;
  const normalized = createGenerationError({
    type:
      statusCode === 401
        ? "auth"
        : statusCode === 429
          ? "rate_limit"
          : statusCode >= 500
            ? "upstream"
            : "validation",
    code: isOutpaintError(error) ? error.code : "OUTPAINT_UNKNOWN_ERROR",
    title: isOutpaintError(error) ? error.title : "画布扩图失败",
    message:
      error instanceof Error && error.message
        ? error.message
        : "画布扩图流程发生未知错误。",
    retryable: statusCode >= 500 || statusCode === 429,
    statusCode
  });

  res.status(statusCode).json({
    success: false,
    error: normalized,
    requestId,
    serverTime: new Date().toISOString()
  });
}

function requireText(
  value: unknown,
  code: string,
  message: string
) {
  const normalized = optionalText(value);

  if (!normalized) {
    throw createOutpaintError(400, code, message);
  }

  return normalized;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
