import type {
  AdapterHttpRequest,
  AdapterRequestSummary,
  EndpointOverride,
  ModelConfig,
  ModelRequestOverride,
  UsageInfo
} from "../domain";
import {
  DEFAULT_REASONING_MAX_TOKENS,
  REASONING_DEFAULT_BASE_URL,
  getReasoningPlatform,
  type ReasoningApiStyle,
  type ReasoningPlatformId
} from "../config/reasoning";
import { getRecognitionRolePrompt } from "./recognition-service";
import { clampReasoningMaxTokens, type ReasoningEffort } from "./reasoning-service";
import type { RecognitionRole } from "./recognition-service";
import { base64ToDataUrl, stripDataUrlPrefix } from "../adapters/adapter-utils";
import { buildModelEndpointURL } from "./model-endpoint-service";
import { stripKnownEndpointSuffix } from "./model-endpoint-service";

export const RESPONSES_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;

export type ResponsesImageInput = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  base64?: string;
  remoteURL?: string;
  order: number;
};

export type RecognitionRequestPayload = {
  requestId?: string;
  modelId: string;
  role: RecognitionRole;
  question: string;
  images: ResponsesImageInput[];
  endpointOverride?: EndpointOverride;
  modelOverride?: ModelRequestOverride;
};

export type ReasoningRequestPayload = {
  requestId?: string;
  modelId: string;
  platform: string;
  modelName: string;
  effort: ReasoningEffort;
  maxTokens: number;
  prompt: string;
  referenceImages?: ResponsesImageInput[];
  apiStyle?: ReasoningApiStyle;
  wantSummary?: boolean;
  endpointOverride?: EndpointOverride;
  modelOverride?: ModelRequestOverride;
};

export type ResponsesRequestResult = {
  requestId: string;
  status: "success";
  modelId: string;
  modelName: string;
  endpoint: string;
  outputText: string;
  thinkingText?: string;
  usage?: UsageInfo;
  durationMs: number;
  requestPreview: Record<string, unknown>;
  rawResponseSummary?: unknown;
  adapterRequest?: AdapterRequestSummary;
};

export type ResponsesBody = Record<string, unknown>;

type TextContentPart = {
  type: "input_text";
  text: string;
};

type ImageContentPart = {
  type: "input_image";
  image_url: string;
};

type ChatTextContentPart = {
  type: "text";
  text: string;
};

type ChatImageContentPart = {
  type: "image_url";
  image_url: {
    url: string;
  };
};

type UtilityAdapterName =
  | "openai-responses"
  | "openai-chat-completions"
  | "anthropic-messages"
  | "gemini-generate-content";

export function buildRecognitionResponsesBody(input: {
  modelName: string;
  role: RecognitionRole;
  question: string;
  images: ResponsesImageInput[];
}): ResponsesBody {
  const question = input.question.trim() || "Analyze the uploaded images and return a structured result.";
  const imageParts = input.images.map((image) => ({
    type: "input_image" as const,
    image_url: imageToResponsesImageUrl(image)
  }));
  const content: Array<TextContentPart | ImageContentPart> = [
    {
      type: "input_text",
      text: [
        getRecognitionRolePrompt(input.role),
        "Return the answer in clear Chinese unless the user asks for another language.",
        `User question: ${question}`
      ].join("\n")
    },
    ...imageParts
  ];

  return {
    model: input.modelName,
    input: [
      {
        role: "user",
        content
      }
    ]
  };
}

export function buildRecognitionChatCompletionsBody(input: {
  modelName: string;
  role: RecognitionRole;
  question: string;
  images: ResponsesImageInput[];
}): ResponsesBody {
  const prompt = buildRecognitionPrompt(input.role, input.question);

  return {
    model: input.modelName,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt
          },
          ...input.images.map((image) => ({
            type: "image_url" as const,
            image_url: {
              url: imageToResponsesImageUrl(image)
            }
          }))
        ] satisfies Array<ChatTextContentPart | ChatImageContentPart>
      }
    ],
    temperature: 0.7,
    stream: false
  };
}

