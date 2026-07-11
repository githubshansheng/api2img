import type {
  CustomModelSettings,
  EndpointOverride,
  EndpointSettings,
  ModelConfig,
  ModelEndpointSettings,
  ModelRequestOverride,
  OpenAIEndpointVariant
} from "../domain";
import {
  buildModelEndpointURL,
  normalizeOpenAIEndpointVariant,
  resolveOpenAIEndpointVariant
} from "./model-endpoint-service";

type SettingsLike = {
  mainApiKeyValue?: string;
  endpoint: EndpointSettings;
};

function trimOptional(value?: string) {
  const trimmed = value?.trim() ?? "";

  return trimmed || undefined;
}

function hasEndpointOverrideValue(override: EndpointOverride) {
  return Boolean(override.baseURL || override.editURL || override.endpointVariant || override.apiKey || override.headers);
}

function hasModelRequestOverrideValue(override: ModelRequestOverride) {
  return Boolean(override.displayName || override.apiModelName);
}

function cloneModelConfig(model: ModelConfig): ModelConfig {
  return {
    ...model,
    tags: [...model.tags],
    price: {
      ...model.price,
      multiplierFields: [...model.price.multiplierFields],
      qualityMultiplier: model.price.qualityMultiplier ? { ...model.price.qualityMultiplier } : undefined,
      resolutionMultiplier: model.price.resolutionMultiplier ? { ...model.price.resolutionMultiplier } : undefined
    },
    capabilities: {
      ...model.capabilities,
      ratios: model.capabilities.ratios.map((option) => ({ ...option })),
      resolutions: model.capabilities.resolutions.map((option) => ({ ...option })),
      qualities: model.capabilities.qualities.map((option) => ({ ...option })),
      supportedReferenceFormats: [...model.capabilities.supportedReferenceFormats],
      outputFormats: [...model.capabilities.outputFormats],
      responseFormats: [...model.capabilities.responseFormats]
    },
    request: {
      ...model.request,
      includeFields: [...model.request.includeFields],
      omitFields: [...model.request.omitFields],
      retry: {
        ...model.request.retry,
        retryableStatusCodes: [...model.request.retry.retryableStatusCodes]
      }
    },
    response: {
      ...model.response,
      imageUrlPaths: [...model.response.imageUrlPaths],
      imageBase64Paths: [...model.response.imageBase64Paths],
      errorCodePaths: [...model.response.errorCodePaths],
      errorMessagePaths: [...model.response.errorMessagePaths],
      finishReasonPaths: [...model.response.finishReasonPaths],
      tokenCountPaths: [...model.response.tokenCountPaths]
    },
    featureFlags: { ...model.featureFlags },
    temporaryRestrictions: model.temporaryRestrictions.map((restriction) => ({
      ...restriction,
      affectedFields: [...restriction.affectedFields],
      disabledOptions: restriction.disabledOptions ? [...restriction.disabledOptions] : undefined,
      forcedValues: restriction.forcedValues ? { ...restriction.forcedValues } : undefined
    })),
    notice: model.notice ? { ...model.notice } : undefined,
    ui: { ...model.ui }
  };
}

function createCustomModelConfig(
  template: ModelConfig,
  customModel: CustomModelSettings,
  index: number
): ModelConfig {
  const baseModel = cloneModelConfig(template);
  const model: ModelConfig = {
    ...baseModel,
    id: customModel.id,
    displayName: customModel.displayName ?? baseModel.displayName,
    apiModelName: customModel.apiModelName ?? baseModel.apiModelName,
    enabled: true,
    isDefault: false,
    sortOrder: baseModel.sortOrder + 1000 + index,
    tags: baseModel.tags.includes("recommended") ? [...baseModel.tags] : [...baseModel.tags, "recommended"],
    description: `自定义模型，继承 ${template.displayName} 的能力配置。`,
    updatedAt: customModel.updatedAt ?? baseModel.updatedAt
  };

  return applyModelEndpointSettings(model, customModel);
}

