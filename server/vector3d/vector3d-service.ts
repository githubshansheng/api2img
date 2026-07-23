import type {
  GenerateVector3DViewRequest,
  GenerateVector3DViewResult,
  Vector3DCameraParameters,
  Vector3DRepairAnalysis
} from "../../src/domain";
import { VECTOR3D_VIEW_LIMITS } from "../../src/domain";
import { findInvalidHeaderValueCharacter } from "../../src/services/http-header-service";
import { stripKnownEndpointSuffix } from "../../src/services/model-endpoint-service";

const DEFAULT_OPENAI_ROOT = "https://api.openai.com";
const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const REASONING_TIMEOUT_MS = 10 * 60 * 1000;
const IMAGE_EDIT_TIMEOUT_MS = 30 * 60 * 1000;

type ParsedDataURL = {
  mimeType: string;
  bytes: Uint8Array<ArrayBuffer>;
};

type NormalizedRequest = GenerateVector3DViewRequest & {
  endpoint_override: NonNullable<GenerateVector3DViewRequest["endpoint_override"]> & {
    apiKey: string;
  };
};

export class Vector3DServiceError extends Error {
  statusCode: number;
  code: string;
  retryable: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { retryable?: boolean } = {}
  ) {
    super(message);
    this.name = "Vector3DServiceError";
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = options.retryable ?? (statusCode >= 500 || statusCode === 429);
  }
}

export async function generateVector3DView(
  input: Partial<GenerateVector3DViewRequest>,
  onStage?: (input: {
    stage: "reasoning" | "rendering";
    message: string;
    analysis?: Vector3DRepairAnalysis;
  }) => void,
  signal?: AbortSignal
): Promise<GenerateVector3DViewResult> {
  throwIfAborted(signal);
  const startedAt = Date.now();
  const request = validateGenerateVector3DViewRequest(input);
  const sourceImage = parseImageDataURL(request.source_image, "source_image");
  const draftImage = parseImageDataURL(request.draft_image, "draft_image");
  const endpoints = resolveVector3DEndpoints(request.endpoint_override);
  const requestHeaders = buildRequestHeaders(request.endpoint_override);

  onStage?.({
    stage: "reasoning",
    message: `${request.reasoning_model} 正在分析三维几何、遮挡关系与形变补偿`
  });

  const reasoningStartedAt = Date.now();
  const reasoningResponse = await requestJSON(endpoints.responses, {
    method: "POST",
    headers: {
      ...requestHeaders,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildSpatialReasoningRequest(request)),
    timeoutMs: REASONING_TIMEOUT_MS,
    label: "空间推理",
    signal
  });
  throwIfAborted(signal);
  const analysis = parseSpatialReasoningResponse(reasoningResponse);
  const reasoningDurationMs = Date.now() - reasoningStartedAt;

  throwIfAborted(signal);
  onStage?.({
    stage: "rendering",
    message: `${request.image_model} 正在以 Gaussian 代理草图为镜头锚点重塑材质与隐藏区域`,
    analysis
  });
  throwIfAborted(signal);

  const renderingStartedAt = Date.now();
  const editForm = buildImageEditForm({
    request,
    analysis,
    sourceImage,
    draftImage
  });
  const imageResponse = await requestJSON(endpoints.imageEdits, {
    method: "POST",
    headers: buildRequestHeaders(request.endpoint_override, true),
    body: editForm,
    timeoutMs: IMAGE_EDIT_TIMEOUT_MS,
    label: "图像重塑",
    signal
  });
  throwIfAborted(signal);
  const renderedImage = parseImageEditResponse(imageResponse);
  const renderingDurationMs = Date.now() - renderingStartedAt;

  return {
    requestId: request.requestId,
    image: renderedImage.image,
    imageMimeType: renderedImage.mimeType,
    optimizedPrompt: analysis.optimizedPrompt,
    viewDescription: analysis.viewDescription,
    repairNotes: analysis.repairNotes,
    reasoningModel: request.reasoning_model,
    imageModel: request.image_model,
    reasoningDurationMs,
    renderingDurationMs,
    totalDurationMs: Date.now() - startedAt
  };
}

