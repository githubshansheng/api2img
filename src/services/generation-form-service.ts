import { resolveModelCapabilities } from "../domain";
import type {
  ClientContext,
  CreateGenerationResponse,
  EndpointOverride,
  GenerationParams,
  GenerationReferenceInput,
  GenerationRequestPayload,
  GenerationServerOptions,
  ModelConfig,
  ModelRequestOverride,
  ReferenceImage,
  ValidationIssue,
  ValidationState
} from "../domain";
import { isSafeApiKeyForHeader } from "./http-header-service";

export type CostPreview = {
  unitPriceText: string;
  estimatedCostText: string;
  canCalculate: boolean;
  estimatedCostValue?: number;
  currency?: string;
  quantityText: string;
  resolutionText: string;
  qualityText: string;
  affectedByFields: string[];
  note?: string;
  riskText?: string;
};

export type ValidatableReferenceImage = Pick<
  GenerationReferenceInput,
  "base64" | "format" | "mimeType" | "name" | "order" | "remoteURL" | "sizeBytes"
>;

export type GenerationFormValidationInput = {
  model: ModelConfig;
  prompt: string;
  referenceImages: ValidatableReferenceImage[];
  params: GenerationParams;
  apiKey?: string;
  requireApiKey?: boolean;
};

export type BuildGenerationPayloadInput = {
  model: ModelConfig;
  prompt: string;
  negativePrompt?: string;
  referenceImages: ReferenceImage[];
  params: GenerationParams;
  requestId?: string;
  endpointOverride?: EndpointOverride;
  modelOverride?: ModelRequestOverride;
  options?: Partial<GenerationServerOptions>;
  clientContext?: ClientContext;
};

export const defaultGenerationServerOptions: GenerationServerOptions = {
  saveToHistory: true,
  storeResultToCloud: true,
  returnRawSummary: false,
  useCustomEndpoint: false
};

export function estimateGenerationCost(model: ModelConfig, params: GenerationParams): CostPreview {
  const { price } = model;
  const count = Math.max(1, Math.floor(params.count || 1));
  const resolution = model.capabilities.resolutions.find((option) => option.key === params.resolution);
  const quality = model.capabilities.qualities.find((option) => option.key === params.quality);
  const qualityMultiplier = price.qualityMultiplier?.[params.quality] ?? quality?.priceMultiplier ?? 1;
  const resolutionMultiplier = price.resolutionMultiplier?.[params.resolution] ?? 1;
  const multiplier = qualityMultiplier * resolutionMultiplier;
  const resolutionText = formatResolutionText(resolution?.label ?? params.resolution, resolution?.isEstimated);
  const qualityText = quality?.label ?? params.quality;
  const basePreview = {
    unitPriceText: price.basePriceText,
    estimatedCostText: "以上游实际扣费为准",
    canCalculate: false,
    currency: price.currency,
    quantityText: `${count} ${price.unitLabel}`,
    resolutionText,
    qualityText,
    affectedByFields: price.multiplierFields,
    note: price.pricingNote,
    riskText: price.chargeOnFailureRisk ? "上游失败仍可能产生扣费，请以账户账单为准。" : undefined
  } satisfies CostPreview;

  if (price.mode === "range" && price.minPriceValue !== undefined && price.maxPriceValue !== undefined) {
    const minTotal = price.minPriceValue * count * multiplier;
    const maxTotal = price.maxPriceValue * count * multiplier;

    return {
      ...basePreview,
      unitPriceText: `${formatMoney(price.minPriceValue, price.currency)} - ${formatMoney(
        price.maxPriceValue,
        price.currency
      )}/${price.unitLabel}`,
      estimatedCostText: `${formatMoney(minTotal, price.currency)} - ${formatMoney(maxTotal, price.currency)}`,
      canCalculate: true
    };
  }

  if (price.mode !== "token" && price.mode !== "custom" && price.basePriceValue !== undefined) {
    const estimatedCostValue = price.basePriceValue * count * multiplier;

    return {
      ...basePreview,
      unitPriceText: `${formatMoney(price.basePriceValue * multiplier, price.currency)}/${price.unitLabel}`,
      estimatedCostText: formatMoney(estimatedCostValue, price.currency),
      canCalculate: true,
      estimatedCostValue
    };
  }

  return basePreview;
}