export function buildReasoningResponsesBody(input: {
  modelName: string;
  effort: ReasoningEffort;
  maxTokens: number;
  prompt: string;
  referenceImages?: ResponsesImageInput[];
  wantSummary?: boolean;
}): ResponsesBody {
  const prompt = input.prompt.trim() || "Analyze the problem and provide a concise, verifiable answer.";
  const maxTokens = clampResponsesMaxTokens(input.maxTokens || DEFAULT_REASONING_MAX_TOKENS);
  const images = input.referenceImages ?? [];
  const reasoning = buildOpenAIReasoningConfig(input.effort, input.wantSummary);

  if (images.length === 0) {
    return {
      model: input.modelName,
      input: prompt,
      ...(reasoning ? { reasoning } : {}),
      max_output_tokens: maxTokens
    };
  }

  return {
    model: input.modelName,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: prompt
          },
          ...images.map((image) => ({
            type: "input_image" as const,
            image_url: imageToResponsesImageUrl(image)
          }))
        ]
      }
    ],
    ...(reasoning ? { reasoning } : {}),
    max_output_tokens: maxTokens
  };
}

export function buildReasoningChatCompletionsBody(input: {
  modelName: string;
  effort: ReasoningEffort;
  maxTokens: number;
  prompt: string;
  referenceImages?: ResponsesImageInput[];
}): ResponsesBody {
  const prompt = input.prompt.trim() || "Analyze the problem and provide a concise, verifiable answer.";
  const images = input.referenceImages ?? [];
  const body: ResponsesBody = {
    model: input.modelName,
    messages: [
      {
        role: "user",
        content:
          images.length > 0
            ? ([
                {
                  type: "text",
                  text: prompt
                },
                ...images.map((image) => ({
                  type: "image_url" as const,
                  image_url: {
                    url: imageToResponsesImageUrl(image)
                  }
                }))
              ] satisfies Array<ChatTextContentPart | ChatImageContentPart>)
            : prompt
      }
    ],
    max_completion_tokens: clampResponsesMaxTokens(input.maxTokens || DEFAULT_REASONING_MAX_TOKENS),
    stream: false
  };

  if (input.effort !== "none") {
    body.reasoning_effort = input.effort;
  }

  return body;
}

export function buildReasoningAnthropicMessagesBody(input: {
  modelName: string;
  effort: ReasoningEffort;
  maxTokens: number;
  prompt: string;
  referenceImages?: ResponsesImageInput[];
  wantSummary?: boolean;
}): ResponsesBody {
  const prompt = input.prompt.trim() || "Analyze the problem and provide a concise, verifiable answer.";
  const images = input.referenceImages ?? [];
  const content =
    images.length > 0
      ? [
          {
            type: "text",
            text: prompt
          },
          ...images.map(imageToAnthropicImageContent)
        ]
      : prompt;
  const body: ResponsesBody = {
    model: input.modelName,
    max_tokens: clampResponsesMaxTokens(input.maxTokens || DEFAULT_REASONING_MAX_TOKENS),
    messages: [
      {
        role: "user",
        content
      }
    ],
    output_config: {
      effort: input.effort
    }
  };

  if (input.effort !== "none") {
    body.thinking = {
      type: "adaptive",
      display: input.wantSummary ? "summarized" : "full"
    };
  }

  return body;
}

export function buildReasoningGeminiGenerateContentBody(input: {
  effort: ReasoningEffort;
  maxTokens: number;
  prompt: string;
  referenceImages?: ResponsesImageInput[];
  wantSummary?: boolean;
}): ResponsesBody {
  const prompt = input.prompt.trim() || "Analyze the problem and provide a concise, verifiable answer.";
  const images = input.referenceImages ?? [];

  return {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: prompt
          },
          ...images.map(imageToGeminiPart)
        ]
      }
    ],
    generationConfig: {
      maxOutputTokens: clampResponsesMaxTokens(input.maxTokens || DEFAULT_REASONING_MAX_TOKENS),
      thinkingConfig: {
        thinkingBudget: effortToThinkingBudget(input.effort),
        includeThoughts: Boolean(input.wantSummary)
      }
    }
  };
}

export function buildResponsesHttpRequest(input: {
  model: ModelConfig;
  body: ResponsesBody;
  endpointOverride?: EndpointOverride;
}): AdapterHttpRequest {
  const endpointVariant = "responses";
  const apiKey = input.endpointOverride?.apiKey?.trim() ?? "";
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json"
  };

  if (input.model.request.authScheme === "Bearer") {
    headers[input.model.request.authHeaderName] = `Bearer ${apiKey}`;
  } else if (input.model.request.authScheme === "ApiKey") {
    headers[input.model.request.authHeaderName] = apiKey;
  }

  return {
    method: "POST",
    url: buildModelEndpointURL(
      input.model,
      input.endpointOverride?.baseURL ?? input.model.baseURL,
      "generation",
      endpointVariant
    ),
    headers: {
      ...headers,
      ...input.endpointOverride?.headers
    },
    body: input.body,
    contentType: "application/json",
    timeoutMs: RESPONSES_REQUEST_TIMEOUT_MS
  };
}