export function validateGenerateVector3DViewRequest(
  input: Partial<GenerateVector3DViewRequest>
): NormalizedRequest {
  const requestId = input.requestId?.trim() || crypto.randomUUID();
  const sourceImage = requireString(input.source_image, "source_image");
  const draftImage = requireString(input.draft_image, "draft_image");
  const source = parseImageDataURL(sourceImage, "source_image");
  const draft = parseImageDataURL(draftImage, "draft_image");

  if (source.bytes.byteLength > VECTOR3D_VIEW_LIMITS.sourceImageBytes) {
    throw new Vector3DServiceError(
      413,
      "VECTOR3D_SOURCE_TOO_LARGE",
      "原始参考图超过 20 MB 限制。"
    );
  }

  if (draft.bytes.byteLength > VECTOR3D_VIEW_LIMITS.draftImageBytes) {
    throw new Vector3DServiceError(
      413,
      "VECTOR3D_DRAFT_TOO_LARGE",
      "Gaussian 代理草图超过 20 MB 限制。"
    );
  }

  if (source.bytes.byteLength + draft.bytes.byteLength > VECTOR3D_VIEW_LIMITS.combinedImageBytes) {
    throw new Vector3DServiceError(
      413,
      "VECTOR3D_IMAGES_TOO_LARGE",
      "两张输入图片合计超过 32 MB 限制。"
    );
  }

  const apiKey = input.endpoint_override?.apiKey?.trim();

  if (!apiKey) {
    throw new Vector3DServiceError(
      400,
      "API_KEY_REQUIRED",
      "缺少 API Key，请先在设置中保存主 Key 或当前图片编辑模型的 Key。"
    );
  }

  return {
    requestId,
    source_image: sourceImage,
    draft_image: draftImage,
    camera_parameters: validateCameraParameters(input.camera_parameters),
    reasoning_model: requireString(input.reasoning_model, "reasoning_model"),
    image_model: requireString(input.image_model, "image_model"),
    endpoint_override: {
      ...input.endpoint_override,
      apiKey,
      headers: sanitizeHeaders(input.endpoint_override?.headers)
    }
  };
}

export function buildSpatialReasoningRequest(request: GenerateVector3DViewRequest) {
  const camera = request.camera_parameters;
  const cameraSummary = [
    `yaw=${camera.yaw.toFixed(2)} degrees`,
    `pitch=${camera.pitch.toFixed(2)} degrees`,
    `distance=${camera.distance.toFixed(4)}`,
    `position=(${formatNumber(camera.position.x)}, ${formatNumber(camera.position.y)}, ${formatNumber(camera.position.z)})`,
    `rotationEuler=(${formatNumber(camera.rotation.x)}, ${formatNumber(camera.rotation.y)}, ${formatNumber(camera.rotation.z)})`,
    `viewport=${camera.viewport.width}x${camera.viewport.height}`
  ].join("; ");

  return {
    model: request.reasoning_model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "You are a senior 3D reconstruction supervisor and image-editing prompt engineer.",
              "Image 1 is the original high-fidelity identity and material reference. Image 2 is a rough render from an image-derived Gaussian proxy captured at a new virtual camera viewpoint.",
              `Camera parameters: ${cameraSummary}.`,
              "The proxy is generated from Image 1 pixels with heuristic shallow depth, edge, and foreground priors. It provides approximate camera direction, framing, pose, silhouette, and visible depth cues; it is not authoritative photogrammetry or hidden-surface geometry.",
              "Analyze the subject's exact identity, markings, typography, materials, local geometry, lighting cues, and scale. Determine the semantic viewpoint represented by the draft. Locate proxy holes, stretched ellipsoids, floaters, noise, missing back-side texture, broken silhouettes, paper-thin regions, and implausible proxy geometry.",
              `Write an English production prompt for the configured image editing model (${request.image_model}). Use Image 2 as the camera, framing, pose, and approximate silhouette anchor while using Image 1 as the authoritative identity, material, color, logo, and photographic-quality reference. Infer occluded and hidden surfaces conservatively from object semantics and visible geometry instead of copying proxy artifacts. Preserve all legible text and brand marks exactly. Remove every Gaussian proxy artifact without changing the intended camera viewpoint or subject proportions.`,
              "Target a polished cinematic photorealistic 16:9 image. The redraw should be medium strength, approximately 0.45: enough to reconstruct defects and lighting, but not enough to drift from the draft geometry.",
              "Return only the requested JSON fields."
            ].join("\n\n")
          },
          {
            type: "input_image",
            image_url: request.source_image,
            detail: "original"
          },
          {
            type: "input_image",
            image_url: request.draft_image,
            detail: "original"
          }
        ]
      }
    ],
    reasoning: {
      effort: "high"
    },
    text: {
      format: {
        type: "json_schema",
        name: "vector3d_repair_plan",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            optimized_prompt: {
              type: "string"
            },
            view_description: {
              type: "string"
            },
            repair_notes: {
              type: "array",
              items: {
                type: "string"
              }
            }
          },
          required: ["optimized_prompt", "view_description", "repair_notes"]
        }
      }
    },
    max_output_tokens: 5000
  };
}

