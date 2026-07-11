import { describe, expect, it } from "vitest";
import { getEnabledModels, getModelById } from "../../config/models";
import { createDefaultUserSettings } from "../../services/settings-service";
import {
  applyUserModelEndpointSettings,
  buildEndpointOverrideFromSettings,
  resolveModelApiKey
} from "../../services/model-settings-service";

describe("model settings service", () => {
  it("merges custom models with inherited template capabilities", () => {
    const template = getModelById("gpt-image-2")!;
    const settings = createDefaultUserSettings("sk-main", {
      customModels: [
        {
          id: "custom-model-image2-enterprise",
          templateModelId: "gpt-image-2",
          displayName: "GPT Image 2 Enterprise",
          apiModelName: "image2Enterprise",
          endpointVariant: "images-generations",
          baseURL: "https://proxy.example",
          apiKey: "sk-custom"
        }
      ]
    });
    const models = applyUserModelEndpointSettings(getEnabledModels(), settings);
    const customModel = models.find((model) => model.id === "custom-model-image2-enterprise");

    expect(customModel).toMatchObject({
      displayName: "GPT Image 2 Enterprise",
      apiModelName: "image2Enterprise",
      provider: template.provider,
      apiType: template.apiType
    });
    expect(customModel?.capabilities.maxOutputs).toBe(template.capabilities.maxOutputs);
    expect(customModel?.baseURL).toBe("https://proxy.example/v1/images/generations");
    expect(resolveModelApiKey(settings, customModel?.id)).toBe("sk-custom");
  });

  it("hides built-in models without hiding custom models based on the same template", () => {
    const settings = createDefaultUserSettings(undefined, {
      hiddenModelIds: ["gpt-image-2"],
      customModels: [
        {
          id: "custom-model-image2-channel",
          templateModelId: "gpt-image-2",
          displayName: "GPT Image 2 Channel",
          apiModelName: "image2-channel"
        }
      ]
    });
    const models = applyUserModelEndpointSettings(getEnabledModels(), settings);

    expect(models.some((model) => model.id === "gpt-image-2")).toBe(false);
    expect(models.some((model) => model.id === "custom-model-image2-channel")).toBe(true);
  });

  it("builds endpoint overrides for custom model request settings", () => {
    const settings = createDefaultUserSettings("sk-main", {
      customModels: [
        {
          id: "custom-model-image2-responses",
          templateModelId: "gpt-image-2",
          displayName: "GPT Image 2 Responses",
          apiModelName: "image2-responses",
          endpointVariant: "responses",
          baseURL: "https://proxy.example",
          apiKey: "sk-model"
        }
      ]
    });
    const model = applyUserModelEndpointSettings(getEnabledModels(), settings).find(
      (item) => item.id === "custom-model-image2-responses"
    )!;
    const endpointOverride = buildEndpointOverrideFromSettings(settings, model, {
      includeApiKey: true
    });

    expect(endpointOverride).toMatchObject({
      baseURL: "https://proxy.example/v1/responses",
      endpointVariant: "responses",
      apiKey: "sk-model"
    });
  });
});