export function buildRecognitionHttpRequest(input: {
  model: ModelConfig;
  body: ResponsesBody;
  endpointOverride?: EndpointOverride;
}): AdapterHttpRequest {
  return {
    method: "POST",
    url: buildUtilityEndpointURL(input.endpointOverride?.baseURL ?? input.model.baseURL, "v1/chat/completions"),
    headers: {
      ...buildModelAuthHeaders(input.model, input.endpointOverride?.apiKey?.trim() ?? ""),
      ...input.endpointOverride?.headers
    },
    body: input.body,
    contentType: "application/json",
    timeoutMs: RESPONSES_REQUEST_TIMEOUT_MS
  };
}

export function buildReasoningHttpRequest(input: {
  model: ModelConfig;
  platform: string;
  modelName: string;
  effort: ReasoningEffort;
  maxTokens: number;
  prompt: string;
  referenceImages?: ResponsesImageInput[];
  apiStyle?: ReasoningApiStyle;
  wantSummary?: boolean;
  endpointOverride?: EndpointOverride;
}): AdapterHttpRequest {
  const platformId = normalizeReasoningPlatformId(input.platform);
  const apiStyle = normalizeReasoningApiStyle(platformId, input.apiStyle);
  const modelName = input.modelName.trim() || getReasoningPlatform(platformId).models[0]?.id || input.model.apiModelName;
  const common = {
    modelName,
    effort: input.effort,
    maxTokens: input.maxTokens,
    prompt: input.prompt,
    referenceImages: input.referenceImages,
    wantSummary: input.wantSummary
  };

  if (platformId === "anthropic") {
    return {
      method: "POST",
      url: buildUtilityEndpointURL(resolveUtilityEndpointPrefix(input), "v1/messages"),
      headers: {
        ...buildAnthropicHeaders(input.endpointOverride?.apiKey?.trim() ?? ""),
        ...input.endpointOverride?.headers
      },
      body: buildReasoningAnthropicMessagesBody(common),
      contentType: "application/json",
      timeoutMs: RESPONSES_REQUEST_TIMEOUT_MS
    };
  }

  if (platformId === "gemini") {
    return {
      method: "POST",
      url: buildUtilityEndpointURL(
        resolveUtilityEndpointPrefix(input),
        `v1beta/models/${encodeURIComponent(modelName)}:generateContent`
      ),
      headers: {
        ...buildGeminiHeaders(input.endpointOverride?.apiKey?.trim() ?? ""),
        ...input.endpointOverride?.headers
      },
      body: buildReasoningGeminiGenerateContentBody(common),
      contentType: "application/json",
      timeoutMs: RESPONSES_REQUEST_TIMEOUT_MS
    };
  }

  if (apiStyle === "chat-completions") {
    return {
      method: "POST",
      url: buildUtilityEndpointURL(resolveUtilityEndpointPrefix(input), "v1/chat/completions"),
      headers: {
        ...buildModelAuthHeaders(input.model, input.endpointOverride?.apiKey?.trim() ?? ""),
        ...input.endpointOverride?.headers
      },
      body: buildReasoningChatCompletionsBody(common),
      contentType: "application/json",
      timeoutMs: RESPONSES_REQUEST_TIMEOUT_MS
    };
  }

  return {
    method: "POST",
    url: buildUtilityEndpointURL(resolveUtilityEndpointPrefix(input), "v1/responses"),
    headers: {
      ...buildModelAuthHeaders(input.model, input.endpointOverride?.apiKey?.trim() ?? ""),
      ...input.endpointOverride?.headers
    },
    body: buildReasoningResponsesBody(common),
    contentType: "application/json",
    timeoutMs: RESPONSES_REQUEST_TIMEOUT_MS
  };
}

export function summarizeResponsesRequest(request: AdapterHttpRequest): AdapterRequestSummary {
  return summarizeUtilityRequest(request);
}

