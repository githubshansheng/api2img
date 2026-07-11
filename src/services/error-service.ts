import type { ErrorType, GenerationError, ModelConfig } from "../domain";

type ErrorModelContext = Pick<ModelConfig, "id" | "apiModelName" | "featureFlags">;

type CreateGenerationErrorInput = {
  type: ErrorType;
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
};

type NormalizeGenerationErrorInput = {
  statusCode?: number;
  upstreamCode?: string;
  upstreamMessage?: string;
  model?: ErrorModelContext;
  rawBody?: unknown;
  finishReason?: string;
  field?: string;
  signal?: "network" | "timeout" | "temporary_url_expired";
};

type ErrorMapping = {
  type: ErrorType;
  title: string;
  message: string;
  suggestion: string;
  retryable: boolean;
  mayHaveCharged: boolean;
};

const SENSITIVE_VALUE_PATTERN =
  /(sk-[A-Za-z0-9_-]{6,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,}|api[_-]?key["'\s:=]+[A-Za-z0-9._~+/=-]{6,})/gi;

export function normalizeGenerationError(input: NormalizeGenerationErrorInput): GenerationError {
  const statusCode = input.statusCode;
  const upstreamCode = sanitizeErrorText(input.upstreamCode ?? codeForSignal(input.signal) ?? String(statusCode ?? "UNKNOWN_ERROR"), 80);
  const mapping = mapError(input, upstreamCode);
  const message = sanitizeErrorText(input.upstreamMessage, 260) || mapping.message;
  const safeDetails = buildSafeDetails({
    statusCode,
    type: mapping.type,
    code: upstreamCode,
    modelId: input.model?.id,
    requestModelName: input.model?.apiModelName,
    finishReason: input.finishReason,
    field: input.field
  });

  return createGenerationError({
    type: mapping.type,
    code: upstreamCode,
    title: mapping.title,
    message,
    suggestion: mapping.suggestion,
    retryable: mapping.retryable,
    mayHaveCharged: mapping.mayHaveCharged,
    statusCode,
    upstreamStatus: statusCode,
    upstreamCode,
    finishReason: input.finishReason,
    field: input.field,
    safeDetails,
    rawExcerpt: summarizeRawBody(input.rawBody)
  });
}

export function createGenerationError(input: CreateGenerationErrorInput): GenerationError {
  const statusCode = input.statusCode ?? input.upstreamStatus;

  return {
    id: createRuntimeId(),
    type: input.type,
    code: sanitizeErrorText(input.code, 80) || "UNKNOWN_ERROR",
    title: input.title,
    message: sanitizeErrorText(input.message, 320) || "生成请求失败。",
    suggestion: input.suggestion ? sanitizeErrorText(input.suggestion, 320) : undefined,
    retryable: input.retryable,
    mayHaveCharged: input.mayHaveCharged ?? defaultChargeRisk(input.type, statusCode),
    statusCode,
    upstreamStatus: input.upstreamStatus ?? statusCode,
    upstreamCode: input.upstreamCode ? sanitizeErrorText(input.upstreamCode, 80) : undefined,
    finishReason: input.finishReason ? sanitizeErrorText(input.finishReason, 80) : undefined,
    field: input.field,
    safeDetails: input.safeDetails ? sanitizeErrorText(input.safeDetails, 500) : undefined,
    rawExcerpt: input.rawExcerpt ? sanitizeErrorText(input.rawExcerpt, 500) : undefined,
    createdAt: Date.now()
  };
}

export function maskApiKey(value: string) {
  if (!value) {
    return "";
  }

  if (value.length <= 8) {
    return "****";
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function sanitizeErrorText(value: unknown, maxLength = 240) {
  if (typeof value !== "string") {
    return "";
  }

  const masked = value
    .replace(SENSITIVE_VALUE_PATTERN, (match) => {
      const key = match.replace(/^Bearer\s+/i, "").replace(/^api[_-]?key["'\s:=]+/i, "");
      return match.toLowerCase().startsWith("bearer") ? `Bearer ${maskApiKey(key)}` : maskApiKey(key);
    })
    .replace(/[\r\n\t]+/g, " ")
    .trim();

  return masked.length > maxLength ? `${masked.slice(0, maxLength - 3)}...` : masked;
}

function mapError(input: NormalizeGenerationErrorInput, upstreamCode: string): ErrorMapping {
  if (input.signal === "temporary_url_expired") {
    return {
      type: "storage",
      title: "图片链接已失效",
      message: "结果图片的临时链接已经过期，无法继续访问。",
      suggestion: "请重新生成，或在结果可见时及时下载保存。",
      retryable: false,
      mayHaveCharged: false
    };
  }

  if (input.signal === "timeout" || upstreamCode === "UPSTREAM_TIMEOUT") {
    return {
      type: "network",
      title: "生成请求超时",
      message: "等待上游图片生成服务返回时超时。",
      suggestion: "请稍后重试；如果参考图较多，可以减少参考图或降低复杂度。",
      retryable: true,
      mayHaveCharged: false
    };
  }

  if (
    input.signal === "network" ||
    upstreamCode === "UPSTREAM_REQUEST_FAILED" ||
    /failed to fetch|fetch failed|network/i.test(input.upstreamMessage ?? "")
  ) {
    return {
      type: "network",
      title: "连接中断",
      message: "无法连接上游图片生成服务，生成未完成。",
      suggestion: "请检查网络、baseUrl 前缀和代理配置，稍后再重试。",
      retryable: true,
      mayHaveCharged: false
    };
  }

  if (input.finishReason) {
    return mapFinishReason(input.finishReason);
  }

  if (input.statusCode === 400) {
    return {
      type: "validation",
      title: "请求参数错误",
      message: "上游认为请求参数不合法，生成未完成。",
      suggestion: "请检查提示词、参考图、尺寸、分辨率、质量和 API 端点是否匹配。",
      retryable: false,
      mayHaveCharged: false
    };
  }

  if (input.statusCode === 401) {
    return {
      type: "auth",
      title: "API Key 认证失败",
      message: "上游拒绝了当前 API Key。",
      suggestion: "请检查 Key 是否正确、是否过期，或是否配置在当前模型上。",
      retryable: false,
      mayHaveCharged: false
    };
  }

  if (input.statusCode === 402 || /quota|insufficient|billing|balance/i.test(upstreamCode)) {
    return {
      type: "quota",
      title: "额度或余额不足",
      message: "当前账号可能没有足够额度完成本次生成。",
      suggestion: "请检查账户余额、计费状态或切换到有额度的模型配置。",
      retryable: false,
      mayHaveCharged: false
    };
  }

  if (input.statusCode === 403) {
    return {
      type: "permission",
      title: "访问权限不足",
      message: "当前账号没有权限调用该模型或端点。",
      suggestion: "请检查模型开通状态、账户分组、API Key 权限和 baseUrl 配置。",
      retryable: false,
      mayHaveCharged: true
    };
  }

  if (input.statusCode === 429) {
    const shouldSuggestEnterpriseGroup = input.model?.featureFlags.requiresEnterpriseGroupOnRateLimit;

    return {
      type: "rate_limit",
      title: shouldSuggestEnterpriseGroup ? "出图失败异常" : "请求过于频繁",
      message: "上游限制了当前请求频率或当前模型分组。",
      suggestion: shouldSuggestEnterpriseGroup
        ? "可能需要切换到 image2Enterprise 企业分组；也可以稍后重试或降低并发。"
        : "请稍后重试，或降低并发、切换到其它可用模型。",
      retryable: true,
      mayHaveCharged: true
    };
  }

  if (input.statusCode === 500) {
    return {
      type: "upstream",
      title: "服务器内部错误",
      message: "上游服务处理生成请求时发生内部错误。",
      suggestion: "请稍后重试；如果持续失败，可以切换模型或简化输入。",
      retryable: true,
      mayHaveCharged: true
    };
  }

  if (input.statusCode && [502, 503, 504].includes(input.statusCode)) {
    return {
      type: "upstream",
      title: "服务暂时不可用",
      message: "上游服务暂时不可用或网关返回异常。",
      suggestion: "请稍后重试；如果多次失败，请检查 baseUrl 前缀和上游服务状态。",
      retryable: true,
      mayHaveCharged: false
    };
  }

  if (input.statusCode && input.statusCode >= 400 && input.statusCode < 500) {
    return {
      type: "validation",
      title: "请求被上游拒绝",
      message: "上游拒绝了当前生成请求。",
      suggestion: "请检查请求参数、模型名、端点和账号权限。",
      retryable: false,
      mayHaveCharged: false
    };
  }

  if (input.statusCode && input.statusCode >= 500) {
    return {
      type: "upstream",
      title: "上游生成失败",
      message: "上游服务返回错误，生成未完成。",
      suggestion: "请稍后重试，或切换模型后再次生成。",
      retryable: true,
      mayHaveCharged: true
    };
  }

  return {
    type: "unknown",
    title: "生成失败",
    message: "生成请求失败，暂时无法判断具体原因。",
    suggestion: "请检查网络、模型配置和输入参数后重试。",
    retryable: true,
    mayHaveCharged: false
  };
}

function mapFinishReason(finishReason: string): ErrorMapping {
  if (finishReason === "PROHIBITED_CONTENT") {
    return {
      type: "safety",
      title: "违禁内容",
      message: "上游安全策略拒绝了本次图片生成。",
      suggestion: "请调整提示词，避免违法、暴力、成人或受保护内容。",
      retryable: false,
      mayHaveCharged: true
    };
  }

  if (finishReason === "SAFETY") {
    return {
      type: "safety",
      title: "安全过滤",
      message: "上游安全过滤阻止了图片输出。",
      suggestion: "请弱化敏感描述，明确合法、安全的生成意图。",
      retryable: false,
      mayHaveCharged: true
    };
  }

  if (finishReason === "RECITATION") {
    return {
      type: "safety",
      title: "引用限制",
      message: "上游判断提示词可能复现受保护内容。",
      suggestion: "请改写提示词，避免要求复刻具体作品、角色或受保护图像。",
      retryable: false,
      mayHaveCharged: true
    };
  }

  if (finishReason === "MAX_TOKENS") {
    return {
      type: "upstream",
      title: "Token 超限",
      message: "上游输出达到限制，图片未能完整返回。",
      suggestion: "请缩短输入、减少参考图或降低生成复杂度后重试。",
      retryable: true,
      mayHaveCharged: true
    };
  }

  return {
    type: "upstream",
    title: "未生成图片",
    message: "上游返回了文本或空结果，没有返回图片。",
    suggestion: "请在提示词中明确要求生成或编辑图片。",
    retryable: true,
    mayHaveCharged: true
  };
}

function codeForSignal(signal?: NormalizeGenerationErrorInput["signal"]) {
  if (signal === "network") {
    return "UPSTREAM_REQUEST_FAILED";
  }

  if (signal === "timeout") {
    return "UPSTREAM_TIMEOUT";
  }

  if (signal === "temporary_url_expired") {
    return "TEMPORARY_URL_EXPIRED";
  }

  return undefined;
}

function buildSafeDetails(input: {
  statusCode?: number;
  type: ErrorType;
  code: string;
  modelId?: string;
  requestModelName?: string;
  finishReason?: string;
  field?: string;
}) {
  return [
    input.statusCode ? `status=${input.statusCode}` : undefined,
    `type=${input.type}`,
    `code=${input.code}`,
    input.requestModelName || input.modelId ? `model=${input.requestModelName ?? input.modelId}` : undefined,
    input.modelId && input.requestModelName && input.modelId !== input.requestModelName
      ? `modelId=${input.modelId}`
      : undefined,
    input.finishReason ? `finishReason=${input.finishReason}` : undefined,
    input.field ? `field=${input.field}` : undefined
  ]
    .filter(Boolean)
    .join("; ");
}

function summarizeRawBody(body: unknown) {
  if (body === undefined || body === null) {
    return undefined;
  }

  if (typeof body === "string") {
    return sanitizeErrorText(body, 500);
  }

  if (typeof body !== "object") {
    return sanitizeErrorText(String(body), 160);
  }

  const record = body as Record<string, unknown>;
  const fields = Object.keys(record).slice(0, 12).join(",");
  const error = typeof record.error === "object" && record.error !== null ? (record.error as Record<string, unknown>) : undefined;
  const rawText = typeof record.rawText === "string" ? sanitizeErrorText(record.rawText, 220) : undefined;
  const errorCode = sanitizeErrorText(error?.code, 80);
  const errorMessage = sanitizeErrorText(error?.message, 220);
  const errorDetails = sanitizeErrorText(error?.details, 220);

  return [
    fields ? `fields=${fields}` : undefined,
    errorCode ? `error.code=${errorCode}` : undefined,
    errorMessage ? `error.message=${errorMessage}` : undefined,
    errorDetails ? `error.details=${errorDetails}` : undefined,
    rawText ? `rawText=${rawText}` : undefined
  ]
    .filter(Boolean)
    .join("; ");
}

function defaultChargeRisk(type: ErrorType, statusCode?: number) {
  if (type === "safety") {
    return true;
  }

  if (type === "rate_limit" || type === "permission") {
    return true;
  }

  if (type === "upstream" && statusCode === 500) {
    return true;
  }

  return false;
}

function createRuntimeId() {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
