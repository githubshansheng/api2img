export type LangCode = "zh-CN" | "en-US" | "zh-TW" | "ru-RU";

export type PageKey =
  | "studio"
  | "editing"
  | "generation"
  | "compare"
  | "history"
  | "assets"
  | "recognition"
  | "reasoning"
  | "settings";

export type ApiType =
  | "openai-image"
  | "openai-image-edit"
  | "gemini-native"
  | "flux-kontext"
  | "flux-2"
  | "seedream"
  | "generic-image";

export type OpenAIEndpointVariant = "images-generations" | "responses";
export type EndpointType = OpenAIEndpointVariant | "images-edits" | "gemini-generate-content" | "custom";

export type Provider = "google" | "openai" | "flux" | "bytedance" | "apiyi" | "custom";

export type PriceMode = "fixed" | "range" | "token" | "custom";

export type RatioKey =
  | "auto"
  | "1:1"
  | "16:9"
  | "9:16"
  | "4:3"
  | "3:4"
  | "3:2"
  | "2:3"
  | "21:9"
  | "5:4"
  | "4:5"
  | "4:1"
  | "1:4"
  | "8:1"
  | "1:8";

export type ResolutionKey = "auto" | "0.5K" | "1K" | "2K" | "4K";
export type QualityKey = "auto" | "low" | "medium" | "high";
export type ImageFormat = "jpg" | "jpeg" | "png" | "gif" | "webp";
export type OutputFormat = "png" | "jpeg" | "jpg" | "webp";
export type ResponseFormat = "url" | "b64_json" | "json";
export type OpenAIImageBackground = "auto" | "opaque" | "transparent";
export type OpenAIImageModeration = "auto" | "low";

export type RequestStatus =
  | "idle"
  | "validating"
  | "running"
  | "success"
  | "partial_success"
  | "failed"
  | "cancelled";

export type StorageType = "default-cloud" | "r2" | "oss" | "local-directory";
export type SyncStatus = "local" | "syncing" | "synced" | "failed";

export type ErrorType =
  | "validation"
  | "auth"
  | "permission"
  | "quota"
  | "rate_limit"
  | "safety"
  | "network"
  | "upstream"
  | "storage"
  | "unknown";

export type ModelTag = "new" | "hot" | "fast" | "vip" | "legacy" | "restricted" | "recommended";
export type NoticeLevel = "info" | "warning" | "error";
export type UploadStatus = "idle" | "reading" | "ready" | "failed";
export type ReferenceImageSource = "local-file" | "remote-url" | "history" | "asset-template";
export type GenerationMode = "single" | "batch" | "compare" | "retry";
export type GeneratedImageSourceType = "url" | "base64" | "blob" | "storage";