export function parseSpatialReasoningResponse(body: unknown): Vector3DRepairAnalysis {
  const outputText = extractResponseOutputText(body);

  if (!outputText) {
    throw new Vector3DServiceError(
      502,
      "VECTOR3D_REASONING_EMPTY",
      "空间推理模型没有返回修复提示词。",
      { retryable: true }
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(stripJSONFence(outputText));
  } catch {
    throw new Vector3DServiceError(
      502,
      "VECTOR3D_REASONING_INVALID_JSON",
      "空间推理模型返回的修复计划不是合法 JSON。",
      { retryable: true }
    );
  }

  if (!isRecord(parsed)) {
    throw new Vector3DServiceError(502, "VECTOR3D_REASONING_INVALID", "空间修复计划结构无效。");
  }

  const optimizedPrompt = requireString(parsed.optimized_prompt, "optimized_prompt");
  const viewDescription = requireString(parsed.view_description, "view_description");
  const repairNotes = Array.isArray(parsed.repair_notes)
    ? parsed.repair_notes.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];

  return {
    optimizedPrompt,
    viewDescription,
    repairNotes
  };
}

export function buildImageEditPrompt(
  analysis: Vector3DRepairAnalysis,
  camera: Vector3DCameraParameters
) {
  return [
    analysis.optimizedPrompt,
    "",
    "REFERENCE ORDER AND NON-NEGOTIABLE CONSTRAINTS:",
    "Image 1 is a rough image-derived Gaussian proxy draft. Preserve its intended camera perspective, yaw, pitch, pose, framing, object placement, approximate silhouette, and visible-side proportions.",
    "Image 2 is the original high-resolution reference. Preserve its subject identity, exact materials, colors, surface details, logos, labels, typography, and lighting character.",
    "The proxy is only an approximate camera and depth guide, not authoritative hidden-surface geometry. Infer occluded surfaces from the source identity and object semantics; never copy stretched splats, paper-thin layers, holes, or invented proxy geometry.",
    `The virtual camera is yaw ${camera.yaw.toFixed(2)} degrees and pitch ${camera.pitch.toFixed(2)} degrees.`,
    "Use a medium redraw strength equivalent to approximately 0.45. Reconstruct holes, stretched splats, floaters, noisy edges, missing textures, and occluded back-side surfaces, but do not redesign or rotate the subject away from the intended proxy camera.",
    "Output one seamless, artifact-free, cinematic photorealistic 16:9 frame. Do not add captions, watermarks, new text, extra objects, duplicate parts, or invented branding."
  ].join("\n");
}