export function summarizeUtilityRequest(request: AdapterHttpRequest): AdapterRequestSummary {
  return {
    adapterName: detectUtilityAdapterName(request.url),
    method: request.method,
    url: request.url,
    requestModelName: extractUtilityRequestModelName(request.body),
    contentType: request.contentType,
    timeoutMs: request.timeoutMs,
    bodyFields: isRecord(request.body) ? Object.keys(request.body) : [],
    hasReferenceImages: countUtilityImages(request.body) > 0
  };
}

function extractUtilityRequestModelName(body: unknown) {
  if (!isRecord(body)) {
    return undefined;
  }

  return typeof body.model === "string" ? body.model : undefined;
}

export function parseResponsesTextResult(body: unknown) {
  const outputText = collectResponsesText(body).join("\n").trim();
  const usage = parseResponsesUsage(body);

  return {
    outputText,
    thinkingText: undefined,
    usage,
    rawResponseSummary: summarizeResponsesBody(body)
  };
}

export function parseUtilityTextResult(body: unknown, requestOrAdapter?: AdapterHttpRequest | UtilityAdapterName | string) {
  const adapterName =
    typeof requestOrAdapter === "string"
      ? requestOrAdapter
      : requestOrAdapter
        ? detectUtilityAdapterName(requestOrAdapter.url)
        : "openai-responses";

  if (adapterName === "openai-chat-completions") {
    return parseChatCompletionsTextResult(body);
  }

  if (adapterName === "anthropic-messages") {
    return parseAnthropicTextResult(body);
  }

  if (adapterName === "gemini-generate-content") {
    return parseGeminiTextResult(body);
  }

  return parseResponsesTextResult(body);
}

export function extractResponsesErrorCode(body: unknown) {
  const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
  const code = error?.code ?? (isRecord(body) ? body.code : undefined);

  return typeof code === "string" ? code : undefined;
}

export function extractResponsesErrorMessage(body: unknown) {
  const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
  const message = error?.message ?? (isRecord(body) ? body.message : undefined);

  return typeof message === "string" ? message : undefined;
}

export function imageToResponsesImageUrl(image: ResponsesImageInput) {
  if (image.remoteURL?.trim()) {
    return image.remoteURL.trim();
  }

  const base64 = image.base64?.trim() ?? "";

  if (!base64 || stripDataUrlPrefix(base64).replace(/\s/g, "").length === 0) {
    throw new Error(`Image ${image.name || image.id} is missing non-empty base64 data.`);
  }

  return base64ToDataUrl(base64, image.mimeType || "image/png");
}

export function clampResponsesMaxTokens(value: number) {
  return clampReasoningMaxTokens(value);
}

function buildRecognitionPrompt(role: RecognitionRole, questionValue: string) {
  const question = questionValue.trim() || "请详细分析图片内容，并输出结构化结果。";

  return [
    getRecognitionRolePrompt(role),
    "请使用中文回答；如果图片中有无法确认的内容，请明确说明不确定。",
    `用户问题：${question}`
  ].join("\n\n");
}

function buildOpenAIReasoningConfig(effort: ReasoningEffort, wantSummary?: boolean) {
  if (effort === "none") {
    return undefined;
  }

  return {
    effort,
    ...(wantSummary ? { summary: "auto" } : {})
  };
}

function normalizeReasoningPlatformId(value?: string): ReasoningPlatformId {
  return value === "anthropic" || value === "openai" || value === "gemini" ? value : "openai";
}

function normalizeReasoningApiStyle(
  platformId: ReasoningPlatformId,
  apiStyle?: ReasoningApiStyle
): ReasoningApiStyle {
  if (platformId !== "openai") {
    return "responses";
  }

  return apiStyle === "chat-completions" ? "chat-completions" : "responses";
}

function resolveUtilityEndpointPrefix(input: { endpointOverride?: EndpointOverride; model: ModelConfig }) {
  return input.endpointOverride?.baseURL ?? input.model.baseURL ?? REASONING_DEFAULT_BASE_URL;
}

function buildModelAuthHeaders(model: ModelConfig, apiKey: string) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json"
  };

  if (model.request.authScheme === "Bearer") {
    headers[model.request.authHeaderName] = `Bearer ${apiKey}`;
  } else if (model.request.authScheme === "ApiKey") {
    headers[model.request.authHeaderName] = apiKey;
  }

  return headers;
}

function buildAnthropicHeaders(apiKey: string) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    "x-api-key": apiKey
  };
}

function buildGeminiHeaders(apiKey: string) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey
  };
}

