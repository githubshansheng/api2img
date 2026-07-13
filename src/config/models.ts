import type {
  ApiType,
  EndpointType,
  ModelConfig,
  ModelFeatureFlags,
  ModelTag,
  OutputFormat,
  Provider,
  QualityOption,
  RatioOption,
  ResolutionOption,
  ResponseFormat
} from "../domain";

const UPDATED_AT = "2026-07-06";
const DEFAULT_API_BASE_URL = "https://ai.heigh.vip";
const IMAGE_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;
const OPENAI_IMAGE_TIMEOUT_MS = IMAGE_REQUEST_TIMEOUT_MS;
const GEMINI_IMAGE_TIMEOUT_MS = IMAGE_REQUEST_TIMEOUT_MS;
const APIYI_DOC_URL = "https://api.apiyi.com/";
const OPENAI_IMAGE_URL = `${DEFAULT_API_BASE_URL}/v1/images/generations`;
const OPENAI_EDIT_URL = `${DEFAULT_API_BASE_URL}/v1/images/edits`;

export const DEFAULT_MODEL_ID = "gpt-image-2";

const ratioOptions: RatioOption[] = [
  { key: "auto", label: "自适应", enabled: true },
  { key: "1:1", label: "1:1", widthRatio: 1, heightRatio: 1, enabled: true },
  { key: "16:9", label: "16:9", widthRatio: 16, heightRatio: 9, enabled: true },
  { key: "9:16", label: "9:16", widthRatio: 9, heightRatio: 16, enabled: true },
  { key: "4:3", label: "4:3", widthRatio: 4, heightRatio: 3, enabled: true },
  { key: "3:4", label: "3:4", widthRatio: 3, heightRatio: 4, enabled: true },
  { key: "3:2", label: "3:2", widthRatio: 3, heightRatio: 2, enabled: true },
  { key: "2:3", label: "2:3", widthRatio: 2, heightRatio: 3, enabled: true },
  { key: "21:9", label: "21:9", widthRatio: 21, heightRatio: 9, enabled: true },
  { key: "5:4", label: "5:4", widthRatio: 5, heightRatio: 4, enabled: true },
  { key: "4:5", label: "4:5", widthRatio: 4, heightRatio: 5, enabled: true },
  { key: "4:1", label: "4:1", widthRatio: 4, heightRatio: 1, enabled: true },
  { key: "1:4", label: "1:4", widthRatio: 1, heightRatio: 4, enabled: true },
  { key: "8:1", label: "8:1", widthRatio: 8, heightRatio: 1, enabled: true },
  { key: "1:8", label: "1:8", widthRatio: 1, heightRatio: 8, enabled: true }
];

const resolutionOptions: ResolutionOption[] = [
  { key: "auto", label: "自适应", isEstimated: true, enabled: true },
  { key: "0.5K", label: "0.5K", isEstimated: false, enabled: true },
  { key: "1K", label: "1K", isEstimated: false, enabled: true },
  { key: "2K", label: "2K", isEstimated: false, enabled: true },
  { key: "4K", label: "4K", isEstimated: false, enabled: true }
];

const basicQualities: QualityOption[] = [
  { key: "auto", label: "自动", enabled: true },
  { key: "low", label: "低", enabled: true, priceMultiplier: 0.8 },
  { key: "medium", label: "中", enabled: true, priceMultiplier: 1 },
  { key: "high", label: "高", enabled: true, priceMultiplier: 1.4 }
];

const autoQualityOnly: QualityOption[] = [{ key: "auto", label: "自动", enabled: true }];

type ModelSeed = {
  id: string;
  displayName: string;
  apiType: ApiType;
  endpointType: EndpointType;
  maxReferenceImages: number;
  maxOutputs: number;
  description: string;
  sortOrder: number;
  tags?: ModelTag[];
  timeLabel?: string;
  responseFormat?: ResponseFormat;
  apiModelName?: string;
  supportsHighResolution?: boolean;
  sizeByPromptOnly?: boolean;
  requiresEnterpriseGroupOnRateLimit?: boolean;
  supportsTransparentBackground?: boolean;
};

function cloneRatios() {
  return ratioOptions.map((option) => ({ ...option }));
}

