import type {
  AdapterHttpRequest,
  AdapterHttpResponse,
  AdapterRequestSummary,
  AdapterResult,
  CurlBuildOptions,
  GeneratedImage,
  GenerationError,
  GenerationRequestDraft,
  ModelConfig,
  PreparedReferenceImage,
  RequestStatus
} from "../domain";
import {
  createGenerationError as createMappedGenerationError,
  normalizeGenerationError
} from "../services/error-service";
import { buildModelEndpointURL } from "../services/model-endpoint-service";

const DATA_URL_PREFIX_PATTERN = /^data:([^;]+);base64,/i;

type PathToken = {
  key: string;
  array: boolean;
};

export function buildJsonHeaders(draft: GenerationRequestDraft): Record<string, string> {
  const apiKey = draft.endpointOverride?.apiKey ?? draft.apiKey ?? "{{API_KEY}}";
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json"
  };

  if (draft.model.request.authScheme === "Bearer") {
    headers[draft.model.request.authHeaderName] = `Bearer ${apiKey}`;
  } else if (draft.model.request.authScheme === "ApiKey") {
    headers[draft.model.request.authHeaderName] = apiKey;
  }

  return {
    ...headers,
    ...draft.endpointOverride?.headers
  };
}

export function buildPromptWithParamHints(draft: GenerationRequestDraft, forceHints = false) {
  const prompt = draft.prompt.trim();

  if (!forceHints) {
    return prompt;
  }

  const hints = buildPromptParamHints(draft);

  if (hints.length === 0) {
    return prompt;
  }

  return `${prompt ? `${prompt}\n\n` : ""}参数要求：${hints.join("；")}。`;
}

function buildPromptParamHints(draft: GenerationRequestDraft) {
  const hints: string[] = [
    `画幅比例 ${optionLabel(draft.model.capabilities.ratios, draft.params.ratio)}`,
    `请求分辨率 ${optionLabel(draft.model.capabilities.resolutions, draft.params.resolution)}`,
    `图片质量 ${optionLabel(draft.model.capabilities.qualities, draft.params.quality)}`
  ];
  const outputFormat = normalizeImageOutputFormat(draft.params.outputFormat);

  if (outputFormat) {
    hints.push(`输出格式 ${outputFormat.toUpperCase()}`);
  }

  if (draft.params.outputCompression !== undefined) {
    hints.push(`输出压缩 ${draft.params.outputCompression}`);
  }

  if (draft.params.background) {
    hints.push(`背景 ${openAIBackgroundLabel(draft.params.background)}`);
  }

  if (draft.params.seed !== undefined) {
    hints.push(`随机种子 ${draft.params.seed}`);
  }

  if (draft.params.stylePreset?.trim()) {
    hints.push(`风格 ${draft.params.stylePreset.trim()}`);
  }

  if (draft.params.partialImages !== undefined) {
    hints.push(`流式预览 ${draft.params.partialImages}`);
  }

  Object.entries(draft.params.customParams ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      hints.push(`${key} ${formatPromptParamValue(value)}`);
    }
  });

  return hints;
}

function optionLabel<T extends { key: string; label?: string }>(options: T[], value: string) {
  return options.find((option) => option.key === value)?.label ?? value;
}

function openAIBackgroundLabel(value: NonNullable<GenerationRequestDraft["params"]["background"]>) {
  return (
    {
      auto: "自动",
      transparent: "透明",
      opaque: "不透明"
    } satisfies Record<typeof value, string>
  )[value];
}

function formatPromptParamValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function ratioToOpenAISize(draft: GenerationRequestDraft) {
  if (
    draft.params.ratio === "auto" &&
    draft.params.resolution === "auto"
  ) {
    return undefined;
  }

  if (draft.model.request.omitFields.includes("size")) {
    return undefined;
  }

  if (
    draft.model.temporaryRestrictions.some(
      (restriction) =>
        restriction.enabled &&
        (restriction.type === "size_disabled" || restriction.affectedFields.includes("ratio"))
    )
  ) {
    return undefined;
  }

  if (draft.model.featureFlags.sizeByPromptOnly) {
    return undefined;
  }

  if (isGptImage2Model(draft.model)) {
    return sizeForGptImage2(draft.params.resolution, draft.params.ratio);
  }

  return sizeForResolutionAndOrientation(draft.params.resolution, orientationForRatio(draft.params.ratio));
}

export function stripDataUrlPrefix(value: string) {
  return value.replace(DATA_URL_PREFIX_PATTERN, "");
}