function buildUtilityEndpointURL(prefixOrURL: string | undefined, endpointPath: string) {
  return appendUtilityEndpointPath(stripKnownUtilityEndpointSuffix(prefixOrURL ?? ""), endpointPath);
}

function stripKnownUtilityEndpointSuffix(value: string) {
  const cleanValue = stripKnownEndpointSuffix(value);

  if (!cleanValue) {
    return "";
  }

  try {
    const parsed = new URL(cleanValue);
    parsed.pathname = stripUtilityPathSuffix(parsed.pathname);
    parsed.search = "";
    parsed.hash = "";

    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return stripUtilityPathSuffix(cleanValue).replace(/\/+$/, "");
  }
}

function stripUtilityPathSuffix(path: string) {
  return path
    .replace(/\/v1\/chat\/completions$/i, "")
    .replace(/\/v1\/messages$/i, "")
    .replace(/\/v1beta\/models\/[^/]+:generateContent$/i, "")
    .replace(/\/+$/, "");
}

function appendUtilityEndpointPath(prefix: string, endpointPath: string) {
  const cleanPrefix = prefix.trim().replace(/\/+$/, "");
  const endpointSegments = endpointPath.split("/").filter(Boolean);

  if (!cleanPrefix) {
    return `/${endpointSegments.join("/")}`;
  }

  try {
    const parsed = new URL(cleanPrefix);
    const prefixSegments = parsed.pathname.split("/").filter(Boolean);
    const overlap = countPathSegmentOverlap(prefixSegments, endpointSegments);
    parsed.pathname = `/${[...prefixSegments, ...endpointSegments.slice(overlap)].join("/")}`;
    parsed.search = "";
    parsed.hash = "";

    return parsed.toString();
  } catch {
    const prefixSegments = cleanPrefix.split("/").filter(Boolean);
    const overlap = countPathSegmentOverlap(prefixSegments, endpointSegments);

    return prefixSegments.concat(endpointSegments.slice(overlap)).join("/");
  }
}

function countPathSegmentOverlap(prefixSegments: string[], endpointSegments: string[]) {
  const maxOverlap = Math.min(prefixSegments.length, endpointSegments.length);

  for (let length = maxOverlap; length > 0; length -= 1) {
    const prefixTail = prefixSegments.slice(-length).map(normalizeSegment);
    const endpointHead = endpointSegments.slice(0, length).map(normalizeSegment);

    if (prefixTail.every((segment, index) => segment === endpointHead[index])) {
      return length;
    }
  }

  return 0;
}

function normalizeSegment(value: string) {
  return decodeURIComponent(value).toLowerCase();
}

function detectUtilityAdapterName(url: string): UtilityAdapterName {
  const normalizedURL = url.toLowerCase();

  if (normalizedURL.includes("/v1/chat/completions")) {
    return "openai-chat-completions";
  }

  if (normalizedURL.includes("/v1/messages")) {
    return "anthropic-messages";
  }

  if (normalizedURL.includes(":generatecontent")) {
    return "gemini-generate-content";
  }

  return "openai-responses";
}

function imageToAnthropicImageContent(image: ResponsesImageInput) {
  if (image.remoteURL?.trim()) {
    return {
      type: "image",
      source: {
        type: "url",
        url: image.remoteURL.trim()
      }
    };
  }

  const base64 = stripNonEmptyBase64(image);

  return {
    type: "image",
    source: {
      type: "base64",
      media_type: image.mimeType || "image/png",
      data: base64
    }
  };
}

function imageToGeminiPart(image: ResponsesImageInput) {
  if (image.remoteURL?.trim()) {
    return {
      fileData: {
        mimeType: image.mimeType || "image/png",
        fileUri: image.remoteURL.trim()
      }
    };
  }

  return {
    inlineData: {
      mimeType: image.mimeType || "image/png",
      data: stripNonEmptyBase64(image)
    }
  };
}

function stripNonEmptyBase64(image: ResponsesImageInput) {
  const base64 = stripDataUrlPrefix(image.base64?.trim() ?? "").replace(/\s/g, "");

  if (!base64) {
    throw new Error(`Image ${image.name || image.id} is missing non-empty base64 data.`);
  }

  return base64;
}

function effortToThinkingBudget(effort: ReasoningEffort) {
  const budget: Record<ReasoningEffort, number> = {
    none: 0,
    minimal: 256,
    low: 1024,
    medium: 4096,
    high: 8192,
    xhigh: 16000,
    max: 32000
  };

  return budget[effort] ?? budget.medium;
}

