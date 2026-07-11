import { describe, expect, it } from "vitest";
import { getModelById } from "../../config/models";
import {
  buildModelEndpointURL,
  getModelEndpointPrefix,
  stripKnownEndpointSuffix
} from "../../services/model-endpoint-service";

describe("model endpoint service", () => {
  it("uses root prefixes for configured default URLs", () => {
    expect(getModelEndpointPrefix(getModelById("gpt-image-2")!)).toBe("https://ai.heigh.vip");
    expect(getModelEndpointPrefix(getModelById("nano-banana-pro")!)).toBe("https://ai.heigh.vip");
  });

  it("appends OpenAI image endpoint paths without duplicating version segments", () => {
    const model = getModelById("gpt-image-2")!;

    expect(buildModelEndpointURL(model, "https://proxy.example", "generation")).toBe(
      "https://proxy.example/v1/images/generations"
    );
    expect(buildModelEndpointURL(model, "https://proxy.example/v1", "generation")).toBe(
      "https://proxy.example/v1/images/generations"
    );
    expect(buildModelEndpointURL(model, "https://proxy.example/v1/images/generations", "edit")).toBe(
      "https://proxy.example/v1/images/edits"
    );
  });

  it("can switch OpenAI generation requests to the Responses endpoint", () => {
    const model = getModelById("gpt-image-2")!;

    expect(buildModelEndpointURL(model, "https://proxy.example", "generation", "responses")).toBe(
      "https://proxy.example/v1/responses"
    );
    expect(buildModelEndpointURL(model, "https://proxy.example/v1/responses", "generation", "images-generations")).toBe(
      "https://proxy.example/v1/images/generations"
    );
  });

  it("uses the current actual model name for Gemini generateContent URLs", () => {
    const baseModel = getModelById("nano-banana-pro")!;
    const model = {
      ...baseModel,
      apiModelName: "gemini-image-real"
    };

    expect(buildModelEndpointURL(model, "https://gemini.example/v1beta", "generation")).toBe(
      "https://gemini.example/v1beta/models/gemini-image-real:generateContent"
    );
  });

  it("normalizes previously saved full endpoints back to prefixes", () => {
    expect(stripKnownEndpointSuffix("https://proxy.example/v1/images/generations")).toBe("https://proxy.example");
    expect(stripKnownEndpointSuffix("https://proxy.example/v1/responses")).toBe("https://proxy.example");
    expect(stripKnownEndpointSuffix("https://proxy.example/v1beta/models/old-model:generateContent")).toBe(
      "https://proxy.example"
    );
  });
});