export function applyModelEndpointSettings(
  model: ModelConfig,
  override?: Partial<ModelEndpointSettings>
): ModelConfig {
  const displayName = trimOptional(override?.displayName);
  const apiModelName = trimOptional(override?.apiModelName);
  const endpointVariant = normalizeOpenAIEndpointVariant(override?.endpointVariant);
  const baseURL = trimOptional(override?.baseURL);
  const editURL = trimOptional(override?.editURL);

  if (!displayName && !apiModelName && !endpointVariant && !baseURL && !editURL) {
    return model;
  }

  const nextModel = {
    ...model,
    endpointType: endpointVariant ?? model.endpointType,
    displayName: displayName ?? model.displayName,
    apiModelName: apiModelName ?? model.apiModelName
  };

  return {
    ...nextModel,
    baseURL:
      baseURL || endpointVariant
        ? buildModelEndpointURL(nextModel, baseURL ?? model.baseURL, "generation", endpointVariant)
        : model.baseURL,
    editURL:
      baseURL || editURL
        ? buildModelEndpointURL(nextModel, editURL ?? baseURL, "edit")
        : model.editURL
  };
}

export function applyUserModelEndpointSettings(models: ModelConfig[], settings: SettingsLike) {
  const hiddenModelIds = new Set(settings.endpoint.hiddenModelIds);
  const builtInModels = models
    .filter((model) => !hiddenModelIds.has(model.id))
    .map((model) => applyModelEndpointSettings(model, settings.endpoint.modelOverrides[model.id]));
  const customModels = settings.endpoint.customModels
    .map((customModel, index) => {
      const template = models.find((model) => model.id === customModel.templateModelId) ?? models[0];

      return template ? createCustomModelConfig(template, customModel, index) : undefined;
    })
    .filter((model): model is ModelConfig => Boolean(model));

  return [...builtInModels, ...customModels].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function buildEndpointOverrideFromSettings(
  settings: SettingsLike,
  model: ModelConfig,
  options: { includeApiKey?: boolean } = {}
): EndpointOverride | undefined {
  const customModel = settings.endpoint.customModels.find((item) => item.id === model.id);
  const override = settings.endpoint.modelOverrides[model.id] ?? customModel;
  const baseURL = trimOptional(override?.baseURL);
  const editURL = trimOptional(override?.editURL);
  const endpointVariant = normalizeOpenAIEndpointVariant(override?.endpointVariant);
  const resolvedVariant: OpenAIEndpointVariant | undefined =
    endpointVariant && endpointVariant !== resolveOpenAIEndpointVariant(model) ? endpointVariant : endpointVariant;
  const endpointOverride: EndpointOverride = {
    baseURL:
      baseURL || resolvedVariant
        ? buildModelEndpointURL(model, baseURL ?? model.baseURL, "generation", resolvedVariant)
        : undefined,
    editURL:
      baseURL || editURL
        ? buildModelEndpointURL(model, editURL ?? baseURL, "edit")
        : undefined,
    endpointVariant: resolvedVariant,
    apiKey: options.includeApiKey ? resolveModelApiKey(settings, model.id) : undefined
  };

  return hasEndpointOverrideValue(endpointOverride) ? endpointOverride : undefined;
}

export function buildModelRequestOverrideFromSettings(
  settings: SettingsLike,
  modelId: string
): ModelRequestOverride | undefined {
  const override =
    settings.endpoint.modelOverrides[modelId] ?? settings.endpoint.customModels.find((item) => item.id === modelId);
  const modelOverride: ModelRequestOverride = {
    displayName: trimOptional(override?.displayName),
    apiModelName: trimOptional(override?.apiModelName)
  };

  return hasModelRequestOverrideValue(modelOverride) ? modelOverride : undefined;
}

export function applyModelRequestOverride(
  model: ModelConfig,
  override?: Partial<ModelRequestOverride>
): ModelConfig {
  return applyModelEndpointSettings(model, {
    displayName: override?.displayName,
    apiModelName: override?.apiModelName
  });
}

export function resolveModelApiKey(settings: SettingsLike, modelId?: string) {
  if (!modelId) {
    return trimOptional(settings.mainApiKeyValue);
  }

  const customModel = settings.endpoint.customModels.find((item) => item.id === modelId);

  return (
    trimOptional(settings.endpoint.modelOverrides[modelId]?.apiKey) ??
    trimOptional(customModel?.apiKey) ??
    trimOptional(settings.mainApiKeyValue)
  );
}
