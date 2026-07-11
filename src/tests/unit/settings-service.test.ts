import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearMainApiKey,
  createApiKeySettings,
  DEFAULT_LOCAL_ARCHIVE_DIRECTORY_PATH,
  DEFAULT_UTILITY_REASONING_MODEL_NAME,
  DEFAULT_UTILITY_RECOGNITION_MODEL_NAME,
  deleteModelSettings,
  duplicateModelSettings,
  loadUserSettings,
  maskApiKey,
  restoreHiddenModelSettings,
  saveCustomModelSettings,
  saveLocalArchiveDirectoryPath,
  saveMainApiKey,
  saveModelEndpointSettings,
  saveStorageAndArchiveSettings,
  saveStorageSettings,
  saveUtilityModelSettings,
  testStorageConnectionSettings
} from "../../services/settings-service";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    })
  };
}

describe("settings service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("masks API keys by default", () => {
    expect(maskApiKey("sk-1234567890abcdef")).toBe("sk-1****cdef");
  });

  it("creates metadata without exposing the full key", () => {
    const settings = createApiKeySettings("sk-test-secret-value");

    expect(settings.hasValue).toBe(true);
    expect(settings.lastFour).toBe("alue");
    expect(settings.maskedValue).toBe("sk-t****alue");
    expect(JSON.stringify(settings)).not.toContain("secret");
  });

  it("handles empty keys as unset", () => {
    const settings = createApiKeySettings("   ");

    expect(settings.hasValue).toBe(false);
    expect(settings.maskedValue).toBeUndefined();
    expect(settings.lastFour).toBeUndefined();
  });

  it("persists model endpoint settings while preserving the main key", () => {
    vi.stubGlobal("window", {
      localStorage: createMemoryStorage()
    });

    const withMainKey = saveMainApiKey("sk-main-secret");
    const saved = saveModelEndpointSettings(
      "gpt-image-2",
      {
        displayName: "GPT Image 2 Custom",
        apiModelName: "gpt-image-2-real",
        endpointVariant: "responses",
        baseURL: "https://proxy.example/v1/images/generations",
        apiKey: "sk-model-secret"
      },
      withMainKey
    );
    const reloaded = loadUserSettings();

    expect(saved.mainApiKeyValue).toBe("sk-main-secret");
    expect(reloaded.mainApiKeyValue).toBe("sk-main-secret");
    expect(reloaded.endpoint.modelOverrides["gpt-image-2"]).toMatchObject({
      displayName: "GPT Image 2 Custom",
      apiModelName: "gpt-image-2-real",
      endpointVariant: "responses",
      baseURL: "https://proxy.example",
      apiKey: "sk-model-secret"
    });
  });

  it("defaults advanced storage to local archive in the Windows pictures directory", () => {
    vi.stubGlobal("window", {
      localStorage: createMemoryStorage()
    });

    const settings = loadUserSettings();

    expect(settings.storage.activeType).toBe("local-directory");
    expect(settings.storage.defaultCloudEnabled).toBe(false);
    expect(settings.localArchive.enabled).toBe(true);
    expect(settings.localArchive.directoryPath).toBe(DEFAULT_LOCAL_ARCHIVE_DIRECTORY_PATH);
  });

  it("defaults recognition and reasoning to real utility models", () => {
    vi.stubGlobal("window", {
      localStorage: createMemoryStorage()
    });

    const settings = loadUserSettings();

    expect(settings.utilityModels).toEqual({
      recognitionModelName: DEFAULT_UTILITY_RECOGNITION_MODEL_NAME,
      reasoningModelName: DEFAULT_UTILITY_REASONING_MODEL_NAME
    });
    expect(settings.utilityModels.recognitionModelName).not.toBe("gpt-image-2");
    expect(settings.utilityModels.reasoningModelName).not.toBe("gpt-image-2");
  });

  it("persists utility model settings for real recognition and reasoning requests", () => {
    vi.stubGlobal("window", {
      localStorage: createMemoryStorage()
    });

    saveUtilityModelSettings({
      recognitionModelName: "gpt-5.4-mini",
      reasoningModelName: "gpt-5.5"
    });
    const reloaded = loadUserSettings();

    expect(reloaded.utilityModels).toEqual({
      recognitionModelName: "gpt-5.4-mini",
      reasoningModelName: "gpt-5.5"
    });
  });

  it("persists local archive path while preserving model overrides", () => {
    vi.stubGlobal("window", {
      localStorage: createMemoryStorage()
    });

    const withStoragePath = saveLocalArchiveDirectoryPath("D:\\Images\\AI");
    const withModelOverride = saveModelEndpointSettings(
      "gpt-image-2",
      {
        apiModelName: "gpt-image-2-real",
        baseURL: "https://proxy.example"
      },
      withStoragePath
    );
    const reloaded = loadUserSettings();

    expect(withModelOverride.localArchive.directoryPath).toBe("D:\\Images\\AI");
    expect(reloaded.localArchive.directoryPath).toBe("D:\\Images\\AI");
    expect(reloaded.endpoint.modelOverrides["gpt-image-2"]?.apiModelName).toBe("gpt-image-2-real");
  });

  it("persists advanced storage settings", () => {
    vi.stubGlobal("window", {
      localStorage: createMemoryStorage()
    });

    saveStorageSettings({
      activeType: "r2",
      defaultCloudEnabled: false,
      r2: {
        endpoint: "https://r2.example",
        bucket: "image-assets",
        accessKeyId: "ak",
        secretAccessKey: "sk"
      }
    });
    const reloaded = loadUserSettings();

    expect(reloaded.storage).toMatchObject({
      activeType: "r2",
      defaultCloudEnabled: false,
      r2: {
        endpoint: "https://r2.example",
        bucket: "image-assets",
        accessKeyId: "ak",
        secretAccessKey: "sk"
      }
    });
  });

  it("saves storage settings and local archive settings together", () => {
    vi.stubGlobal("window", {
      localStorage: createMemoryStorage()
    });

    const saved = saveStorageAndArchiveSettings(
      {
        activeType: "local-directory"
      },
      {
        enabled: true,
        directoryPath: "D:\\AI\\Pictures",
        filenamePattern: "{date}_{model}_{index}"
      }
    );
    const reloaded = loadUserSettings();

    expect(saved.storage.activeType).toBe("local-directory");
    expect(reloaded.localArchive).toMatchObject({
      enabled: true,
      directoryPath: "D:\\AI\\Pictures",
      filenamePattern: "{date}_{model}_{index}"
    });
  });

  it("validates storage connection field completeness", () => {
    const missingR2 = testStorageConnectionSettings({
      activeType: "r2",
      defaultCloudEnabled: true,
      r2: {
        endpoint: "https://r2.example"
      }
    });
    const completeOss = testStorageConnectionSettings({
      activeType: "oss",
      defaultCloudEnabled: true,
      oss: {
        endpoint: "https://oss.example",
        bucket: "image-assets",
        accessKeyId: "ak",
        accessKeySecret: "secret"
      }
    });

    expect(missingR2.success).toBe(false);
    expect(missingR2.message).toContain("bucket");
    expect(missingR2.message).toContain("secretAccessKey");
    expect(completeOss).toMatchObject({
      success: true,
      type: "oss"
    });
  });

  it("clears only the main key and keeps model overrides", () => {
    vi.stubGlobal("window", {
      localStorage: createMemoryStorage()
    });

    const withMainKey = saveMainApiKey("sk-main-secret");
    const withModelOverride = saveModelEndpointSettings(
      "gpt-image-2",
      {
        apiModelName: "gpt-image-2-real",
        baseURL: "https://proxy.example"
      },
      withMainKey
    );
    const cleared = clearMainApiKey(withModelOverride);

    expect(cleared.mainApiKeyValue).toBeUndefined();
    expect(cleared.mainApiKey.hasValue).toBe(false);
    expect(cleared.endpoint.modelOverrides["gpt-image-2"]?.apiModelName).toBe("gpt-image-2-real");
  });

  it("persists custom models and reloads them from local storage", () => {
    vi.stubGlobal("window", {
      localStorage: createMemoryStorage()
    });

    saveCustomModelSettings({
      id: "custom-model-image2-enterprise",
      templateModelId: "gpt-image-2",
      displayName: "GPT Image 2 Enterprise",
      apiModelName: "image2Enterprise",
      endpointVariant: "images-generations",
      baseURL: "https://proxy.example/v1/images/generations",
      apiKey: "sk-model-secret"
    });
    const reloaded = loadUserSettings();

    expect(reloaded.endpoint.customModels).toHaveLength(1);
    expect(reloaded.endpoint.customModels[0]).toMatchObject({
      id: "custom-model-image2-enterprise",
      templateModelId: "gpt-image-2",
      displayName: "GPT Image 2 Enterprise",
      apiModelName: "image2Enterprise",
      endpointVariant: "images-generations",
      baseURL: "https://proxy.example",
      apiKey: "sk-model-secret"
    });
  });

  it("duplicates models as custom entries and deletes only the selected custom model", () => {
    vi.stubGlobal("window", {
      localStorage: createMemoryStorage()
    });

    const first = duplicateModelSettings("gpt-image-2", {
      displayName: "GPT Image 2 上游 A",
      apiModelName: "upstream-image-a"
    });
    const second = duplicateModelSettings(
      "gpt-image-2",
      {
        displayName: "GPT Image 2 上游 B",
        apiModelName: "upstream-image-b"
      },
      first
    );
    const deleted = deleteModelSettings(second.endpoint.customModels[0].id, second);

    expect(second.endpoint.customModels).toHaveLength(2);
    expect(deleted.endpoint.customModels).toHaveLength(1);
    expect(deleted.endpoint.customModels[0].apiModelName).toBe("upstream-image-b");
    expect(deleted.endpoint.hiddenModelIds).toEqual([]);
  });

  it("hides built-in models and restores them", () => {
    vi.stubGlobal("window", {
      localStorage: createMemoryStorage()
    });

    const hidden = deleteModelSettings("gpt-image-2");
    const restored = restoreHiddenModelSettings(hidden);

    expect(hidden.endpoint.hiddenModelIds).toContain("gpt-image-2");
    expect(restored.endpoint.hiddenModelIds).toEqual([]);
  });
});