export function base64ToDataUrl(base64: string, mimeType = "image/png") {
  if (DATA_URL_PREFIX_PATTERN.test(base64)) {
    return base64;
  }

  return `data:${mimeType};base64,${base64}`;
}

export function referenceToTransportValue(reference: PreparedReferenceImage) {
  if (reference.remoteURL) {
    return {
      type: "url",
      url: reference.remoteURL,
      mime_type: reference.mimeType,
      name: reference.name
    };
  }

  return {
    type: "base64",
    data: reference.base64 ?? "",
    mime_type: reference.mimeType,
    name: reference.name
  };
}

export function extractValuesByPath(source: unknown, path: string): unknown[] {
  const tokens = parsePath(path);
  let values: unknown[] = [source];

  for (const token of tokens) {
    const nextValues: unknown[] = [];

    for (const value of values) {
      if (!isRecord(value)) {
        continue;
      }

      const child = value[token.key];

      if (token.array) {
        if (Array.isArray(child)) {
          nextValues.push(...child);
        } else if (child !== undefined && child !== null) {
          nextValues.push(child);
        }
      } else if (child !== undefined && child !== null) {
        nextValues.push(child);
      }
    }

    values = nextValues;
  }

  return values;
}

export function extractStringValues(source: unknown, paths: string[]) {
  return paths
    .flatMap((path) => extractValuesByPath(source, path))
    .flatMap((value) => extractStringLeaves(value))
    .filter((value) => value.trim().length > 0);
}

export function extractFirstString(source: unknown, paths: string[]) {
  return extractStringValues(source, paths)[0];
}

export function extractFirstNumber(source: unknown, paths: string[]) {
  for (const value of paths.flatMap((path) => extractValuesByPath(source, path))) {
    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number(value);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

export function parseConfiguredImageResponse(
  response: AdapterHttpResponse,
  draft: GenerationRequestDraft,
  emptyErrorTitle = "未返回图片"
): AdapterResult {
  if (response.statusCode >= 400) {
    return failedResult(draft, response, createUpstreamError(response, draft));
  }

  const images = collectGeneratedImages(response.body, draft);

  if (images.length === 0) {
    return failedResult(
      draft,
      response,
      createGenerationError({
        type: "upstream",
        code: "NO_IMAGE",
        title: emptyErrorTitle,
        message: "上游响应中没有解析到可用图片。",
        suggestion: "请确认提示词明确要求生成或编辑图片，也可以更换模型后重试。",
        retryable: true,
        mayHaveCharged: true,
        statusCode: response.statusCode,
        upstreamStatus: response.statusCode
      })
    );
  }

  return {
    requestId: draft.requestId,
    status: statusForImageCount(images.length, draft.params.count),
    images,
    rawResponseSummary: summarizeResponse(response.body),
    usage: {
      totalTokens: extractFirstNumber(response.body, draft.model.response.tokenCountPaths),
      imageCount: images.length
    },
    durationMs: response.durationMs
  };
}

export function collectGeneratedImages(body: unknown, draft: GenerationRequestDraft): GeneratedImage[] {
  const urlValues = extractStringValues(body, draft.model.response.imageUrlPaths);
  const base64Values = extractStringValues(body, draft.model.response.imageBase64Paths);
  const images: GeneratedImage[] = [];

  urlValues.forEach((url) => {
    images.push(createGeneratedUrlImage(draft, url, images.length));
  });

  base64Values.forEach((base64) => {
    images.push(createGeneratedBase64Image(draft, base64, images.length));
  });

  return images;
}

export function createGeneratedUrlImage(draft: GenerationRequestDraft, url: string, index: number): GeneratedImage {
  const ttl = draft.model.response.temporaryUrlTTLSeconds;
  const format = normalizeImageOutputFormat(draft.params.outputFormat);

  return {
    id: `${draft.requestId}-image-${index}`,
    sourceType: "url",
    url,
    mimeType: mimeTypeForOutputFormat(format),
    format,
    index,
    temporary: Boolean(ttl) || draft.model.response.resultRequiresImmediateSave,
    expiresAt: ttl ? new Date(Date.now() + ttl * 1000).toISOString() : undefined,
    saved: false
  };
}

export function createGeneratedBase64Image(draft: GenerationRequestDraft, base64: string, index: number): GeneratedImage {
  const cleanBase64 = stripDataUrlPrefix(base64);
  const format = normalizeImageOutputFormat(draft.params.outputFormat);
  const dimensions = readImageDimensionsFromBase64(cleanBase64);

  return {
    id: `${draft.requestId}-image-${index}`,
    sourceType: "base64",
    url: base64ToDataUrl(cleanBase64, mimeTypeForOutputFormat(format)),
    base64: cleanBase64,
    mimeType: mimeTypeForOutputFormat(format),
    width: dimensions?.width,
    height: dimensions?.height,
    format,
    index,
    temporary: false,
    saved: false
  };
}

export function readImageDimensionsFromBase64(base64: string) {
  const bytes = decodeBase64Header(base64);

  if (!bytes) {
    return undefined;
  }

  return readPngDimensions(bytes) ?? readJpegDimensions(bytes) ?? readWebpDimensions(bytes);
}

const MAX_DIMENSION_HEADER_BYTES = 512 * 1024;

function decodeBase64Header(base64: string) {
  const cleanBase64 = stripDataUrlPrefix(base64).replace(/\s/g, "");

  if (!cleanBase64 || typeof globalThis.atob !== "function") {
    return undefined;
  }

  const maxChars = Math.ceil(MAX_DIMENSION_HEADER_BYTES / 3) * 4;
  const sliceLength = Math.min(cleanBase64.length, maxChars);
  const alignedLength = sliceLength - (sliceLength % 4);

  if (alignedLength <= 0) {
    return undefined;
  }

  try {
    const binary = globalThis.atob(cleanBase64.slice(0, alignedLength));
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  } catch {
    return undefined;
  }
}

function readPngDimensions(bytes: Uint8Array) {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    ascii(bytes, 12, 4) !== "IHDR"
  ) {
    return undefined;
  }

  const width = readUInt32BE(bytes, 16);
  const height = readUInt32BE(bytes, 20);

  return width > 0 && height > 0 ? { width, height } : undefined;
}

function readJpegDimensions(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return undefined;
  }

  let offset = 2;

  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    while (bytes[offset] === 0xff) {
      offset += 1;
    }

    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    if (offset + 2 > bytes.length) {
      break;
    }

    const segmentLength = readUInt16BE(bytes, offset);

    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      break;
    }

    if (isJpegStartOfFrame(marker) && offset + 7 < bytes.length) {
      const height = readUInt16BE(bytes, offset + 3);
      const width = readUInt16BE(bytes, offset + 5);

      return width > 0 && height > 0 ? { width, height } : undefined;
    }

    offset += segmentLength;
  }

  return undefined;
}

