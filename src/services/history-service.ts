import type {
  ApiError,
  CreateGenerationResponse,
  GeneratedImage,
  GenerationError,
  GenerationHistoryRecord,
  GenerationParams,
  RequestStatus,
  UsageInfo
} from "../domain";
import { sanitizeErrorText } from "./error-service";

const HISTORY_STORAGE_KEY = "api2image:history:v1";
const MAX_HISTORY_RECORDS = 50;
const PROMPT_SUMMARY_LENGTH = 120;
const MAX_STORED_BASE64_CHARS = 160_000;

export type HistoryListItem = {
  id: string;
  requestId: string;
  modelDisplayName: string;
  promptSummary?: string;
  thumbnailURL?: string;
  status: RequestStatus;
  imageCount: number;
  costText?: string;
  durationMs?: number;
  archived: boolean;
  temporary: boolean;
  expiresAt?: string;
  createdAt: string;
};

export type CreateHistoryRecordInput = {
  requestId: string;
  status: RequestStatus;
  modelId: string;
  modelDisplayName: string;
  prompt?: string;
  params: GenerationParams;
  resultImages?: GeneratedImage[];
  error?: ApiError | GenerationError;
  usage?: UsageInfo;
  estimatedCostText?: string;
  durationMs?: number;
  acceptedAt?: string;
};

export type CreateHistoryRecordFromResponseInput = {
  response: CreateGenerationResponse;
  modelDisplayName: string;
  prompt?: string;
  params: GenerationParams;
};

function canUseLocalStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function createHistoryId(requestId: string) {
  return `history-${requestId}`;
}

function normalizePromptSummary(prompt?: string) {
  const summary = prompt?.replace(/\s+/g, " ").trim() ?? "";

  if (!summary) {
    return undefined;
  }

  return summary.length > PROMPT_SUMMARY_LENGTH
    ? `${summary.slice(0, PROMPT_SUMMARY_LENGTH - 1)}...`
    : summary;
}

function isDataUrl(value?: string) {
  return Boolean(value?.startsWith("data:"));
}

function sanitizeGeneratedImage(image: GeneratedImage): GeneratedImage {
  const canStoreBase64 = Boolean(image.base64 && image.base64.length <= MAX_STORED_BASE64_CHARS);
  const safeBase64 = canStoreBase64 ? image.base64 : undefined;
  const safeUrl = isDataUrl(image.url) && !safeBase64 ? undefined : image.url;

  return {
    ...image,
    blobURL: undefined,
    base64: safeBase64,
    url: safeUrl
  };
}

function sanitizeHistoryError(error?: ApiError | GenerationError): GenerationError | undefined {
  if (!error) {
    return undefined;
  }

  return {
    ...error,
    code: sanitizeErrorText(error.code, 80) || "UNKNOWN_ERROR",
    title: sanitizeErrorText(error.title, 120) || "生成失败",
    message: sanitizeErrorText(error.message, 320) || "生成请求失败。",
    suggestion: error.suggestion ? sanitizeErrorText(error.suggestion, 320) : undefined,
    safeDetails: error.safeDetails ? sanitizeErrorText(error.safeDetails, 500) : undefined,
    rawExcerpt: "rawExcerpt" in error && error.rawExcerpt ? sanitizeErrorText(error.rawExcerpt, 500) : undefined
  };
}

function sanitizeRecords(records: GenerationHistoryRecord[]) {
  return records
    .filter((record) => record?.id && record?.requestId)
    .map((record) => ({
      ...record,
      error: sanitizeHistoryError(record.error),
      resultImages: (record.resultImages ?? []).map(sanitizeGeneratedImage)
    }))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, MAX_HISTORY_RECORDS);
}

export function createHistoryRecord(input: CreateHistoryRecordInput): GenerationHistoryRecord {
  const createdAt = input.acceptedAt ?? new Date().toISOString();
  const images = (input.resultImages ?? []).map(sanitizeGeneratedImage);

  return {
    id: createHistoryId(input.requestId),
    requestId: input.requestId,
    status: input.status,
    modelId: input.modelId,
    modelDisplayName: input.modelDisplayName,
    promptSummary: normalizePromptSummary(input.prompt),
    params: { ...input.params },
    resultImages: images,
    error: sanitizeHistoryError(input.error),
    usage:
      input.usage ??
      (input.estimatedCostText
        ? {
            imageCount: images.length,
            estimatedCostText: input.estimatedCostText
          }
        : undefined),
    durationMs: input.durationMs,
    syncStatus: "local",
    archived: false,
    createdAt,
    updatedAt: new Date().toISOString()
  };
}

export function createHistoryRecordFromResponse(input: CreateHistoryRecordFromResponseInput) {
  const result = input.response.result;

  return createHistoryRecord({
    requestId: input.response.requestId,
    status: result?.status ?? input.response.status,
    modelId: input.response.modelId,
    modelDisplayName: input.modelDisplayName,
    prompt: input.prompt,
    params: input.params,
    resultImages: result?.images ?? [],
    error: result?.error,
    usage: result?.usage,
    estimatedCostText: input.response.estimatedCostText,
    durationMs: result?.durationMs,
    acceptedAt: input.response.acceptedAt
  });
}

export function loadHistoryRecords(): GenerationHistoryRecord[] {
  if (!canUseLocalStorage()) {
    return [];
  }

  const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);

  if (!raw) {
    return [];
  }

  try {
    const records = JSON.parse(raw) as GenerationHistoryRecord[];
    return Array.isArray(records) ? sanitizeRecords(records) : [];
  } catch {
    return [];
  }
}

export function saveHistoryRecord(record: GenerationHistoryRecord): GenerationHistoryRecord[] {
  const records = sanitizeRecords([record, ...loadHistoryRecords().filter((item) => item.id !== record.id)]);

  if (canUseLocalStorage()) {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(records));
  }

  return records;
}

export function clearHistoryRecords() {
  if (canUseLocalStorage()) {
    window.localStorage.removeItem(HISTORY_STORAGE_KEY);
  }

  return [];
}

export function toHistoryListItems(records: GenerationHistoryRecord[]): HistoryListItem[] {
  return sanitizeRecords(records).map((record) => {
    const images = record.resultImages ?? [];
    const firstImage = images.find((image) => image.url || image.base64);
    const thumbnailURL =
      firstImage?.url ??
      (firstImage?.base64 ? `data:${firstImage.mimeType ?? "image/png"};base64,${firstImage.base64}` : undefined);
    const expiresAt = images
      .map((image) => image.expiresAt)
      .filter((value): value is string => Boolean(value))
      .sort()[0];

    return {
      id: record.id,
      requestId: record.requestId,
      modelDisplayName: record.modelDisplayName,
      promptSummary: record.promptSummary,
      thumbnailURL,
      status: record.status,
      imageCount: images.length,
      costText: record.usage?.chargedAmountText ?? record.usage?.estimatedCostText,
      durationMs: record.durationMs,
      archived: record.archived,
      temporary: images.some((image) => image.temporary),
      expiresAt,
      createdAt: record.createdAt
    };
  });
}
