import type { LangCode, OpenAIEndpointVariant, StorageType } from "./common";

export type ApiKeySettings = {
  maskedValue?: string;
  lastFour?: string;
  storageMode: "memory" | "local";
  hasValue: boolean;
  updatedAt?: string;
};

export type EndpointSettings = {
  useProxy: boolean;
  customRootURL?: string;
  modelOverrides: Record<string, ModelEndpointSettings>;
  customModels: CustomModelSettings[];
  hiddenModelIds: string[];
};

export type UtilityModelSettings = {
  recognitionModelName: string;
  reasoningModelName: string;
};

export type ModelEndpointSettings = {
  displayName?: string;
  apiModelName?: string;
  endpointVariant?: OpenAIEndpointVariant;
  baseURL?: string;
  editURL?: string;
  apiKey?: string;
};

export type CustomModelSettings = ModelEndpointSettings & {
  id: string;
  templateModelId: string;
  createdAt?: string;
  updatedAt?: string;
};

export type SafetySettings = {
  enablePromptSafetyHint: boolean;
  enableSensitiveLogMasking: boolean;
  allowRealKeyInCurl: boolean;
};

export type StorageSettings = {
  activeType: StorageType;
  defaultCloudEnabled: boolean;
  r2?: Record<string, string>;
  oss?: Record<string, string>;
  lastTestResult?: StorageTestResult;
};

export type StorageTestResult = {
  success: boolean;
  type: StorageType;
  message: string;
  checkedAt: string;
};

export type LocalArchiveSettings = {
  supported: boolean;
  enabled: boolean;
  permissionState: "prompt" | "granted" | "denied" | "unsupported";
  directoryName?: string;
  directoryPath?: string;
  filenamePattern: string;
};

export type UserSettings = {
  lang: LangCode;
  mainApiKey: ApiKeySettings;
  visionApiKey?: ApiKeySettings;
  endpoint: EndpointSettings;
  utilityModels: UtilityModelSettings;
  safety: SafetySettings;
  storage: StorageSettings;
  localArchive: LocalArchiveSettings;
};