function isJpegStartOfFrame(marker: number) {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function readWebpDimensions(bytes: Uint8Array) {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") {
    return undefined;
  }

  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const chunkType = ascii(bytes, offset, 4);
    const chunkSize = readUInt32LE(bytes, offset + 4);
    const payloadOffset = offset + 8;

    if (payloadOffset + chunkSize > bytes.length) {
      break;
    }

    if (chunkType === "VP8X" && chunkSize >= 10) {
      const width = 1 + readUInt24LE(bytes, payloadOffset + 4);
      const height = 1 + readUInt24LE(bytes, payloadOffset + 7);

      return width > 0 && height > 0 ? { width, height } : undefined;
    }

    if (chunkType === "VP8L" && chunkSize >= 5 && bytes[payloadOffset] === 0x2f) {
      const b0 = bytes[payloadOffset + 1];
      const b1 = bytes[payloadOffset + 2];
      const b2 = bytes[payloadOffset + 3];
      const b3 = bytes[payloadOffset + 4];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));

      return width > 0 && height > 0 ? { width, height } : undefined;
    }

    if (
      chunkType === "VP8 " &&
      chunkSize >= 10 &&
      bytes[payloadOffset + 3] === 0x9d &&
      bytes[payloadOffset + 4] === 0x01 &&
      bytes[payloadOffset + 5] === 0x2a
    ) {
      const width = readUInt16LE(bytes, payloadOffset + 6) & 0x3fff;
      const height = readUInt16LE(bytes, payloadOffset + 8) & 0x3fff;

      return width > 0 && height > 0 ? { width, height } : undefined;
    }

    offset = payloadOffset + chunkSize + (chunkSize % 2);
  }

  return undefined;
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function readUInt16BE(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUInt16LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUInt24LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUInt32BE(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] * 0x1000000 +
    ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  );
}

function readUInt32LE(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] * 0x1000000)
  );
}

export function normalizeImageOutputFormat(format: GenerationRequestDraft["params"]["outputFormat"] = "png") {
  return format === "jpg" ? "jpeg" : format;
}

export function mimeTypeForOutputFormat(format: ReturnType<typeof normalizeImageOutputFormat>) {
  return format === "jpeg" ? "image/jpeg" : `image/${format}`;
}