function cloneResolutions(disableHighResolution = false) {
  return resolutionOptions.map((option) => {
    if (disableHighResolution && (option.key === "2K" || option.key === "4K")) {
      return {
        ...option,
        enabled: false,
        disabledReason: "当前模型暂未开放高分辨率"
      };
    }

    return { ...option };
  });
}

function providerFor(apiType: ApiType): Provider {
  if (apiType === "gemini-native") {
    return "google";
  }

  if (apiType === "seedream") {
    return "bytedance";
  }

  if (apiType === "flux-kontext" || apiType === "flux-2") {
    return "flux";
  }

  if (apiType === "openai-image" || apiType === "openai-image-edit") {
    return "openai";
  }

  return "custom";
}

function baseURLFor(seed: ModelSeed) {
  if (seed.endpointType === "gemini-generate-content") {
    return `${DEFAULT_API_BASE_URL}/v1beta/models/${seed.apiModelName ?? seed.id}:generateContent`;
  }

  return OPENAI_IMAGE_URL;
}

function featureFlagsFor(seed: ModelSeed): ModelFeatureFlags {
  return {
    allowLegacyModelName: seed.id === "gpt-image-1-5",
    isPreviewModel: false,
    sizeByPromptOnly: seed.sizeByPromptOnly ?? false,
    supportsHighResolution: seed.supportsHighResolution ?? true,
    allowChatCompletionsFallback: false,
    requiresEnterpriseGroupOnRateLimit: seed.requiresEnterpriseGroupOnRateLimit ?? false,
    supportsPromptTemplate: true,
    supportsPromptOptimize: false,
    supportsTransparentBackground: seed.supportsTransparentBackground ?? false,
    supportsSafetyLevel: seed.apiType === "openai-image" || seed.apiType === "openai-image-edit",
    returnsTemporaryURL: seed.responseFormat !== "b64_json"
  };
}

function responsePolicyFor(seed: ModelSeed) {
  if (seed.endpointType === "gemini-generate-content") {
    return {
      imageUrlPaths: ["candidates[].content.parts[].fileData.fileUri"],
      imageBase64Paths: ["candidates[].content.parts[].inlineData.data"],
      errorCodePaths: ["error.code"],
      errorMessagePaths: ["error.message"],
      finishReasonPaths: ["candidates[].finishReason"],
      tokenCountPaths: ["usageMetadata.totalTokenCount", "usageMetadata.candidatesTokenCount"],
      temporaryUrlTTLSeconds: 600,
      resultRequiresImmediateSave: true
    };
  }

  return {
    imageUrlPaths: [
      "data[].url",
      "data[].image_url",
      "images[].url",
      "result.images[].url",
      "output[].content[].image_url",
      "output[].content[].image_url.url"
    ],
    imageBase64Paths: [
      "data[].b64_json",
      "images[].b64_json",
      "output[].result",
      "output[].content[].b64_json",
      "output[].content[].image_base64"
    ],
    errorCodePaths: ["error.code", "code"],
    errorMessagePaths: ["error.message", "message"],
    finishReasonPaths: [],
    tokenCountPaths: ["usage.total_tokens", "usage.input_tokens", "usage.output_tokens"],
    temporaryUrlTTLSeconds: seed.responseFormat === "b64_json" ? undefined : 600,
    resultRequiresImmediateSave: seed.responseFormat !== "b64_json"
  };
}