function collectResponsesText(body: unknown): string[] {
  if (!isRecord(body)) {
    return [];
  }

  const directText = typeof body.output_text === "string" ? [body.output_text] : [];
  const outputText = Array.isArray(body.output)
    ? body.output.flatMap((item) => {
        if (!isRecord(item)) {
          return [];
        }

        if (typeof item.text === "string") {
          return [item.text];
        }

        if (!Array.isArray(item.content)) {
          return [];
        }

        return item.content.flatMap((content) => {
          if (!isRecord(content)) {
            return [];
          }

          if (typeof content.text === "string") {
            return [content.text];
          }

          if (typeof content.output_text === "string") {
            return [content.output_text];
          }

          return [];
        });
      })
    : [];

  return [...directText, ...outputText].filter((value) => value.trim().length > 0);
}

function parseResponsesUsage(body: unknown): UsageInfo | undefined {
  if (!isRecord(body) || !isRecord(body.usage)) {
    return undefined;
  }

  const promptTokens = readNumber(body.usage.input_tokens);
  const completionTokens = readNumber(body.usage.output_tokens);
  const totalTokens = readNumber(body.usage.total_tokens);

  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) {
    return undefined;
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    imageCount: 0
  };
}

function parseChatCompletionsTextResult(body: unknown) {
  const outputText = collectChatCompletionsText(body).join("\n").trim();
  const thinkingText = collectChatCompletionsThinkingText(body).join("\n").trim();

  return {
    outputText,
    thinkingText: thinkingText || undefined,
    usage: parseChatCompletionsUsage(body),
    rawResponseSummary: summarizeChatCompletionsBody(body)
  };
}

function parseAnthropicTextResult(body: unknown) {
  const outputText = collectAnthropicText(body, false).join("\n").trim();
  const thinkingText = collectAnthropicText(body, true).join("\n").trim();

  return {
    outputText,
    thinkingText: thinkingText || undefined,
    usage: parseAnthropicUsage(body),
    rawResponseSummary: summarizeGenericBody(body, {
      hasOutputText: Boolean(outputText),
      hasThinkingText: Boolean(thinkingText)
    })
  };
}

function parseGeminiTextResult(body: unknown) {
  const outputText = collectGeminiText(body, false).join("\n").trim();
  const thinkingText = collectGeminiText(body, true).join("\n").trim();

  return {
    outputText,
    thinkingText: thinkingText || undefined,
    usage: parseGeminiUsage(body),
    rawResponseSummary: summarizeGenericBody(body, {
      hasOutputText: Boolean(outputText),
      hasThinkingText: Boolean(thinkingText)
    })
  };
}

function summarizeResponsesBody(body: unknown) {
  if (!isRecord(body)) {
    return typeof body;
  }

  return {
    fields: Object.keys(body),
    hasError: Boolean(body.error),
    hasOutputText: typeof body.output_text === "string" && body.output_text.trim().length > 0,
    outputCount: Array.isArray(body.output) ? body.output.length : 0
  };
}

function countResponsesImages(body: unknown) {
  if (!isRecord(body)) {
    return 0;
  }

  const input = body.input;

  if (!Array.isArray(input)) {
    return 0;
  }

  return input.reduce((total, item) => {
    if (!isRecord(item) || !Array.isArray(item.content)) {
      return total;
    }

    return total + item.content.filter((content) => isRecord(content) && content.type === "input_image").length;
  }, 0);
}

function countUtilityImages(body: unknown) {
  return countImageLikeParts(body);
}

function countImageLikeParts(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countImageLikeParts(item), 0);
  }

  if (!isRecord(value)) {
    return 0;
  }

  const self =
    value.type === "input_image" ||
    value.type === "image_url" ||
    value.type === "image" ||
    isRecord(value.inlineData) ||
    isRecord(value.fileData)
      ? 1
      : 0;

  return (
    self +
    Object.entries(value).reduce((total, [key, child]) => {
      if (key === "image_url" && isRecord(child) && typeof child.url === "string") {
        return total;
      }

      return total + countImageLikeParts(child);
    }, 0)
  );
}

function collectChatCompletionsText(body: unknown): string[] {
  if (!isRecord(body) || !Array.isArray(body.choices)) {
    return [];
  }

  return body.choices.flatMap((choice) => {
    if (!isRecord(choice) || !isRecord(choice.message)) {
      return [];
    }

    return collectMessageContentText(choice.message.content);
  });
}