export function validateGenerationForm(input: GenerationFormValidationInput): ValidationState {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const { model, params, referenceImages } = input;
  const resolved = resolveModelCapabilities(model);
  const prompt = input.prompt.trim();
  const maxReferenceImages = Math.min(model.capabilities.maxReferenceImages, 12);
  const minReferenceImages = model.capabilities.supportsTextToImage ? model.capabilities.minReferenceImages : 1;
  const maxSizeBytes = model.capabilities.maxReferenceImageSizeMB * 1024 * 1024;
  const supportedFormats = new Set(model.capabilities.supportedReferenceFormats);

  if (input.requireApiKey && !input.apiKey?.trim()) {
    errors.push({
      field: "apiKeys.main",
      code: "API_KEY_REQUIRED",
      message: "请先在设置中配置 API Key",
      blocking: true
    });
  } else if (input.requireApiKey && !isSafeApiKeyForHeader(input.apiKey)) {
    errors.push({
      field: "apiKeys.main",
      code: "API_KEY_INVALID_HEADER_VALUE",
      message: "API Key 只能包含英文、数字和常见符号，请清除中文说明、空格或换行后重新保存。",
      blocking: true
    });
  }

  if (!prompt && referenceImages.length === 0) {
    errors.push({
      field: "prompt",
      code: "PROMPT_OR_IMAGE_REQUIRED",
      message: "请输入提示词或上传参考图",
      blocking: true
    });
  }

  if (referenceImages.length < minReferenceImages) {
    errors.push({
      field: "referenceImages",
      code: "REFERENCE_IMAGE_REQUIRED",
      message: `当前模型至少需要 ${minReferenceImages} 张参考图`,
      blocking: true
    });
  }

  if (referenceImages.length > maxReferenceImages) {
    errors.push({
      field: "referenceImages",
      code: "REFERENCE_LIMIT_EXCEEDED",
      message: `当前模型最多支持 ${maxReferenceImages} 张参考图`,
      blocking: true
    });
  }

  if (referenceImages.length > 0 && !model.capabilities.supportsImageToImage) {
    errors.push({
      field: "referenceImages",
      code: "MODEL_REFERENCE_UNSUPPORTED",
      message: "当前模型不支持参考图输入",
      blocking: true
    });
  }

  referenceImages.forEach((image, index) => {
    if (!hasReferenceImageTransportData(image)) {
      errors.push({
        field: `referenceImages[${index}].base64`,
        code: "REFERENCE_IMAGE_DATA_EMPTY",
        message: `${image.name} 图片内容未读取完成，请重新上传或稍后再试。`,
        blocking: true
      });
    }

    if (!supportedFormats.has(image.format)) {
      errors.push({
        field: `referenceImages[${index}].format`,
        code: "FILE_FORMAT_UNSUPPORTED",
        message: `${image.name} 格式不支持`,
        blocking: true
      });
    }

    if (image.sizeBytes !== undefined && image.sizeBytes > maxSizeBytes) {
      errors.push({
        field: `referenceImages[${index}].sizeBytes`,
        code: "FILE_TOO_LARGE",
        message: `${image.name} 超过 ${model.capabilities.maxReferenceImageSizeMB} MB`,
        blocking: true
      });
    }
  });

  resolved.activeRestrictions.forEach((restriction) => {
    Object.entries(restriction.forcedValues ?? {}).forEach(([field, value]) => {
      const currentValue = params[field as keyof GenerationParams];

      if (currentValue !== value) {
        errors.push({
          field: `params.${field}`,
          code: "MODEL_TEMP_RESTRICTED",
          message: `${restriction.title}：${restriction.description}`,
          blocking: true
        });
      }
    });
  });

  ensureParamEnabled({
    field: "ratio",
    value: params.ratio,
    enabledValues: resolved.ratios.filter((option) => option.enabled).map((option) => option.key),
    errors
  });
  ensureParamEnabled({
    field: "resolution",
    value: params.resolution,
    enabledValues: resolved.resolutions.filter((option) => option.enabled).map((option) => option.key),
    errors
  });
  ensureParamEnabled({
    field: "quality",
    value: params.quality,
    enabledValues: resolved.qualities.filter((option) => option.enabled).map((option) => option.key),
    errors
  });

  if (params.outputFormat && !model.capabilities.outputFormats.includes(params.outputFormat)) {
    errors.push({
      field: "params.outputFormat",
      code: "MODEL_PARAM_UNSUPPORTED",
      message: "当前模型不支持所选输出格式",
      blocking: true
    });
  }

  if (params.background === "transparent" && !model.featureFlags.supportsTransparentBackground) {
    errors.push({
      field: "params.background",
      code: "MODEL_PARAM_UNSUPPORTED",
      message: "当前模型不支持透明背景，请选择自动或不透明。",
      blocking: true
    });
  }

  if (
    params.outputCompression !== undefined &&
    (!Number.isInteger(params.outputCompression) || params.outputCompression < 0 || params.outputCompression > 100)
  ) {
    errors.push({
      field: "params.outputCompression",
      code: "MODEL_PARAM_UNSUPPORTED",
      message: "输出压缩需在 0 到 100 之间。",
      blocking: true
    });
  }

  if (
    params.partialImages !== undefined &&
    (!Number.isInteger(params.partialImages) || params.partialImages < 0 || params.partialImages > 3)
  ) {
    errors.push({
      field: "params.partialImages",
      code: "MODEL_PARAM_UNSUPPORTED",
      message: "流式预览图片数量需在 0 到 3 之间。",
      blocking: true
    });
  }

  if (!Number.isInteger(params.count) || params.count < 1 || params.count > model.capabilities.maxOutputs) {
    errors.push({
      field: "params.count",
      code: "MODEL_PARAM_UNSUPPORTED",
      message: `生成张数需在 1 到 ${model.capabilities.maxOutputs} 之间`,
      blocking: true
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

function hasReferenceImageTransportData(image: ValidatableReferenceImage) {
  if (image.remoteURL?.trim()) {
    return true;
  }

  const base64 = image.base64?.trim();

  if (!base64) {
    return false;
  }

  const commaIndex = base64.indexOf(",");
  const payload = base64.startsWith("data:")
    ? commaIndex >= 0
      ? base64.slice(commaIndex + 1)
      : ""
    : base64;

  return payload.replace(/\s/g, "").length > 0;
}

export function prepareGenerationReferences(referenceImages: ReferenceImage[]): GenerationReferenceInput[] {
  return referenceImages.map((image, index) => ({
    id: image.id,
    name: image.name,
    mimeType: image.mimeType,
    format: image.format,
    sizeBytes: image.sizeBytes,
    width: image.width,
    height: image.height,
    base64: image.base64,
    remoteURL: image.remoteURL,
    objectKey: image.objectKey,
    order: index
  }));
}

export function buildGenerationRequestPayload(input: BuildGenerationPayloadInput): GenerationRequestPayload {
  const prompt = input.prompt.trim();
  const negativePrompt = input.model.capabilities.supportsNegativePrompt ? input.negativePrompt?.trim() : undefined;

  return {
    requestId: input.requestId,
    modelId: input.model.id,
    prompt,
    negativePrompt: negativePrompt || undefined,
    referenceImages: prepareGenerationReferences(input.referenceImages),
    params: input.params,
    endpointOverride: input.endpointOverride,
    modelOverride: input.modelOverride,
    options: {
      ...defaultGenerationServerOptions,
      ...input.options
    },
    clientContext: input.clientContext
  };
}

export function buildAcceptedGenerationResponse(
  payload: GenerationRequestPayload,
  costPreview: CostPreview,
  warnings: ValidationIssue[] = []
): CreateGenerationResponse {
  return {
    requestId: payload.requestId ?? crypto.randomUUID(),
    status: "running",
    acceptedAt: new Date().toISOString(),
    modelId: payload.modelId,
    estimatedCostText: costPreview.estimatedCostText,
    warnings
  };
}

function ensureParamEnabled(input: {
  field: "ratio" | "resolution" | "quality";
  value: string;
  enabledValues: string[];
  errors: ValidationIssue[];
}) {
  if (input.enabledValues.includes(input.value)) {
    return;
  }

  if (input.errors.some((issue) => issue.field === `params.${input.field}`)) {
    return;
  }

  input.errors.push({
    field: `params.${input.field}`,
    code: "MODEL_PARAM_UNSUPPORTED",
    message: `当前模型不支持所选${paramLabel(input.field)}`,
    blocking: true
  });
}

function paramLabel(field: "ratio" | "resolution" | "quality") {
  if (field === "ratio") {
    return "尺寸";
  }

  if (field === "resolution") {
    return "分辨率";
  }

  return "质量";
}

function formatResolutionText(label: string, isEstimated?: boolean) {
  return isEstimated ? `${label}（估算）` : label;
}

function formatMoney(value: number, currency = "CNY") {
  const amount = trimNumber(value);

  if (currency === "USD") {
    return `$${amount}`;
  }

  if (currency === "POINT") {
    return `${amount} 点`;
  }

  if (currency === "TOKEN") {
    return `${amount} token`;
  }

  return `¥${amount}`;
}

function trimNumber(value: number) {
  const fixed = value < 1 ? value.toFixed(4) : value.toFixed(2);

  return fixed.replace(/\.?0+$/, "");
}
