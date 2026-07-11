import { describe, expect, it } from "vitest";
import { getModelById } from "../../config/models";
import { createDefaultGenerationParams } from "../../domain";
import type { ModelConfig, ReferenceImage } from "../../domain";
import {
  buildGenerationRequestPayload,
  estimateGenerationCost,
  validateGenerationForm
} from "../../services/generation-form-service";

const model = getModelById("flux-2-pro")!;

function fixedPriceModel(): ModelConfig {
  return {
    ...model,
    price: {
      ...model.price,
      mode: "fixed",
      basePriceValue: 0.03,
      currency: "CNY",
      qualityMultiplier: {
        high: 2
      },
      resolutionMultiplier: {
        "2K": 1.5
      }
    }
  };
}

describe("generation form service", () => {
  it("calculates fixed price estimates with count and multipliers", () => {
    const pricedModel = fixedPriceModel();
    const params = {
      ...createDefaultGenerationParams(pricedModel),
      count: 2,
      quality: "high",
      resolution: "2K"
    } as const;
    const preview = estimateGenerationCost(pricedModel, params);

    expect(preview.canCalculate).toBe(true);
    expect(preview.estimatedCostValue).toBeCloseTo(0.18);
    expect(preview.estimatedCostText).toBe("¥0.18");
  });

  it("does not invent precise totals for custom pricing", () => {
    const preview = estimateGenerationCost(model, createDefaultGenerationParams(model));

    expect(preview.canCalculate).toBe(false);
    expect(preview.unitPriceText).toBe(model.price.basePriceText);
    expect(preview.estimatedCostText).toBe("以上游实际扣费为准");
  });

  it("blocks submit when prompt and reference images are empty", () => {
    const validation = validateGenerationForm({
      model,
      prompt: "  ",
      referenceImages: [],
      params: createDefaultGenerationParams(model)
    });

    expect(validation.isValid).toBe(false);
    expect(validation.errors[0]?.code).toBe("PROMPT_OR_IMAGE_REQUIRED");
  });

  it("blocks API keys that cannot be used in request headers", () => {
    const validation = validateGenerationForm({
      model,
      prompt: "生成产品图",
      referenceImages: [],
      params: createDefaultGenerationParams(model),
      apiKey: "sk-test-使用中文说明",
      requireApiKey: true
    });

    expect(validation.isValid).toBe(false);
    expect(validation.errors[0]?.code).toBe("API_KEY_INVALID_HEADER_VALUE");
  });

  it("blocks reference images whose transport data has not been read", () => {
    const imageModel = getModelById("gpt-image-2")!;
    const validation = validateGenerationForm({
      model: imageModel,
      prompt: "参考这张图生成新图片",
      referenceImages: [
        {
          name: "sample.png",
          mimeType: "image/png",
          format: "png",
          sizeBytes: 1024,
          order: 0
        }
      ],
      params: createDefaultGenerationParams(imageModel)
    });

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((issue) => issue.code === "REFERENCE_IMAGE_DATA_EMPTY")).toBe(true);
  });

  it("blocks params that violate temporary restrictions", () => {
    const baseModel = getModelById("gpt-image-2")!;
    const restrictedModel: ModelConfig = {
      ...baseModel,
      id: "restricted-openai-image",
      temporaryRestrictions: [
        {
          id: "size-disabled-test",
          enabled: true,
          type: "size_disabled",
          title: "尺寸参数暂不可用",
          description: "测试临时限制",
          affectedFields: ["ratio", "resolution"],
          forcedValues: { ratio: "auto", resolution: "1K" },
          disabledOptions: ["1:1", "16:9", "9:16", "2K", "4K"],
          priority: 100
        }
      ]
    };
    const validation = validateGenerationForm({
      model: restrictedModel,
      prompt: "生成一张海报",
      referenceImages: [],
      params: {
        ...createDefaultGenerationParams(restrictedModel),
        ratio: "16:9"
      }
    });

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((issue) => issue.code === "MODEL_TEMP_RESTRICTED")).toBe(true);
  });

  it("builds request payload without local preview-only fields", () => {
    const image: ReferenceImage = {
      id: "ref-1",
      source: "local-file",
      name: "sample.png",
      mimeType: "image/png",
      format: "png",
      sizeBytes: 1024,
      previewURL: "blob:local-preview",
      order: 0,
      uploadStatus: "ready",
      createdAt: 1
    };
    const payload = buildGenerationRequestPayload({
      model,
      prompt: "  生成产品图  ",
      referenceImages: [image],
      params: createDefaultGenerationParams(model)
    });

    expect(payload.prompt).toBe("生成产品图");
    expect(payload.referenceImages).toHaveLength(1);
    expect(payload.referenceImages[0]).not.toHaveProperty("previewURL");
    expect(payload.referenceImages[0]).not.toHaveProperty("file");
  });

  it("carries endpoint and model request overrides", () => {
    const payload = buildGenerationRequestPayload({
      model,
      prompt: "生成产品图",
      referenceImages: [],
      params: createDefaultGenerationParams(model),
      endpointOverride: {
        baseURL: "https://proxy.example",
        apiKey: "sk-model-secret"
      },
      modelOverride: {
        displayName: "Flux 2 Custom",
        apiModelName: "flux-2-real"
      }
    });

    expect(payload.endpointOverride?.baseURL).toBe("https://proxy.example");
    expect(payload.endpointOverride?.apiKey).toBe("sk-model-secret");
    expect(payload.modelOverride?.apiModelName).toBe("flux-2-real");
  });
});