function createModel(seed: ModelSeed): ModelConfig {
  const apiModelName = seed.apiModelName ?? seed.id;
  const isGemini = seed.endpointType === "gemini-generate-content";
  const isOpenAI = seed.apiType === "openai-image" || seed.apiType === "openai-image-edit";
  const responseFormat = seed.responseFormat ?? (isGemini ? "json" : "url");
  const supportsHighResolution = seed.supportsHighResolution ?? true;
  const outputFormats: OutputFormat[] = isOpenAI ? ["png", "jpeg", "webp"] : ["png"];

  return {
    id: seed.id,
    apiModelName,
    displayName: seed.displayName,
    provider: providerFor(seed.apiType),
    apiType: seed.apiType,
    endpointType: seed.endpointType,
    baseURL: baseURLFor({ ...seed, apiModelName }),
    editURL: isOpenAI ? OPENAI_EDIT_URL : undefined,
    docURL: APIYI_DOC_URL,
    enabled: true,
    isDefault: seed.id === DEFAULT_MODEL_ID,
    sortOrder: seed.sortOrder,
    tags: seed.tags ?? [],
    timeLabel: seed.timeLabel ?? "按上游响应",
    description: seed.description,
    price: {
      mode: "custom",
      unitLabel: "张",
      basePriceText: "按当前配置计费",
      currency: "CNY",
      multiplierFields: ["count", "resolution", "quality"],
      pricingNote: "最终费用以上游和账户扣费为准",
      chargeOnFailureRisk: true
    },
    capabilities: {
      ratios: cloneRatios(),
      resolutions: cloneResolutions(!supportsHighResolution),
      qualities: isGemini ? autoQualityOnly.map((option) => ({ ...option })) : basicQualities.map((option) => ({ ...option })),
      maxOutputs: seed.maxOutputs,
      defaultOutputCount: 1,
      maxReferenceImages: seed.maxReferenceImages,
      minReferenceImages: 0,
      supportedReferenceFormats: ["jpg", "jpeg", "png"],
      maxReferenceImageSizeMB: 20,
      supportsTextToImage: true,
      supportsImageToImage: seed.maxReferenceImages > 0,
      supportsMultiImageFusion: seed.maxReferenceImages > 1,
      supportsGifReference: false,
      outputFormats,
      responseFormats: [responseFormat],
      supportsSeed: false,
      supportsNegativePrompt: false,
      supportsStylePreset: false
    },
    editCapabilities: {
      supportsWholeImageEdit: seed.maxReferenceImages > 0,
      localMode:
        isOpenAI && seed.maxReferenceImages > 0
          ? "native-mask"
          : seed.maxReferenceImages > 1
            ? "annotated-reference"
            : "none",
      continuationMode:
        isOpenAI && seed.endpointType === "responses"
          ? "openai-response"
          : isGemini
            ? "gemini-context"
            : "reference",
      supportsBranchMerge: seed.maxReferenceImages > 1,
      maxCandidates: seed.maxReferenceImages > 0 ? 4 : 1
    },
    request: {
      authHeaderName: "Authorization",
      authScheme: "Bearer",
      contentType: "application/json",
      imageInputMode: isGemini ? "base64" : "auto",
      preferEditEndpointWhenHasReference: isOpenAI,
      includeFields: isGemini ? ["contents", "generationConfig"] : ["model", "prompt", "n"],
      omitFields: seed.sizeByPromptOnly ? ["size"] : [],
      removeResponseFormatWhenUnsupported: isOpenAI,
      modelNameMode: "current",
      timeoutMs: isGemini ? GEMINI_IMAGE_TIMEOUT_MS : OPENAI_IMAGE_TIMEOUT_MS,
      retry: {
        autoRetry: false,
        maxAttempts: 1,
        retryableStatusCodes: [502, 503, 504],
        backoffMs: 1000
      }
    },
    response: responsePolicyFor({ ...seed, apiModelName, responseFormat }),
    featureFlags: featureFlagsFor({ ...seed, apiModelName, responseFormat, supportsHighResolution }),
    temporaryRestrictions: [],
    notice: undefined,
    ui: {
      badgeText: seed.tags?.[0]?.toUpperCase(),
      parameterHelpText: "参数选项由当前模型能力配置决定。",
      costHelpText: "费用为预估展示，最终以上游和账户扣费为准。",
      referenceHelpText: `最多支持 ${seed.maxReferenceImages} 张参考图。`,
      resultHelpText: "图片链接可能短期失效，请及时保存。"
    },
    updatedAt: UPDATED_AT
  };
}