function collectChatCompletionsThinkingText(body: unknown): string[] {
  if (!isRecord(body) || !Array.isArray(body.choices)) {
    return [];
  }

  return body.choices.flatMap((choice) => {
    if (!isRecord(choice) || !isRecord(choice.message)) {
      return [];
    }

    const reasoning = choice.message.reasoning_content ?? choice.message.reasoning ?? choice.message.thinking;

    return typeof reasoning === "string" && reasoning.trim() ? [reasoning] : [];
  });
}

function collectMessageContentText(content: unknown): string[] {
  if (typeof content === "string" && content.trim()) {
    return [content];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((part) => {
    if (!isRecord(part)) {
      return [];
    }

    if (typeof part.text === "string" && part.text.trim()) {
      return [part.text];
    }

    return [];
  });
}

function collectAnthropicText(body: unknown, thinkingOnly: boolean): string[] {
  if (!isRecord(body) || !Array.isArray(body.content)) {
    return [];
  }

  return body.content.flatMap((part) => {
    if (!isRecord(part)) {
      return [];
    }

    const isThinking = part.type === "thinking" || part.type === "redacted_thinking";
    const text = typeof part.text === "string" ? part.text : typeof part.thinking === "string" ? part.thinking : "";

    if (Boolean(isThinking) !== thinkingOnly || !text.trim()) {
      return [];
    }

    return [text];
  });
}

function collectGeminiText(body: unknown, thinkingOnly: boolean): string[] {
  if (!isRecord(body) || !Array.isArray(body.candidates)) {
    return [];
  }

  return body.candidates.flatMap((candidate) => {
    if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) {
      return [];
    }

    return candidate.content.parts.flatMap((part) => {
      if (!isRecord(part) || typeof part.text !== "string" || !part.text.trim()) {
        return [];
      }

      const isThinking = part.thought === true || part.type === "thinking";

      return Boolean(isThinking) === thinkingOnly ? [part.text] : [];
    });
  });
}

function parseChatCompletionsUsage(body: unknown): UsageInfo | undefined {
  if (!isRecord(body) || !isRecord(body.usage)) {
    return undefined;
  }

  return normalizeUsage({
    promptTokens: readNumber(body.usage.prompt_tokens),
    completionTokens: readNumber(body.usage.completion_tokens),
    totalTokens: readNumber(body.usage.total_tokens)
  });
}

function parseAnthropicUsage(body: unknown): UsageInfo | undefined {
  if (!isRecord(body) || !isRecord(body.usage)) {
    return undefined;
  }

  return normalizeUsage({
    promptTokens: readNumber(body.usage.input_tokens),
    completionTokens: readNumber(body.usage.output_tokens)
  });
}

function parseGeminiUsage(body: unknown): UsageInfo | undefined {
  if (!isRecord(body) || !isRecord(body.usageMetadata)) {
    return undefined;
  }

  return normalizeUsage({
    promptTokens: readNumber(body.usageMetadata.promptTokenCount),
    completionTokens: readNumber(body.usageMetadata.candidatesTokenCount),
    totalTokens: readNumber(body.usageMetadata.totalTokenCount)
  });
}

function normalizeUsage(input: {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}): UsageInfo | undefined {
  const totalTokens =
    input.totalTokens ??
    (input.promptTokens !== undefined && input.completionTokens !== undefined
      ? input.promptTokens + input.completionTokens
      : undefined);

  if (input.promptTokens === undefined && input.completionTokens === undefined && totalTokens === undefined) {
    return undefined;
  }

  return {
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    totalTokens,
    imageCount: 0
  };
}

function summarizeChatCompletionsBody(body: unknown) {
  if (!isRecord(body)) {
    return typeof body;
  }

  return {
    fields: Object.keys(body),
    hasError: Boolean(body.error),
    choiceCount: Array.isArray(body.choices) ? body.choices.length : 0,
    hasOutputText: collectChatCompletionsText(body).length > 0,
    hasThinkingText: collectChatCompletionsThinkingText(body).length > 0
  };
}

function summarizeGenericBody(body: unknown, extra: Record<string, unknown>) {
  if (!isRecord(body)) {
    return typeof body;
  }

  return {
    fields: Object.keys(body),
    hasError: Boolean(body.error),
    ...extra
  };
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