export function parseImageEditResponse(body: unknown) {
  const record = isRecord(body) ? body : {};
  const data = Array.isArray(record.data) ? record.data : [];
  const first = isRecord(data[0]) ? data[0] : undefined;
  const b64 = first ? first.b64_json : undefined;
  const url = first ? first.url : undefined;

  if (typeof b64 === "string" && b64.trim()) {
    return {
      image: `data:image/png;base64,${b64.trim()}`,
      mimeType: "image/png"
    };
  }

  if (typeof url === "string" && url.trim()) {
    return {
      image: url.trim(),
      mimeType: "image/png"
    };
  }

  const output = Array.isArray(record.output) ? record.output : [];
  const outputItem = isRecord(output[0]) ? output[0] : undefined;
  const result = outputItem?.result;

  if (typeof result === "string" && result.trim()) {
    return {
      image: result.startsWith("data:") ? result : `data:image/png;base64,${result.trim()}`,
      mimeType: "image/png"
    };
  }

  throw new Vector3DServiceError(
    502,
    "VECTOR3D_IMAGE_EMPTY",
    "图片编辑模型已返回响应，但没有找到可用的图像结果。",
    { retryable: true }
  );
}

export function resolveVector3DEndpoints(
  endpointOverride: GenerateVector3DViewRequest["endpoint_override"]
) {
  const responsesBase = endpointOverride?.baseURL || DEFAULT_OPENAI_ROOT;
  const imageEditsBase = endpointOverride?.editURL || endpointOverride?.baseURL || DEFAULT_OPENAI_ROOT;

  return {
    responses: appendEndpointPath(responsesBase, "v1/responses"),
    imageEdits: appendEndpointPath(imageEditsBase, "v1/images/edits")
  };
}

export function buildImageEditForm(input: {
  request: NormalizedRequest;
  analysis: Vector3DRepairAnalysis;
  sourceImage: ParsedDataURL;
  draftImage: ParsedDataURL;
}) {
  const form = new FormData();
  form.append("model", input.request.image_model);
  form.append(
    "prompt",
    buildImageEditPrompt(input.analysis, input.request.camera_parameters)
  );
  form.append(
    "image[]",
    new Blob([input.draftImage.bytes], { type: input.draftImage.mimeType }),
    extensionFilename("draft", input.draftImage.mimeType)
  );
  form.append(
    "image[]",
    new Blob([input.sourceImage.bytes], { type: input.sourceImage.mimeType }),
    extensionFilename("source", input.sourceImage.mimeType)
  );
  form.append("quality", "high");
  form.append("size", "2048x1152");
  form.append("output_format", "png");

  return form;
}

function parseImageDataURL(value: string, field: string): ParsedDataURL {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(value);

  if (!match) {
    throw new Vector3DServiceError(
      400,
      "VECTOR3D_IMAGE_DATA_URL_INVALID",
      `${field} 必须是 Base64 图片 Data URL。`
    );
  }

  const mimeType = match[1]?.toLowerCase() ?? "";

  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Vector3DServiceError(
      400,
      "VECTOR3D_IMAGE_TYPE_UNSUPPORTED",
      `${field} 仅支持 PNG、JPEG 或 WebP。`
    );
  }

  const base64 = (match[2] ?? "").replace(/\s+/g, "");
  const buffer = Buffer.from(base64, "base64");

  if (buffer.byteLength === 0) {
    throw new Vector3DServiceError(
      400,
      "VECTOR3D_IMAGE_EMPTY",
      `${field} 不包含有效图片数据。`
    );
  }

  return {
    mimeType,
    bytes: Uint8Array.from(buffer)
  };
}

function validateCameraParameters(value: unknown): Vector3DCameraParameters {
  if (!isRecord(value)) {
    throw new Vector3DServiceError(400, "VECTOR3D_CAMERA_REQUIRED", "缺少相机参数。");
  }

  const yaw = requireFiniteNumber(value.yaw, "camera_parameters.yaw");
  const pitch = requireFiniteNumber(value.pitch, "camera_parameters.pitch");
  const distance = requireFiniteNumber(value.distance, "camera_parameters.distance");

  if (yaw < -180 || yaw > 180) {
    throw new Vector3DServiceError(400, "VECTOR3D_YAW_INVALID", "Yaw 必须在 -180° 到 180° 之间。");
  }

  if (pitch < -90 || pitch > 90) {
    throw new Vector3DServiceError(400, "VECTOR3D_PITCH_INVALID", "Pitch 必须在 -90° 到 90° 之间。");
  }

  if (distance <= 0) {
    throw new Vector3DServiceError(400, "VECTOR3D_DISTANCE_INVALID", "相机距离必须大于 0。");
  }

  return {
    yaw,
    pitch,
    distance,
    position: validatePoint(value.position, "camera_parameters.position"),
    rotation: validatePoint(value.rotation, "camera_parameters.rotation"),
    viewport: validateViewport(value.viewport)
  };
}