export function createUpstreamError(response: AdapterHttpResponse, draft: GenerationRequestDraft) {
  const upstreamCode = extractFirstString(response.body, draft.model.response.errorCodePaths) ?? String(response.statusCode);
  const upstreamMessage =
    extractFirstString(response.body, draft.model.response.errorMessagePaths) ?? "上游服务返回错误，生成未完成。";

  return normalizeGenerationError({
    statusCode: response.statusCode,
    upstreamCode,
    upstreamMessage,
    model: draft.model,
    rawBody: response.body
  });
}

export function createGenerationError(input: {
  type: GenerationError["type"];
  code: string;
  title: string;
  message: string;
  suggestion?: string;
  retryable: boolean;
  mayHaveCharged?: boolean;
  statusCode?: number;
  upstreamStatus?: number;
  upstreamCode?: string;
  finishReason?: string;
  field?: string;
  safeDetails?: string;
  rawExcerpt?: string;
}): GenerationError {
  return createMappedGenerationError(input);
}

export function failedResult(
  draft: GenerationRequestDraft,
  response: AdapterHttpResponse,
  error: GenerationError
): AdapterResult {
  return {
    requestId: draft.requestId,
    status: "failed",
    images: [],
    rawResponseSummary: summarizeResponse(response.body),
    usage: {
      totalTokens: extractFirstNumber(response.body, draft.model.response.tokenCountPaths),
      imageCount: 0
    },
    durationMs: response.durationMs,
    error
  };
}

export function summarizeAdapterRequest(
  adapterName: string,
  request: AdapterHttpRequest,
  draft: GenerationRequestDraft
): AdapterRequestSummary {
  return {
    adapterName,
    method: request.method,
    url: request.url,
    requestModelName: draft.model.apiModelName,
    contentType: request.contentType,
    timeoutMs: request.timeoutMs,
    bodyFields: isRecord(request.body) ? Object.keys(request.body) : [],
    hasReferenceImages: draft.referenceImages.length > 0
  };
}

export function buildCurlForRequest(request: AdapterHttpRequest, options: CurlBuildOptions) {
  const maskedHeaders = Object.fromEntries(
    Object.entries(request.headers).map(([key, value]) => [
      key,
      key.toLowerCase() === "authorization" && !options.showRealKey ? `Bearer ${options.placeholderKey}` : value
    ])
  );
  const headerLines = Object.entries(maskedHeaders)
    .map(([key, value]) => `  -H ${quoteShell(`${key}: ${value}`)}`)
    .join(" \\\n");
  const body = typeof request.body === "string" ? request.body : JSON.stringify(request.body, null, options.pretty ? 2 : 0);

  return [`curl -X ${request.method} ${quoteShell(request.url)}`, headerLines, `  -d ${quoteShell(body)}`]
    .filter(Boolean)
    .join(" \\\n");
}

export function summarizeResponse(body: unknown) {
  if (!isRecord(body)) {
    return typeof body;
  }

  return {
    fields: Object.keys(body),
    hasError: Boolean(body.error),
    hasData: Boolean(body.data),
    hasCandidates: Boolean(body.candidates)
  };
}

export function endpointURL(model: ModelConfig, draft: GenerationRequestDraft, preferEditEndpoint = false) {
  const endpointVariant = draft.endpointOverride?.endpointVariant;

  if (preferEditEndpoint && draft.referenceImages.length > 0) {
    if (draft.endpointOverride?.editURL || draft.endpointOverride?.baseURL) {
      return buildModelEndpointURL(model, draft.endpointOverride.editURL ?? draft.endpointOverride.baseURL, "edit");
    }

    return model.editURL ?? model.baseURL;
  }

  if (draft.endpointOverride?.baseURL || endpointVariant) {
    return buildModelEndpointURL(
      model,
      draft.endpointOverride?.baseURL ?? model.baseURL,
      "generation",
      endpointVariant
    );
  }

  return model.baseURL;
}

function orientationForRatio(ratio: GenerationRequestDraft["params"]["ratio"]) {
  if (ratio === "auto" || ratio === "1:1") {
    return "square";
  }

  const [width, height] = ratio.split(":").map(Number);

  return width < height ? "portrait" : "landscape";
}

const GPT_IMAGE_2_MIN_PIXELS = 655_360;
const GPT_IMAGE_2_MAX_PIXELS = 8_294_400;
const GPT_IMAGE_2_MAX_EDGE = 3_840;
const GPT_IMAGE_2_MAX_ASPECT_RATIO = 3;

