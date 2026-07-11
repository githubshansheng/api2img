import type {
  GeneratedImageSourceType,
  GenerationMode,
  ImageFormat,
  OpenAIImageBackground,
  OpenAIImageModeration,
  OutputFormat,
  PageKey,
  QualityKey,
  RatioKey,
  ReferenceImageSource,
  RequestStatus,
  ResolutionKey,
  OpenAIEndpointVariant,
  ResponseFormat,
  SyncStatus,
  UploadStatus
} from "./common";
import type { ClientContext } from "./config";
import type { GenerationError } from "./error";
import type { ModelConfig } from "./model";

export type GenerationParams = {
  ratio: RatioKey;
  resolution: ResolutionKey;
  quality: QualityKey;
  count: number;
  outputFormat?: OutputFormat;
  outputCompression?: number;
  background?: OpenAIImageBackground;
  moderation?: OpenAIImageModeration;
  responseFormat?: ResponseFormat;
  seed?: number;
  stylePreset?: string;
  stream?: boolean;
  partialImages?: number;
  user?: string;
  customParams?: Record<string, unknown>;
};

export type GenerationRuntimeOptions = {
  saveToHistory: boolean;
  autoArchiveToLocalDirectory: boolean;
  useRealKeyInCurl: boolean;
  useCustomEndpoint: boolean;
  streamProgress: boolean;
};

export type ValidationIssue = {
  field: string;
  code: string;
  message: string;
  blocking: boolean;
};

export type ValidationState = {
  isValid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

export type ReferenceImage = {
  id: string;
  source: ReferenceImageSource;
  file?: File;
  name: string;
  mimeType: string;
  format: ImageFormat;
  sizeBytes?: number;
  width?: number;
  height?: number;
  previewURL: string;
  remoteURL?: string;
  base64?: string;
  objectKey?: string;
  order: number;
  uploadStatus: UploadStatus;
  errorMessage?: string;
  createdAt: number;
};

export type GenerationFormState = {
  page: PageKey;
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  referenceImages: ReferenceImage[];
  params: GenerationParams;
  options: GenerationRuntimeOptions;
  validation: ValidationState;
  requestStatus: RequestStatus;
  activeRequestId?: string;
  draftUpdatedAt: number;
};

export type EndpointOverride = {
  baseURL?: string;
  editURL?: string;
  endpointVariant?: OpenAIEndpointVariant;
  apiKey?: string;
  headers?: Record<string, string>;
};

export type ModelRequestOverride = {
  displayName?: string;
  apiModelName?: string;
};

export type PreparedReferenceImage = {
  id: string;
  name: string;
  mimeType: string;
  format: ImageFormat;
  sizeBytes?: number;
  width?: number;
  height?: number;
  base64?: string;
  remoteURL?: string;
  order: number;
};

export type GenerationRequestDraft = {
  requestId: string;
  mode: GenerationMode;
  model: ModelConfig;
  prompt: string;
  negativePrompt?: string;
  referenceImages: PreparedReferenceImage[];
  params: GenerationParams;
  apiKey?: string;
  endpointOverride?: EndpointOverride;
  createdAt: number;
};

export type UsageInfo = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  imageCount: number;
  chargedAmountText?: string;
  estimatedCostText?: string;
};

export type GeneratedImage = {
  id: string;
  sourceType: GeneratedImageSourceType;
  url?: string;
  base64?: string;
  blobURL?: string;
  storageKey?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  format?: OutputFormat;
  index: number;
  temporary: boolean;
  expiresAt?: string;
  saved: boolean;
  error?: GenerationError;
};

export type AdapterResult = {
  requestId: string;
  status: RequestStatus;
  images: GeneratedImage[];
  rawResponseSummary?: unknown;
  usage?: UsageInfo;
  durationMs: number;
  error?: GenerationError;
};

export type AdapterHttpRequest = {
  method: "POST";
  url: string;
  headers: Record<string, string>;
  body: unknown;
  contentType: "application/json" | "multipart/form-data";
  timeoutMs: number;
};

export type AdapterHttpResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  durationMs: number;
};

export type CurlBuildOptions = {
  showRealKey: boolean;
  placeholderKey: string;
  pretty: boolean;
};

export type ImageAdapter = {
  name: string;
  supports(model: ModelConfig): boolean;
  buildRequest(draft: GenerationRequestDraft): AdapterHttpRequest;
  parseResponse(response: AdapterHttpResponse, draft: GenerationRequestDraft): AdapterResult;
  buildCurl(draft: GenerationRequestDraft, options: CurlBuildOptions): string;
};

export type GenerationHistoryRecord = {
  id: string;
  requestId: string;
  status: RequestStatus;
  modelId: string;
  modelDisplayName: string;
  promptSummary?: string;
  params: GenerationParams;
  resultImages: GeneratedImage[];
  error?: GenerationError;
  usage?: UsageInfo;
  durationMs?: number;
  syncStatus: SyncStatus;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type GenerationReferenceInput = Omit<PreparedReferenceImage, "remoteURL"> & {
  base64?: string;
  remoteURL?: string;
  objectKey?: string;
};

export type GenerationServerOptions = {
  saveToHistory: boolean;
  storeResultToCloud: boolean;
  returnRawSummary: boolean;
  useCustomEndpoint: boolean;
};

export type GenerationRequestPayload = {
  requestId?: string;
  modelId: string;
  prompt?: string;
  negativePrompt?: string;
  referenceImages: GenerationReferenceInput[];
  params: GenerationParams;
  endpointOverride?: EndpointOverride;
  modelOverride?: ModelRequestOverride;
  options?: GenerationServerOptions;
  clientContext?: ClientContext;
};

export type AdapterRequestSummary = {
  adapterName: string;
  method: "POST";
  url: string;
  requestModelName?: string;
  contentType: "application/json" | "multipart/form-data";
  timeoutMs: number;
  bodyFields: string[];
  hasReferenceImages: boolean;
};

export type CurlCopyStatus = "idle" | "success" | "failed";

export type CurlState = {
  code: string;
  endpoint: string;
  method: "POST";
  showRealKey: boolean;
  copiedAt?: number;
  copyStatus: CurlCopyStatus;
  warning?: string;
  adapterName?: string;
  bodyFields?: string[];
  requestModelName?: string;
};

export type CreateGenerationResponse = {
  requestId: string;
  status: RequestStatus;
  acceptedAt: string;
  modelId: string;
  estimatedCostText?: string;
  warnings?: ValidationIssue[];
  adapterRequest?: AdapterRequestSummary;
  result?: AdapterResult;
};