function validatePoint(value: unknown, field: string) {
  if (!isRecord(value)) {
    throw new Vector3DServiceError(400, "VECTOR3D_CAMERA_INVALID", `${field} 无效。`);
  }

  return {
    x: requireFiniteNumber(value.x, `${field}.x`),
    y: requireFiniteNumber(value.y, `${field}.y`),
    z: requireFiniteNumber(value.z, `${field}.z`)
  };
}

function validateViewport(value: unknown) {
  if (!isRecord(value)) {
    throw new Vector3DServiceError(400, "VECTOR3D_VIEWPORT_INVALID", "相机视口尺寸无效。");
  }

  const width = Math.floor(requireFiniteNumber(value.width, "camera_parameters.viewport.width"));
  const height = Math.floor(requireFiniteNumber(value.height, "camera_parameters.viewport.height"));

  if (width < 1 || height < 1 || width > 8192 || height > 8192) {
    throw new Vector3DServiceError(400, "VECTOR3D_VIEWPORT_INVALID", "相机视口尺寸超出有效范围。");
  }

  return { width, height };
}

function extractResponseOutputText(body: unknown) {
  if (!isRecord(body)) {
    return undefined;
  }

  if (typeof body.output_text === "string" && body.output_text.trim()) {
    return body.output_text;
  }

  if (Array.isArray(body.output)) {
    for (const item of body.output) {
      if (!isRecord(item) || !Array.isArray(item.content)) {
        continue;
      }

      for (const content of item.content) {
        if (isRecord(content) && typeof content.text === "string" && content.text.trim()) {
          return content.text;
        }
      }
    }
  }

  const choices = Array.isArray(body.choices) ? body.choices : [];
  const firstChoice = isRecord(choices[0]) ? choices[0] : undefined;
  const message = firstChoice && isRecord(firstChoice.message) ? firstChoice.message : undefined;

  return typeof message?.content === "string" ? message.content : undefined;
}

async function requestJSON(
  url: string,
  input: {
    method: "POST";
    headers: Record<string, string>;
    body: string | FormData;
    timeoutMs: number;
    label: string;
    signal?: AbortSignal;
  }
) {
  const controller = new AbortController();
  let timedOut = false;
  const handleExternalAbort = () => {
    controller.abort(input.signal?.reason);
  };

  if (input.signal?.aborted) {
    handleExternalAbort();
  } else {
    input.signal?.addEventListener("abort", handleExternalAbort, { once: true });
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, input.timeoutMs);

  try {
    const response = await fetch(url, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      signal: controller.signal
    });
    const text = await response.text();
    const body = parseJSONOrText(text);

    if (!response.ok) {
      const upstreamMessage = extractUpstreamErrorMessage(body);
      const statusCode = response.status === 401 || response.status === 403 || response.status === 429
        ? response.status
        : 502;

      throw new Vector3DServiceError(
        statusCode,
        `VECTOR3D_${input.label === "空间推理" ? "REASONING" : "IMAGE"}_UPSTREAM_${response.status}`,
        `${input.label}上游请求失败：${upstreamMessage || `HTTP ${response.status}`}`,
        { retryable: response.status === 429 || response.status >= 500 }
      );
    }

    return body;
  } catch (error) {
    if (error instanceof Vector3DServiceError) {
      throw error;
    }

    if (controller.signal.aborted) {
      if (!timedOut && input.signal?.aborted) {
        throw new Vector3DServiceError(
          499,
          "VECTOR3D_REQUEST_ABORTED",
          `${input.label}请求已取消。`,
          { retryable: false }
        );
      }

      throw new Vector3DServiceError(
        504,
        "VECTOR3D_UPSTREAM_TIMEOUT",
        `${input.label}请求超时。`,
        { retryable: true }
      );
    }

    throw new Vector3DServiceError(
      502,
      "VECTOR3D_UPSTREAM_UNREACHABLE",
      `${input.label}无法连接上游服务。`,
      { retryable: true }
    );
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", handleExternalAbort);
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Vector3DServiceError(
      499,
      "VECTOR3D_REQUEST_ABORTED",
      "3D 视角重塑请求已取消。",
      { retryable: false }
    );
  }
}

