import { describe, expect, it } from "vitest";
import { getModelById } from "../../config/models";
import { createDefaultGenerationParams } from "../../domain";
import { buildCurlPreview, CURL_PLACEHOLDER_KEY } from "../../services/curl-service";

describe("curl service", () => {
  it("uses placeholder key by default and removes unsupported response_format", () => {
    const model = getModelById("gpt-image-2")!;
    const preview = buildCurlPreview({
      model,
      prompt: "生成一张商品图",
      referenceImages: [],
      params: {
        ...createDefaultGenerationParams(model),
        responseFormat: "b64_json"
      },
      apiKey: "sk-real-secret",
      showRealKey: false
    });

    expect(preview.code).toContain(CURL_PLACEHOLDER_KEY);
    expect(preview.code).not.toContain("sk-real-secret");
    expect(preview.code).not.toContain("response_format");
    expect(preview.warning).toContain("response_format");
  });

  it("shows real key only after explicit opt-in", () => {
    const model = getModelById("nano-banana-pro")!;
    const preview = buildCurlPreview({
      model,
      prompt: "生成一张海报",
      referenceImages: [],
      params: createDefaultGenerationParams(model),
      apiKey: "sk-real-secret",
      showRealKey: true
    });

    expect(preview.code).toContain("sk-real-secret");
    expect(preview.adapterName).toBe("gemini-image");
    expect(preview.endpoint).toContain(":generateContent");
    expect(preview.code).toContain("contents");
  });

  it("keeps prompt-only size models out of OpenAI cURL body", () => {
    const baseModel = getModelById("gpt-image-2")!;
    const model = {
      ...baseModel,
      id: "prompt-only-openai-image",
      apiModelName: "prompt-only-openai-image",
      request: {
        ...baseModel.request,
        omitFields: ["size"]
      },
      featureFlags: {
        ...baseModel.featureFlags,
        sizeByPromptOnly: true
      }
    };
    const preview = buildCurlPreview({
      model,
      prompt: "生成一张宽幅图",
      referenceImages: [],
      params: {
        ...createDefaultGenerationParams(model),
        ratio: "16:9"
      },
      apiKey: "sk-real-secret",
      showRealKey: false
    });

    expect(preview.code).not.toContain('"size"');
    expect(preview.code).toContain(CURL_PLACEHOLDER_KEY);
  });

  it("uses configured endpoint and actual request model name", () => {
    const baseModel = getModelById("gpt-image-2")!;
    const model = {
      ...baseModel,
      apiModelName: "gpt-image-2-real"
    };
    const preview = buildCurlPreview({
      model,
      prompt: "生成一张产品图",
      referenceImages: [],
      params: createDefaultGenerationParams(model),
      endpointOverride: {
        baseURL: "https://proxy.example",
        apiKey: "sk-model-secret"
      },
      showRealKey: false
    });

    expect(preview.endpoint).toBe("https://proxy.example/v1/images/generations");
    expect(preview.code).toContain('"model": "gpt-image-2-real"');
    expect(preview.code).toContain(CURL_PLACEHOLDER_KEY);
    expect(preview.code).not.toContain("sk-model-secret");
  });

  it("applies request model override to curl request body", () => {
    const model = getModelById("gpt-image-2")!;
    const preview = buildCurlPreview({
      model,
      modelOverride: {
        displayName: "GPT Image 2 4K",
        apiModelName: "gpt-image-2-4k"
      },
      prompt: "generate a product poster",
      referenceImages: [],
      params: createDefaultGenerationParams(model),
      showRealKey: false
    });

    expect(preview.requestModelName).toBe("gpt-image-2-4k");
    expect(preview.code).toContain('"model": "gpt-image-2-4k"');
    expect(preview.code).not.toContain('"model": "gpt-image-2"');
  });

  it("shows the selected OpenAI Responses endpoint and request fields", () => {
    const model = getModelById("gpt-image-2")!;
    const preview = buildCurlPreview({
      model,
      prompt: "鐢熸垚涓€寮犱骇鍝佸浘",
      referenceImages: [],
      params: {
        ...createDefaultGenerationParams(model),
        ratio: "16:9",
        resolution: "2K",
        quality: "high"
      },
      endpointOverride: {
        baseURL: "https://proxy.example",
        endpointVariant: "responses"
      },
      showRealKey: false
    });

    expect(preview.endpoint).toBe("https://proxy.example/v1/responses");
    expect(preview.bodyFields).toEqual(["model", "input", "tools", "tool_choice"]);
    expect(preview.code).toContain('"type": "image_generation"');
    expect(preview.code).toContain('"size": "2048x1152"');
    expect(preview.code).toContain('"quality": "high"');
    expect(preview.code).toContain('"output_format": "png"');
    expect(preview.code).toContain('"background": "auto"');
  });
});