export const models: ModelConfig[] = [
  createModel({
    id: "nano-banana-pro",
    displayName: "Nano Banana Pro",
    apiType: "gemini-native",
    endpointType: "gemini-generate-content",
    maxReferenceImages: 12,
    maxOutputs: 1,
    description: "适合高质量生成与编辑，图片输入走 contents.parts。",
    sortOrder: 10,
    tags: ["recommended", "new"],
    timeLabel: "高质量"
  }),
  createModel({
    id: "nano-banana-2",
    displayName: "Nano Banana 2",
    apiType: "gemini-native",
    endpointType: "gemini-generate-content",
    maxReferenceImages: 12,
    maxOutputs: 1,
    description: "与 Gemini 原生适配器一致，适合稳定生成与编辑。",
    sortOrder: 20,
    tags: ["hot"]
  }),
  createModel({
    id: "nano-banana-lite",
    displayName: "Nano Banana Lite",
    apiType: "gemini-native",
    endpointType: "gemini-generate-content",
    maxReferenceImages: 12,
    maxOutputs: 1,
    description: "速度优先，适合快速草图和轻量生成。",
    sortOrder: 30,
    tags: ["fast"],
    timeLabel: "速度优先",
    supportsHighResolution: false
  }),
  createModel({
    id: "gpt-image-2",
    displayName: "GPT Image 2",
    apiType: "openai-image",
    endpointType: "images-generations",
    maxReferenceImages: 12,
    maxOutputs: 10,
    description: "",
    sortOrder: 60,
    tags: ["hot"],
    responseFormat: "b64_json"
  }),
  createModel({
    id: "nano-banana",
    displayName: "Nano Banana",
    apiType: "gemini-native",
    endpointType: "gemini-generate-content",
    maxReferenceImages: 12,
    maxOutputs: 1,
    description: "兼容或基础 Gemini 图像模型。",
    sortOrder: 70,
    tags: ["legacy"]
  }),
  createModel({
    id: "seedream-5",
    displayName: "SeeDream 5.0",
    apiType: "seedream",
    endpointType: "custom",
    maxReferenceImages: 12,
    maxOutputs: 1,
    description: "支持 URL 与 Base64 输出时按配置解析。",
    sortOrder: 80,
    tags: ["new"]
  }),
  createModel({
    id: "seedream-4-5",
    displayName: "SeeDream 4.5",
    apiType: "seedream",
    endpointType: "custom",
    maxReferenceImages: 12,
    maxOutputs: 1,
    description: "与 SeeDream 适配器一致的稳定版本。",
    sortOrder: 90
  }),
  createModel({
    id: "flux-kontext-pro",
    displayName: "Flux Kontext Pro",
    apiType: "flux-kontext",
    endpointType: "custom",
    maxReferenceImages: 4,
    maxOutputs: 1,
    description: "强调图像编辑，提示词语言差异按配置提示。",
    sortOrder: 100,
    tags: ["recommended"]
  }),
  createModel({
    id: "flux-kontext-max",
    displayName: "Flux Kontext Max",
    apiType: "flux-kontext",
    endpointType: "custom",
    maxReferenceImages: 4,
    maxOutputs: 1,
    description: "高质量模式，费用和耗时按配置展示。",
    sortOrder: 110,
    tags: ["hot"]
  }),
  createModel({
    id: "flux-2-pro",
    displayName: "Flux 2 Pro",
    apiType: "flux-2",
    endpointType: "custom",
    maxReferenceImages: 4,
    maxOutputs: 1,
    description: "多图融合能力按配置开启。",
    sortOrder: 120,
    tags: ["new"]
  }),
  createModel({
    id: "flux-2-max",
    displayName: "Flux 2 Max",
    apiType: "flux-2",
    endpointType: "custom",
    maxReferenceImages: 8,
    maxOutputs: 1,
    description: "高质量多图融合，参考图上限为 8。",
    sortOrder: 130,
    tags: ["hot"]
  }),
  createModel({
    id: "flux-2-flex",
    displayName: "Flux 2 Flex",
    apiType: "flux-2",
    endpointType: "custom",
    maxReferenceImages: 4,
    maxOutputs: 1,
    description: "平衡速度与质量的 Flux 2 模型。",
    sortOrder: 140,
    tags: ["fast"]
  }),
  createModel({
    id: "flux-2-klein-9b",
    displayName: "Flux 2 Klein 9B",
    apiType: "flux-2",
    endpointType: "custom",
    maxReferenceImages: 4,
    maxOutputs: 1,
    description: "轻量模型，适合更快的低成本探索。",
    sortOrder: 150,
    tags: ["fast"]
  }),
  createModel({
    id: "gpt-image-1-5",
    displayName: "GPT Image 1.5",
    apiType: "openai-image",
    endpointType: "images-generations",
    maxReferenceImages: 12,
    maxOutputs: 4,
    description: "旧模型或高兼容模型，支持最多 4 张输出。",
    sortOrder: 160,
    tags: ["legacy"],
    responseFormat: "b64_json"
  })
];

export function getEnabledModels() {
  return models.filter((model) => model.enabled).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getModelById(modelId: string) {
  return models.find((model) => model.id === modelId);
}