function buildRequestHeaders(
  endpointOverride: NonNullable<GenerateVector3DViewRequest["endpoint_override"]>,
  omitContentType = false
) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${endpointOverride.apiKey?.trim() ?? ""}`,
    ...sanitizeHeaders(endpointOverride.headers)
  };

  if (omitContentType) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "content-type") {
        delete headers[key];
      }
    }
  }

  for (const [name, value] of Object.entries(headers)) {
    if (findInvalidHeaderValueCharacter(value)) {
      throw new Vector3DServiceError(
        400,
        "VECTOR3D_HEADER_INVALID",
        `请求头 ${name} 包含非法字符。`
      );
    }
  }

  return headers;
}

function sanitizeHeaders(value: unknown) {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([name, item]) => Boolean(name.trim()) && typeof item === "string")
      .map(([name, item]) => [name.trim(), String(item)])
  );
}

function appendEndpointPath(value: string, endpointPath: string) {
  const prefix = stripKnownEndpointSuffix(value || DEFAULT_OPENAI_ROOT);
  const cleanPrefix = prefix.replace(/\/+$/, "");
  const endpointSegments = endpointPath.split("/").filter(Boolean);

  try {
    const parsed = new URL(cleanPrefix);
    const prefixSegments = parsed.pathname.split("/").filter(Boolean);
    const overlap = countSegmentOverlap(prefixSegments, endpointSegments);
    parsed.pathname = `/${[...prefixSegments, ...endpointSegments.slice(overlap)].join("/")}`;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    const prefixSegments = cleanPrefix.split("/").filter(Boolean);
    const overlap = countSegmentOverlap(prefixSegments, endpointSegments);
    return [...prefixSegments, ...endpointSegments.slice(overlap)].join("/");
  }
}

function countSegmentOverlap(prefix: string[], endpoint: string[]) {
  for (let length = Math.min(prefix.length, endpoint.length); length > 0; length -= 1) {
    const left = prefix.slice(-length).map((item) => item.toLowerCase());
    const right = endpoint.slice(0, length).map((item) => item.toLowerCase());

    if (left.every((item, index) => item === right[index])) {
      return length;
    }
  }

  return 0;
}

function parseJSONOrText(text: string) {
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { rawText: text.slice(0, 500) };
  }
}

function extractUpstreamErrorMessage(body: unknown) {
  if (!isRecord(body)) {
    return "";
  }

  const error = isRecord(body.error) ? body.error : undefined;

  if (typeof error?.message === "string") {
    return error.message;
  }

  if (typeof body.message === "string") {
    return body.message;
  }

  if (typeof body.rawText === "string") {
    return body.rawText;
  }

  return "";
}

function extensionFilename(prefix: string, mimeType: string) {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1] || "png";
  return `${prefix}.${extension}`;
}

function stripJSONFence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function requireString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Vector3DServiceError(400, "VECTOR3D_FIELD_REQUIRED", `${field} 不能为空。`);
  }

  return value.trim();
}

function requireFiniteNumber(value: unknown, field: string) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    throw new Vector3DServiceError(400, "VECTOR3D_NUMBER_INVALID", `${field} 必须是有效数字。`);
  }

  return numberValue;
}

function formatNumber(value: number) {
  return Number(value).toFixed(5);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
