import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyzeRecognitionRequest,
  runReasoningRequest
} from "../../services/generation-api-service";

function stubSuccessFetch() {
  const fetchSpy = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      success: true,
      data: {
        requestId: "req-test",
        model: "gpt-5.2",
        endpoint: "https://proxy.example/v1/responses",
        outputText: "测试结果",
        raw: {}
      }
    })
  }));

  vi.stubGlobal("fetch", fetchSpy);

  return fetchSpy;
}

describe("generation api service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes abort signals to recognition requests", async () => {
    const fetchSpy = stubSuccessFetch();
    const controller = new AbortController();

    await analyzeRecognitionRequest(
      {
        modelId: "gpt-image-2",
        role: "universal",
        question: "请识别图片",
        images: [],
        modelOverride: {
          apiModelName: "gpt-5.2"
        }
      },
      controller.signal
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/recognition/analyze",
      expect.objectContaining({
        method: "POST",
        signal: controller.signal
      })
    );
  });

  it("passes abort signals to reasoning requests", async () => {
    const fetchSpy = stubSuccessFetch();
    const controller = new AbortController();

    await runReasoningRequest(
      {
        modelId: "gpt-image-2",
        platform: "openai",
        modelName: "o3",
        effort: "high",
        maxTokens: 4096,
        prompt: "请推理",
        apiStyle: "responses",
        referenceImages: []
      },
      controller.signal
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/reasoning/test",
      expect.objectContaining({
        method: "POST",
        signal: controller.signal
      })
    );
  });

  it("turns empty API responses into structured errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 502,
        text: async () => ""
      }))
    );

    await expect(
      analyzeRecognitionRequest({
        modelId: "gpt-image-2",
        role: "universal",
        question: "请识别图片",
        images: []
      })
    ).rejects.toMatchObject({
      name: "GenerationApiError",
      apiError: {
        code: "EMPTY_API_RESPONSE",
        title: "接口返回空响应"
      }
    });
  });

  it("turns invalid API JSON into structured errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => "<html>server error</html>"
      }))
    );

    await expect(
      runReasoningRequest({
        modelId: "gpt-image-2",
        platform: "openai",
        modelName: "o3",
        effort: "high",
        maxTokens: 4096,
        prompt: "请推理",
        apiStyle: "responses",
        referenceImages: []
      })
    ).rejects.toMatchObject({
      name: "GenerationApiError",
      apiError: {
        code: "INVALID_API_JSON",
        title: "接口返回非 JSON 响应"
      }
    });
  });
});