function isGptImage2Model(model: ModelConfig) {
  return [model.id, model.apiModelName].some((value) => {
    const normalized = value.trim().toLowerCase();

    return normalized === "gpt-image-2" || normalized.startsWith("gpt-image-2-");
  });
}

function sizeForGptImage2(
  resolution: GenerationRequestDraft["params"]["resolution"],
  ratio: GenerationRequestDraft["params"]["ratio"]
) {
  const resolvedRatio = ratio === "auto" ? "1:1" : ratio;
  const [rawWidthRatio, rawHeightRatio] = resolvedRatio.split(":").map(Number);

  if (!rawWidthRatio || !rawHeightRatio) {
    return undefined;
  }

  const aspectRatio = Math.max(rawWidthRatio / rawHeightRatio, rawHeightRatio / rawWidthRatio);

  if (aspectRatio > GPT_IMAGE_2_MAX_ASPECT_RATIO) {
    return undefined;
  }

  const divisor = greatestCommonDivisor(rawWidthRatio, rawHeightRatio);
  const widthStep = 16 * (rawWidthRatio / divisor);
  const heightStep = 16 * (rawHeightRatio / divisor);
  const longStep = Math.max(widthStep, heightStep);
  const shortStep = Math.min(widthStep, heightStep);
  const resolvedResolution = resolution === "auto" ? "1K" : resolution;
  let multiplier: number;

  if (resolvedResolution === "0.5K") {
    multiplier = Math.ceil(Math.sqrt(GPT_IMAGE_2_MIN_PIXELS / (widthStep * heightStep)));
  } else if (resolvedResolution === "1K") {
    const targetShortEdgeMultiplier = Math.max(1, Math.round(1024 / shortStep));
    const standardLongEdgeMultiplier = Math.max(1, Math.floor(1536 / longStep));
    multiplier = Math.min(targetShortEdgeMultiplier, standardLongEdgeMultiplier);
  } else if (resolvedResolution === "2K") {
    multiplier = Math.max(1, Math.floor(2048 / longStep));
  } else {
    const edgeMultiplier = Math.max(1, Math.floor(GPT_IMAGE_2_MAX_EDGE / longStep));
    const pixelMultiplier = Math.max(
      1,
      Math.floor(Math.sqrt(GPT_IMAGE_2_MAX_PIXELS / (widthStep * heightStep)))
    );
    multiplier = Math.min(edgeMultiplier, pixelMultiplier);
  }

  const width = widthStep * multiplier;
  const height = heightStep * multiplier;
  const pixels = width * height;

  if (
    width > GPT_IMAGE_2_MAX_EDGE ||
    height > GPT_IMAGE_2_MAX_EDGE ||
    pixels < GPT_IMAGE_2_MIN_PIXELS ||
    pixels > GPT_IMAGE_2_MAX_PIXELS
  ) {
    return undefined;
  }

  return `${width}x${height}`;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);

  while (b !== 0) {
    [a, b] = [b, a % b];
  }

  return a || 1;
}

function sizeForResolutionAndOrientation(
  resolution: GenerationRequestDraft["params"]["resolution"],
  orientation: "square" | "portrait" | "landscape"
) {
  const resolvedResolution = resolution === "auto" ? "1K" : resolution;
  const sizes: Record<Exclude<typeof resolvedResolution, "auto">, Record<typeof orientation, string>> = {
    "0.5K": {
      square: "832x832",
      landscape: "1024x640",
      portrait: "640x1024"
    },
    "1K": {
      square: "1024x1024",
      landscape: "1536x1024",
      portrait: "1024x1536"
    },
    "2K": {
      square: "2048x2048",
      landscape: "2048x1152",
      portrait: "1152x2048"
    },
    "4K": {
      square: "2880x2880",
      landscape: "3840x2160",
      portrait: "2160x3840"
    }
  };

  return sizes[resolvedResolution][orientation];
}

function parsePath(path: string): PathToken[] {
  return path
    .split(".")
    .filter(Boolean)
    .map((part) => ({
      key: part.endsWith("[]") ? part.slice(0, -2) : part,
      array: part.endsWith("[]")
    }));
}

function extractStringLeaves(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractStringLeaves(item));
  }

  return [];
}

function statusForImageCount(imageCount: number, requestedCount: number): RequestStatus {
  if (imageCount <= 0) {
    return "failed";
  }

  if (requestedCount > 1 && imageCount < requestedCount) {
    return "partial_success";
  }

  return "success";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function quoteShell(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
