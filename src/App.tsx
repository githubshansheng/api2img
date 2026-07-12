import {
  AlertTriangle,
  Box,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Code2,
  Compass,
  Copy,
  Download,
  Eye,
  EyeOff,
  Folder,
  GalleryVerticalEnd,
  Images,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  Save,
  Settings,
  Sparkles,
  TestTube2,
  Trash2,
  WandSparkles,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from "react";
import { createDefaultGenerationParams, resolveModelCapabilities } from "./domain";
import { GenerationSuiteWorkbench } from "./components/generation-suite/GenerationSuiteWorkbench";
import type {
  ApiError,
  CreateGenerationResponse,
  CurlCopyStatus,
  GeneratedImage,
  GenerationError,
  GenerationHistoryRecord,
  GenerationParams,
  ModelConfig,
  ModelCapabilities,
  NavItemConfig,
  OpenAIEndpointVariant,
  PageKey,
  ReferenceImage,
  RequestStatus,
  StorageType,
  ValidationIssue,
  ValidationState
} from "./domain";
import {
  loadAnalyticsEvents,
  logAnalyticsEvent,
  summarizeAnalyticsEvents
} from "./services/analytics-service";
import {
  createAssetTemplate,
  deleteAssetTemplate,
  loadAssetTemplates,
  saveAssetTemplate
} from "./services/asset-template-service";
import { planCompareGenerationSlots } from "./services/compare-service";
import { fetchBootstrapConfig, fallbackBootstrapConfig } from "./services/config-service";
import { buildCurlPreview } from "./services/curl-service";
import { buildImageResultZip } from "./services/download-service";
import {
  analyzeRecognitionRequest,
  createGenerationRequest,
  GenerationApiError,
  runReasoningRequest
} from "./services/generation-api-service";
import {
  buildGenerationRequestPayload,
  estimateGenerationCost,
  prepareGenerationReferences,
  validateGenerationForm
} from "./services/generation-form-service";
import {
  clearHistoryRecords,
  createHistoryRecord,
  createHistoryRecordFromResponse,
  loadHistoryRecords,
  saveHistoryRecord,
  toHistoryListItems
} from "./services/history-service";
import {
  applyUserModelEndpointSettings,
  buildEndpointOverrideFromSettings,
  buildModelRequestOverrideFromSettings,
  resolveModelApiKey
} from "./services/model-settings-service";
import {
  buildPromptPolishInstruction,
  extractPolishedPrompt,
  inferPromptPolishPlatform,
  type PromptPolishRequest
} from "./services/prompt-polish-service";
import {
  DEFAULT_OPENAI_ENDPOINT_VARIANT,
  getModelEndpointPrefix,
  OPENAI_ENDPOINT_VARIANT_OPTIONS,
  resolveOpenAIEndpointVariant,
  stripKnownEndpointSuffix
} from "./services/model-endpoint-service";
import {
  DEFAULT_REASONING_MAX_TOKENS,
  DEFAULT_REASONING_PLATFORM,
  MAX_REASONING_OUTPUT_TOKENS,
  REASONING_EFFORT_LABELS,
  REASONING_PLATFORMS,
  REASONING_PROMPT_PRESETS,
  getDefaultReasoningModel,
  getReasoningPlatform,
  type ReasoningApiStyle,
  type ReasoningPlatformId
} from "./config/reasoning";
import {
  DEFAULT_VISION_RECOGNITION_MODEL,
  DEFAULT_VISION_RECOGNITION_ROLE,
  VISION_RECOGNITION_MODELS,
  VISION_RECOGNITION_ROLES
} from "./config/vision-recognition";
import { GPT_STUDIO_BASE_URL, GPT_STUDIO_FEATURE_ROUTES } from "./config/gpt-studio-routes";
import {
  clearModelEndpointSettings,
  DEFAULT_RESPONSES_MODEL_NAME,
  DEFAULT_UTILITY_REASONING_MODEL_NAME,
  DEFAULT_UTILITY_RECOGNITION_MODEL_NAME,
  DEFAULT_LOCAL_ARCHIVE_DIRECTORY_PATH,
  deleteModelSettings,
  duplicateModelSettings,
  loadUserSettings,
  restoreHiddenModelSettings,
  saveCustomModelSettings,
  saveMainApiKey,
  saveModelEndpointSettings,
  saveStorageAndArchiveSettings,
  saveUtilityModelSettings,
  testStorageConnectionSettings
} from "./services/settings-service";
import {
  getPromptTemplateCategories,
  getPromptTemplateCount,
  searchPromptTemplates
} from "./services/prompt-template-service";
import {
  createRecognitionDraft,
  getRecognitionRoleConfig,
  getRecognitionRolePrompt,
  type RecognitionDraft,
  type RecognitionRole
} from "./services/recognition-service";
import { createReasoningDraft, type ReasoningDraft, type ReasoningEffort } from "./services/reasoning-service";
import type { ResponsesImageInput, ResponsesRequestResult } from "./services/responses-api-service";
import {
  createReferenceImageWithBase64,
  formatFileSize,
  validateReferenceImageFiles
} from "./services/upload-service";

const icons: Record<PageKey, React.ComponentType<{ size?: number }>> = {
  studio: Sparkles,
  generation: WandSparkles,
  compare: Compass,
  history: Clock3,
  assets: GalleryVerticalEnd,
  recognition: Images,
  reasoning: TestTube2,
  settings: Settings
};

const validFormState: ValidationState = {
  isValid: true,
  errors: [],
  warnings: []
};
const DEFAULT_TEST_PROMPT = "小金毛在海边晒太阳";
const MAX_BATCH_GENERATION_COUNT = 10;
const MAX_OPENAI_IMAGE_COUNT = 10;
const MIN_PREVIEW_ZOOM = 50;
const MAX_PREVIEW_ZOOM = 500;
const PROMPT_TEMPLATE_CATEGORIES = getPromptTemplateCategories();
const DEFAULT_TEMPLATE_CATEGORY_ID = PROMPT_TEMPLATE_CATEGORIES[0]?.id ?? "popular";
const BATCH_GENERATION_OPTIONS = Array.from({ length: MAX_BATCH_GENERATION_COUNT }, (_, index) => index + 1);
const UTILITY_REFERENCE_IMAGE_CAPABILITIES: ModelCapabilities = {
  supportedReferenceFormats: ["jpg", "png"],
  maxReferenceImageSizeMB: 20,
  maxReferenceImages: 12,
  minReferenceImages: 0,
  maxOutputs: 1,
  defaultOutputCount: 1,
  ratios: [],
  resolutions: [],
  qualities: [],
  supportsTextToImage: true,
  supportsImageToImage: true,
  supportsMultiImageFusion: true,
  supportsGifReference: false,
  outputFormats: ["png"],
  responseFormats: ["b64_json"],
  supportsNegativePrompt: false,
  supportsSeed: false,
  supportsStylePreset: false
};
const OPENAI_OUTPUT_FORMAT_OPTIONS: Array<{ value: NonNullable<GenerationParams["outputFormat"]>; label: string }> = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" }
];
const OPENAI_BACKGROUND_OPTIONS: Array<{ value: NonNullable<GenerationParams["background"]>; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "opaque", label: "不透明" },
  { value: "transparent", label: "透明" }
];
const OPENAI_MODERATION_OPTIONS: Array<{ value: NonNullable<GenerationParams["moderation"]>; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "low", label: "低" }
];
const STORAGE_TYPE_OPTIONS: Array<{ value: StorageType; label: string }> = [
  { value: "default-cloud", label: "默认云存储" },
  { value: "r2", label: "Cloudflare R2" },
  { value: "oss", label: "阿里云 OSS" },
  { value: "local-directory", label: "本地归档" }
];

const pageSummaries: Record<PageKey, { title: string; eyebrow: string; status: string }> = {
  studio: {
    title: "GPT-Image2 Studio",
    eyebrow: "参考项目移植",
    status: "原项目运行时已内嵌到当前项目，保留 Studio 的多模式创作、画廊、记录和配置体验。"
  },
  generation: {
    title: "生成图片",
    eyebrow: "M1 核心工作台",
    status: "模型选择、提示词、参数、上传、模板和结果区在这里完成闭环。"
  },
  compare: {
    title: "模型对比",
    eyebrow: "M3 资产复用",
    status: "使用同一提示词并排调用两个模型，比较请求端点、参数和返回结果。"
  },
  history: {
    title: "历史记录",
    eyebrow: "M1 基础历史",
    status: "查看本地生成记录、详情、临时链接和复用入口。"
  },
  assets: {
    title: "素材模板",
    eyebrow: "M3 模板能力",
    status: "保存本地提示词模板，记录标签、参考图数量和同步状态。"
  },
  recognition: {
    title: "识别图片",
    eyebrow: "M3 图像理解",
    status: "上传图片后调用真实视觉模型，支持角色模板与 Chat Completions 端点。"
  },
  reasoning: {
    title: "推理测试",
    eyebrow: "M4 推理能力",
    status: "按平台切换 Messages、Responses、Chat Completions 与 Gemini 推理端点。"
  },
  settings: {
    title: "设置",
    eyebrow: "运行时配置",
    status: "API Key、模型展示名、实际模型名和端点配置会在设置弹窗中管理。"
  }
};

function getRandomDefaultPrompt() {
  const templates = PROMPT_TEMPLATE_CATEGORIES.flatMap((category) => category.templates).filter((template) =>
    template.prompt.trim()
  );

  if (templates.length === 0) {
    return DEFAULT_TEST_PROMPT;
  }

  const randomIndex = Math.floor(Math.random() * templates.length);
  return templates[randomIndex]?.prompt ?? DEFAULT_TEST_PROMPT;
}

function formatApiEndpointName(endpoint: string) {
  if (endpoint.includes("/v1/responses")) {
    return "OpenAI Responses";
  }

  if (endpoint.includes("/v1/images/generations")) {
    return "OpenAI Images Generations";
  }

  if (endpoint.includes("/v1/images/edits")) {
    return "OpenAI Images Edits";
  }

  if (endpoint.includes(":generateContent")) {
    return "Gemini generateContent";
  }

  return "Custom API";
}

function formatPanelTime(value?: string) {
  if (!value) {
    return "等待提交";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function compactRequestId(value?: string) {
  if (!value) {
    return "pending";
  }

  return value.length > 24 ? `${value.slice(0, 10)}...${value.slice(-8)}` : value;
}

function formatImageResolution(image?: GeneratedImage, fallback?: string) {
  if (image?.width && image.height) {
    return `${image.width} x ${image.height}`;
  }

  return fallback ?? "按模型返回";
}

function formatActualImageResolution(image?: GeneratedImage) {
  if (image?.width && image.height) {
    return `${image.width} x ${image.height}`;
  }

  return "尺寸待读取";
}

function formatResultStatus(input: {
  isSubmitting: boolean;
  status?: RequestStatus;
  hasImage: boolean;
  errorMessage?: string;
}) {
  if (input.isSubmitting) {
    return "图片正在生成";
  }

  if (input.status === "success") {
    return "生成完成";
  }

  if (input.status === "partial_success") {
    return "部分生成完成";
  }

  if (input.status === "failed" || input.errorMessage) {
    return "生成失败";
  }

  if (input.hasImage) {
    return "生成完成";
  }

  return "等待生成";
}

function formatResultHint(input: {
  isSubmitting: boolean;
  imageCount: number;
  errorMessage?: string;
  endpoint?: string;
}) {
  if (input.isSubmitting) {
    return "正在调用模型并等待上游返回，请保持页面打开。";
  }

  if (input.errorMessage) {
    return input.errorMessage;
  }

  if (input.imageCount > 0) {
    return `已解析 ${input.imageCount} 张图片，可在下方缩略图切换查看。`;
  }

  return input.endpoint ? "开始生成后，图片会显示在右侧工作台。" : "请先选择模型并配置 API。";
}

type VisibleError = ApiError | GenerationError;

type SettingsFeedback = {
  target: "main-key" | "model" | "storage" | "all";
  message: string;
};

type SettingsTabKey = "api-model" | "storage-image";

type ZipStatus = {
  state: "idle" | "running" | "success" | "failed";
  message: string;
  progress?: number;
};

type CompareSlotResult = {
  status: "idle" | "running" | "success" | "failed";
  modelId?: string;
  modelDisplayName?: string;
  response?: CreateGenerationResponse;
  error?: VisibleError;
};

type UtilityRequestStatus = "idle" | "running" | "success" | "failed" | "cancelled";
type UtilityCopyTarget =
  | "recognition-output"
  | "recognition-request"
  | "recognition-raw"
  | "reasoning-output"
  | "reasoning-thinking"
  | "reasoning-request"
  | "reasoning-raw";

type ResultQueueItem = {
  id: string;
  requestId: string;
  status: "queued" | "success" | "failed";
  createdAt: string;
  acceptedAt?: string;
  modelId: string;
  modelDisplayName: string;
  requestModelName?: string;
  prompt: string;
  negativePrompt?: string;
  params: GenerationParams;
  endpoint?: string;
  resolutionText?: string;
  image?: GeneratedImage;
  imageCount?: number;
  durationMs?: number;
  error?: VisibleError;
  batchIndex?: number;
  batchTotal?: number;
};

type PreviewPan = {
  x: number;
  y: number;
};

type PreviewDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

function getErrorStatusCode(error?: VisibleError) {
  if (!error || !("statusCode" in error || "upstreamStatus" in error)) {
    return undefined;
  }

  return error.statusCode ?? error.upstreamStatus;
}

function formatErrorTypeLabel(type?: VisibleError["type"]) {
  const labels: Record<VisibleError["type"], string> = {
    validation: "参数错误",
    auth: "认证失败",
    permission: "权限不足",
    quota: "额度不足",
    rate_limit: "限流",
    safety: "安全过滤",
    network: "网络异常",
    upstream: "上游异常",
    storage: "存储异常",
    unknown: "未知错误"
  };

  return type ? labels[type] : "生成失败";
}

function formatErrorMeta(error?: VisibleError) {
  if (!error) {
    return [];
  }

  const statusCode = getErrorStatusCode(error);

  return [
    formatErrorTypeLabel(error.type),
    statusCode ? `HTTP ${statusCode}` : undefined,
    error.code,
    error.retryable ? "可重试" : "不可重试",
    error.mayHaveCharged ? "可能计费" : undefined
  ].filter(Boolean);
}

function shouldOfferSettings(error?: VisibleError) {
  return Boolean(error && ["auth", "permission", "quota"].includes(error.type));
}

function clampZoom(value: number) {
  return Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, value));
}

function clampBatchGenerationCount(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(MAX_BATCH_GENERATION_COUNT, Math.max(1, Math.floor(value)));
}

function clampGenerationImageCount(value: number, model?: ModelConfig) {
  const maxOutputs = Math.min(model?.capabilities.maxOutputs ?? 1, MAX_OPENAI_IMAGE_COUNT);

  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(maxOutputs, Math.max(1, Math.floor(value)));
}

function clampOutputCompression(value: number) {
  if (!Number.isFinite(value)) {
    return 100;
  }

  return Math.min(100, Math.max(0, Math.floor(value)));
}

function isOpenAIImageModel(model?: ModelConfig) {
  return Boolean(model && (model.apiType === "openai-image" || model.apiType === "openai-image-edit"));
}

function createClientRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createLocalVisibleError(input: {
  code: string;
  title: string;
  message: string;
  retryable?: boolean;
  type?: ApiError["type"];
}): ApiError {
  return {
    id: `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: input.type ?? "unknown",
    code: input.code,
    title: input.title,
    message: input.message,
    retryable: input.retryable ?? false,
    createdAt: Date.now()
  };
}

function isAbortLikeError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function formatUtilityJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value);
  }
}

function isUtilityListLine(value: string) {
  return /^(\d+\.|[-*•]|[一二三四五六七八九十]+[、.])\s*/.test(value.trim());
}

function stripUtilityListMarker(value: string) {
  return value.trim().replace(/^(\d+\.|[-*•]|[一二三四五六七八九十]+[、.])\s*/, "");
}

function renderUtilityText(text: string) {
  const blocks = text
    .trim()
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return <p className="utility-output-placeholder">接口未返回可展示文本。</p>;
  }

  return blocks.map((block, blockIndex) => {
    const heading = block.match(/^(#{1,4})\s+(.+)$/);

    if (heading) {
      return <h3 key={`heading-${blockIndex}`}>{heading[2]}</h3>;
    }

    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length > 1 && lines.every(isUtilityListLine)) {
      return (
        <ul key={`list-${blockIndex}`}>
          {lines.map((line, lineIndex) => (
            <li key={`${blockIndex}-${lineIndex}`}>{stripUtilityListMarker(line)}</li>
          ))}
        </ul>
      );
    }

    return <p key={`paragraph-${blockIndex}`}>{block}</p>;
  });
}

function replaceQueueItem(items: ResultQueueItem[], itemId: string, replacements: ResultQueueItem[]) {
  const index = items.findIndex((item) => item.id === itemId);

  if (index < 0) {
    return items;
  }

  return [...items.slice(0, index), ...replacements, ...items.slice(index + 1)];
}

function formatTimestampForFilename(value = new Date()) {
  const pad = (part: number) => String(part).padStart(2, "0");

  return [
    value.getFullYear(),
    pad(value.getMonth() + 1),
    pad(value.getDate()),
    "-",
    pad(value.getHours()),
    pad(value.getMinutes()),
    pad(value.getSeconds())
  ].join("");
}

function sanitizeFilenamePart(value?: string) {
  const cleaned = (value ?? "result")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return (cleaned || "result").slice(0, 48);
}

function createImageDownloadFilename(input: {
  image: GeneratedImage;
  requestId?: string;
  format?: string;
  date?: Date;
}) {
  const extension = sanitizeFilenamePart(input.image.format ?? input.format ?? "png").toLowerCase();
  const requestPart = sanitizeFilenamePart(input.requestId ?? input.image.id).slice(-18);
  const imageIndex = String(input.image.index + 1).padStart(2, "0");

  return `api2image-${formatTimestampForFilename(input.date)}-${requestPart}-${imageIndex}.${extension}`;
}

function toResponsesImageInput(image: ReferenceImage): ResponsesImageInput {
  return {
    id: image.id,
    name: image.name,
    mimeType: image.mimeType,
    sizeBytes: image.sizeBytes,
    width: image.width,
    height: image.height,
    base64: image.base64,
    remoteURL: image.remoteURL,
    order: image.order
  };
}

function mergeResponsesImageInputs(...groups: ReferenceImage[][]) {
  const seen = new Set<string>();
  const images: ResponsesImageInput[] = [];

  groups.flat().forEach((image) => {
    if (seen.has(image.id)) {
      return;
    }

    seen.add(image.id);
    images.push(toResponsesImageInput(image));
  });

  return images.map((image, index) => ({
    ...image,
    order: index
  }));
}

function formatResponsesUsage(usage?: ResponsesRequestResult["usage"]) {
  if (!usage) {
    return "token 未返回";
  }

  const parts = [
    usage.promptTokens !== undefined ? `input ${usage.promptTokens}` : undefined,
    usage.completionTokens !== undefined ? `output ${usage.completionTokens}` : undefined,
    usage.totalTokens !== undefined ? `total ${usage.totalTokens}` : undefined
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" / ") : "token 未返回";
}

function joinDisplayPath(directoryPath: string | undefined, filename: string) {
  const basePath = (directoryPath?.trim() || DEFAULT_LOCAL_ARCHIVE_DIRECTORY_PATH).replace(/[\\/]+$/, "");

  return `${basePath}\\${filename}`;
}

function formatParamValue(value?: string) {
  return value && value !== "auto" ? value : "自动";
}

function formatHistoryStatus(status: RequestStatus) {
  const labels: Record<RequestStatus, string> = {
    idle: "等待中",
    validating: "校验中",
    running: "生成中",
    success: "成功",
    partial_success: "部分成功",
    failed: "失败",
    cancelled: "已取消"
  };

  return labels[status] ?? status;
}

function formatDuration(durationMs?: number) {
  if (!durationMs) {
    return "耗时待记录";
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} s`;
}

function createSingleOutputGenerationParams(model: ModelConfig): GenerationParams {
  return {
    ...createDefaultGenerationParams(model),
    count: clampGenerationImageCount(1, model)
  };
}

export function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionFileInputRef = useRef<HTMLInputElement | null>(null);
  const reasoningFileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionAbortRef = useRef<AbortController | undefined>(undefined);
  const reasoningAbortRef = useRef<AbortController | undefined>(undefined);
  const runningRequestIdsRef = useRef<Set<string>>(new Set());
  const runningGenerationModelCountsRef = useRef<Map<string, number>>(new Map());
  const [activePage, setActivePage] = useState<PageKey>("generation");
  const [activeStudioRoute, setActiveStudioRoute] = useState(GPT_STUDIO_FEATURE_ROUTES[0].route);
  const [bootstrap, setBootstrap] = useState(fallbackBootstrapConfig);
  const [selectedModelId, setSelectedModelId] = useState(fallbackBootstrapConfig.defaultModelId);
  const [generationParams, setGenerationParams] = useState<GenerationParams>(() =>
    createSingleOutputGenerationParams(fallbackBootstrapConfig.models[0])
  );
  const [generationWorkspaceMode, setGenerationWorkspaceMode] = useState<"single" | "suite">("single");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsActiveTab, setSettingsActiveTab] = useState<SettingsTabKey>("api-model");
  const [showRealKey, setShowRealKey] = useState(false);
  const [settings, setSettings] = useState(loadUserSettings);
  const [apiKeyInput, setApiKeyInput] = useState(settings.mainApiKeyValue ?? "");
  const [settingsFeedback, setSettingsFeedback] = useState<SettingsFeedback | undefined>();
  const [settingsModelId, setSettingsModelId] = useState(fallbackBootstrapConfig.defaultModelId);
  const [modelDisplayNameInput, setModelDisplayNameInput] = useState("");
  const [modelApiModelNameInput, setModelApiModelNameInput] = useState("");
  const [modelEndpointVariantInput, setModelEndpointVariantInput] = useState<OpenAIEndpointVariant>(
    DEFAULT_OPENAI_ENDPOINT_VARIANT
  );
  const [modelBaseUrlInput, setModelBaseUrlInput] = useState("");
  const [modelApiKeyInput, setModelApiKeyInput] = useState("");
  const [settingsRecognitionModelInput, setSettingsRecognitionModelInput] = useState(
    settings.utilityModels.recognitionModelName
  );
  const [settingsReasoningModelInput, setSettingsReasoningModelInput] = useState(
    settings.utilityModels.reasoningModelName
  );
  const [storagePathInput, setStoragePathInput] = useState(
    settings.localArchive.directoryPath ?? DEFAULT_LOCAL_ARCHIVE_DIRECTORY_PATH
  );
  const [storageTypeInput, setStorageTypeInput] = useState<StorageType>(settings.storage.activeType);
  const [defaultCloudEnabledInput, setDefaultCloudEnabledInput] = useState(settings.storage.defaultCloudEnabled);
  const [localArchiveEnabledInput, setLocalArchiveEnabledInput] = useState(settings.localArchive.enabled);
  const [r2EndpointInput, setR2EndpointInput] = useState(settings.storage.r2?.endpoint ?? "");
  const [r2BucketInput, setR2BucketInput] = useState(settings.storage.r2?.bucket ?? "");
  const [r2AccessKeyInput, setR2AccessKeyInput] = useState(settings.storage.r2?.accessKeyId ?? "");
  const [r2SecretKeyInput, setR2SecretKeyInput] = useState(settings.storage.r2?.secretAccessKey ?? "");
  const [ossEndpointInput, setOssEndpointInput] = useState(settings.storage.oss?.endpoint ?? "");
  const [ossBucketInput, setOssBucketInput] = useState(settings.storage.oss?.bucket ?? "");
  const [ossAccessKeyInput, setOssAccessKeyInput] = useState(settings.storage.oss?.accessKeyId ?? "");
  const [ossSecretKeyInput, setOssSecretKeyInput] = useState(settings.storage.oss?.accessKeySecret ?? "");
  const [showModelApiKey, setShowModelApiKey] = useState(false);
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [uploadIssues, setUploadIssues] = useState<ValidationIssue[]>([]);
  const [prompt, setPrompt] = useState(getRandomDefaultPrompt);
  const [negativePrompt, setNegativePrompt] = useState("");
  const [promptTemplatesOpen, setPromptTemplatesOpen] = useState(false);
  const [templateCategoryId, setTemplateCategoryId] = useState(DEFAULT_TEMPLATE_CATEGORY_ID);
  const [templateSearch, setTemplateSearch] = useState("");
  const [batchGenerationCount, setBatchGenerationCount] = useState(1);
  const [formValidation, setFormValidation] = useState<ValidationState>(validFormState);
  const [requestStatus, setRequestStatus] = useState<RequestStatus>("idle");
  const [lastRequest, setLastRequest] = useState<CreateGenerationResponse | undefined>();
  const [requestError, setRequestError] = useState<VisibleError | undefined>();
  const [resultQueue, setResultQueue] = useState<ResultQueueItem[]>([]);
  const [activeResultItemId, setActiveResultItemId] = useState<string | undefined>();
  const [imageDetailsOpen, setImageDetailsOpen] = useState(false);
  const [historyRecords, setHistoryRecords] = useState(loadHistoryRecords);
  const [selectedHistoryRecordId, setSelectedHistoryRecordId] = useState<string | undefined>();
  const [curlExpanded, setCurlExpanded] = useState(false);
  const [showRealKeyInCurl, setShowRealKeyInCurl] = useState(false);
  const [curlCopyStatus, setCurlCopyStatus] = useState<CurlCopyStatus>("idle");
  const [curlCopiedAt, setCurlCopiedAt] = useState<number | undefined>();
  const [utilityCopyTarget, setUtilityCopyTarget] = useState<UtilityCopyTarget | undefined>();
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [previewZoom, setPreviewZoom] = useState(100);
  const [previewPan, setPreviewPan] = useState<PreviewPan>({ x: 0, y: 0 });
  const [isPreviewDragging, setIsPreviewDragging] = useState(false);
  const previewDragRef = useRef<PreviewDragState | undefined>(undefined);
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const [zipStatus, setZipStatus] = useState<ZipStatus>({ state: "idle", message: "等待打包" });
  const [analyticsEvents, setAnalyticsEvents] = useState(loadAnalyticsEvents);
  const [assetTemplates, setAssetTemplates] = useState(loadAssetTemplates);
  const [assetNameInput, setAssetNameInput] = useState("新素材模板");
  const [assetPromptInput, setAssetPromptInput] = useState(DEFAULT_TEST_PROMPT);
  const [assetTagsInput, setAssetTagsInput] = useState("写实, 可复用");
  const [comparePrompt, setComparePrompt] = useState(DEFAULT_TEST_PROMPT);
  const [compareLeftModelId, setCompareLeftModelId] = useState(fallbackBootstrapConfig.defaultModelId);
  const [compareRightModelId, setCompareRightModelId] = useState(fallbackBootstrapConfig.models[1]?.id ?? fallbackBootstrapConfig.defaultModelId);
  const [compareRatio, setCompareRatio] = useState<GenerationParams["ratio"]>("1:1");
  const [compareLeftResolution, setCompareLeftResolution] = useState<GenerationParams["resolution"]>("1K");
  const [compareRightResolution, setCompareRightResolution] = useState<GenerationParams["resolution"]>("1K");
  const [compareResult, setCompareResult] = useState<{
    left: CompareSlotResult;
    right: CompareSlotResult;
  }>({
    left: { status: "idle" },
    right: { status: "idle" }
  });
  const runningCompareModelIdsRef = useRef<Set<string>>(new Set());
  const [recognitionImages, setRecognitionImages] = useState<ReferenceImage[]>([]);
  const [recognitionIssues, setRecognitionIssues] = useState<ValidationIssue[]>([]);
  const [recognitionRole, setRecognitionRole] = useState<RecognitionRole>(DEFAULT_VISION_RECOGNITION_ROLE);
  const [recognitionQuestion, setRecognitionQuestion] = useState(() =>
    getRecognitionRolePrompt(DEFAULT_VISION_RECOGNITION_ROLE)
  );
  const [recognitionDraft, setRecognitionDraft] = useState<RecognitionDraft | undefined>();
  const [recognitionStatus, setRecognitionStatus] = useState<UtilityRequestStatus>("idle");
  const [recognitionResult, setRecognitionResult] = useState<ResponsesRequestResult | undefined>();
  const [recognitionError, setRecognitionError] = useState<VisibleError | undefined>();
  const [recognitionModelName, setRecognitionModelName] = useState(settings.utilityModels.recognitionModelName);
  const [reasoningPlatform, setReasoningPlatform] = useState<ReasoningPlatformId>(DEFAULT_REASONING_PLATFORM);
  const [reasoningModelName, setReasoningModelName] = useState(settings.utilityModels.reasoningModelName);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    getDefaultReasoningModel(DEFAULT_REASONING_PLATFORM).default
  );
  const [reasoningApiStyle, setReasoningApiStyle] = useState<ReasoningApiStyle>("responses");
  const [reasoningWantSummary, setReasoningWantSummary] = useState(true);
  const [reasoningMaxTokens, setReasoningMaxTokens] = useState(DEFAULT_REASONING_MAX_TOKENS);
  const [reasoningPrompt, setReasoningPrompt] = useState(REASONING_PROMPT_PRESETS[0]?.prompt ?? "");
  const [reasoningImages, setReasoningImages] = useState<ReferenceImage[]>([]);
  const [reasoningIssues, setReasoningIssues] = useState<ValidationIssue[]>([]);
  const [reasoningDraft, setReasoningDraft] = useState<ReasoningDraft | undefined>();
  const [reasoningStatus, setReasoningStatus] = useState<UtilityRequestStatus>("idle");
  const [reasoningResult, setReasoningResult] = useState<ResponsesRequestResult | undefined>();
  const [reasoningError, setReasoningError] = useState<VisibleError | undefined>();

  useEffect(() => {
    let mounted = true;

    fetchBootstrapConfig()
      .then((config) => {
        if (mounted) {
          setBootstrap(config);
        }
      })
      .finally(() => {
        if (mounted) {
          setLoadingConfig(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!settingsFeedback) {
      return;
    }

    const timer = window.setTimeout(() => {
      setSettingsFeedback(undefined);
    }, 2400);

    return () => window.clearTimeout(timer);
  }, [settingsFeedback]);

  useEffect(() => {
    if (!utilityCopyTarget) {
      return;
    }

    const timer = window.setTimeout(() => {
      setUtilityCopyTarget(undefined);
    }, 1600);

    return () => window.clearTimeout(timer);
  }, [utilityCopyTarget]);

  useEffect(() => {
    return () => {
      recognitionAbortRef.current?.abort();
      reasoningAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    setStoragePathInput(settings.localArchive.directoryPath ?? DEFAULT_LOCAL_ARCHIVE_DIRECTORY_PATH);
    setLocalArchiveEnabledInput(settings.localArchive.enabled);
    setStorageTypeInput(settings.storage.activeType);
    setDefaultCloudEnabledInput(settings.storage.defaultCloudEnabled);
    setR2EndpointInput(settings.storage.r2?.endpoint ?? "");
    setR2BucketInput(settings.storage.r2?.bucket ?? "");
    setR2AccessKeyInput(settings.storage.r2?.accessKeyId ?? "");
    setR2SecretKeyInput(settings.storage.r2?.secretAccessKey ?? "");
    setOssEndpointInput(settings.storage.oss?.endpoint ?? "");
    setOssBucketInput(settings.storage.oss?.bucket ?? "");
    setOssAccessKeyInput(settings.storage.oss?.accessKeyId ?? "");
    setOssSecretKeyInput(settings.storage.oss?.accessKeySecret ?? "");
  }, [settings.localArchive, settings.storage]);

  useEffect(() => {
    const recognitionName = settings.utilityModels.recognitionModelName || DEFAULT_UTILITY_RECOGNITION_MODEL_NAME;
    const reasoningName = settings.utilityModels.reasoningModelName || DEFAULT_UTILITY_REASONING_MODEL_NAME;

    setRecognitionModelName(recognitionName);
    setReasoningModelName(reasoningName);
    setSettingsRecognitionModelInput(recognitionName);
    setSettingsReasoningModelInput(reasoningName);
  }, [settings.utilityModels]);

  useEffect(() => {
    if (!imageDetailsOpen && !selectedHistoryRecordId && !promptTemplatesOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setImageDetailsOpen(false);
        setSelectedHistoryRecordId(undefined);
        setPromptTemplatesOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [imageDetailsOpen, selectedHistoryRecordId, promptTemplatesOpen]);

  const configuredModels = useMemo(
    () => applyUserModelEndpointSettings(bootstrap.models, settings),
    [bootstrap.models, settings]
  );

  useEffect(() => {
    const currentModelExists = configuredModels.some((model) => model.id === selectedModelId);
    const fallbackModelId =
      configuredModels.find((model) => model.id === bootstrap.defaultModelId)?.id ?? configuredModels[0]?.id;

    if (!currentModelExists && fallbackModelId) {
      setSelectedModelId(fallbackModelId);
    }
  }, [bootstrap.defaultModelId, configuredModels, selectedModelId]);

  useEffect(() => {
    if (configuredModels.length === 0) {
      return;
    }

    if (!configuredModels.some((model) => model.id === compareLeftModelId)) {
      setCompareLeftModelId(configuredModels[0].id);
    }

    if (!configuredModels.some((model) => model.id === compareRightModelId)) {
      setCompareRightModelId(configuredModels[1]?.id ?? configuredModels[0].id);
    }
  }, [compareLeftModelId, compareRightModelId, configuredModels]);

  const activeNavItem = useMemo(
    () => bootstrap.navItems.find((item) => item.key === activePage),
    [activePage, bootstrap.navItems]
  );
  const selectedModel = useMemo(
    () => configuredModels.find((model) => model.id === selectedModelId) ?? configuredModels[0],
    [configuredModels, selectedModelId]
  );
  const selectedApiKey = useMemo(
    () => resolveModelApiKey(settings, selectedModel?.id),
    [selectedModel?.id, settings]
  );
  const selectedEndpointOverride = useMemo(
    () =>
      selectedModel
        ? buildEndpointOverrideFromSettings(settings, selectedModel, {
            includeApiKey: true
          })
        : undefined,
    [selectedModel, settings]
  );
  const curlEndpointOverride = useMemo(
    () =>
      selectedModel
        ? buildEndpointOverrideFromSettings(settings, selectedModel, {
            includeApiKey: showRealKeyInCurl
          })
        : undefined,
    [selectedModel, settings, showRealKeyInCurl]
  );
  const selectedModelRequestOverride = useMemo(
    () => (selectedModel ? buildModelRequestOverrideFromSettings(settings, selectedModel.id) : undefined),
    [selectedModel, settings]
  );
  const recognitionRoleConfig = useMemo(() => getRecognitionRoleConfig(recognitionRole), [recognitionRole]);
  const recognitionEndpointLabel = "POST /v1/chat/completions";
  const recognitionRequestModelName =
    recognitionModelName.trim() || recognitionRoleConfig.defaultModel || DEFAULT_UTILITY_RECOGNITION_MODEL_NAME;
  const reasoningPlatformConfig = useMemo(() => getReasoningPlatform(reasoningPlatform), [reasoningPlatform]);
  const reasoningDefaultModel = useMemo(() => getDefaultReasoningModel(reasoningPlatform), [reasoningPlatform]);
  const reasoningModelOption = useMemo(
    () =>
      reasoningPlatformConfig.models.find((model) => model.id === reasoningModelName.trim()) ??
      reasoningPlatformConfig.models.find((model) => model.id === reasoningDefaultModel.id) ??
      reasoningDefaultModel,
    [reasoningDefaultModel, reasoningModelName, reasoningPlatformConfig.models]
  );
  const reasoningEffortOptions = reasoningModelOption.levels;
  const reasoningRequestModelName = reasoningModelName.trim() || reasoningDefaultModel.id || DEFAULT_RESPONSES_MODEL_NAME;
  const reasoningEndpointLabel =
    reasoningPlatform === "anthropic"
      ? "POST /v1/messages"
      : reasoningPlatform === "gemini"
        ? `POST /v1beta/models/${reasoningRequestModelName}:generateContent`
        : reasoningApiStyle === "chat-completions"
          ? "POST /v1/chat/completions"
          : "POST /v1/responses";

  useEffect(() => {
    if (!reasoningEffortOptions.includes(reasoningEffort)) {
      setReasoningEffort(reasoningModelOption.default);
    }
  }, [reasoningEffort, reasoningEffortOptions, reasoningModelOption.default]);

  const settingsModelBaseModel = useMemo(
    () =>
      configuredModels.find((model) => model.id === settingsModelId) ??
      configuredModels.find((model) => model.id === selectedModelId) ??
      configuredModels[0],
    [configuredModels, selectedModelId, settingsModelId]
  );
  const settingsCustomModel = settingsModelBaseModel
    ? settings.endpoint.customModels.find((model) => model.id === settingsModelBaseModel.id)
    : undefined;
  const settingsModelOverride = settingsModelBaseModel
    ? settings.endpoint.modelOverrides[settingsModelBaseModel.id] ?? settingsCustomModel
    : undefined;
  const settingsModelIsCustom = Boolean(settingsCustomModel);
  const settingsModelUsesOpenAIEndpoint = Boolean(
    settingsModelBaseModel?.apiType === "openai-image" || settingsModelBaseModel?.apiType === "openai-image-edit"
  );
  const resolvedCapabilities = useMemo(
    () => (selectedModel ? resolveModelCapabilities(selectedModel) : undefined),
    [selectedModel]
  );
  const supportsOpenAIAdvancedParams = isOpenAIImageModel(selectedModel);
  const imageCountOptions = useMemo(
    () =>
      Array.from(
        { length: clampGenerationImageCount(selectedModel?.capabilities.maxOutputs ?? 1, selectedModel) },
        (_, index) => index + 1
      ),
    [selectedModel]
  );
  const openAIOutputFormatOptions = useMemo(
    () =>
      OPENAI_OUTPUT_FORMAT_OPTIONS.filter((option) =>
        selectedModel?.capabilities.outputFormats.includes(option.value)
      ),
    [selectedModel]
  );
  const openAIBackgroundOptions = useMemo(
    () =>
      OPENAI_BACKGROUND_OPTIONS.filter(
        (option) => option.value !== "transparent" || selectedModel?.featureFlags.supportsTransparentBackground
      ),
    [selectedModel]
  );

  useEffect(() => {
    if (selectedModel) {
      setGenerationParams(createSingleOutputGenerationParams(selectedModel));
    }
  }, [selectedModel?.id]);

  useEffect(() => {
    if (!selectedApiKey && showRealKeyInCurl) {
      setShowRealKeyInCurl(false);
    }
  }, [selectedApiKey, showRealKeyInCurl]);

  useEffect(() => {
    if (configuredModels.length === 0) {
      return;
    }

    const currentModelExists = configuredModels.some((model) => model.id === settingsModelId);

    if (!currentModelExists) {
      setSettingsModelId(
        configuredModels.find((model) => model.id === selectedModelId)?.id ?? configuredModels[0].id
      );
    }
  }, [configuredModels, selectedModelId, settingsModelId]);

  useEffect(() => {
    if (!settingsModelBaseModel) {
      return;
    }

    setModelDisplayNameInput(settingsModelOverride?.displayName ?? settingsModelBaseModel.displayName);
    setModelApiModelNameInput(settingsModelOverride?.apiModelName ?? settingsModelBaseModel.apiModelName);
    setModelEndpointVariantInput(
      settingsModelOverride?.endpointVariant ?? resolveOpenAIEndpointVariant(settingsModelBaseModel)
    );
    setModelBaseUrlInput(
      settingsModelOverride?.baseURL
        ? stripKnownEndpointSuffix(settingsModelOverride.baseURL)
        : getModelEndpointPrefix(settingsModelBaseModel)
    );
    setModelApiKeyInput(settingsModelOverride?.apiKey ?? "");
    setShowModelApiKey(false);
  }, [
    settingsModelBaseModel,
    settingsModelOverride?.apiKey,
    settingsModelOverride?.apiModelName,
    settingsModelOverride?.baseURL,
    settingsModelOverride?.displayName,
    settingsModelOverride?.endpointVariant
  ]);

  useEffect(() => {
    if (!selectedModel || referenceImages.length <= selectedModel.capabilities.maxReferenceImages) {
      return;
    }

    const maxCount = selectedModel.capabilities.maxReferenceImages;
    const removedImages = referenceImages.slice(maxCount);
    removedImages.forEach((image) => {
      if (image.previewURL) {
        URL.revokeObjectURL(image.previewURL);
      }
    });
    setReferenceImages(referenceImages.slice(0, maxCount));
    setUploadIssues([
      {
        field: "referenceImages",
        code: "REFERENCE_IMAGE_COUNT_EXCEEDED",
        message: `当前模型最多保留 ${maxCount} 张参考图`,
        blocking: true
      }
    ]);
  }, [referenceImages, selectedModel]);

  const activeSummary = pageSummaries[activePage];
  const studioFrameSrc = `${GPT_STUDIO_BASE_URL}${activeStudioRoute}`;
  const activeNotice = bootstrap.notices[0];
  const canCreateGeneration = activePage === "generation";
  const batchControlsEnabled = bootstrap.featureFlags.enableBatch && canCreateGeneration;
  const effectiveBatchGenerationCount =
    batchControlsEnabled ? clampBatchGenerationCount(batchGenerationCount) : 1;
  const requestGenerationParams = useMemo<GenerationParams>(
    () => ({
      ...generationParams,
      count: clampGenerationImageCount(generationParams.count, selectedModel)
    }),
    [generationParams, selectedModel]
  );
  const costPreviewParams = useMemo<GenerationParams>(
    () => ({
      ...requestGenerationParams,
      count: requestGenerationParams.count * effectiveBatchGenerationCount
    }),
    [effectiveBatchGenerationCount, requestGenerationParams]
  );
  const outputCompressionEnabled =
    supportsOpenAIAdvancedParams &&
    (requestGenerationParams.outputFormat === "jpeg" ||
      requestGenerationParams.outputFormat === "jpg" ||
      requestGenerationParams.outputFormat === "webp");
  const pendingQueueCount = resultQueue.filter((item) => item.status === "queued").length;
  const uploadDisabled =
    !canCreateGeneration || !selectedModel || selectedModel.capabilities.maxReferenceImages <= 0;
  const costPreview = useMemo(
    () => (selectedModel ? estimateGenerationCost(selectedModel, costPreviewParams) : undefined),
    [costPreviewParams, selectedModel]
  );
  const requestCostPreview = useMemo(
    () => (selectedModel ? estimateGenerationCost(selectedModel, requestGenerationParams) : undefined),
    [requestGenerationParams, selectedModel]
  );
  const historyItems = useMemo(() => toHistoryListItems(historyRecords), [historyRecords]);
  const analyticsSummary = useMemo(() => summarizeAnalyticsEvents(analyticsEvents), [analyticsEvents]);
  const selectedHistoryRecord = useMemo(
    () => historyRecords.find((record) => record.id === selectedHistoryRecordId),
    [historyRecords, selectedHistoryRecordId]
  );
  const visiblePromptTemplates = useMemo(
    () => searchPromptTemplates(templateSearch, templateCategoryId),
    [templateCategoryId, templateSearch]
  );
  const compareLeftModel = useMemo(
    () => configuredModels.find((model) => model.id === compareLeftModelId) ?? configuredModels[0],
    [compareLeftModelId, configuredModels]
  );
  const compareRightModel = useMemo(
    () => configuredModels.find((model) => model.id === compareRightModelId) ?? configuredModels[1] ?? configuredModels[0],
    [compareRightModelId, configuredModels]
  );
  const curlPreview = useMemo(
    () =>
      selectedModel
        ? buildCurlPreview({
            model: selectedModel,
            prompt,
            negativePrompt,
            referenceImages,
            params: requestGenerationParams,
            apiKey: selectedApiKey,
            endpointOverride: curlEndpointOverride,
            modelOverride: selectedModelRequestOverride,
            showRealKey: showRealKeyInCurl
          })
        : undefined,
    [
      curlEndpointOverride,
      negativePrompt,
      prompt,
      referenceImages,
      requestGenerationParams,
      selectedApiKey,
      selectedModel,
      selectedModelRequestOverride,
      showRealKeyInCurl
    ]
  );
  const isSubmitting = pendingQueueCount > 0 || requestStatus === "running";
  const activeResultItem = useMemo(
    () =>
      resultQueue.find((item) => item.id === activeResultItemId) ??
      (resultQueue.length > 0 ? resultQueue[0] : undefined),
    [activeResultItemId, resultQueue]
  );
  const activeItemIsQueued = activeResultItem?.status === "queued";
  const resultImageItems = resultQueue.filter((item) => item.status === "success" && item.image?.url);
  const zipDownloadItems = resultImageItems
    .filter((item): item is ResultQueueItem & { image: GeneratedImage } => Boolean(item.image?.url || item.image?.base64))
    .map((item) => ({
      requestId: item.requestId,
      modelDisplayName: item.modelDisplayName,
      prompt: item.prompt,
      image: item.image,
      createdAt: item.createdAt,
      resolutionText: item.resolutionText
    }));
  const previewImage = activeResultItem?.status === "success" ? activeResultItem.image : undefined;
  const visibleError =
    activeResultItem?.status === "failed" ? activeResultItem.error : activeResultItem ? undefined : requestError;
  const formRequestErrorMessage = !activeResultItem
    ? formValidation.errors.find((issue) => issue.field === "request")?.message
    : undefined;
  const requestErrorMessage = visibleError?.message ?? formRequestErrorMessage;
  const requestErrorTitle = visibleError?.title ?? (requestErrorMessage ? "生成失败" : undefined);
  const requestErrorSuggestion = visibleError?.suggestion;
  const requestErrorMeta = formatErrorMeta(visibleError);
  const recognitionErrorMeta = formatErrorMeta(recognitionError);
  const reasoningErrorMeta = formatErrorMeta(reasoningError);
  const currentResultEndpoint = activeResultItem?.endpoint ?? lastRequest?.adapterRequest?.url ?? curlPreview?.endpoint;
  const currentResultModelName =
    activeResultItem?.modelDisplayName ?? selectedModel?.displayName ?? lastRequest?.modelId ?? "gpt-image-2";
  const currentResultRequestModelName =
    activeResultItem?.requestModelName ??
    lastRequest?.adapterRequest?.requestModelName ??
    curlPreview?.requestModelName ??
    selectedModel?.apiModelName ??
    "gpt-image-2";
  const currentResultResolution =
    activeResultItem?.status === "success"
      ? formatActualImageResolution(previewImage)
      : activeResultItem?.resolutionText ?? formatImageResolution(previewImage, costPreview?.resolutionText);
  const baseResultStatusText = formatResultStatus({
    isSubmitting: Boolean(activeItemIsQueued),
    status:
      activeResultItem?.status === "success"
        ? "success"
        : activeResultItem?.status === "failed"
          ? "failed"
          : lastRequest?.result?.status,
    hasImage: Boolean(previewImage?.url),
    errorMessage: requestErrorMessage
  });
  const baseResultHintText = formatResultHint({
    isSubmitting: Boolean(activeItemIsQueued),
    imageCount: resultImageItems.length,
    errorMessage: requestErrorMessage,
    endpoint: currentResultEndpoint
  });
  const resultStatusText =
    !activeItemIsQueued && pendingQueueCount > 0 ? `${pendingQueueCount} 个任务生成中` : baseResultStatusText;
  const resultHintText =
    !activeItemIsQueued && pendingQueueCount > 0
      ? "后台队列仍在等待上游返回，可继续新增生成任务。"
      : baseResultHintText;
  const detailFilename =
    previewImage &&
    createImageDownloadFilename({
      image: previewImage,
      requestId: activeResultItem?.requestId ?? lastRequest?.requestId,
      format: generationParams.outputFormat,
      date: activeResultItem?.createdAt ? new Date(activeResultItem.createdAt) : undefined
    });

  useEffect(() => {
    setPreviewZoom(100);
    setPreviewPan({ x: 0, y: 0 });
    setIsPreviewDragging(false);
    previewDragRef.current = undefined;
  }, [previewImage?.id]);

  useEffect(() => {
    const stage = previewStageRef.current;

    if (!stage) {
      return undefined;
    }

    function handleNativePreviewWheel(event: WheelEvent) {
      if (!previewImage?.url) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setPreviewZoom((value) => clampZoom(value + (event.deltaY < 0 ? 10 : -10)));
    }

    stage.addEventListener("wheel", handleNativePreviewWheel, { capture: true, passive: false });

    return () => {
      stage.removeEventListener("wheel", handleNativePreviewWheel, { capture: true });
    };
  }, [previewImage?.url]);

  useEffect(() => {
    if (!previewImage?.url) {
      setImageDetailsOpen(false);
    }
  }, [previewImage?.url]);

  useEffect(() => {
    setCurlCopyStatus("idle");
    setCurlCopiedAt(undefined);
  }, [curlPreview?.code]);

  function recordAnalytics(name: Parameters<typeof logAnalyticsEvent>[0], properties?: Record<string, unknown>) {
    setAnalyticsEvents(logAnalyticsEvent(name, properties));
  }

  function clearFormValidation() {
    if (!formValidation.isValid || formValidation.warnings.length > 0) {
      setFormValidation(validFormState);
    }
  }

  function markGenerationModelRunning(modelId: string) {
    const currentCount = runningGenerationModelCountsRef.current.get(modelId) ?? 0;
    runningGenerationModelCountsRef.current.set(modelId, currentCount + 1);
  }

  function markGenerationModelFinished(modelId: string) {
    const currentCount = runningGenerationModelCountsRef.current.get(modelId) ?? 0;

    if (currentCount <= 1) {
      runningGenerationModelCountsRef.current.delete(modelId);
      return;
    }

    runningGenerationModelCountsRef.current.set(modelId, currentCount - 1);
  }

  function closeSettingsAfterSave() {
    setSettingsOpen(false);
  }

  function handleClearApiKey() {
    setApiKeyInput("");
    setShowRealKey(false);
    setShowRealKeyInCurl(false);
    setSettingsFeedback({
      target: "main-key",
      message: "主 Key 输入已清空，保存设置后生效"
    });
  }

  function buildCurrentModelSettingsDraft() {
    return {
      displayName: modelDisplayNameInput,
      apiModelName: modelApiModelNameInput,
      endpointVariant: settingsModelUsesOpenAIEndpoint ? modelEndpointVariantInput : undefined,
      baseURL: modelBaseUrlInput,
      apiKey: modelApiKeyInput
    };
  }

  function saveCurrentModelSettings(currentSettings = settings) {
    if (!settingsModelBaseModel) {
      return currentSettings;
    }

    const modelSettingsDraft = buildCurrentModelSettingsDraft();

    return settingsModelIsCustom
      ? saveCustomModelSettings(
          {
            ...settingsCustomModel,
            id: settingsModelBaseModel.id,
            templateModelId: settingsCustomModel?.templateModelId ?? settingsModelBaseModel.id,
            ...modelSettingsDraft,
            displayName: modelDisplayNameInput.trim() || settingsModelBaseModel.displayName,
            apiModelName: modelApiModelNameInput.trim() || settingsModelBaseModel.apiModelName,
            updatedAt: new Date().toISOString()
          },
          currentSettings
        )
      : saveModelEndpointSettings(settingsModelBaseModel.id, modelSettingsDraft, currentSettings);
  }

  function handleSaveAllSettings() {
    let nextSettings = saveMainApiKey(apiKeyInput, settings);
    nextSettings = saveCurrentModelSettings(nextSettings);
    nextSettings = saveUtilityModelSettings(
      {
        recognitionModelName: settingsRecognitionModelInput,
        reasoningModelName: settingsReasoningModelInput
      },
      nextSettings
    );
    nextSettings = saveStorageAndArchiveSettings(
      buildStorageDraft(),
      {
        enabled: localArchiveEnabledInput,
        directoryPath: storagePathInput
      },
      nextSettings
    );

    setSettings(nextSettings);
    setApiKeyInput(nextSettings.mainApiKeyValue ?? "");
    setRecognitionModelName(nextSettings.utilityModels.recognitionModelName);
    setReasoningModelName(nextSettings.utilityModels.reasoningModelName);
    setSettingsRecognitionModelInput(nextSettings.utilityModels.recognitionModelName);
    setSettingsReasoningModelInput(nextSettings.utilityModels.reasoningModelName);
    setStoragePathInput(nextSettings.localArchive.directoryPath ?? DEFAULT_LOCAL_ARCHIVE_DIRECTORY_PATH);
    setShowRealKey(false);
    setShowModelApiKey(false);
    setSettingsFeedback({
      target: "all",
      message: "设置已保存"
    });
    clearFormValidation();
    closeSettingsAfterSave();
  }

  function handleClearModelSettings() {
    if (!settingsModelBaseModel || settingsModelIsCustom) {
      return;
    }

    const nextSettings = clearModelEndpointSettings(settingsModelBaseModel.id, settings);
    setSettings(nextSettings);
    setModelDisplayNameInput(settingsModelBaseModel.displayName);
    setModelApiModelNameInput(settingsModelBaseModel.apiModelName);
    setModelEndpointVariantInput(resolveOpenAIEndpointVariant(settingsModelBaseModel));
    setModelBaseUrlInput(getModelEndpointPrefix(settingsModelBaseModel));
    setModelApiKeyInput("");
    setShowModelApiKey(false);
    setSettingsFeedback({
      target: "model",
      message: "模型配置已清除"
    });
  }

  function handleDuplicateModelSettings() {
    if (!settingsModelBaseModel) {
      return;
    }

    const sourceName = modelDisplayNameInput.trim() || settingsModelBaseModel.displayName;
    const templateModelId = settingsCustomModel?.templateModelId ?? settingsModelBaseModel.id;
    const nextSettings = duplicateModelSettings(
      templateModelId,
      {
        displayName: `${sourceName} 副本`,
        apiModelName: modelApiModelNameInput.trim() || settingsModelBaseModel.apiModelName,
        endpointVariant: settingsModelUsesOpenAIEndpoint ? modelEndpointVariantInput : undefined,
        baseURL: modelBaseUrlInput,
        apiKey: modelApiKeyInput
      },
      settings
    );
    const createdModel = nextSettings.endpoint.customModels.find(
      (model) => !settings.endpoint.customModels.some((existing) => existing.id === model.id)
    );

    setSettings(nextSettings);
    if (createdModel) {
      setSettingsModelId(createdModel.id);
      setSelectedModelId(createdModel.id);
    }
    setSettingsFeedback({
      target: "model",
      message: "已新增自定义模型"
    });
  }

  function handleDeleteModelSettings() {
    if (!settingsModelBaseModel) {
      return;
    }

    const deletedModelId = settingsModelBaseModel.id;
    const nextSettings = deleteModelSettings(deletedModelId, settings);
    const nextConfiguredModels = applyUserModelEndpointSettings(bootstrap.models, nextSettings);
    const fallbackModelId =
      nextConfiguredModels.find((model) => model.id === selectedModelId)?.id ??
      nextConfiguredModels.find((model) => model.id === bootstrap.defaultModelId)?.id ??
      nextConfiguredModels[0]?.id;

    setSettings(nextSettings);
    if (fallbackModelId) {
      setSettingsModelId(fallbackModelId);
      if (!nextConfiguredModels.some((model) => model.id === selectedModelId)) {
        setSelectedModelId(fallbackModelId);
      }
    }
    setSettingsFeedback({
      target: "model",
      message: settingsModelIsCustom ? "自定义模型已删除" : "内置模型已隐藏，可随时恢复"
    });
  }

  function handleRestoreModelSettings() {
    const nextSettings = restoreHiddenModelSettings(settings);
    const nextConfiguredModels = applyUserModelEndpointSettings(bootstrap.models, nextSettings);
    const fallbackModelId =
      nextConfiguredModels.find((model) => model.id === settingsModelId)?.id ??
      nextConfiguredModels.find((model) => model.id === bootstrap.defaultModelId)?.id ??
      nextConfiguredModels[0]?.id;

    setSettings(nextSettings);
    if (fallbackModelId) {
      setSettingsModelId(fallbackModelId);
    }
    setSettingsFeedback({
      target: "model",
      message: "内置模型已恢复"
    });
  }

  async function copyTextToClipboard(text: string) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // Fall through to the DOM copy paths for embedded browsers.
      }
    }

    let eventCopied = false;
    const handleCopy = (event: ClipboardEvent) => {
      event.clipboardData?.setData("text/plain", text);
      event.preventDefault();
      eventCopied = true;
    };

    document.addEventListener("copy", handleCopy);
    const copiedByEvent = document.execCommand("copy");
    document.removeEventListener("copy", handleCopy);

    if (copiedByEvent && eventCopied) {
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.height = "1px";
    textarea.style.opacity = "0";
    textarea.style.position = "fixed";
    textarea.style.left = "0";
    textarea.style.top = "0";
    textarea.style.width = "1px";

    document.body.append(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    const copied = document.execCommand("copy");
    textarea.remove();

    if (!copied) {
      throw new Error("Clipboard copy failed");
    }
  }

  async function handleCopyUtilityText(target: UtilityCopyTarget, text: string) {
    if (!text.trim()) {
      return;
    }

    await copyTextToClipboard(text);
    setUtilityCopyTarget(target);
  }

  function renderUtilityCopyButton(target: UtilityCopyTarget, label: string, text: string) {
    const copied = utilityCopyTarget === target;

    return (
      <button
        className="utility-copy-button"
        disabled={!text.trim()}
        onClick={() => void handleCopyUtilityText(target, text)}
        type="button"
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
        {copied ? "已复制" : label}
      </button>
    );
  }

  async function handleCopyCurl() {
    if (!curlPreview?.code) {
      return;
    }

    if (showRealKeyInCurl && selectedApiKey) {
      const confirmed = window.confirm("cURL 将包含真实 API Key，确认复制？");

      if (!confirmed) {
        return;
      }
    }

    try {
      await copyTextToClipboard(curlPreview.code);
      setCurlCopyStatus("success");
      setCurlCopiedAt(Date.now());
      recordAnalytics("curl_copied", {
        endpoint: curlPreview.endpoint,
        adapterName: curlPreview.adapterName,
        showRealKey: showRealKeyInCurl
      });
    } catch {
      setCurlCopyStatus("failed");
      setCurlCopiedAt(undefined);
    }
  }

  function handleOpenPreviewImage() {
    if (!previewImage?.url) {
      return;
    }

    setImageDetailsOpen(true);
  }

  function handleDownloadPreviewImage() {
    if (!previewImage?.url) {
      return;
    }

    const link = document.createElement("a");

    link.href = previewImage.url;
    link.download = createImageDownloadFilename({
      image: previewImage,
      requestId: activeResultItem?.requestId ?? lastRequest?.requestId,
      format: generationParams.outputFormat
    });
    document.body.append(link);
    link.click();
    link.remove();
  }

  function resetPreviewTransform() {
    previewDragRef.current = undefined;
    setIsPreviewDragging(false);
    setPreviewZoom(100);
    setPreviewPan({ x: 0, y: 0 });
  }

  async function handleDownloadResultZip() {
    if (zipDownloadItems.length === 0 || zipStatus.state === "running") {
      return;
    }

    setZipStatus({ state: "running", message: "正在打包图片", progress: 0 });
    recordAnalytics("zip_download_started", {
      fileCount: zipDownloadItems.length
    });

    try {
      const result = await buildImageResultZip(zipDownloadItems, (progress) => {
        setZipStatus({
          state: "running",
          message: `正在打包图片 ${progress}%`,
          progress
        });
      });
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = result.filename;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setZipStatus({
        state: "success",
        message: `已打包 ${result.fileCount} 张图片`,
        progress: 100
      });
      recordAnalytics("zip_download_finished", {
        fileCount: result.fileCount,
        filename: result.filename
      });
    } catch (error) {
      setZipStatus({
        state: "failed",
        message: error instanceof Error ? error.message : "打包下载失败"
      });
    }
  }

  function handleOpenPromptTemplates() {
    setPromptTemplatesOpen(true);
    recordAnalytics("prompt_template_opened", {
      total: getPromptTemplateCount()
    });
  }

  function handleUsePromptTemplate(templateId: string) {
    const template = PROMPT_TEMPLATE_CATEGORIES.flatMap((category) => category.templates).find(
      (item) => item.id === templateId
    );

    if (!template) {
      return;
    }

    setPrompt(template.prompt);
    setAssetPromptInput(template.prompt);
    setPromptTemplatesOpen(false);
    clearFormValidation();
    recordAnalytics("prompt_template_used", {
      templateId: template.id,
      categoryId: template.categoryId,
      title: template.title
    });
  }

  function handleClearResult() {
    setLastRequest(undefined);
    setRequestError(undefined);
    setResultQueue([]);
    setActiveResultItemId(undefined);
    setImageDetailsOpen(false);
    setRequestStatus("idle");
    resetPreviewTransform();
  }

  function handleDeleteActiveResult() {
    const targetId = activeResultItem?.id ?? activeResultItemId ?? resultQueue[0]?.id;

    if (!targetId) {
      setLastRequest(undefined);
      setRequestError(undefined);
      setImageDetailsOpen(false);
      setRequestStatus(runningRequestIdsRef.current.size > 0 ? "running" : "idle");
      setPreviewZoom(100);
      return;
    }

    const targetIndex = resultQueue.findIndex((item) => item.id === targetId);
    const targetItem = resultQueue[targetIndex];

    if (!targetItem) {
      return;
    }

    const nextQueue = [...resultQueue.slice(0, targetIndex), ...resultQueue.slice(targetIndex + 1)];
    const nextActiveItem = nextQueue[Math.min(targetIndex, nextQueue.length - 1)];

    if (targetItem.status === "queued") {
      runningRequestIdsRef.current.delete(targetItem.requestId);
    }

    const nextRequestStatus: RequestStatus =
      runningRequestIdsRef.current.size > 0
        ? "running"
        : nextQueue.length === 0
          ? "idle"
          : nextActiveItem?.status === "failed"
            ? "failed"
            : "idle";

    setResultQueue(nextQueue);
    setActiveResultItemId(nextActiveItem?.id);
    setRequestError(nextActiveItem?.status === "failed" ? nextActiveItem.error : undefined);
    setImageDetailsOpen(false);
    resetPreviewTransform();
    setRequestStatus(nextRequestStatus);

    if (nextQueue.length === 0) {
      setLastRequest(undefined);
    }
  }

  function handlePreviewPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!previewImage?.url) {
      return;
    }

    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    previewDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: previewPan.x,
      originY: previewPan.y
    };
    setIsPreviewDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePreviewPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const dragState = previewDragRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setPreviewPan({
      x: dragState.originX + event.clientX - dragState.startX,
      y: dragState.originY + event.clientY - dragState.startY
    });
  }

  function handlePreviewPointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    const dragState = previewDragRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    previewDragRef.current = undefined;
    setIsPreviewDragging(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function persistHistoryRecord(record: GenerationHistoryRecord) {
    setHistoryRecords(saveHistoryRecord(record));
  }

  function handleGeneratedImageLoaded(image: GeneratedImage | undefined, width: number, height: number) {
    if (!image?.id || width <= 0 || height <= 0) {
      return;
    }

    const dimensionsAlreadyKnown = image.width === width && image.height === height;

    if (!dimensionsAlreadyKnown) {
      setResultQueue((current) =>
        current.map((item) =>
          item.image?.id === image.id
            ? {
                ...item,
                image: {
                  ...item.image,
                  width,
                  height
                }
              }
            : item
        )
      );
    }

    setHistoryRecords((current) => {
      const record = current.find((item) => item.resultImages.some((resultImage) => resultImage.id === image.id));

      if (!record) {
        return current;
      }

      const resultImages = record.resultImages.map((resultImage) =>
        resultImage.id === image.id && (resultImage.width !== width || resultImage.height !== height)
          ? {
              ...resultImage,
              width,
              height
            }
          : resultImage
      );
      const hasChanged = resultImages.some(
        (resultImage, index) => resultImage.width !== record.resultImages[index]?.width || resultImage.height !== record.resultImages[index]?.height
      );

      if (!hasChanged) {
        return current;
      }

      return saveHistoryRecord({
        ...record,
        resultImages,
        updatedAt: new Date().toISOString()
      });
    });
  }

  function handleClearHistory() {
    setHistoryRecords(clearHistoryRecords());
    setSelectedHistoryRecordId(undefined);
  }

  function handleOpenHistoryDetail(record: GenerationHistoryRecord) {
    setSelectedHistoryRecordId(record.id);
    recordAnalytics("history_detail_opened", {
      status: record.status,
      imageCount: record.resultImages.length
    });
  }

  function handleReuseHistoryRecord(record: GenerationHistoryRecord) {
    const reusableModel = configuredModels.find((model) => model.id === record.modelId);
    const fallbackModel = configuredModels.find((model) => model.id === bootstrap.defaultModelId) ?? configuredModels[0];
    const modelExists = Boolean(reusableModel);

    if (!fallbackModel) {
      return;
    }

    setSelectedModelId(reusableModel?.id ?? fallbackModel?.id ?? bootstrap.defaultModelId);
    setGenerationParams(
      reusableModel
        ? { ...record.params, count: clampGenerationImageCount(record.params.count, reusableModel) }
        : createSingleOutputGenerationParams(fallbackModel)
    );
    setPrompt(record.promptSummary ?? "");
    setNegativePrompt("");
    setActivePage("generation");
    setFormValidation(
      modelExists
        ? validFormState
        : {
            isValid: true,
            errors: [],
            warnings: [
              {
                field: "modelId",
                code: "HISTORY_MODEL_MISSING",
                message: "历史记录中的模型当前不可用，已回退到默认模型。",
                blocking: false
              }
            ]
          }
    );
  }

  function handleSaveAssetTemplate() {
    const template = createAssetTemplate({
      name: assetNameInput,
      prompt: assetPromptInput,
      tags: assetTagsInput.split(/[,，\s]+/),
      referenceCount: referenceImages.length
    });

    setAssetTemplates(saveAssetTemplate(template));
    setAssetNameInput("新素材模板");
    setAssetTagsInput("写实, 可复用");
    recordAnalytics("asset_template_saved", {
      tagCount: template.tags.length,
      referenceCount: template.referenceCount
    });
  }

  function handleDeleteAssetTemplate(templateId: string) {
    setAssetTemplates(deleteAssetTemplate(templateId));
  }

  function handleUseAssetTemplate(templateId: string) {
    const template = assetTemplates.find((item) => item.id === templateId);

    if (!template) {
      return;
    }

    setPrompt(template.prompt);
    setAssetPromptInput(template.prompt);
    setActivePage("generation");
    clearFormValidation();
    recordAnalytics("asset_template_used", {
      templateId,
      tagCount: template.tags.length
    });
  }

  async function handleIncomingFiles(fileList: FileList | File[]) {
    if (uploadDisabled || !selectedModel) {
      return;
    }

    const files = Array.from(fileList);
    const validation = validateReferenceImageFiles(files, selectedModel.capabilities, referenceImages.length);
    let nextImages: ReferenceImage[] = [];

    try {
      nextImages = await Promise.all(
        validation.acceptedFiles.map((file, index) => createReferenceImageWithBase64(file, index))
      );
    } catch {
      setUploadIssues([
        ...validation.issues,
        {
          field: "referenceImages",
          code: "REFERENCE_IMAGE_READ_FAILED",
          message: "参考图内容读取失败，请重新选择图片后再试。",
          blocking: true
        }
      ]);
      return;
    }

    setReferenceImages((current) => [
      ...current,
      ...nextImages.map((image, index) => ({
        ...image,
        order: current.length + index
      }))
    ]);
    setUploadIssues(validation.issues);
    clearFormValidation();
  }

  function handleRemoveReferenceImage(imageId: string) {
    setReferenceImages((current) => {
      const image = current.find((item) => item.id === imageId);

      if (image?.previewURL) {
        URL.revokeObjectURL(image.previewURL);
      }

      return current
        .filter((item) => item.id !== imageId)
        .map((item, index) => ({
          ...item,
          order: index
        }));
    });
    clearFormValidation();
  }

  async function handleRecognitionFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    const validation = validateReferenceImageFiles(files, UTILITY_REFERENCE_IMAGE_CAPABILITIES, recognitionImages.length);
    let nextImages: ReferenceImage[] = [];

    try {
      nextImages = await Promise.all(
        validation.acceptedFiles.map((file, index) => createReferenceImageWithBase64(file, index))
      );
    } catch {
      setRecognitionIssues([
        ...validation.issues,
        {
          field: "referenceImages",
          code: "REFERENCE_IMAGE_READ_FAILED",
          message: "图片内容读取失败，请重新选择图片后再试。",
          blocking: true
        }
      ]);
      return;
    }

    setRecognitionImages((current) => [
      ...current,
      ...nextImages.map((image, index) => ({
        ...image,
        order: current.length + index
      }))
    ]);
    setRecognitionIssues(validation.issues);
  }

  async function handleReasoningFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    const validation = validateReferenceImageFiles(files, UTILITY_REFERENCE_IMAGE_CAPABILITIES, reasoningImages.length);
    let nextImages: ReferenceImage[] = [];

    try {
      nextImages = await Promise.all(
        validation.acceptedFiles.map((file, index) => createReferenceImageWithBase64(file, index))
      );
    } catch {
      setReasoningIssues([
        ...validation.issues,
        {
          field: "referenceImages",
          code: "REFERENCE_IMAGE_READ_FAILED",
          message: "图片内容读取失败，请重新选择图片后再试。",
          blocking: true
        }
      ]);
      return;
    }

    setReasoningImages((current) => [
      ...current,
      ...nextImages.map((image, index) => ({
        ...image,
        order: current.length + index
      }))
    ]);
    setReasoningIssues(validation.issues);
  }

  function handleRemoveRecognitionImage(imageId: string) {
    setRecognitionImages((current) => {
      const image = current.find((item) => item.id === imageId);

      if (image?.previewURL) {
        URL.revokeObjectURL(image.previewURL);
      }

      return current
        .filter((item) => item.id !== imageId)
        .map((item, index) => ({
          ...item,
          order: index
        }));
    });
  }

  function handleRemoveReasoningImage(imageId: string) {
    setReasoningImages((current) => {
      const image = current.find((item) => item.id === imageId);

      if (image?.previewURL) {
        URL.revokeObjectURL(image.previewURL);
      }

      return current
        .filter((item) => item.id !== imageId)
        .map((item, index) => ({
          ...item,
          order: index
        }));
    });
  }

  function handleRecognitionPaste(event: ReactClipboardEvent<HTMLElement>) {
    const imageFiles = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));

    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    void handleRecognitionFiles(imageFiles);
  }

  function handleReasoningPaste(event: ReactClipboardEvent<HTMLElement>) {
    const imageFiles = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));

    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    void handleReasoningFiles(imageFiles);
  }

  function handleRecognitionRoleChange(nextRole: RecognitionRole) {
    const nextConfig = getRecognitionRoleConfig(nextRole);

    setRecognitionRole(nextConfig.id);
    setRecognitionModelName(nextConfig.defaultModel || DEFAULT_VISION_RECOGNITION_MODEL);
    setRecognitionQuestion(nextConfig.prompt);
  }

  function handleReasoningPlatformChange(nextPlatform: ReasoningPlatformId) {
    const nextPlatformConfig = getReasoningPlatform(nextPlatform);
    const nextModel = getDefaultReasoningModel(nextPlatform);

    setReasoningPlatform(nextPlatform);
    setReasoningModelName(nextModel.id);
    setReasoningEffort(nextModel.default);
    setReasoningApiStyle(nextPlatformConfig.defaultApiStyle ?? "responses");
  }

  function handleReasoningModelPresetChange(nextModelName: string) {
    const nextModel = reasoningPlatformConfig.models.find((model) => model.id === nextModelName);

    setReasoningModelName(nextModelName);

    if (nextModel) {
      setReasoningEffort(nextModel.default);
    }
  }

  function handleCancelRecognitionRequest() {
    recognitionAbortRef.current?.abort();
    recognitionAbortRef.current = undefined;
    setRecognitionStatus("cancelled");
    setRecognitionError(
      createLocalVisibleError({
        code: "RECOGNITION_ABORTED",
        title: "识图已中止",
        message: "当前识图请求已在浏览器端取消，可调整图片或提示词后重新开始。",
        type: "validation"
      })
    );
  }

  async function handleCreateRecognitionDraft() {
    if (recognitionStatus === "running") {
      handleCancelRecognitionRequest();
      return;
    }

    const recognitionDraftModel = selectedModel
      ? {
          ...selectedModel,
          apiModelName: recognitionRequestModelName
        }
      : undefined;
    const draft = createRecognitionDraft({
      role: recognitionRole,
      question: recognitionQuestion,
      model: recognitionDraftModel,
      images: recognitionImages
    });

    setRecognitionDraft(draft);
    setRecognitionResult(undefined);
    setRecognitionError(undefined);

    if (!selectedModel) {
      setRecognitionStatus("failed");
      setRecognitionError(
        createLocalVisibleError({
          code: "MODEL_REQUIRED",
          title: "缺少模型",
          message: "请先选择一个可用模型。",
          type: "validation"
        })
      );
      return;
    }

    if (recognitionImages.length === 0) {
      setRecognitionStatus("failed");
      setRecognitionError(
        createLocalVisibleError({
          code: "IMAGE_REQUIRED",
          title: "缺少识别图片",
          message: "请先上传至少一张图片。",
          type: "validation"
        })
      );
      return;
    }

    if (!selectedApiKey) {
      const apiError = createLocalVisibleError({
        code: "API_KEY_REQUIRED",
        title: "缺少 API Key",
        message: "请先在设置中保存主 Key 或当前模型 Key。",
        type: "auth"
      });

      setRecognitionStatus("failed");
      setRecognitionError(apiError);
      setSettingsOpen(true);
      return;
    }

    const abortController = new AbortController();
    recognitionAbortRef.current?.abort();
    recognitionAbortRef.current = abortController;
    setRecognitionStatus("running");
    recordAnalytics("image_recognition_started", {
      role: recognitionRole,
      imageCount: recognitionImages.length,
      modelId: selectedModel?.id ?? "",
      modelName: recognitionRequestModelName
    });

    try {
      const result = await analyzeRecognitionRequest({
        requestId: createClientRequestId(),
        modelId: selectedModel.id,
        role: recognitionRole,
        question: recognitionQuestion,
        images: recognitionImages.map(toResponsesImageInput),
        endpointOverride: selectedEndpointOverride,
        modelOverride: {
          ...selectedModelRequestOverride,
          apiModelName: recognitionRequestModelName
        }
      }, abortController.signal);

      if (recognitionAbortRef.current !== abortController) {
        return;
      }

      setRecognitionResult(result);
      setRecognitionStatus("success");
      recordAnalytics("image_recognition_completed", {
        role: recognitionRole,
        imageCount: recognitionImages.length,
        modelId: selectedModel.id,
        modelName: result.modelName,
        durationMs: result.durationMs
      });
    } catch (error) {
      if (isAbortLikeError(error)) {
        if (recognitionAbortRef.current === abortController) {
          setRecognitionStatus("cancelled");
          setRecognitionError(
            createLocalVisibleError({
              code: "RECOGNITION_ABORTED",
              title: "识图已中止",
              message: "当前识图请求已取消。",
              type: "validation"
            })
          );
        }
        return;
      }

      if (recognitionAbortRef.current !== abortController) {
        return;
      }

      const apiError =
        (error instanceof GenerationApiError ? error.apiError : undefined) ??
        createLocalVisibleError({
          code: "RECOGNITION_REQUEST_FAILED",
          title: "识图请求失败",
          message: error instanceof Error ? error.message : "识图请求失败",
          retryable: true
        });

      setRecognitionStatus("failed");
      setRecognitionError(apiError);
    } finally {
      if (recognitionAbortRef.current === abortController) {
        recognitionAbortRef.current = undefined;
      }
    }
  }

  function handleCancelReasoningRequest() {
    reasoningAbortRef.current?.abort();
    reasoningAbortRef.current = undefined;
    setReasoningStatus("cancelled");
    setReasoningError(
      createLocalVisibleError({
        code: "REASONING_ABORTED",
        title: "推理已中止",
        message: "当前推理请求已在浏览器端取消，可调整输入后重新开始。",
        type: "validation"
      })
    );
  }

  async function handlePolishSuitePrompt(request: PromptPolishRequest) {
    if (!selectedModel) {
      throw new Error("请先选择一个用于提供请求地址的模型配置。");
    }

    if (!selectedApiKey) {
      setSettingsActiveTab("api-model");
      setSettingsOpen(true);
      throw new Error("请先在设置中保存主 API Key 或当前模型 API Key。");
    }

    const modelName =
      settings.utilityModels.reasoningModelName.trim() ||
      DEFAULT_UTILITY_REASONING_MODEL_NAME;
    const result = await runReasoningRequest({
      requestId: createClientRequestId(),
      modelId: selectedModel.id,
      platform: inferPromptPolishPlatform(modelName),
      modelName,
      effort: "low",
      maxTokens: 2048,
      prompt: buildPromptPolishInstruction(request),
      apiStyle: "responses",
      wantSummary: false,
      endpointOverride: selectedEndpointOverride,
      modelOverride: {
        ...selectedModelRequestOverride,
        apiModelName: modelName
      }
    });

    return extractPolishedPrompt(result.outputText);
  }

  async function handleCreateReasoningDraft() {
    if (reasoningStatus === "running") {
      handleCancelReasoningRequest();
      return;
    }

    const draft = createReasoningDraft({
      platform: reasoningPlatform,
      modelName: reasoningRequestModelName,
      effort: reasoningEffort,
      maxTokens: reasoningMaxTokens,
      prompt: reasoningPrompt,
      hasReferenceImage: reasoningImages.length > 0,
      apiStyle: reasoningApiStyle,
      wantSummary: reasoningWantSummary
    });

    setReasoningDraft(draft);
    setReasoningResult(undefined);
    setReasoningError(undefined);

    if (!selectedModel) {
      setReasoningStatus("failed");
      setReasoningError(
        createLocalVisibleError({
          code: "MODEL_REQUIRED",
          title: "缺少端点模型",
          message: "请先选择一个用于提供 baseUrl 和 API Key 的模型配置。",
          type: "validation"
        })
      );
      return;
    }

    if (!selectedApiKey) {
      const apiError = createLocalVisibleError({
        code: "API_KEY_REQUIRED",
        title: "缺少 API Key",
        message: "请先在设置中保存主 Key 或当前模型 Key。",
        type: "auth"
      });

      setReasoningStatus("failed");
      setReasoningError(apiError);
      setSettingsOpen(true);
      return;
    }

    const abortController = new AbortController();
    reasoningAbortRef.current?.abort();
    reasoningAbortRef.current = abortController;
    setReasoningStatus("running");
    recordAnalytics("reasoning_request_started", {
      platform: reasoningPlatform,
      modelName: reasoningRequestModelName,
      effort: reasoningEffort,
      maxTokens: reasoningMaxTokens
    });

    try {
      const result = await runReasoningRequest({
        requestId: createClientRequestId(),
        modelId: selectedModel.id,
        platform: reasoningPlatform,
        modelName: reasoningRequestModelName,
        effort: reasoningEffort,
        maxTokens: reasoningMaxTokens,
        prompt: reasoningPrompt,
        referenceImages: mergeResponsesImageInputs(reasoningImages),
        apiStyle: reasoningApiStyle,
        wantSummary: reasoningWantSummary,
        endpointOverride: selectedEndpointOverride,
        modelOverride: {
          ...selectedModelRequestOverride,
          apiModelName: reasoningRequestModelName
        }
      }, abortController.signal);

      if (reasoningAbortRef.current !== abortController) {
        return;
      }

      setReasoningResult(result);
      setReasoningStatus("success");
      recordAnalytics("reasoning_request_completed", {
        platform: reasoningPlatform,
        modelName: result.modelName,
        effort: reasoningEffort,
        durationMs: result.durationMs
      });
    } catch (error) {
      if (isAbortLikeError(error)) {
        if (reasoningAbortRef.current === abortController) {
          setReasoningStatus("cancelled");
          setReasoningError(
            createLocalVisibleError({
              code: "REASONING_ABORTED",
              title: "推理已中止",
              message: "当前推理请求已取消。",
              type: "validation"
            })
          );
        }
        return;
      }

      if (reasoningAbortRef.current !== abortController) {
        return;
      }

      const apiError =
        (error instanceof GenerationApiError ? error.apiError : undefined) ??
        createLocalVisibleError({
          code: "REASONING_REQUEST_FAILED",
          title: "推理请求失败",
          message: error instanceof Error ? error.message : "推理请求失败",
          retryable: true
        });

      setReasoningStatus("failed");
      setReasoningError(apiError);
    } finally {
      if (reasoningAbortRef.current === abortController) {
        reasoningAbortRef.current = undefined;
      }
    }
  }

  function buildStorageDraft() {
    return {
      activeType: storageTypeInput,
      defaultCloudEnabled: defaultCloudEnabledInput,
      r2: {
        endpoint: r2EndpointInput,
        bucket: r2BucketInput,
        accessKeyId: r2AccessKeyInput,
        secretAccessKey: r2SecretKeyInput
      },
      oss: {
        endpoint: ossEndpointInput,
        bucket: ossBucketInput,
        accessKeyId: ossAccessKeyInput,
        accessKeySecret: ossSecretKeyInput
      }
    };
  }

  function handleTestStorageSettings() {
    const storageDraft = {
      ...settings.storage,
      ...buildStorageDraft()
    };
    const result = testStorageConnectionSettings(storageDraft);
    const nextSettings = saveStorageAndArchiveSettings(
      {
        ...storageDraft,
        lastTestResult: result
      },
      {
        enabled: localArchiveEnabledInput,
        directoryPath: storagePathInput
      },
      settings
    );

    setSettings(nextSettings);
    setSettingsFeedback({
      target: "storage",
      message: result.message
    });
    recordAnalytics("storage_settings_tested", {
      type: result.type,
      success: result.success
    });
  }

  async function handleCreateCompare() {
    if (!compareLeftModel || !compareRightModel) {
      return;
    }

    const leftParams = {
      ...createDefaultGenerationParams(compareLeftModel),
      ratio: compareRatio,
      resolution: compareLeftResolution,
      count: 1
    };
    const rightParams = {
      ...createDefaultGenerationParams(compareRightModel),
      ratio: compareRatio,
      resolution: compareRightResolution,
      count: 1
    };
    const slotInputs = [
      { slot: "left" as const, model: compareLeftModel, params: leftParams },
      { slot: "right" as const, model: compareRightModel, params: rightParams }
    ];
    const { pendingSlots, skippedModelNames: skippedModels } = planCompareGenerationSlots(
      slotInputs,
      runningGenerationModelCountsRef.current.keys(),
      runningCompareModelIdsRef.current
    );

    const skipWarnings: ValidationIssue[] = Array.from(new Set(skippedModels)).map((modelName) => ({
      field: "compare",
      code: "COMPARE_MODEL_RUNNING",
      message: `${modelName} 正在生成中，已跳过重复请求。`,
      blocking: false
    }));

    if (pendingSlots.length === 0) {
      setFormValidation({
        isValid: true,
        errors: [],
        warnings: skipWarnings
      });
      return;
    }

    const validations = pendingSlots.map((slotInput) =>
      validateGenerationForm({
        model: slotInput.model,
        prompt: comparePrompt,
        referenceImages: [],
        params: slotInput.params,
        apiKey: resolveModelApiKey(settings, slotInput.model.id),
        requireApiKey: true
      })
    );
    const validationErrors = validations.flatMap((validation) => validation.errors);

    if (validationErrors.length > 0) {
      setFormValidation({
        isValid: false,
        errors: validationErrors,
        warnings: skipWarnings
      });
      if (validationErrors.some((issue) => issue.code === "API_KEY_REQUIRED")) {
        setSettingsOpen(true);
      }
      return;
    }

    pendingSlots.forEach((slotInput) => runningCompareModelIdsRef.current.add(slotInput.model.id));

    setCompareResult((current) => {
      const next = { ...current };
      pendingSlots.forEach((slotInput) => {
        next[slotInput.slot] = {
          status: "running",
          modelId: slotInput.model.id,
          modelDisplayName: slotInput.model.displayName
        };
      });
      return next;
    });
    setFormValidation({
      isValid: true,
      errors: [],
      warnings: skipWarnings
    });
    recordAnalytics("compare_started", {
      leftModelId: compareLeftModel.id,
      rightModelId: compareRightModel.id,
      ratio: compareRatio,
      startedModelIds: pendingSlots.map((slotInput) => slotInput.model.id),
      skippedModelNames: skippedModels
    });

    const runSlot = async (slot: "left" | "right", model: ModelConfig, params: GenerationParams) => {
      const requestId = createClientRequestId();
      const payload = buildGenerationRequestPayload({
        model,
        prompt: comparePrompt,
        referenceImages: [],
        params,
        requestId,
        endpointOverride: buildEndpointOverrideFromSettings(settings, model, {
          includeApiKey: true
        }),
        modelOverride: buildModelRequestOverrideFromSettings(settings, model.id),
        clientContext: {
          page: "compare",
          lang: bootstrap.lang,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          source: "model-compare"
        }
      });

      try {
        const response = await createGenerationRequest(payload);
        const hasImages = Boolean(response.result?.images.length);
        const nextResult: CompareSlotResult = hasImages
          ? { status: "success", modelId: model.id, modelDisplayName: model.displayName, response }
          : {
              status: "failed",
              modelId: model.id,
              modelDisplayName: model.displayName,
              response,
              error:
                response.result?.error ??
                createLocalVisibleError({
                  code: "NO_IMAGE",
                  title: "未返回图片",
                  message: "对比请求已返回，但没有可展示图片。",
                  retryable: true
                })
            };

        setCompareResult((current) => ({
          ...current,
          [slot]: nextResult
        }));
      } catch (error) {
        const apiError =
          (error instanceof GenerationApiError ? error.apiError : undefined) ??
          createLocalVisibleError({
            code: "COMPARE_REQUEST_FAILED",
            title: "对比请求失败",
            message: error instanceof Error ? error.message : "模型对比请求失败",
            retryable: true
          });

        setCompareResult((current) => ({
          ...current,
          [slot]: {
            status: "failed",
            modelId: model.id,
            modelDisplayName: model.displayName,
            error: apiError
          }
        }));
      } finally {
        runningCompareModelIdsRef.current.delete(model.id);
      }
    };

    pendingSlots.forEach((slotInput) => {
      void runSlot(slotInput.slot, slotInput.model, slotInput.params);
    });
  }

  function handleCreateGeneration() {
    if (!selectedModel || !canCreateGeneration) {
      return;
    }

    const submittedModel = selectedModel;
    const submittedPage = activePage;
    const submittedBatchCount = batchControlsEnabled ? clampBatchGenerationCount(batchGenerationCount) : 1;
    const submittedParams = { ...requestGenerationParams };
    const submittedPrompt = prompt;
    const submittedNegativePrompt = negativePrompt;
    const submittedReferenceImages = referenceImages;
    const submittedEndpointOverride = selectedEndpointOverride;
    const submittedModelRequestOverride = selectedModelRequestOverride;
    const submittedEndpoint = curlPreview?.endpoint;
    const submittedResolutionText = costPreview?.resolutionText;
    const submittedEstimatedCostText = requestCostPreview?.estimatedCostText;
    const validation = validateGenerationForm({
      model: submittedModel,
      prompt: submittedPrompt,
      referenceImages: prepareGenerationReferences(referenceImages),
      params: submittedParams,
      apiKey: selectedApiKey,
      requireApiKey: true
    });
    setRequestError(undefined);
    setFormValidation(validation);

    if (!validation.isValid) {
      if (validation.errors.some((issue) => issue.code === "API_KEY_REQUIRED")) {
        setSettingsOpen(true);
      }
      return;
    }

    const queuedWork = Array.from({ length: submittedBatchCount }, (_, index) => {
      const requestId = createClientRequestId();
      const queuedItem: ResultQueueItem = {
        id: `queue-${requestId}`,
        requestId,
        status: "queued",
        createdAt: new Date().toISOString(),
        modelId: submittedModel.id,
        modelDisplayName: submittedModel.displayName,
        requestModelName: submittedModelRequestOverride?.apiModelName ?? submittedModel.apiModelName,
        prompt: submittedPrompt,
        negativePrompt: submittedNegativePrompt,
        params: submittedParams,
        endpoint: submittedEndpoint,
        resolutionText: submittedResolutionText,
        imageCount: submittedParams.count,
        batchIndex: submittedBatchCount > 1 ? index + 1 : undefined,
        batchTotal: submittedBatchCount > 1 ? submittedBatchCount : undefined
      };
      const payload = buildGenerationRequestPayload({
        model: submittedModel,
        prompt: submittedPrompt,
        negativePrompt: submittedNegativePrompt,
        referenceImages: submittedReferenceImages,
        params: submittedParams,
        requestId,
        endpointOverride: submittedEndpointOverride,
        modelOverride: submittedModelRequestOverride,
        clientContext: {
          page: submittedPage,
          lang: bootstrap.lang,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          source: "web-workbench"
        }
      });

      return {
        payload,
        queuedItem
      };
    });

    queuedWork.forEach(({ queuedItem }) => {
      runningRequestIdsRef.current.add(queuedItem.requestId);
      markGenerationModelRunning(queuedItem.modelId);
    });

    setRequestStatus("running");
    setRequestError(undefined);
    setImageDetailsOpen(false);
    setResultQueue((current) => [...queuedWork.map((item) => item.queuedItem), ...current]);
    setActiveResultItemId(queuedWork[0]?.queuedItem.id);
    recordAnalytics(submittedBatchCount > 1 ? "batch_started" : "generation_started", {
      page: submittedPage,
      modelId: submittedModel.id,
      count: submittedBatchCount * submittedParams.count,
      batchCount: submittedBatchCount,
      imageCount: submittedParams.count,
      totalRequestedImages: submittedBatchCount * submittedParams.count,
      endpoint: submittedEndpoint ?? ""
    });

    queuedWork.forEach(({ payload, queuedItem }) => {
      void submitQueuedGeneration({
        payload,
        queuedItem,
        submittedEstimatedCostText,
        submittedModel,
        submittedParams,
        submittedPrompt
      });
    });
  }

  async function submitQueuedGeneration(input: {
    payload: ReturnType<typeof buildGenerationRequestPayload>;
    queuedItem: ResultQueueItem;
    submittedEstimatedCostText?: string;
    submittedModel: ModelConfig;
    submittedParams: GenerationParams;
    submittedPrompt: string;
  }) {
    const { payload, queuedItem, submittedEstimatedCostText, submittedModel, submittedParams, submittedPrompt } = input;

    try {
      const response = await createGenerationRequest(payload);
      const responseImages = response.result?.images ?? [];
      const responseEndpoint = response.adapterRequest?.url ?? queuedItem.endpoint;
      const responseRequestModelName = response.adapterRequest?.requestModelName ?? queuedItem.requestModelName;
      const responseAcceptedAt = response.acceptedAt ?? queuedItem.createdAt;
      const replacementItems: ResultQueueItem[] =
        responseImages.length > 0
          ? responseImages.map((image) => ({
              ...queuedItem,
              id: `${queuedItem.id}-image-${image.index}`,
              status: "success",
              acceptedAt: responseAcceptedAt,
              endpoint: responseEndpoint,
              requestModelName: responseRequestModelName,
              image,
              imageCount: responseImages.length,
              durationMs: response.result?.durationMs,
              error: undefined
            }))
          : [
              {
                ...queuedItem,
                id: `${queuedItem.id}-failed`,
                status: "failed",
                acceptedAt: responseAcceptedAt,
                endpoint: responseEndpoint,
                requestModelName: responseRequestModelName,
                imageCount: 0,
                durationMs: response.result?.durationMs,
                error:
                  response.result?.error ??
                  createLocalVisibleError({
                    code: "NO_IMAGE",
                    title: "未返回图片",
                    message: "上游响应中没有可展示的图片。",
                    retryable: true
                  })
              }
            ];

      setLastRequest(response);
      setResultQueue((current) => replaceQueueItem(current, queuedItem.id, replacementItems));
      setActiveResultItemId((current) => (current === queuedItem.id ? replacementItems[0]?.id : current));
      setRequestError(replacementItems[0]?.status === "failed" ? replacementItems[0].error : undefined);
      persistHistoryRecord(
        createHistoryRecordFromResponse({
          response,
          modelDisplayName: submittedModel.displayName,
          prompt: submittedPrompt,
          params: submittedParams
        })
      );
      runningRequestIdsRef.current.delete(queuedItem.requestId);
      markGenerationModelFinished(queuedItem.modelId);
      if (runningRequestIdsRef.current.size === 0) {
        setRequestStatus(replacementItems[0]?.status === "failed" ? "failed" : "idle");
      }
    } catch (error) {
      const apiError =
        (error instanceof GenerationApiError ? error.apiError : undefined) ??
        createLocalVisibleError({
          code: "GENERATION_REQUEST_FAILED",
          title: "生成请求失败",
          message: error instanceof Error ? error.message : "创建生成请求失败",
          retryable: true
        });
      const failedItem: ResultQueueItem = {
        ...queuedItem,
        id: `${queuedItem.id}-failed`,
        status: "failed",
        imageCount: 0,
        error: apiError
      };

      setRequestError(apiError);
      setResultQueue((current) => replaceQueueItem(current, queuedItem.id, [failedItem]));
      setActiveResultItemId((current) => (current === queuedItem.id ? failedItem.id : current));
      persistHistoryRecord(
        createHistoryRecord({
          requestId: queuedItem.requestId,
          status: "failed",
          modelId: submittedModel.id,
          modelDisplayName: submittedModel.displayName,
          prompt: submittedPrompt,
          params: submittedParams,
          error: apiError,
          estimatedCostText: submittedEstimatedCostText
        })
      );
      setFormValidation({
        isValid: false,
        errors: [
          {
            field: "request",
            code: "GENERATION_REQUEST_FAILED",
            message: apiError?.message ?? (error instanceof Error ? error.message : "创建生成请求失败"),
            blocking: true
          }
        ],
        warnings: []
      });
      runningRequestIdsRef.current.delete(queuedItem.requestId);
      markGenerationModelFinished(queuedItem.modelId);
      if (runningRequestIdsRef.current.size === 0) {
        setRequestStatus("failed");
      }
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="工作台导航">
        <div className="brand">
          <span className="brand-mark">
            <Sparkles size={20} />
          </span>
          <span>
            <strong>AI Image Master</strong>
            <small>api2Image</small>
          </span>
        </div>

        <nav className="nav-list">
          {bootstrap.navItems.map((item: NavItemConfig) => {
            const Icon = icons[item.key];
            const isActive = item.key !== "settings" && item.key === activePage;

            return (
              <button
                className={`nav-item${isActive ? " active" : ""}`}
                disabled={!item.enabled}
                key={item.key}
                onClick={() => {
                  if (item.key === "settings") {
                    setSettingsModelId(selectedModel?.id ?? selectedModelId);
                    setSettingsOpen(true);
                    return;
                  }

                  setActivePage(item.key);
                }}
                type="button"
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {!item.enabled && <em>未开放</em>}
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="notice">
            <Box size={18} />
            <span>{activeNotice.title}</span>
            <strong>{activeNotice.content}</strong>
          </div>
          <div className="runtime-pill">{loadingConfig ? "配置加载中" : `v${bootstrap.appVersion}`}</div>
        </header>

        <section
          className={`page-surface${activePage === "studio" ? " studio-page-surface" : ""}${
            activePage === "generation" ? " generation-page-surface" : ""
          }`}
        >
          {activePage !== "studio" && (
            <div className="page-heading">
              <span>{activeSummary.eyebrow}</span>
              <h1>{activeSummary.title}</h1>
              <p>{activeSummary.status}</p>
            </div>
          )}

          {activePage === "studio" ? (
            <section className="studio-embed-view" aria-label="GPT-Image2 Studio">
              <aside className="studio-route-panel" aria-label="GPT Studio 功能入口">
                <div className="studio-route-panel-head">
                  <span>GPT-Image2-Studio</span>
                  <strong>{GPT_STUDIO_FEATURE_ROUTES.length} 个功能入口</strong>
                </div>
                <div className="studio-route-grid">
                  {GPT_STUDIO_FEATURE_ROUTES.map((feature) => {
                    const isActiveStudioRoute = feature.route === activeStudioRoute;

                    return (
                      <button
                        className={`studio-route-button${isActiveStudioRoute ? " is-active" : ""}`}
                        data-studio-route={feature.route}
                        key={feature.id}
                        onClick={() => setActiveStudioRoute(feature.route)}
                        type="button"
                      >
                        <span>{feature.label}</span>
                        <small>{feature.note}</small>
                      </button>
                    );
                  })}
                </div>
                <a className="studio-open-link" href={studioFrameSrc} rel="noreferrer" target="_blank">
                  <Maximize2 size={15} />
                  新窗口打开
                </a>
              </aside>
              <iframe
                className="studio-embed-frame"
                src={studioFrameSrc}
                title="GPT-Image2 Studio"
              />
            </section>
          ) : activePage === "history" ? (
            <section className="history-view" aria-label="历史记录列表">
              <div className="history-toolbar">
                <div>
                  <strong>{historyItems.length}</strong>
                  <span>本地记录</span>
                </div>
                <button
                  className="secondary-action danger-action"
                  disabled={historyItems.length === 0}
                  onClick={handleClearHistory}
                  type="button"
                >
                  <Trash2 size={15} />
                  清空历史
                </button>
              </div>

              {historyItems.length === 0 ? (
                <div className="history-empty">
                  <Clock3 size={34} />
                  <strong>0 条记录</strong>
                  <span>完成一次生成后，记录会显示在这里。</span>
                </div>
              ) : (
                <div className="history-list">
                  {historyItems.map((item) => {
                    const record = historyRecords.find((historyRecord) => historyRecord.id === item.id);

                    return (
                      <article className="history-card" key={item.id}>
                        <div className="history-thumb">
                          {item.thumbnailURL ? (
                            <img alt={`${item.modelDisplayName} 历史缩略图`} src={item.thumbnailURL} />
                          ) : (
                            <Images size={24} />
                          )}
                        </div>
                        <div className="history-card-main">
                          <div className="history-card-title">
                            <strong>{item.modelDisplayName}</strong>
                            <span className={`history-status status-${item.status}`}>{formatHistoryStatus(item.status)}</span>
                          </div>
                          <p>{item.promptSummary ?? "无提示词摘要"}</p>
                          <div className="history-meta">
                            <span>{formatPanelTime(item.createdAt)}</span>
                            <span>{item.imageCount} 张</span>
                            <span>{item.costText ?? "费用待确认"}</span>
                            <span>{formatDuration(item.durationMs)}</span>
                            {item.temporary && <span>临时链接</span>}
                          </div>
                        </div>
                        <div className="history-actions">
                          <button
                            className="secondary-action"
                            disabled={!record}
                            onClick={() => record && handleOpenHistoryDetail(record)}
                            type="button"
                          >
                            <Eye size={15} />
                            详情
                          </button>
                          <button
                            className="secondary-action"
                            disabled={!record}
                            onClick={() => record && handleReuseHistoryRecord(record)}
                            type="button"
                          >
                            <RotateCcw size={15} />
                            复用
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          ) : activePage === "assets" ? (
            <section className="utility-view" aria-label="素材模板">
              <div className="utility-grid">
                <section className="panel utility-panel">
                  <div className="section-head">
                    <div>
                      <span>本地模板</span>
                      <h2>保存提示词资产</h2>
                    </div>
                    <strong>{assetTemplates.length} 条</strong>
                  </div>
                  <label className="field">
                    <span>模板名称</span>
                    <input
                      aria-label="素材模板名称"
                      onChange={(event) => setAssetNameInput(event.target.value)}
                      value={assetNameInput}
                    />
                  </label>
                  <label className="field">
                    <span>模板提示词</span>
                    <textarea
                      aria-label="素材模板提示词"
                      onChange={(event) => setAssetPromptInput(event.target.value)}
                      rows={7}
                      value={assetPromptInput}
                    />
                  </label>
                  <label className="field">
                    <span>标签</span>
                    <input
                      aria-label="素材模板标签"
                      onChange={(event) => setAssetTagsInput(event.target.value)}
                      placeholder="用逗号分隔"
                      value={assetTagsInput}
                    />
                  </label>
                  <div className="button-row">
                    <button className="secondary-action" onClick={() => setAssetPromptInput(prompt)} type="button">
                      <RotateCcw size={15} />
                      使用当前提示词
                    </button>
                    <button
                      className="primary-action"
                      disabled={!assetPromptInput.trim()}
                      onClick={handleSaveAssetTemplate}
                      type="button"
                    >
                      <Save size={17} />
                      保存模板
                    </button>
                  </div>
                </section>

                <section className="panel utility-panel">
                  <div className="section-head">
                    <div>
                      <span>模板列表</span>
                      <h2>复用与维护</h2>
                    </div>
                  </div>
                  {assetTemplates.length === 0 ? (
                    <div className="compact-empty">
                      <GalleryVerticalEnd size={30} />
                      <strong>暂无本地模板</strong>
                      <span>保存后可在这里一键复用到生成页。</span>
                    </div>
                  ) : (
                    <div className="template-list">
                      {assetTemplates.map((template) => (
                        <article className="template-card" key={template.id}>
                          <div>
                            <strong>{template.name}</strong>
                            <p>{template.prompt}</p>
                            <div className="tag-row">
                              {template.tags.map((tag) => (
                                <span key={tag}>{tag}</span>
                              ))}
                              <span>{template.referenceCount} 张参考图</span>
                              <span>{template.syncStatus === "local" ? "本地" : template.syncStatus}</span>
                            </div>
                          </div>
                          <div className="button-row">
                            <button
                              className="secondary-action"
                              onClick={() => handleUseAssetTemplate(template.id)}
                              type="button"
                            >
                              <RotateCcw size={15} />
                              复用
                            </button>
                            <button
                              aria-label={`删除 ${template.name}`}
                              className="icon-button"
                              onClick={() => handleDeleteAssetTemplate(template.id)}
                              type="button"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </section>
          ) : activePage === "compare" ? (
            <section className="utility-view" aria-label="模型对比">
              <div className="compare-layout">
                <section className="panel utility-panel compare-controls">
                  <div className="section-head">
                    <div>
                      <span>对比输入</span>
                      <h2>同提示词双模型请求</h2>
                    </div>
                  </div>
                  <label className="field">
                    <span>提示词</span>
                    <textarea
                      aria-label="模型对比提示词"
                      onChange={(event) => setComparePrompt(event.target.value)}
                      rows={5}
                      value={comparePrompt}
                    />
                  </label>
                  <div className="settings-grid">
                    <label className="field">
                      <span>画幅</span>
                      <select
                        aria-label="模型对比画幅"
                        onChange={(event) => setCompareRatio(event.target.value as GenerationParams["ratio"])}
                        value={compareRatio}
                      >
                        {selectedModel?.capabilities.ratios.map((option) => (
                          <option disabled={!option.enabled} key={option.key} value={option.key}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>左侧分辨率</span>
                      <select
                        aria-label="左侧分辨率"
                        onChange={(event) =>
                          setCompareLeftResolution(event.target.value as GenerationParams["resolution"])
                        }
                        value={compareLeftResolution}
                      >
                        {compareLeftModel?.capabilities.resolutions.map((option) => (
                          <option disabled={!option.enabled} key={option.key} value={option.key}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>右侧分辨率</span>
                      <select
                        aria-label="右侧分辨率"
                        onChange={(event) =>
                          setCompareRightResolution(event.target.value as GenerationParams["resolution"])
                        }
                        value={compareRightResolution}
                      >
                        {compareRightModel?.capabilities.resolutions.map((option) => (
                          <option disabled={!option.enabled} key={option.key} value={option.key}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {formValidation.errors.length > 0 && activePage === "compare" && (
                    <div className="issue-list" role="alert">
                      {formValidation.errors.map((issue, index) => (
                        <span key={`${issue.code}-${issue.field}-${index}`}>{issue.message}</span>
                      ))}
                    </div>
                  )}
                  {formValidation.warnings.length > 0 && activePage === "compare" && (
                    <div className="issue-list is-warning" role="status">
                      {formValidation.warnings.map((issue, index) => (
                        <span key={`${issue.code}-${issue.field}-${index}`}>{issue.message}</span>
                      ))}
                    </div>
                  )}
                  <button
                    className="primary-action"
                    disabled={!comparePrompt.trim()}
                    onClick={handleCreateCompare}
                    type="button"
                  >
                    <Compass size={18} />
                    开始对比
                  </button>
                </section>

                {(["left", "right"] as const).map((slot) => {
                  const model = slot === "left" ? compareLeftModel : compareRightModel;
                  const result = compareResult[slot];
                  const firstImage = result.response?.result?.images[0];

                  return (
                    <section className="panel compare-slot" key={slot}>
                      <label className="field">
                        <span>{slot === "left" ? "左侧模型" : "右侧模型"}</span>
                        <select
                          aria-label={slot === "left" ? "左侧模型" : "右侧模型"}
                          onChange={(event) =>
                            slot === "left"
                              ? setCompareLeftModelId(event.target.value)
                              : setCompareRightModelId(event.target.value)
                          }
                          value={model?.id ?? ""}
                        >
                          {configuredModels.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.displayName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className={`compare-preview status-${result.status}`}>
                        {result.status === "running" ? (
                          <div className="generation-loader compact-loader" role="status">
                            <div className="generation-orb" aria-hidden="true">
                              <span className="orb-ring outer" />
                              <span className="orb-ring middle" />
                              <span className="orb-core" />
                            </div>
                            <strong>正在请求 {model?.displayName}</strong>
                          </div>
                        ) : firstImage?.url ? (
                          <img
                            alt={`${model?.displayName} 对比结果`}
                            draggable={false}
                            onDragStart={(event) => event.preventDefault()}
                            src={firstImage.url}
                          />
                        ) : result.error ? (
                          <div className="stage-error-panel">
                            <strong>{result.error.title}</strong>
                            <span>{result.error.message}</span>
                          </div>
                        ) : (
                          <div className="compact-empty">
                            <Images size={30} />
                            <strong>等待对比结果</strong>
                            <span>{model?.displayName ?? "请选择模型"}</span>
                          </div>
                        )}
                      </div>
                      <dl className="detail-list compact-detail-list">
                        <div>
                          <dt>端点</dt>
                          <dd>{result.response?.adapterRequest?.url ?? "待请求"}</dd>
                        </div>
                        <div>
                          <dt>状态</dt>
                          <dd>{result.status}</dd>
                        </div>
                        <div>
                          <dt>耗时</dt>
                          <dd>{formatDuration(result.response?.result?.durationMs)}</dd>
                        </div>
                      </dl>
                    </section>
                  );
                })}
              </div>
            </section>
          ) : activePage === "recognition" ? (
            <section className="utility-view" aria-label="识别图片" onPaste={handleRecognitionPaste}>
              <div className="utility-grid">
                <section className="panel utility-panel">
                  <div className="section-head">
                    <div>
                      <span>图片输入</span>
                      <h2>多图识别请求</h2>
                    </div>
                    <strong>{recognitionImages.length} / 12</strong>
                  </div>
                  <input
                    accept="image/jpeg,image/png"
                    hidden
                    multiple
                    onChange={(event) => {
                      if (event.target.files) {
                        void handleRecognitionFiles(event.target.files);
                        event.target.value = "";
                      }
                    }}
                    ref={recognitionFileInputRef}
                    type="file"
                  />
                  <button
                    className="secondary-action upload-command"
                    onClick={() => recognitionFileInputRef.current?.click()}
                    type="button"
                  >
                    <Images size={17} />
                    上传图片
                  </button>
                  <span className="utility-upload-hint">支持 JPG/PNG，多图联合分析；也可以直接粘贴剪贴板图片。</span>
                  {recognitionIssues.length > 0 && (
                    <div className="issue-list" role="alert">
                      {recognitionIssues.map((issue, index) => (
                        <span key={`${issue.code}-${issue.field}-${index}`}>{issue.message}</span>
                      ))}
                    </div>
                  )}
                  <div className="reference-list">
                    {recognitionImages.map((image) => (
                      <div className="reference-item" key={image.id}>
                        {image.previewURL ? <img alt="" src={image.previewURL} /> : <Images size={18} />}
                        <div>
                          <strong>{image.name}</strong>
                          <span>{image.sizeBytes ? formatFileSize(image.sizeBytes) : image.mimeType}</span>
                        </div>
                        <button
                          aria-label={`删除 ${image.name}`}
                          className="icon-button"
                          onClick={() => handleRemoveRecognitionImage(image.id)}
                          type="button"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="panel utility-panel">
                  <div className="section-head">
                    <div>
                      <span>真实识图接口</span>
                      <h2>角色、模型与问题</h2>
                    </div>
                    <strong>{recognitionEndpointLabel}</strong>
                  </div>
                  <div className="settings-grid">
                    <label className="field">
                      <span>连接配置</span>
                      <select
                        aria-label="识图连接配置"
                        onChange={(event) => setSelectedModelId(event.target.value)}
                        value={selectedModel?.id ?? ""}
                      >
                        {configuredModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>参考模型</span>
                      <select
                        aria-label="识图参考模型"
                        onChange={(event) => {
                          if (event.target.value !== "custom") {
                            setRecognitionModelName(event.target.value);
                          }
                        }}
                        value={
                          VISION_RECOGNITION_MODELS.some((model) => model.id === recognitionModelName)
                            ? recognitionModelName
                            : "custom"
                        }
                      >
                        {VISION_RECOGNITION_MODELS.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.shortName}
                          </option>
                        ))}
                        <option value="custom">自定义模型</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>识图请求模型</span>
                      <input
                        aria-label="识图请求模型"
                        onChange={(event) => setRecognitionModelName(event.target.value)}
                        placeholder={DEFAULT_UTILITY_RECOGNITION_MODEL_NAME}
                        value={recognitionModelName}
                      />
                    </label>
                  </div>
                  <div className="utility-endpoint-strip">
                    <Code2 size={16} />
                    <span>{recognitionEndpointLabel}</span>
                    <strong>{recognitionRequestModelName}</strong>
                  </div>
                  <div className="utility-card-grid">
                    {VISION_RECOGNITION_ROLES.map((role) => (
                      <button
                        className={`utility-choice-card${recognitionRoleConfig.id === role.id ? " is-active" : ""}`}
                        key={role.id}
                        onClick={() => handleRecognitionRoleChange(role.id)}
                        type="button"
                      >
                        <strong>{role.shortName}</strong>
                        <span>{role.description}</span>
                      </button>
                    ))}
                  </div>
                  <label className="field">
                    <span>问题</span>
                    <textarea
                      aria-label="识别问题"
                      onChange={(event) => setRecognitionQuestion(event.target.value)}
                      rows={5}
                      value={recognitionQuestion}
                    />
                  </label>
                  <button
                    className={`primary-action${recognitionStatus === "running" ? " is-danger" : ""}`}
                    onClick={() => void handleCreateRecognitionDraft()}
                    type="button"
                  >
                    {recognitionStatus === "running" ? <X size={18} /> : <Sparkles size={18} />}
                    {recognitionStatus === "running" ? "中止识别" : "开始识别"}
                  </button>
                  {recognitionDraft && (
                    <div className="draft-panel">
                      <strong>{recognitionDraft.title}</strong>
                      <p>{recognitionDraft.summary}</p>
                      <div className="tag-row">
                        {recognitionDraft.imageFacts.map((fact) => (
                          <span key={fact}>{fact}</span>
                        ))}
                      </div>
                      <pre>
                        <code>{JSON.stringify(recognitionDraft.requestPreview, null, 2)}</code>
                      </pre>
                    </div>
                  )}
                  {recognitionStatus === "running" && (
                    <div aria-live="polite" className="generation-loader compact-loader utility-loader" role="status">
                      <div className="generation-orb">
                        <span className="orb-ring outer" />
                        <span className="orb-ring middle" />
                        <span className="orb-core" />
                      </div>
                      <strong>正在调用真实识图接口</strong>
                      <span>请求会发送到当前 baseUrl 拼接后的 {recognitionEndpointLabel} 端点。</span>
                    </div>
                  )}
                  {recognitionResult && (
                    <div className="utility-result-panel">
                      <div className="section-head">
                        <div>
                          <span>识图结果</span>
                          <h2>真实接口返回</h2>
                        </div>
                        <strong>{formatDuration(recognitionResult.durationMs)}</strong>
                      </div>
                      <dl className="detail-list compact-detail-list">
                        <div>
                          <dt>端点</dt>
                          <dd>{recognitionResult.endpoint}</dd>
                        </div>
                        <div>
                          <dt>请求模型</dt>
                          <dd>{recognitionResult.modelName}</dd>
                        </div>
                        <div>
                          <dt>Token</dt>
                          <dd>{formatResponsesUsage(recognitionResult.usage)}</dd>
                        </div>
                      </dl>
                      {recognitionResult.adapterRequest && (
                        <div className="utility-endpoint-strip is-muted">
                          <Code2 size={15} />
                          <span>{recognitionResult.adapterRequest.adapterName}</span>
                          <strong>{recognitionResult.adapterRequest.bodyFields.join(", ")}</strong>
                        </div>
                      )}
                      <div className="utility-result-toolbar">
                        {renderUtilityCopyButton("recognition-output", "复制结果", recognitionResult.outputText)}
                        {renderUtilityCopyButton(
                          "recognition-request",
                          "复制请求体",
                          formatUtilityJson(recognitionResult.requestPreview)
                        )}
                        {renderUtilityCopyButton(
                          "recognition-raw",
                          "复制原始摘要",
                          formatUtilityJson(recognitionResult.rawResponseSummary)
                        )}
                      </div>
                      <section className="utility-output-card">
                        <div className="utility-output-card-head">
                          <strong>模型回答</strong>
                        </div>
                        <div className="utility-output-content">{renderUtilityText(recognitionResult.outputText)}</div>
                      </section>
                      <details className="utility-json-panel">
                        <summary>请求体</summary>
                        <pre>
                          <code>{formatUtilityJson(recognitionResult.requestPreview)}</code>
                        </pre>
                      </details>
                      <details className="utility-json-panel">
                        <summary>原始响应摘要</summary>
                        <pre>
                          <code>{formatUtilityJson(recognitionResult.rawResponseSummary)}</code>
                        </pre>
                      </details>
                    </div>
                  )}
                  {recognitionError && (
                    <div className="stage-error-panel utility-error-panel" role="alert">
                      <div className="error-heading">
                        <div className="error-icon">
                          <AlertTriangle size={18} />
                        </div>
                        <div>
                          <strong>{recognitionError.title}</strong>
                          <span>{recognitionError.message}</span>
                        </div>
                      </div>
                      {recognitionError.suggestion && <p>{recognitionError.suggestion}</p>}
                      <div className="error-meta">
                        {recognitionErrorMeta.map((item) => (
                          <span key={item}>{item}</span>
                        ))}
                      </div>
                      {recognitionError.safeDetails && <code>{recognitionError.safeDetails}</code>}
                    </div>
                  )}
                </section>
              </div>
            </section>
          ) : activePage === "reasoning" ? (
            <section className="utility-view" aria-label="推理测试" onPaste={handleReasoningPaste}>
              <div className="utility-grid">
                <section className="panel utility-panel">
                  <div className="section-head">
                    <div>
                      <span>真实推理接口</span>
                      <h2>平台、模型与端点</h2>
                    </div>
                    <strong>{reasoningEndpointLabel}</strong>
                  </div>
                  <div className="utility-card-grid">
                    {REASONING_PLATFORMS.map((platform) => (
                      <button
                        className={`utility-choice-card${reasoningPlatform === platform.id ? " is-active" : ""}`}
                        key={platform.id}
                        onClick={() => handleReasoningPlatformChange(platform.id)}
                        type="button"
                      >
                        <strong>{platform.label}</strong>
                        <span>{platform.hint}</span>
                      </button>
                    ))}
                  </div>
                  <div className="settings-grid">
                    <label className="field">
                      <span>连接配置</span>
                      <select
                        aria-label="推理连接配置"
                        onChange={(event) => setSelectedModelId(event.target.value)}
                        value={selectedModel?.id ?? ""}
                      >
                        {configuredModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>参考模型</span>
                      <select
                        aria-label="推理参考模型"
                        onChange={(event) => handleReasoningModelPresetChange(event.target.value)}
                        value={
                          reasoningPlatformConfig.models.some((model) => model.id === reasoningModelName)
                            ? reasoningModelName
                            : "custom"
                        }
                      >
                        {reasoningPlatformConfig.models.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.id}
                          </option>
                        ))}
                        <option value="custom">自定义模型</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>请求模型名</span>
                      <input
                        aria-label="推理模型"
                        onChange={(event) => setReasoningModelName(event.target.value)}
                        placeholder={reasoningDefaultModel.id}
                        value={reasoningModelName}
                      />
                    </label>
                    {reasoningPlatform === "openai" && (
                      <label className="field">
                        <span>API 端点</span>
                        <select
                          aria-label="OpenAI 推理端点"
                          onChange={(event) => setReasoningApiStyle(event.target.value as ReasoningApiStyle)}
                          value={reasoningApiStyle}
                        >
                          <option value="responses">Responses</option>
                          <option value="chat-completions">Chat Completions</option>
                        </select>
                      </label>
                    )}
                    <label className="field">
                      <span>推理强度</span>
                      <select
                        aria-label="推理强度"
                        onChange={(event) => setReasoningEffort(event.target.value as ReasoningEffort)}
                        value={reasoningEffort}
                      >
                        {reasoningEffortOptions.map((effort) => (
                          <option key={effort} value={effort}>
                            {REASONING_EFFORT_LABELS[effort]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>最大 tokens</span>
                      <input
                        aria-label="最大 tokens"
                        max={MAX_REASONING_OUTPUT_TOKENS}
                        min={256}
                        onChange={(event) => setReasoningMaxTokens(Number(event.target.value))}
                        type="number"
                        value={reasoningMaxTokens}
                      />
                    </label>
                  </div>
                  <input
                    accept="image/jpeg,image/png"
                    hidden
                    multiple
                    onChange={(event) => {
                      if (event.target.files) {
                        void handleReasoningFiles(event.target.files);
                        event.target.value = "";
                      }
                    }}
                    ref={reasoningFileInputRef}
                    type="file"
                  />
                  <div className="utility-reference-uploader">
                    <button
                      className="secondary-action upload-command"
                      onClick={() => reasoningFileInputRef.current?.click()}
                      type="button"
                    >
                      <Images size={17} />
                      上传推理参考图
                    </button>
                    <span>可选。支持 JPG/PNG，最多 12 张；也可以直接粘贴图片。</span>
                  </div>
                  {reasoningIssues.length > 0 && (
                    <div className="issue-list" role="alert">
                      {reasoningIssues.map((issue, index) => (
                        <span key={`${issue.code}-${issue.field}-${index}`}>{issue.message}</span>
                      ))}
                    </div>
                  )}
                  {reasoningImages.length > 0 && (
                    <div className="reference-list">
                      {reasoningImages.map((image) => (
                        <div className="reference-item" key={image.id}>
                          {image.previewURL ? <img alt="" src={image.previewURL} /> : <Images size={18} />}
                          <div>
                            <strong>{image.name}</strong>
                            <span>{image.sizeBytes ? formatFileSize(image.sizeBytes) : image.mimeType}</span>
                          </div>
                          <button
                            aria-label={`删除 ${image.name}`}
                            className="icon-button"
                            onClick={() => handleRemoveReasoningImage(image.id)}
                            type="button"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="utility-endpoint-strip">
                    <Code2 size={16} />
                    <span>{reasoningEndpointLabel}</span>
                    <strong>{reasoningRequestModelName}</strong>
                  </div>
                  <label className="inline-toggle">
                    <input
                      checked={reasoningWantSummary}
                      onChange={(event) => setReasoningWantSummary(event.target.checked)}
                      type="checkbox"
                    />
                    <span>请求思考摘要或思考块</span>
                  </label>
                  <div className="template-chip-grid" aria-label="推理题库模板">
                    {REASONING_PROMPT_PRESETS.map((preset) => (
                      <button
                        className="template-chip"
                        key={preset.id}
                        onClick={() => setReasoningPrompt(preset.prompt)}
                        type="button"
                      >
                        {preset.shortName}
                      </button>
                    ))}
                  </div>
                  <label className="field">
                    <span>推理输入</span>
                    <textarea
                      aria-label="推理输入"
                      onChange={(event) => setReasoningPrompt(event.target.value)}
                      rows={7}
                      value={reasoningPrompt}
                    />
                  </label>
                  <button
                    className={`primary-action${reasoningStatus === "running" ? " is-danger" : ""}`}
                    onClick={() => void handleCreateReasoningDraft()}
                    type="button"
                  >
                    {reasoningStatus === "running" ? <X size={18} /> : <TestTube2 size={18} />}
                    {reasoningStatus === "running" ? "中止推理" : "开始推理测试"}
                  </button>
                </section>

                <section className="panel utility-panel">
                  <div className="section-head">
                    <div>
                      <span>结果与请求</span>
                      <h2>真实返回与检查</h2>
                    </div>
                    <strong>{analyticsSummary.totalEvents} 条事件</strong>
                  </div>
                  <div className="metric-grid">
                    <span>模板使用 {analyticsSummary.templateUseCount}</span>
                    <span>cURL 复制 {analyticsSummary.curlCopyCount}</span>
                    <span>批量开始 {analyticsSummary.batchStartCount}</span>
                    <span>zip 下载 {analyticsSummary.zipDownloadCount}</span>
                  </div>
                  {reasoningDraft ? (
                    <div className="draft-panel">
                      <strong>{reasoningDraft.title}</strong>
                      <p>{reasoningDraft.summary}</p>
                      <div className="tag-row">
                        {reasoningDraft.checklist.map((item) => (
                          <span key={item}>{item}</span>
                        ))}
                      </div>
                      <pre>
                        <code>{JSON.stringify(reasoningDraft.requestPreview, null, 2)}</code>
                      </pre>
                    </div>
                  ) : (
                    <div className="compact-empty">
                      <TestTube2 size={30} />
                      <strong>等待真实请求预览</strong>
                      <span>开始测试后会展示请求字段、端点、思考摘要和模型回答。</span>
                    </div>
                  )}
                  {reasoningStatus === "running" && (
                    <div aria-live="polite" className="generation-loader compact-loader utility-loader" role="status">
                      <div className="generation-orb">
                        <span className="orb-ring outer" />
                        <span className="orb-ring middle" />
                        <span className="orb-core" />
                      </div>
                      <strong>正在调用真实推理接口</strong>
                      <span>请求会发送到当前 baseUrl 拼接后的 {reasoningEndpointLabel} 端点。</span>
                    </div>
                  )}
                  {reasoningResult && (
                    <div className="utility-result-panel">
                      <div className="section-head">
                        <div>
                          <span>推理结果</span>
                          <h2>真实接口返回</h2>
                        </div>
                        <strong>{formatDuration(reasoningResult.durationMs)}</strong>
                      </div>
                      <dl className="detail-list compact-detail-list">
                        <div>
                          <dt>端点</dt>
                          <dd>{reasoningResult.endpoint}</dd>
                        </div>
                        <div>
                          <dt>请求模型</dt>
                          <dd>{reasoningResult.modelName}</dd>
                        </div>
                        <div>
                          <dt>Token</dt>
                          <dd>{formatResponsesUsage(reasoningResult.usage)}</dd>
                        </div>
                      </dl>
                      {reasoningResult.adapterRequest && (
                        <div className="utility-endpoint-strip is-muted">
                          <Code2 size={15} />
                          <span>{reasoningResult.adapterRequest.adapterName}</span>
                          <strong>{reasoningResult.adapterRequest.bodyFields.join(", ")}</strong>
                        </div>
                      )}
                      <div className="utility-result-toolbar">
                        {renderUtilityCopyButton("reasoning-output", "复制回答", reasoningResult.outputText)}
                        {renderUtilityCopyButton(
                          "reasoning-thinking",
                          "复制思考",
                          reasoningResult.thinkingText ?? ""
                        )}
                        {renderUtilityCopyButton(
                          "reasoning-request",
                          "复制请求体",
                          formatUtilityJson(reasoningResult.requestPreview)
                        )}
                        {renderUtilityCopyButton(
                          "reasoning-raw",
                          "复制原始摘要",
                          formatUtilityJson(reasoningResult.rawResponseSummary)
                        )}
                      </div>
                      {reasoningResult.thinkingText && (
                        <div className="utility-thinking-panel">
                          <strong>思考摘要</strong>
                          <div className="utility-output-content">{renderUtilityText(reasoningResult.thinkingText)}</div>
                        </div>
                      )}
                      <section className="utility-output-card">
                        <div className="utility-output-card-head">
                          <strong>模型回答</strong>
                        </div>
                        <div className="utility-output-content">{renderUtilityText(reasoningResult.outputText)}</div>
                      </section>
                      <details className="utility-json-panel">
                        <summary>请求体</summary>
                        <pre>
                          <code>{formatUtilityJson(reasoningResult.requestPreview)}</code>
                        </pre>
                      </details>
                      <details className="utility-json-panel">
                        <summary>原始响应摘要</summary>
                        <pre>
                          <code>{formatUtilityJson(reasoningResult.rawResponseSummary)}</code>
                        </pre>
                      </details>
                    </div>
                  )}
                  {reasoningError && (
                    <div className="stage-error-panel utility-error-panel" role="alert">
                      <div className="error-heading">
                        <div className="error-icon">
                          <AlertTriangle size={18} />
                        </div>
                        <div>
                          <strong>{reasoningError.title}</strong>
                          <span>{reasoningError.message}</span>
                        </div>
                      </div>
                      {reasoningError.suggestion && <p>{reasoningError.suggestion}</p>}
                      <div className="error-meta">
                        {reasoningErrorMeta.map((item) => (
                          <span key={item}>{item}</span>
                        ))}
                      </div>
                      {reasoningError.safeDetails && <code>{reasoningError.safeDetails}</code>}
                    </div>
                  )}
                </section>
              </div>
            </section>
          ) : (
          <>
            <div className="generation-mode-switch" aria-label="生成模式">
              <button
                className={generationWorkspaceMode === "single" ? "is-active" : undefined}
                onClick={() => setGenerationWorkspaceMode("single")}
                type="button"
              >
                <Images size={16} />
                单图生成
              </button>
              <button
                className={generationWorkspaceMode === "suite" ? "is-active" : undefined}
                onClick={() => setGenerationWorkspaceMode("suite")}
                type="button"
              >
                <GalleryVerticalEnd size={16} />
                一致性套图
              </button>
            </div>
            {generationWorkspaceMode === "suite" ? (
              <GenerationSuiteWorkbench
                endpointOverride={selectedEndpointOverride}
                modelOverride={selectedModelRequestOverride}
                models={configuredModels}
                onParamsChange={setGenerationParams}
                onPolishPrompt={handlePolishSuitePrompt}
                onSelectModel={setSelectedModelId}
                params={generationParams}
                selectedModel={selectedModel}
                selectedModelId={selectedModel?.id ?? selectedModelId}
              />
            ) : (
          <div className="workbench-grid">
            <section className="panel input-panel" aria-label="输入与参数">
              <div>
                <h2>输入</h2>
                <p>当前已接入模型配置、参数、上传、费用预览和请求创建。</p>
              </div>
              <label className="field">
                <span>模型</span>
                <select
                  aria-label="选择模型"
                  disabled={!canCreateGeneration}
                  onChange={(event) => setSelectedModelId(event.target.value)}
                  value={selectedModel?.id ?? ""}
                >
                  {configuredModels.map((model: ModelConfig) => (
                    <option key={model.id} value={model.id}>
                      {model.displayName}
                    </option>
                  ))}
                </select>
              </label>
              {selectedModel && (
                <div className="model-summary">
                  <div>
                    <strong>{selectedModel.displayName}</strong>
                    {selectedModel.description && <span>{selectedModel.description}</span>}
                  </div>
                  <div className="meta-row">
                    <span>{selectedModel.price.basePriceText}</span>
                    <span>{selectedModel.timeLabel}</span>
                    <span>参考图 {selectedModel.capabilities.maxReferenceImages}</span>
                    <span>输出 {selectedModel.capabilities.maxOutputs}</span>
                  </div>
                </div>
              )}
              {(resolvedCapabilities || batchControlsEnabled) && (
                <div className="parameter-grid generation-parameter-grid" aria-label="生产参数">
                  {resolvedCapabilities && (
                    <>
                      <label className="field">
                        <span>尺寸</span>
                        <select
                          aria-label="图片尺寸"
                          disabled={!canCreateGeneration || resolvedCapabilities.disabledFields.includes("ratio")}
                          onChange={(event) =>
                            setGenerationParams((current) => ({
                              ...current,
                              ratio: event.target.value as GenerationParams["ratio"]
                            }))
                          }
                          value={generationParams.ratio}
                        >
                          {resolvedCapabilities.ratios.map((option) => (
                            <option disabled={!option.enabled} key={option.key} value={option.key}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>分辨率</span>
                        <select
                          aria-label="分辨率"
                          disabled={!canCreateGeneration || resolvedCapabilities.disabledFields.includes("resolution")}
                          onChange={(event) =>
                            setGenerationParams((current) => ({
                              ...current,
                              resolution: event.target.value as GenerationParams["resolution"]
                            }))
                          }
                          value={generationParams.resolution}
                        >
                          {resolvedCapabilities.resolutions.map((option) => (
                            <option disabled={!option.enabled} key={option.key} value={option.key}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>质量</span>
                        <select
                          aria-label="图片质量"
                          disabled={!canCreateGeneration || resolvedCapabilities.disabledFields.includes("quality")}
                          onChange={(event) =>
                            setGenerationParams((current) => ({
                              ...current,
                              quality: event.target.value as GenerationParams["quality"]
                            }))
                          }
                          value={generationParams.quality}
                        >
                          {resolvedCapabilities.qualities.map((option) => (
                            <option disabled={!option.enabled} key={option.key} value={option.key}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                  {resolvedCapabilities && (
                    <label className="field">
                      <span>生成张数</span>
                      <select
                        aria-label="单次 API 生成张数"
                        disabled={!canCreateGeneration}
                        onChange={(event) =>
                          setGenerationParams((current) => ({
                            ...current,
                            count: clampGenerationImageCount(Number(event.target.value), selectedModel)
                          }))
                        }
                        value={requestGenerationParams.count}
                      >
                        {imageCountOptions.map((count) => (
                          <option key={count} value={count}>
                            {count}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {batchControlsEnabled && (
                    <label className="field">
                      <span>批量次数</span>
                      <select
                        aria-label="批量排队次数"
                        disabled={!canCreateGeneration}
                        onChange={(event) => setBatchGenerationCount(clampBatchGenerationCount(Number(event.target.value)))}
                        value={effectiveBatchGenerationCount}
                      >
                        {BATCH_GENERATION_OPTIONS.map((count) => (
                          <option key={count} value={count}>
                            {count}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {supportsOpenAIAdvancedParams && (
                    <>
                      <label className="field">
                        <span>输出格式</span>
                        <select
                          aria-label="输出格式"
                          disabled={!canCreateGeneration || openAIOutputFormatOptions.length <= 1}
                          onChange={(event) => {
                            const nextFormat = event.target.value as GenerationParams["outputFormat"];

                            setGenerationParams((current) => ({
                              ...current,
                              outputFormat: nextFormat,
                              outputCompression:
                                nextFormat === "jpeg" || nextFormat === "jpg" || nextFormat === "webp"
                                  ? current.outputCompression ?? 100
                                  : current.outputCompression
                            }));
                          }}
                          value={requestGenerationParams.outputFormat ?? openAIOutputFormatOptions[0]?.value ?? "png"}
                        >
                          {openAIOutputFormatOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>背景</span>
                        <select
                          aria-label="背景"
                          disabled={!canCreateGeneration}
                          onChange={(event) =>
                            setGenerationParams((current) => ({
                              ...current,
                              background: event.target.value as GenerationParams["background"]
                            }))
                          }
                          value={requestGenerationParams.background ?? "auto"}
                        >
                          {openAIBackgroundOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>审核</span>
                        <select
                          aria-label="审核强度"
                          disabled={!canCreateGeneration || !selectedModel?.featureFlags.supportsSafetyLevel}
                          onChange={(event) =>
                            setGenerationParams((current) => ({
                              ...current,
                              moderation: event.target.value as GenerationParams["moderation"]
                            }))
                          }
                          value={requestGenerationParams.moderation ?? "auto"}
                        >
                          {OPENAI_MODERATION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>压缩</span>
                        <input
                          aria-label="输出压缩"
                          disabled={!canCreateGeneration || !outputCompressionEnabled}
                          max={100}
                          min={0}
                          onChange={(event) =>
                            setGenerationParams((current) => ({
                              ...current,
                              outputCompression: clampOutputCompression(Number(event.target.value))
                            }))
                          }
                          type="number"
                          value={requestGenerationParams.outputCompression ?? 100}
                        />
                      </label>
                    </>
                  )}
                </div>
              )}
              {resolvedCapabilities?.restrictionTips.length ? (
                <div className="restriction-list" role="status">
                  {resolvedCapabilities.restrictionTips.map((tip) => (
                    <span key={tip}>{tip}</span>
                  ))}
                </div>
              ) : null}
              <div
                className={`upload-zone${uploadDisabled ? " disabled" : ""}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void handleIncomingFiles(event.dataTransfer.files);
                }}
              >
                <input
                  accept="image/jpeg,image/png"
                  hidden
                  multiple
                  onChange={(event) => {
                    if (event.target.files) {
                      void handleIncomingFiles(event.target.files);
                      event.target.value = "";
                    }
                  }}
                  ref={fileInputRef}
                  type="file"
                />
                <Images size={22} />
                <div>
                  <strong>参考图</strong>
                  <span>
                    JPG/PNG，单图 {selectedModel?.capabilities.maxReferenceImageSizeMB ?? 20} MB，最多{" "}
                    {selectedModel?.capabilities.maxReferenceImages ?? 0} 张
                  </span>
                </div>
                <button
                  className="secondary-action"
                  disabled={uploadDisabled}
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  选择图片
                </button>
              </div>
              {uploadIssues.length > 0 && (
                <div className="issue-list" role="alert">
                  {uploadIssues.map((issue, index) => (
                    <span key={`${issue.code}-${issue.field}-${index}`}>{issue.message}</span>
                  ))}
                </div>
              )}
              {referenceImages.length > 0 && (
                <div className="reference-list">
                  {referenceImages.map((image) => (
                    <div className="reference-item" key={image.id}>
                      {image.previewURL ? <img alt="" src={image.previewURL} /> : <Images size={18} />}
                      <div>
                        <strong>{image.name}</strong>
                        <span>{image.sizeBytes ? formatFileSize(image.sizeBytes) : image.format.toUpperCase()}</span>
                      </div>
                      <button
                        aria-label={`删除 ${image.name}`}
                        className="icon-button"
                        onClick={() => handleRemoveReferenceImage(image.id)}
                        type="button"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {formValidation.errors.length > 0 && (
                <div className="issue-list" role="alert">
                  {formValidation.errors.map((issue, index) => (
                    <span key={`${issue.code}-${issue.field}-${index}`}>{issue.message}</span>
                  ))}
                </div>
              )}
              <label className="field prompt-field">
                <div className="field-title-row">
                  <span>提示词</span>
                  <button
                    className="secondary-action compact-action"
                    onClick={handleOpenPromptTemplates}
                    type="button"
                  >
                    <GalleryVerticalEnd size={15} />
                    模板库 {getPromptTemplateCount()}
                  </button>
                </div>
                <textarea
                  aria-label="提示词"
                  disabled={!canCreateGeneration || isSubmitting}
                  onChange={(event) => {
                    setPrompt(event.target.value);
                    clearFormValidation();
                  }}
                  placeholder="描述你想生成或编辑的图片"
                  rows={7}
                  value={prompt}
                />
              </label>
              {selectedModel?.capabilities.supportsNegativePrompt && (
                <label className="field">
                  <span>反向提示词</span>
                  <textarea
                      aria-label="反向提示词"
                      disabled={!canCreateGeneration || isSubmitting}
                    onChange={(event) => {
                      setNegativePrompt(event.target.value);
                      clearFormValidation();
                    }}
                    placeholder="描述不希望出现在图片中的内容"
                    rows={3}
                    value={negativePrompt}
                  />
                </label>
              )}
              {costPreview && (
                <div className="cost-preview" aria-label="费用预览">
                  <div className="cost-headline">
                    <span>费用预估</span>
                    <strong>{costPreview.estimatedCostText}</strong>
                  </div>
                  <dl className="cost-facts">
                    <div>
                      <dt>单价</dt>
                      <dd>{costPreview.unitPriceText}</dd>
                    </div>
                    <div>
                      <dt>预估张数</dt>
                      <dd>{costPreview.quantityText}</dd>
                    </div>
                    <div>
                      <dt>分辨率</dt>
                      <dd>{costPreview.resolutionText}</dd>
                    </div>
                    <div>
                      <dt>质量</dt>
                      <dd>{costPreview.qualityText}</dd>
                    </div>
                  </dl>
                  {(costPreview.note || costPreview.riskText) && (
                    <p className={costPreview.riskText ? "cost-risk" : undefined}>
                      {[costPreview.note, costPreview.riskText].filter(Boolean).join("；")}
                    </p>
                  )}
                </div>
              )}
              {curlPreview && (
                <div className="api-endpoint-card" aria-label="当前 API">
                  <div className="api-endpoint-head">
                    <span>当前 API</span>
                    <strong>{formatApiEndpointName(curlPreview.endpoint)}</strong>
                  </div>
                  <div className="api-endpoint-url">
                    <span>{curlPreview.method}</span>
                    <code>{curlPreview.endpoint}</code>
                  </div>
                  {curlPreview.bodyFields?.length ? (
                    <div className="api-field-row" aria-label="请求字段">
                      {curlPreview.bodyFields.map((field) => (
                        <span key={field}>{field}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
              <button
                className="primary-action"
                disabled={!canCreateGeneration}
                onClick={handleCreateGeneration}
                type="button"
              >
                <WandSparkles size={18} />
                开始生成
              </button>
              {curlPreview && (
                <section className={`curl-panel${curlExpanded ? " expanded" : ""}`} aria-label="cURL">
                  <header className="curl-panel-header">
                    <button className="curl-toggle" onClick={() => setCurlExpanded((value) => !value)} type="button">
                      <Code2 size={16} />
                      <span>cURL</span>
                      {curlPreview.adapterName && <small>{curlPreview.adapterName}</small>}
                      {curlExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                    <button
                      aria-label="复制 cURL"
                      className="icon-button"
                      disabled={!curlPreview.code}
                      onClick={handleCopyCurl}
                      title={curlCopyStatus === "success" ? "已复制" : "复制 cURL"}
                      type="button"
                    >
                      {curlCopyStatus === "success" ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                  </header>
                  {curlExpanded && (
                    <div className="curl-content">
                      <div className="curl-meta">
                        <span>{curlPreview.method}</span>
                        <strong>{curlPreview.endpoint}</strong>
                      </div>
                      <label className="curl-key-toggle">
                        <input
                          checked={showRealKeyInCurl}
                          disabled={!selectedApiKey}
                          onChange={(event) => setShowRealKeyInCurl(event.target.checked)}
                          type="checkbox"
                        />
                        <span>显示真实 Key</span>
                      </label>
                      {showRealKeyInCurl && selectedApiKey && (
                        <p className="curl-warning">复制内容包含真实 API Key。</p>
                      )}
                      {curlPreview.warning && <p className="curl-warning">{curlPreview.warning}</p>}
                      <pre className="curl-code">
                        <code>{curlPreview.code}</code>
                      </pre>
                      {curlCopyStatus === "failed" && <p className="curl-warning">复制失败。</p>}
                      {curlCopiedAt && <span className="curl-copied">已复制</span>}
                    </div>
                  )}
                </section>
              )}
            </section>

            <section
              className={`panel result-panel image-workspace${activeItemIsQueued ? " is-generating" : ""}`}
              aria-label="结果预览"
            >
              <header className="result-toolbar">
                <span className="model-chip">{currentResultModelName}</span>
                <span title={currentResultRequestModelName}>model: {currentResultRequestModelName}</span>
                <span>
                  {activeItemIsQueued
                    ? "生成中"
                    : formatPanelTime(activeResultItem?.acceptedAt ?? activeResultItem?.createdAt ?? lastRequest?.acceptedAt)}
                </span>
                <span title={activeResultItem?.requestId ?? lastRequest?.requestId}>
                  ID: {activeItemIsQueued ? "pending" : compactRequestId(activeResultItem?.requestId ?? lastRequest?.requestId)}
                </span>
                <span>{currentResultResolution}</span>
                <span title={currentResultEndpoint}>{currentResultEndpoint ? formatApiEndpointName(currentResultEndpoint) : "API 未就绪"}</span>
              </header>

              <div
                className={`preview-stage${previewImage?.url ? " has-image" : ""}${
                  isPreviewDragging ? " is-dragging" : ""
                }`}
                onLostPointerCapture={handlePreviewPointerEnd}
                onPointerCancel={handlePreviewPointerEnd}
                onPointerDown={handlePreviewPointerDown}
                onPointerMove={handlePreviewPointerMove}
                onPointerUp={handlePreviewPointerEnd}
                ref={previewStageRef}
              >
                {activeItemIsQueued ? (
                  <div aria-live="polite" className="generation-loader" role="status">
                    <div className="generation-orb" aria-hidden="true">
                      <span className="orb-ring outer" />
                      <span className="orb-ring middle" />
                      <span className="orb-core" />
                      <span className="orb-wave" />
                    </div>
                    <div>
                      <strong>图片正在生成</strong>
                      <span>
                        {pendingQueueCount > 1
                          ? `${pendingQueueCount} 个任务正在调用模型`
                          : "正在调用模型并等待上游返回"}
                      </span>
                    </div>
                  </div>
                ) : previewImage?.url ? (
                  <img
                    alt={`生成结果 ${previewImage.index + 1}`}
                    className="stage-image"
                    onLoad={(event) =>
                      handleGeneratedImageLoaded(
                        previewImage,
                        event.currentTarget.naturalWidth,
                        event.currentTarget.naturalHeight
                      )
                    }
                    src={previewImage.url}
                    style={{ transform: `translate3d(${previewPan.x}px, ${previewPan.y}px, 0) scale(${previewZoom / 100})` }}
                  />
                ) : requestErrorMessage ? (
                  <div className="stage-error-panel" role="alert">
                    <div className="error-heading">
                      <span className="error-icon" aria-hidden="true">
                        <AlertTriangle size={22} />
                      </span>
                      <div>
                        <strong>{requestErrorTitle}</strong>
                        <span>{requestErrorMessage}</span>
                      </div>
                    </div>
                    {requestErrorSuggestion && <p>{requestErrorSuggestion}</p>}
                    {requestErrorMeta.length > 0 && (
                      <div className="error-meta" aria-label="错误详情">
                        {requestErrorMeta.map((item) => (
                          <span key={item}>{item}</span>
                        ))}
                      </div>
                    )}
                    {visibleError?.safeDetails && <code>{visibleError.safeDetails}</code>}
                    <div className="error-actions">
                      {visibleError?.retryable && (
                        <button className="secondary-action" onClick={handleCreateGeneration} type="button">
                          <RotateCcw size={15} />
                          重试
                        </button>
                      )}
                      {shouldOfferSettings(visibleError) && (
                        <button className="secondary-action" onClick={() => setSettingsOpen(true)} type="button">
                          <Settings size={15} />
                          设置
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="stage-empty">
                    <Images size={38} />
                    <strong>{activeNavItem?.label ?? activeSummary.title}</strong>
                    <span>点击“开始生成”后，结果会出现在这里。</span>
                  </div>
                )}
              </div>

              <div className="stage-controls">
                <div className="zoom-control" aria-label="预览缩放">
                  <button
                    aria-label="缩小"
                    className="icon-button"
                    disabled={!previewImage?.url || previewZoom <= MIN_PREVIEW_ZOOM}
                    onClick={() => setPreviewZoom((value) => clampZoom(value - 25))}
                    title="缩小"
                    type="button"
                  >
                    <Minus size={16} />
                  </button>
                  <strong>{previewZoom}%</strong>
                  <button
                    aria-label="放大"
                    className="icon-button"
                    disabled={!previewImage?.url || previewZoom >= MAX_PREVIEW_ZOOM}
                    onClick={() => setPreviewZoom((value) => clampZoom(value + 25))}
                    title="放大"
                    type="button"
                  >
                    <Plus size={16} />
                  </button>
                  <button
                    className="secondary-action fit-action"
                    disabled={!previewImage?.url}
                    onClick={resetPreviewTransform}
                    type="button"
                  >
                    <Maximize2 size={15} />
                    适配
                  </button>
                </div>
                <div className="result-action-group">
                  <button
                    className="secondary-action"
                    disabled={!previewImage?.url}
                    onClick={handleDownloadPreviewImage}
                    type="button"
                  >
                    <Download size={15} />
                    下载
                  </button>
                  <button
                    className="secondary-action"
                    disabled={zipDownloadItems.length < 2 || zipStatus.state === "running"}
                    onClick={handleDownloadResultZip}
                    type="button"
                  >
                    <Download size={15} />
                    打包下载
                  </button>
                  <button
                    className="secondary-action"
                    disabled={!previewImage?.url}
                    onClick={handleOpenPreviewImage}
                    type="button"
                  >
                    <Eye size={15} />
                    详情
                  </button>
                  <button
                    className="secondary-action danger-action"
                    disabled={!activeResultItem && !requestError}
                    onClick={handleDeleteActiveResult}
                    type="button"
                  >
                    <Trash2 size={15} />
                    删除
                  </button>
                </div>
              </div>

              {resultQueue.length > 0 && (
                <div className="thumbnail-strip" aria-label="结果缩略图">
                  {resultQueue.map((item) => (
                    <button
                      className={`thumbnail-card ${item.status}${item.id === activeResultItem?.id ? " active" : ""}`}
                      key={item.id}
                      onClick={() => setActiveResultItemId(item.id)}
                      type="button"
                    >
                      {item.status === "queued" ? (
                        <>
                          <div className="queued-thumb" aria-hidden="true">
                            <span />
                          </div>
                          <strong>
                            {item.batchTotal && item.batchTotal > 1
                              ? `排队 ${item.batchIndex}/${item.batchTotal}`
                              : "排队中"}
                          </strong>
                          <span>{item.resolutionText ?? "等待上游"}</span>
                        </>
                      ) : item.status === "failed" ? (
                        <>
                          <div className="failed-thumb" aria-hidden="true">
                            <AlertTriangle size={18} />
                          </div>
                          <strong>生成失败</strong>
                          <span>{item.error?.code ?? "FAILED"}</span>
                        </>
                      ) : (
                        <>
                          {item.image?.url ? (
                            <img
                              alt={`缩略图 ${item.image.index + 1}`}
                              onLoad={(event) =>
                                handleGeneratedImageLoaded(
                                  item.image,
                                  event.currentTarget.naturalWidth,
                                  event.currentTarget.naturalHeight
                                )
                              }
                              src={item.image.url}
                            />
                          ) : (
                            <Images size={18} />
                          )}
                          <strong>{formatActualImageResolution(item.image)}</strong>
                          <span>{item.image?.format?.toUpperCase() ?? "PNG"}</span>
                        </>
                      )}
                    </button>
                  ))}
                </div>
              )}

              <footer className="result-statusbar">
                <strong>{resultStatusText}</strong>
                <span>
                  {resultHintText}
                  {zipStatus.state !== "idle" ? ` · ${zipStatus.message}` : ""}
                </span>
              </footer>
            </section>
          </div>
            )}
          </>
          )}
        </section>
      </main>

      {imageDetailsOpen && previewImage?.url && (
        <div
          className="modal-backdrop image-detail-backdrop"
          onClick={() => setImageDetailsOpen(false)}
          role="presentation"
        >
          <section
            aria-modal="true"
            className="image-detail-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="dialog-header">
              <div>
                <span>图片详情</span>
                <h2>{activeResultItem?.modelDisplayName ?? currentResultModelName}</h2>
              </div>
              <button
                aria-label="关闭图片详情"
                className="icon-button"
                onClick={() => setImageDetailsOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
            </header>

            <div className="image-detail-layout">
              <aside className="detail-side-panel">
                <div className="detail-panel-title">
                  <span>提示词</span>
                  <button
                    aria-label="复制提示词"
                    className="icon-button"
                    onClick={() => navigator.clipboard?.writeText(activeResultItem?.prompt ?? prompt)}
                    type="button"
                  >
                    <Copy size={15} />
                  </button>
                </div>
                <p>{activeResultItem?.prompt ?? prompt}</p>
                {activeResultItem?.negativePrompt && (
                  <>
                    <span className="detail-muted-label">反向提示词</span>
                    <p>{activeResultItem.negativePrompt}</p>
                  </>
                )}
              </aside>

              <div className="detail-image-stage">
                <img
                  alt={`生成结果 ${previewImage.index + 1}`}
                  onLoad={(event) =>
                    handleGeneratedImageLoaded(
                      previewImage,
                      event.currentTarget.naturalWidth,
                      event.currentTarget.naturalHeight
                    )
                  }
                  src={previewImage.url}
                />
              </div>

              <aside className="detail-side-panel">
                <div className="detail-panel-title">
                  <span>参数</span>
                </div>
                <dl className="detail-list">
                  <div>
                    <dt>API 端点</dt>
                    <dd>{currentResultEndpoint ?? "未记录"}</dd>
                  </div>
                  <div>
                    <dt>比例</dt>
                    <dd>{formatParamValue(activeResultItem?.params.ratio)}</dd>
                  </div>
                  <div>
                    <dt>请求分辨率档位</dt>
                    <dd>{formatParamValue(activeResultItem?.params.resolution)}</dd>
                  </div>
                  <div>
                    <dt>实际分辨率</dt>
                    <dd>{formatActualImageResolution(previewImage)}</dd>
                  </div>
                  <div>
                    <dt>格式</dt>
                    <dd>{previewImage.format?.toUpperCase() ?? "PNG"}</dd>
                  </div>
                  <div>
                    <dt>质量</dt>
                    <dd>{formatParamValue(activeResultItem?.params.quality)}</dd>
                  </div>
                  <div>
                    <dt>模型</dt>
                    <dd>{activeResultItem?.modelDisplayName ?? currentResultModelName}</dd>
                  </div>
                  <div>
                    <dt>请求 model</dt>
                    <dd>{currentResultRequestModelName}</dd>
                  </div>
                  <div>
                    <dt>生成耗时</dt>
                    <dd>{formatDuration(activeResultItem?.durationMs)}</dd>
                  </div>
                  <div>
                    <dt>文件名</dt>
                    <dd>{detailFilename ?? "待生成"}</dd>
                  </div>
                  <div>
                    <dt>图片存放路径</dt>
                    <dd>
                      {detailFilename
                        ? joinDisplayPath(settings.localArchive.directoryPath, detailFilename)
                        : settings.localArchive.directoryPath}
                    </dd>
                  </div>
                </dl>
              </aside>
            </div>
          </section>
        </div>
      )}

      {promptTemplatesOpen && (
        <div className="modal-backdrop" onClick={() => setPromptTemplatesOpen(false)} role="presentation">
          <section
            aria-modal="true"
            className="template-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="dialog-header">
              <div>
                <span>模板库</span>
                <h2>{getPromptTemplateCount()} 条提示词模板</h2>
              </div>
              <button
                aria-label="关闭模板库"
                className="icon-button"
                onClick={() => setPromptTemplatesOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
            </header>

            <div className="template-dialog-layout">
              <aside className="template-category-list">
                {PROMPT_TEMPLATE_CATEGORIES.map((category) => (
                  <button
                    className={category.id === templateCategoryId ? "active" : ""}
                    key={category.id}
                    onClick={() => setTemplateCategoryId(category.id)}
                    type="button"
                  >
                    <strong>{category.label}</strong>
                    <span>{category.templates.length} 条</span>
                  </button>
                ))}
              </aside>

              <section className="template-dialog-main">
                <label className="field">
                  <span>搜索模板</span>
                  <input
                    aria-label="搜索模板"
                    onChange={(event) => setTemplateSearch(event.target.value)}
                    placeholder="输入风格、场景或标签"
                    value={templateSearch}
                  />
                </label>
                <div className="template-grid">
                  {visiblePromptTemplates.map((template) => (
                    <article className="template-card" key={template.id}>
                      <div>
                        <strong>{template.title}</strong>
                        <p>{template.prompt}</p>
                        <div className="tag-row">
                          {template.tags.map((tag) => (
                            <span key={tag}>{tag}</span>
                          ))}
                        </div>
                      </div>
                      <button
                        className="primary-action"
                        onClick={() => handleUsePromptTemplate(template.id)}
                        type="button"
                      >
                        <WandSparkles size={16} />
                        使用
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </section>
        </div>
      )}

      {selectedHistoryRecord && (
        <div className="modal-backdrop" onClick={() => setSelectedHistoryRecordId(undefined)} role="presentation">
          <section
            aria-modal="true"
            className="history-detail-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="dialog-header">
              <div>
                <span>历史详情</span>
                <h2>{selectedHistoryRecord.modelDisplayName}</h2>
              </div>
              <button
                aria-label="关闭历史详情"
                className="icon-button"
                onClick={() => setSelectedHistoryRecordId(undefined)}
                type="button"
              >
                <X size={18} />
              </button>
            </header>

            <div className="history-detail-layout">
              <section className="detail-side-panel">
                <div className="detail-panel-title">
                  <span>请求</span>
                </div>
                <dl className="detail-list">
                  <div>
                    <dt>请求 ID</dt>
                    <dd>{selectedHistoryRecord.requestId}</dd>
                  </div>
                  <div>
                    <dt>状态</dt>
                    <dd>{formatHistoryStatus(selectedHistoryRecord.status)}</dd>
                  </div>
                  <div>
                    <dt>创建时间</dt>
                    <dd>{formatPanelTime(selectedHistoryRecord.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>同步状态</dt>
                    <dd>{selectedHistoryRecord.syncStatus}</dd>
                  </div>
                  <div>
                    <dt>归档</dt>
                    <dd>{selectedHistoryRecord.archived ? "已归档" : "未归档"}</dd>
                  </div>
                </dl>
              </section>

              <section className="detail-side-panel">
                <div className="detail-panel-title">
                  <span>提示词</span>
                  <button
                    aria-label="复制历史提示词"
                    className="icon-button"
                    onClick={() => navigator.clipboard?.writeText(selectedHistoryRecord.promptSummary ?? "")}
                    type="button"
                  >
                    <Copy size={15} />
                  </button>
                </div>
                <p>{selectedHistoryRecord.promptSummary ?? "无提示词摘要"}</p>
                <dl className="detail-list">
                  <div>
                    <dt>比例</dt>
                    <dd>{formatParamValue(selectedHistoryRecord.params.ratio)}</dd>
                  </div>
                  <div>
                    <dt>分辨率</dt>
                    <dd>{formatParamValue(selectedHistoryRecord.params.resolution)}</dd>
                  </div>
                  <div>
                    <dt>质量</dt>
                    <dd>{formatParamValue(selectedHistoryRecord.params.quality)}</dd>
                  </div>
                  <div>
                    <dt>生成张数</dt>
                    <dd>{selectedHistoryRecord.params.count}</dd>
                  </div>
                </dl>
              </section>

              <section className="detail-side-panel">
                <div className="detail-panel-title">
                  <span>结果</span>
                </div>
                <div className="history-detail-images">
                  {selectedHistoryRecord.resultImages.length > 0 ? (
                    selectedHistoryRecord.resultImages.map((image) => (
                      <div className="history-detail-image" key={image.id}>
                        {image.url ? (
                          <img
                            alt={`历史图片 ${image.index + 1}`}
                            onLoad={(event) =>
                              handleGeneratedImageLoaded(
                                image,
                                event.currentTarget.naturalWidth,
                                event.currentTarget.naturalHeight
                              )
                            }
                            src={image.url}
                          />
                        ) : (
                          <Images size={18} />
                        )}
                        <span>{formatActualImageResolution(image)}</span>
                        {image.temporary && <small>临时链接{image.expiresAt ? `至 ${formatPanelTime(image.expiresAt)}` : ""}</small>}
                      </div>
                    ))
                  ) : (
                    <p>{selectedHistoryRecord.error?.message ?? "本记录没有可展示图片。"}</p>
                  )}
                </div>
                <footer className="dialog-actions">
                  <button
                    className="primary-action"
                    onClick={() => {
                      handleReuseHistoryRecord(selectedHistoryRecord);
                      setSelectedHistoryRecordId(undefined);
                    }}
                    type="button"
                  >
                    <RotateCcw size={17} />
                    复用记录
                  </button>
                </footer>
              </section>
            </div>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation">
          <section aria-modal="true" className="settings-dialog" role="dialog">
            <header className="dialog-header">
              <div>
                <span>设置</span>
                <h2>设置中心</h2>
              </div>
              <button aria-label="关闭设置" className="icon-button" onClick={() => setSettingsOpen(false)} type="button">
                <X size={18} />
              </button>
            </header>

            <div aria-label="设置分类" className="settings-tabs" role="tablist">
              <button
                aria-selected={settingsActiveTab === "api-model"}
                className={`settings-tab${settingsActiveTab === "api-model" ? " active" : ""}`}
                onClick={() => setSettingsActiveTab("api-model")}
                role="tab"
                type="button"
              >
                <Code2 size={16} />
                API 与模型
              </button>
              <button
                aria-selected={settingsActiveTab === "storage-image"}
                className={`settings-tab${settingsActiveTab === "storage-image" ? " active" : ""}`}
                onClick={() => setSettingsActiveTab("storage-image")}
                role="tab"
                type="button"
              >
                <Folder size={16} />
                存储与图片
              </button>
            </div>

            <div className="settings-tab-panel">
              {settingsActiveTab === "api-model" ? (
                <>
            <section className="settings-section">
              <div className="key-status">
                <span>主 Key 状态</span>
                <strong>{settings.mainApiKey.hasValue ? settings.mainApiKey.maskedValue : "未配置"}</strong>
              </div>

              <label className="field">
                <span>主 API Key</span>
                <div className="secret-input">
                  <input
                    aria-label="主 API Key"
                    autoComplete="off"
                    onChange={(event) => setApiKeyInput(event.target.value)}
                    type={showRealKey ? "text" : "password"}
                    value={apiKeyInput}
                  />
                  <button
                    aria-label={showRealKey ? "隐藏 API Key" : "显示 API Key"}
                    className="icon-button"
                    onClick={() => setShowRealKey((current) => !current)}
                    type="button"
                  >
                    {showRealKey ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </label>

              <footer className="settings-inline-actions">
                <button className="secondary-action" onClick={handleClearApiKey} type="button">
                  <Trash2 size={17} />
                  清空输入
                </button>
              </footer>
              {settingsFeedback?.target === "main-key" && (
                <p className="settings-feedback" role="status">
                  <Check size={15} />
                  {settingsFeedback.message}
                </p>
              )}
            </section>

            <section className="settings-section">
              <div className="settings-section-title">
                <div>
                  <span>工具模型</span>
                  <h3>识图与推理真实接口</h3>
                </div>
                <strong>多端点</strong>
              </div>
              <div className="settings-grid">
                <label className="field">
                  <span>识图请求模型名</span>
                  <input
                    aria-label="设置识图请求模型名"
                    onChange={(event) => setSettingsRecognitionModelInput(event.target.value)}
                    placeholder={DEFAULT_UTILITY_RECOGNITION_MODEL_NAME}
                    value={settingsRecognitionModelInput}
                  />
                </label>
                <label className="field">
                  <span>推理请求模型名</span>
                  <input
                    aria-label="设置推理请求模型名"
                    onChange={(event) => setSettingsReasoningModelInput(event.target.value)}
                    placeholder={DEFAULT_UTILITY_REASONING_MODEL_NAME}
                    value={settingsReasoningModelInput}
                  />
                </label>
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-section-title">
                <div>
                  <span>模型配置</span>
                  <h3>模型映射管理</h3>
                </div>
                <strong>{configuredModels.length} 个可用模型</strong>
              </div>

              <div className="model-settings-layout">
                <aside aria-label="模型列表" className="model-manager-list">
                  <div className="model-manager-header">
                    <div>
                      <span>模型列表</span>
                      <strong>{settings.endpoint.customModels.length} 个自定义</strong>
                    </div>
                    <div className="model-manager-actions">
                      <button
                        aria-label="新增自定义模型"
                        className="icon-button"
                        onClick={handleDuplicateModelSettings}
                        title="新增自定义模型"
                        type="button"
                      >
                        <Plus size={17} />
                      </button>
                      {settings.endpoint.hiddenModelIds.length > 0 && (
                        <button
                          aria-label="恢复内置模型"
                          className="icon-button"
                          onClick={handleRestoreModelSettings}
                          title="恢复内置模型"
                          type="button"
                        >
                          <RotateCcw size={17} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="model-list">
                    {configuredModels.length > 0 ? (
                      configuredModels.map((model) => {
                        const isCustomModel = settings.endpoint.customModels.some((item) => item.id === model.id);

                        return (
                          <button
                            className={`model-list-item${model.id === settingsModelBaseModel?.id ? " active" : ""}`}
                            key={model.id}
                            onClick={() => setSettingsModelId(model.id)}
                            type="button"
                          >
                            <strong>{model.displayName}</strong>
                            <span>{model.apiModelName}</span>
                            <small>{isCustomModel ? "自定义" : "内置"}</small>
                          </button>
                        );
                      })
                    ) : (
                      <p className="model-empty-state">暂无可用模型</p>
                    )}
                  </div>
                </aside>

                <div className="model-editor-panel">
                  {settingsModelBaseModel ? (
                    <>
                      <div className="model-editor-toolbar">
                        <div>
                          <span>{settingsModelIsCustom ? "自定义模型" : "内置模型"}</span>
                          <strong>{settingsModelBaseModel.displayName}</strong>
                        </div>
                        <code>{settingsModelBaseModel.apiModelName}</code>
                      </div>

                      <div className="settings-grid model-editor-grid">
                        <label className="field">
                          <span>展示名</span>
                          <input
                            aria-label="模型展示名"
                            onChange={(event) => setModelDisplayNameInput(event.target.value)}
                            placeholder="页面显示名称"
                            value={modelDisplayNameInput}
                          />
                        </label>
                        <label className="field">
                          <span>请求模型名</span>
                          <input
                            aria-label="实际请求模型名"
                            onChange={(event) => setModelApiModelNameInput(event.target.value)}
                            placeholder="上游 model 字段"
                            value={modelApiModelNameInput}
                          />
                        </label>
                        <label className="field settings-wide-field">
                          <span>baseUrl 前缀</span>
                          <input
                            aria-label="模型 baseUrl 前缀"
                            onChange={(event) => setModelBaseUrlInput(event.target.value)}
                            placeholder={getModelEndpointPrefix(settingsModelBaseModel)}
                            value={modelBaseUrlInput}
                          />
                        </label>
                        {settingsModelUsesOpenAIEndpoint && (
                          <label className="field settings-wide-field">
                            <span>API 端点</span>
                            <select
                              aria-label="模型 API 端点"
                              onChange={(event) =>
                                setModelEndpointVariantInput(event.target.value as OpenAIEndpointVariant)
                              }
                              value={modelEndpointVariantInput}
                            >
                              {OPENAI_ENDPOINT_VARIANT_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <label className="field settings-wide-field">
                          <span>模型 API Key</span>
                          <div className="secret-input">
                            <input
                              aria-label="模型 API Key"
                              autoComplete="off"
                              onChange={(event) => setModelApiKeyInput(event.target.value)}
                              type={showModelApiKey ? "text" : "password"}
                              value={modelApiKeyInput}
                            />
                            <button
                              aria-label={showModelApiKey ? "隐藏模型 API Key" : "显示模型 API Key"}
                              className="icon-button"
                              onClick={() => setShowModelApiKey((current) => !current)}
                              type="button"
                            >
                              {showModelApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                          </div>
                        </label>
                      </div>

                      <footer className="dialog-actions model-editor-actions">
                        <button className="secondary-action danger-action" onClick={handleDeleteModelSettings} type="button">
                          <Trash2 size={17} />
                          {settingsModelIsCustom ? "删除模型" : "隐藏模型"}
                        </button>
                        {!settingsModelIsCustom && (
                          <button className="secondary-action" onClick={handleClearModelSettings} type="button">
                            <RotateCcw size={17} />
                            清除覆盖
                          </button>
                        )}
                        <button className="secondary-action" onClick={handleDuplicateModelSettings} type="button">
                          <Copy size={17} />
                          复制为新模型
                        </button>
                      </footer>
                    </>
                  ) : (
                    <div className="model-empty-state">暂无可编辑模型</div>
                  )}
                </div>
              </div>
              {settingsFeedback?.target === "model" && (
                <p className="settings-feedback" role="status">
                  <Check size={15} />
                  {settingsFeedback.message}
                </p>
              )}
            </section>

                </>
              ) : (
                <>
            <section className="settings-section">
              <div className="settings-section-title">
                <div>
                  <span>图片存放</span>
                  <h3>本地保存路径</h3>
                </div>
                <strong>Windows 图片目录</strong>
              </div>

              <label className="field">
                <span>图片存放路径</span>
                <div className="storage-path-input">
                  <Folder size={18} />
                  <input
                    aria-label="图片存放路径"
                    onChange={(event) => setStoragePathInput(event.target.value)}
                    placeholder={DEFAULT_LOCAL_ARCHIVE_DIRECTORY_PATH}
                    value={storagePathInput}
                  />
                </div>
              </label>

              {settingsFeedback?.target === "storage" && (
                <p className="settings-feedback" role="status">
                  <Check size={15} />
                  {settingsFeedback.message}
                </p>
              )}
            </section>

            <section className="settings-section">
              <div className="settings-section-title">
                <div>
                  <span>高级存储</span>
                  <h3>R2 / OSS / 本地归档</h3>
                </div>
                <strong>{STORAGE_TYPE_OPTIONS.find((option) => option.value === storageTypeInput)?.label}</strong>
              </div>

              <div className="settings-grid">
                <label className="field">
                  <span>存储类型</span>
                  <select
                    aria-label="存储类型"
                    onChange={(event) => setStorageTypeInput(event.target.value as StorageType)}
                    value={storageTypeInput}
                  >
                    {STORAGE_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="toggle-row">
                  <input
                    checked={defaultCloudEnabledInput}
                    onChange={(event) => setDefaultCloudEnabledInput(event.target.checked)}
                    type="checkbox"
                  />
                  <span>启用默认云存储</span>
                </label>
                <label className="toggle-row">
                  <input
                    checked={localArchiveEnabledInput}
                    onChange={(event) => setLocalArchiveEnabledInput(event.target.checked)}
                    type="checkbox"
                  />
                  <span>启用本地归档</span>
                </label>
              </div>

              <div className="settings-grid">
                <label className="field">
                  <span>R2 Endpoint</span>
                  <input
                    aria-label="R2 Endpoint"
                    onChange={(event) => setR2EndpointInput(event.target.value)}
                    value={r2EndpointInput}
                  />
                </label>
                <label className="field">
                  <span>R2 Bucket</span>
                  <input
                    aria-label="R2 Bucket"
                    onChange={(event) => setR2BucketInput(event.target.value)}
                    value={r2BucketInput}
                  />
                </label>
                <label className="field">
                  <span>R2 Access Key ID</span>
                  <input
                    aria-label="R2 Access Key ID"
                    onChange={(event) => setR2AccessKeyInput(event.target.value)}
                    value={r2AccessKeyInput}
                  />
                </label>
                <label className="field">
                  <span>R2 Secret</span>
                  <input
                    aria-label="R2 Secret"
                    autoComplete="off"
                    onChange={(event) => setR2SecretKeyInput(event.target.value)}
                    type="password"
                    value={r2SecretKeyInput}
                  />
                </label>
                <label className="field">
                  <span>OSS Endpoint</span>
                  <input
                    aria-label="OSS Endpoint"
                    onChange={(event) => setOssEndpointInput(event.target.value)}
                    value={ossEndpointInput}
                  />
                </label>
                <label className="field">
                  <span>OSS Bucket</span>
                  <input
                    aria-label="OSS Bucket"
                    onChange={(event) => setOssBucketInput(event.target.value)}
                    value={ossBucketInput}
                  />
                </label>
                <label className="field">
                  <span>OSS Access Key ID</span>
                  <input
                    aria-label="OSS Access Key ID"
                    onChange={(event) => setOssAccessKeyInput(event.target.value)}
                    value={ossAccessKeyInput}
                  />
                </label>
                <label className="field">
                  <span>OSS Secret</span>
                  <input
                    aria-label="OSS Secret"
                    autoComplete="off"
                    onChange={(event) => setOssSecretKeyInput(event.target.value)}
                    type="password"
                    value={ossSecretKeyInput}
                  />
                </label>
              </div>

              {settings.storage.lastTestResult && (
                <p className={`settings-feedback ${settings.storage.lastTestResult.success ? "" : "danger-feedback"}`} role="status">
                  {settings.storage.lastTestResult.success ? <Check size={15} /> : <AlertTriangle size={15} />}
                  {settings.storage.lastTestResult.message}
                </p>
              )}

              <footer className="dialog-actions">
                <button className="secondary-action" onClick={handleTestStorageSettings} type="button">
                  <TestTube2 size={17} />
                  测试连接
                </button>
              </footer>
            </section>
                </>
              )}
            </div>

            <footer className="settings-dialog-footer">
              <button className="secondary-action" onClick={() => setSettingsOpen(false)} type="button">
                取消
              </button>
              <button className="primary-action" onClick={handleSaveAllSettings} type="button">
                <Save size={17} />
                保存设置
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
