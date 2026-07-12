import type {
  ApiKeySettings,
  CustomModelSettings,
  EndpointSettings,
  LocalArchiveSettings,
  ModelEndpointSettings,
  StorageSettings,
  StorageTestResult,
  StorageType,
  UtilityModelSettings,
  UserSettings
} from "../domain";
import { DEFAULT_REASONING_PLATFORM, getDefaultReasoningModel } from "../config/reasoning";
import { DEFAULT_VISION_RECOGNITION_MODEL } from "../config/vision-recognition";
import { normalizeOpenAIEndpointVariant, stripKnownEndpointSuffix } from "./model-endpoint-service";

const SETTINGS_STORAGE_KEY = "api2image:user-settings:v1";
export const DEFAULT_UTILITY_RECOGNITION_MODEL_NAME = DEFAULT_VISION_RECOGNITION_MODEL;
export const DEFAULT_UTILITY_REASONING_MODEL_NAME = getDefaultReasoningModel(DEFAULT_REASONING_PLATFORM).id;
export const DEFAULT_RESPONSES_MODEL_NAME = DEFAULT_UTILITY_REASONING_MODEL_NAME;
const DEFAULT_FILENAME_PATTERN = "{date}_{model}_{prompt}_{index}_{recordId}";
const DEFAULT_STORAGE_TYPE: StorageType = "local-directory";
const DEFAULT_CLOUD_ENABLED = false;
const DEFAULT_LOCAL_ARCHIVE_ENABLED = true;
const CUSTOM_MODEL_ID_PREFIX = "custom-model";
const LEGACY_DEFAULT_RECOGNITION_MODEL_NAME = "gpt-5.2";
const LEGACY_DEFAULT_REASONING_MODEL_NAME = "claude-opus-4-8";
export const DEFAULT_LOCAL_ARCHIVE_DIRECTORY_PATH = "C:\\Users\\%USERNAME%\\Pictures";

export type RuntimeUserSettings = UserSettings & {
  mainApiKeyValue?: string;
};

type StoredSettingsPayload = {
  mainApiKeyValue?: string;
  endpoint?: Partial<EndpointSettings>;
  utilityModels?: Partial<UtilityModelSettings>;
  storage?: Partial<StorageSettings>;
  localArchive?: Partial<LocalArchiveSettings>;
  updatedAt?: string;
};

function canUseLocalStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function maskApiKey(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}****${trimmed.slice(-2)}`;
  }

  return `${trimmed.slice(0, 4)}****${trimmed.slice(-4)}`;
}

export function createApiKeySettings(value?: string): ApiKeySettings {
  const trimmed = value?.trim() ?? "";

  return {
    maskedValue: trimmed ? maskApiKey(trimmed) : undefined,
    lastFour: trimmed ? trimmed.slice(-4) : undefined,
    storageMode: "local",
    hasValue: Boolean(trimmed),
    updatedAt: trimmed ? new Date().toISOString() : undefined
  };
}

function trimOptional(value?: string) {
  const trimmed = value?.trim() ?? "";

  return trimmed || undefined;
}

function hasModelOverrideValue(override: ModelEndpointSettings) {
  return Boolean(
      override.displayName ||
      override.apiModelName ||
      override.endpointVariant ||
      override.baseURL ||
      override.editURL ||
      override.apiKey
  );
}

function uniqueValues(values?: string[]) {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => trimOptional(value))
        .filter((value): value is string => Boolean(value))
    )
  );
}

function slugifyModelId(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || CUSTOM_MODEL_ID_PREFIX;
}

function createUniqueModelId(seed: string, existingIds: string[]) {
  const existing = new Set(existingIds);
  const baseId = `${CUSTOM_MODEL_ID_PREFIX}-${slugifyModelId(seed)}`;

  if (!existing.has(baseId)) {
    return baseId;
  }

  let index = 2;
  while (existing.has(`${baseId}-${index}`)) {
    index += 1;
  }

  return `${baseId}-${index}`;
}

export function normalizeModelEndpointSettings(
  override?: Partial<ModelEndpointSettings>
): ModelEndpointSettings | undefined {
  if (!override) {
    return undefined;
  }

  const normalized: ModelEndpointSettings = {
    displayName: trimOptional(override.displayName),
    apiModelName: trimOptional(override.apiModelName),
    endpointVariant: normalizeOpenAIEndpointVariant(override.endpointVariant),
    baseURL: trimOptional(stripKnownEndpointSuffix(override.baseURL ?? "")),
    editURL: trimOptional(stripKnownEndpointSuffix(override.editURL ?? "")),
    apiKey: trimOptional(override.apiKey)
  };

  return hasModelOverrideValue(normalized) ? normalized : undefined;
}

function normalizeCustomModelSettings(
  model?: Partial<CustomModelSettings>,
  existingIds: string[] = []
): CustomModelSettings | undefined {
  if (!model) {
    return undefined;
  }

  const normalizedOverride = normalizeModelEndpointSettings(model);
  const displayName = trimOptional(normalizedOverride?.displayName);
  const apiModelName = trimOptional(normalizedOverride?.apiModelName);
  const templateModelId = trimOptional(model.templateModelId);

  if (!displayName || !apiModelName || !templateModelId) {
    return undefined;
  }

  const id = trimOptional(model.id) ?? createUniqueModelId(apiModelName, existingIds);

  return {
    id,
    templateModelId,
    displayName,
    apiModelName,
    endpointVariant: normalizedOverride?.endpointVariant,
    baseURL: normalizedOverride?.baseURL,
    editURL: normalizedOverride?.editURL,
    apiKey: normalizedOverride?.apiKey,
    createdAt: trimOptional(model.createdAt),
    updatedAt: trimOptional(model.updatedAt) ?? new Date().toISOString()
  };
}

function normalizeEndpointSettings(endpoint?: Partial<EndpointSettings>): EndpointSettings {
  const modelOverrides = Object.fromEntries(
    Object.entries(endpoint?.modelOverrides ?? {})
      .map(([modelId, override]) => [modelId, normalizeModelEndpointSettings(override)])
      .filter((entry): entry is [string, ModelEndpointSettings] => Boolean(entry[1]))
  );
  const customModels = (endpoint?.customModels ?? []).reduce<CustomModelSettings[]>((models, model) => {
    const normalized = normalizeCustomModelSettings(model, [
      ...Object.keys(modelOverrides),
      ...models.map((item) => item.id)
    ]);

    if (normalized) {
      models.push(normalized);
    }

    return models;
  }, []);

  return {
    useProxy: endpoint?.useProxy ?? true,
    customRootURL: trimOptional(endpoint?.customRootURL),
    modelOverrides,
    customModels,
    hiddenModelIds: uniqueValues(endpoint?.hiddenModelIds)
  };
}

function normalizeUtilityModelSettings(utilityModels?: Partial<UtilityModelSettings>): UtilityModelSettings {
  const recognitionModelName = trimOptional(utilityModels?.recognitionModelName);
  const reasoningModelName = trimOptional(utilityModels?.reasoningModelName);

  return {
    recognitionModelName:
      !recognitionModelName || recognitionModelName === LEGACY_DEFAULT_RECOGNITION_MODEL_NAME
        ? DEFAULT_UTILITY_RECOGNITION_MODEL_NAME
        : recognitionModelName,
    reasoningModelName:
      !reasoningModelName || reasoningModelName === LEGACY_DEFAULT_REASONING_MODEL_NAME
        ? DEFAULT_UTILITY_REASONING_MODEL_NAME
        : reasoningModelName
  };
}

function normalizeStringRecord(values?: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(values ?? {})
      .map(([key, value]) => [key, trimOptional(value)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
  );
}

function normalizeStorageTestResult(result?: Partial<StorageTestResult>): StorageTestResult | undefined {
  if (!result?.type || !result.message || !result.checkedAt) {
    return undefined;
  }

  return {
    success: Boolean(result.success),
    type: result.type,
    message: result.message,
    checkedAt: result.checkedAt
  };
}

function normalizeStorageSettings(storage?: Partial<StorageSettings>): StorageSettings {
  return {
    activeType: storage?.activeType ?? DEFAULT_STORAGE_TYPE,
    defaultCloudEnabled: storage?.defaultCloudEnabled ?? DEFAULT_CLOUD_ENABLED,
    r2: normalizeStringRecord(storage?.r2),
    oss: normalizeStringRecord(storage?.oss),
    lastTestResult: normalizeStorageTestResult(storage?.lastTestResult)
  };
}

function normalizeLocalArchiveSettings(localArchive?: Partial<LocalArchiveSettings>): LocalArchiveSettings {
  const supported = typeof window !== "undefined" && "showDirectoryPicker" in window;

  return {
    supported,
    enabled: localArchive?.enabled ?? DEFAULT_LOCAL_ARCHIVE_ENABLED,
    permissionState: localArchive?.permissionState ?? "prompt",
    directoryName: trimOptional(localArchive?.directoryName),
    directoryPath: trimOptional(localArchive?.directoryPath) ?? DEFAULT_LOCAL_ARCHIVE_DIRECTORY_PATH,
    filenamePattern: trimOptional(localArchive?.filenamePattern) ?? DEFAULT_FILENAME_PATTERN
  };
}

function toStoredPayload(settings: RuntimeUserSettings): StoredSettingsPayload {
  return {
    mainApiKeyValue: settings.mainApiKeyValue,
    endpoint: settings.endpoint,
    utilityModels: settings.utilityModels,
    storage: settings.storage,
    localArchive: {
      enabled: settings.localArchive.enabled,
      permissionState: settings.localArchive.permissionState,
      directoryName: settings.localArchive.directoryName,
      directoryPath: settings.localArchive.directoryPath,
      filenamePattern: settings.localArchive.filenamePattern
    },
    updatedAt: new Date().toISOString()
  };
}

function hasLocalArchiveValue(localArchive: LocalArchiveSettings) {
  return Boolean(
    localArchive.enabled !== DEFAULT_LOCAL_ARCHIVE_ENABLED ||
      localArchive.permissionState !== "prompt" ||
      localArchive.directoryName ||
      (localArchive.directoryPath && localArchive.directoryPath !== DEFAULT_LOCAL_ARCHIVE_DIRECTORY_PATH) ||
      localArchive.filenamePattern !== DEFAULT_FILENAME_PATTERN
  );
}

function hasStorageValue(storage: StorageSettings) {
  return Boolean(
    storage.activeType !== DEFAULT_STORAGE_TYPE ||
      storage.defaultCloudEnabled !== DEFAULT_CLOUD_ENABLED ||
      Object.keys(storage.r2 ?? {}).length > 0 ||
      Object.keys(storage.oss ?? {}).length > 0 ||
      storage.lastTestResult
  );
}

function hasUtilityModelValue(utilityModels: UtilityModelSettings) {
  return Boolean(
    utilityModels.recognitionModelName !== DEFAULT_UTILITY_RECOGNITION_MODEL_NAME ||
      utilityModels.reasoningModelName !== DEFAULT_UTILITY_REASONING_MODEL_NAME
  );
}

function hasStoredSettings(settings: RuntimeUserSettings) {
  return Boolean(
    settings.mainApiKeyValue ||
      settings.endpoint.customRootURL ||
      Object.keys(settings.endpoint.modelOverrides).length > 0 ||
      settings.endpoint.customModels.length > 0 ||
      settings.endpoint.hiddenModelIds.length > 0 ||
      settings.endpoint.useProxy === false ||
      hasUtilityModelValue(settings.utilityModels) ||
      hasStorageValue(settings.storage) ||
      hasLocalArchiveValue(settings.localArchive)
  );
}

export function createDefaultUserSettings(
  mainApiKeyValue?: string,
  endpoint?: Partial<EndpointSettings>,
  storage?: Partial<StorageSettings>,
  localArchive?: Partial<LocalArchiveSettings>,
  utilityModels?: Partial<UtilityModelSettings>
): RuntimeUserSettings {
  return {
    lang: "zh-CN",
    mainApiKey: createApiKeySettings(mainApiKeyValue),
    mainApiKeyValue: trimOptional(mainApiKeyValue),
    endpoint: normalizeEndpointSettings(endpoint),
    utilityModels: normalizeUtilityModelSettings(utilityModels),
    safety: {
      enablePromptSafetyHint: true,
      enableSensitiveLogMasking: true,
      allowRealKeyInCurl: true
    },
    storage: normalizeStorageSettings(storage),
    localArchive: normalizeLocalArchiveSettings(localArchive)
  };
}

export function loadUserSettings(): RuntimeUserSettings {
  if (!canUseLocalStorage()) {
    return createDefaultUserSettings();
  }

  const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);

  if (!raw) {
    return createDefaultUserSettings();
  }

  try {
    const payload = JSON.parse(raw) as StoredSettingsPayload;
    return createDefaultUserSettings(
      payload.mainApiKeyValue,
      payload.endpoint,
      payload.storage,
      payload.localArchive,
      payload.utilityModels
    );
  } catch {
    return createDefaultUserSettings();
  }
}

export function saveUserSettings(settings: RuntimeUserSettings): RuntimeUserSettings {
  const normalized = createDefaultUserSettings(
    settings.mainApiKeyValue,
    settings.endpoint,
    settings.storage,
    settings.localArchive,
    settings.utilityModels
  );

  if (canUseLocalStorage()) {
    if (hasStoredSettings(normalized)) {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(toStoredPayload(normalized)));
    } else {
      window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
    }
  }

  return normalized;
}

export function saveUtilityModelSettings(
  utilityModels: Partial<UtilityModelSettings>,
  currentSettings = loadUserSettings()
): RuntimeUserSettings {
  return saveUserSettings({
    ...currentSettings,
    utilityModels: normalizeUtilityModelSettings({
      ...currentSettings.utilityModels,
      ...utilityModels
    })
  });
}

export function saveLocalArchiveDirectoryPath(
  directoryPath: string,
  currentSettings = loadUserSettings()
): RuntimeUserSettings {
  return saveUserSettings({
    ...currentSettings,
    localArchive: {
      ...currentSettings.localArchive,
      directoryPath: trimOptional(directoryPath) ?? DEFAULT_LOCAL_ARCHIVE_DIRECTORY_PATH
    }
  });
}

export function saveStorageSettings(
  storage: Partial<StorageSettings>,
  currentSettings = loadUserSettings()
): RuntimeUserSettings {
  return saveUserSettings({
    ...currentSettings,
    storage: normalizeStorageSettings({
      ...currentSettings.storage,
      ...storage
    })
  });
}

export function saveStorageAndArchiveSettings(
  storage: Partial<StorageSettings>,
  localArchive: Partial<LocalArchiveSettings>,
  currentSettings = loadUserSettings()
): RuntimeUserSettings {
  return saveUserSettings({
    ...currentSettings,
    storage: normalizeStorageSettings({
      ...currentSettings.storage,
      ...storage
    }),
    localArchive: normalizeLocalArchiveSettings({
      ...currentSettings.localArchive,
      ...localArchive
    })
  });
}

export function testStorageConnectionSettings(storage: StorageSettings): StorageTestResult {
  const checkedAt = new Date().toISOString();

  if (storage.activeType === "default-cloud") {
    return {
      success: storage.defaultCloudEnabled,
      type: storage.activeType,
      message: storage.defaultCloudEnabled ? "默认云存储已启用" : "默认云存储当前关闭",
      checkedAt
    };
  }

  if (storage.activeType === "local-directory") {
    return {
      success: true,
      type: storage.activeType,
      message: "本地归档路径配置可用，浏览器下载时将使用当前文件名。",
      checkedAt
    };
  }

  const config = storage.activeType === "r2" ? storage.r2 : storage.oss;
  const requiredKeys =
    storage.activeType === "r2"
      ? ["endpoint", "bucket", "accessKeyId", "secretAccessKey"]
      : ["endpoint", "bucket", "accessKeyId", "accessKeySecret"];
  const missingKeys = requiredKeys.filter((key) => !config?.[key]);

  return {
    success: missingKeys.length === 0,
    type: storage.activeType,
    message:
      missingKeys.length === 0
        ? `${storage.activeType.toUpperCase()} 配置字段完整，可进入后端联调。`
        : `缺少字段：${missingKeys.join(", ")}`,
    checkedAt
  };
}

export function saveMainApiKey(value: string, currentSettings = loadUserSettings()): RuntimeUserSettings {
  return saveUserSettings({
    ...currentSettings,
    mainApiKey: createApiKeySettings(value),
    mainApiKeyValue: trimOptional(value)
  });
}

export function clearMainApiKey(currentSettings = loadUserSettings()): RuntimeUserSettings {
  return saveUserSettings({
    ...currentSettings,
    mainApiKey: createApiKeySettings(),
    mainApiKeyValue: undefined
  });
}

export function saveModelEndpointSettings(
  modelId: string,
  override: Partial<ModelEndpointSettings>,
  currentSettings = loadUserSettings()
): RuntimeUserSettings {
  const normalizedOverride = normalizeModelEndpointSettings(override);
  const modelOverrides = {
    ...currentSettings.endpoint.modelOverrides
  };

  if (normalizedOverride) {
    modelOverrides[modelId] = normalizedOverride;
  } else {
    delete modelOverrides[modelId];
  }

  return saveUserSettings({
    ...currentSettings,
    endpoint: {
      ...currentSettings.endpoint,
      modelOverrides
    }
  });
}

export function clearModelEndpointSettings(
  modelId: string,
  currentSettings = loadUserSettings()
): RuntimeUserSettings {
  const modelOverrides = {
    ...currentSettings.endpoint.modelOverrides
  };
  delete modelOverrides[modelId];

  return saveUserSettings({
    ...currentSettings,
    endpoint: {
      ...currentSettings.endpoint,
      modelOverrides
    }
  });
}

export function saveCustomModelSettings(
  model: Partial<CustomModelSettings>,
  currentSettings = loadUserSettings()
): RuntimeUserSettings {
  const existingIds = [
    ...Object.keys(currentSettings.endpoint.modelOverrides),
    ...currentSettings.endpoint.customModels.map((item) => item.id)
  ].filter((id) => id !== model.id);
  const normalizedModel = normalizeCustomModelSettings(model, existingIds);

  if (!normalizedModel) {
    return currentSettings;
  }

  const customModels = currentSettings.endpoint.customModels.some((item) => item.id === normalizedModel.id)
    ? currentSettings.endpoint.customModels.map((item) => (item.id === normalizedModel.id ? normalizedModel : item))
    : [...currentSettings.endpoint.customModels, normalizedModel];

  return saveUserSettings({
    ...currentSettings,
    endpoint: {
      ...currentSettings.endpoint,
      customModels
    }
  });
}

export function duplicateModelSettings(
  templateModelId: string,
  override: Partial<ModelEndpointSettings>,
  currentSettings = loadUserSettings()
): RuntimeUserSettings {
  const displayName = trimOptional(override.displayName) ?? "自定义模型";
  const apiModelName = trimOptional(override.apiModelName) ?? displayName;
  const id = createUniqueModelId(apiModelName, [
    ...Object.keys(currentSettings.endpoint.modelOverrides),
    ...currentSettings.endpoint.customModels.map((item) => item.id)
  ]);

  return saveCustomModelSettings(
    {
      id,
      templateModelId,
      displayName,
      apiModelName,
      endpointVariant: override.endpointVariant,
      baseURL: override.baseURL,
      editURL: override.editURL,
      apiKey: override.apiKey,
      createdAt: new Date().toISOString()
    },
    currentSettings
  );
}

export function deleteModelSettings(
  modelId: string,
  currentSettings = loadUserSettings()
): RuntimeUserSettings {
  const customModels = currentSettings.endpoint.customModels.filter((model) => model.id !== modelId);
  const isCustomModel = customModels.length !== currentSettings.endpoint.customModels.length;
  const modelOverrides = {
    ...currentSettings.endpoint.modelOverrides
  };
  delete modelOverrides[modelId];

  return saveUserSettings({
    ...currentSettings,
    endpoint: {
      ...currentSettings.endpoint,
      modelOverrides,
      customModels,
      hiddenModelIds: isCustomModel
        ? currentSettings.endpoint.hiddenModelIds
        : uniqueValues([...currentSettings.endpoint.hiddenModelIds, modelId])
    }
  });
}

export function restoreHiddenModelSettings(currentSettings = loadUserSettings()): RuntimeUserSettings {
  return saveUserSettings({
    ...currentSettings,
    endpoint: {
      ...currentSettings.endpoint,
      hiddenModelIds: []
    }
  });
}
