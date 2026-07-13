import type {
  ApiType,
  EndpointType,
  ImageFormat,
  ModelTag,
  NoticeLevel,
  OutputFormat,
  PriceMode,
  Provider,
  QualityKey,
  RatioKey,
  ResolutionKey,
  ResponseFormat
} from "./common";
import type { GenerationParams } from "./generation";

export type Currency = "CNY" | "USD" | "POINT" | "TOKEN";
export type AuthScheme = "Bearer" | "ApiKey" | "None";
export type ContentType = "application/json" | "multipart/form-data";
export type ImageInputMode = "none" | "base64" | "url" | "multipart" | "auto";
export type ModelNameMode = "current" | "legacy-preview";
export type EditLocalMode = "native-mask" | "annotated-reference" | "none";
export type EditContinuationMode = "openai-response" | "gemini-context" | "reference";
export type TemporaryRestrictionType =
  | "size_disabled"
  | "resolution_locked"
  | "quality_disabled"
  | "rate_limited"
  | "model_degraded"
  | "custom";

export type PriceConfig = {
  mode: PriceMode;
  unitLabel: string;
  basePriceText: string;
  basePriceValue?: number;
  currency?: Currency;
  minPriceValue?: number;
  maxPriceValue?: number;
  multiplierFields: string[];
  qualityMultiplier?: Partial<Record<QualityKey, number>>;
  resolutionMultiplier?: Partial<Record<ResolutionKey, number>>;
  pricingNote?: string;
  chargeOnFailureRisk: boolean;
};

export type RatioOption = {
  key: RatioKey;
  label: string;
  widthRatio?: number;
  heightRatio?: number;
  enabled: boolean;
  disabledReason?: string;
};

export type ResolutionOption = {
  key: ResolutionKey;
  label: string;
  width?: number;
  height?: number;
  isEstimated: boolean;
  enabled: boolean;
  disabledReason?: string;
};

export type QualityOption = {
  key: QualityKey;
  label: string;
  enabled: boolean;
  disabledReason?: string;
  priceMultiplier?: number;
};

export type ModelCapabilities = {
  ratios: RatioOption[];
  resolutions: ResolutionOption[];
  qualities: QualityOption[];
  maxOutputs: number;
  defaultOutputCount: number;
  maxReferenceImages: number;
  minReferenceImages: number;
  supportedReferenceFormats: ImageFormat[];
  maxReferenceImageSizeMB: number;
  supportsTextToImage: boolean;
  supportsImageToImage: boolean;
  supportsMultiImageFusion: boolean;
  supportsGifReference: boolean;
  outputFormats: OutputFormat[];
  responseFormats: ResponseFormat[];
  supportsSeed: boolean;
  supportsNegativePrompt: boolean;
  supportsStylePreset: boolean;
};

export type ModelEditCapabilities = {
  supportsWholeImageEdit: boolean;
  localMode: EditLocalMode;
  continuationMode: EditContinuationMode;
  supportsBranchMerge: boolean;
  maxCandidates: number;
};

export type RetryPolicy = {
  autoRetry: boolean;
  maxAttempts: number;
  retryableStatusCodes: number[];
  backoffMs: number;
};

export type RequestPolicy = {
  authHeaderName: string;
  authScheme: AuthScheme;
  contentType: ContentType;
  imageInputMode: ImageInputMode;
  preferEditEndpointWhenHasReference: boolean;
  includeFields: string[];
  omitFields: string[];
  removeResponseFormatWhenUnsupported: boolean;
  modelNameMode: ModelNameMode;
  timeoutMs: number;
  retry: RetryPolicy;
};

export type ResponsePolicy = {
  imageUrlPaths: string[];
  imageBase64Paths: string[];
  errorCodePaths: string[];
  errorMessagePaths: string[];
  finishReasonPaths: string[];
  tokenCountPaths: string[];
  temporaryUrlTTLSeconds?: number;
  resultRequiresImmediateSave: boolean;
};

export type TemporaryRestriction = {
  id: string;
  enabled: boolean;
  type: TemporaryRestrictionType;
  title: string;
  description: string;
  affectedFields: string[];
  forcedValues?: Partial<GenerationParams>;
  disabledOptions?: string[];
  startedAt?: string;
  expectedEndAt?: string;
  priority: number;
};

export type ModelNotice = {
  level: NoticeLevel;
  title: string;
  content: string;
  linkText?: string;
  linkURL?: string;
};

export type ModelUIHints = {
  badgeText?: string;
  colorToken?: string;
  parameterHelpText?: string;
  costHelpText?: string;
  referenceHelpText?: string;
  resultHelpText?: string;
};

export type ModelFeatureFlags = {
  allowLegacyModelName: boolean;
  isPreviewModel: boolean;
  sizeByPromptOnly: boolean;
  supportsHighResolution: boolean;
  allowChatCompletionsFallback: boolean;
  requiresEnterpriseGroupOnRateLimit: boolean;
  supportsPromptTemplate: boolean;
  supportsPromptOptimize: boolean;
  supportsTransparentBackground: boolean;
  supportsSafetyLevel: boolean;
  returnsTemporaryURL: boolean;
};

export type ModelConfig = {
  id: string;
  apiModelName: string;
  displayName: string;
  provider: Provider;
  apiType: ApiType;
  endpointType: EndpointType;
  baseURL: string;
  editURL?: string;
  docURL?: string;
  enabled: boolean;
  isDefault: boolean;
  sortOrder: number;
  tags: ModelTag[];
  timeLabel?: string;
  description?: string;
  price: PriceConfig;
  capabilities: ModelCapabilities;
  editCapabilities: ModelEditCapabilities;
  request: RequestPolicy;
  response: ResponsePolicy;
  featureFlags: ModelFeatureFlags;
  temporaryRestrictions: TemporaryRestriction[];
  notice?: ModelNotice;
  ui: ModelUIHints;
  updatedAt: string;
};
