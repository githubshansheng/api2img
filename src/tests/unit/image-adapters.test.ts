import { describe, expect, it } from "vitest";
import {
  extractValuesByPath,
  geminiImageAdapter,
  genericImageAdapter,
  openAIImageAdapter,
  selectImageAdapter,
  summarizeAdapterRequest
} from "../../adapters";
import { getModelById } from "../../config/models";
import { createDefaultGenerationParams } from "../../domain";
import type { AdapterHttpResponse, GenerationRequestDraft, GenerationRequestPayload, ModelConfig } from "../../domain";
import { buildGenerationRequestDraft } from "../../services/generation-draft-service";

const TEST_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

function createDraft(
  modelId: string,
  overrides: Partial<GenerationRequestPayload> = {}
): GenerationRequestDraft {
  const model = getModelById(modelId)!;

  return createDraftForModel(model, overrides);
}

function createDraftForModel(
  model: ModelConfig,
  overrides: Partial<GenerationRequestPayload> = {}
): GenerationRequestDraft {

  return buildGenerationRequestDraft({
    model,
    payload: {
      requestId: "req-test",
      modelId: model.id,
      prompt: "生成一张产品海报",
      referenceImages: [],
      params: createDefaultGenerationParams(model),
      ...overrides
    }
  });
}

function okResponse(body: unknown): AdapterHttpResponse {
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json"
    },
    body,
    durationMs: 88
  };
}

function errorResponse(statusCode: number, body: unknown): AdapterHttpResponse {
  return {
    statusCode,
    headers: {
      "content-type": "application/json"
    },
    body,
    durationMs: 52
  };
}

describe("image adapters", () => {
  it("selects adapter by model api type", () => {
    expect(selectImageAdapter(getModelById("gpt-image-2")!)?.name).toBe(openAIImageAdapter.name);
    expect(selectImageAdapter(getModelById("nano-banana-pro")!)?.name).toBe(geminiImageAdapter.name);
    expect(selectImageAdapter(getModelById("seedream-5")!)?.name).toBe(genericImageAdapter.name);
  });

  it("builds OpenAI request without unsupported response_format or native size", () => {
    const baseModel = getModelById("gpt-image-2")!;
    const promptOnlyModel: ModelConfig = {
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
    const draft = createDraftForModel(promptOnlyModel, {
      params: {
        ...createDefaultGenerationParams(promptOnlyModel),
        ratio: "16:9",
        resolution: "2K",
        quality: "high",
        responseFormat: "b64_json"
      }
    });
    const request = openAIImageAdapter.buildRequest(draft);
    const body = request.body as Record<string, unknown>;

    expect(body.model).toBe("prompt-only-openai-image");
    expect(body.prompt).toContain("画幅比例 16:9");
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("size");
  });

  it("maps OpenAI ratio and resolution to native size fields", () => {
    const draft = createDraft("gpt-image-2", {
      params: {
        ...createDefaultGenerationParams(getModelById("gpt-image-2")!),
        ratio: "16:9",
        resolution: "2K",
        quality: "high"
      }
    });
    const request = openAIImageAdapter.buildRequest(draft);
    const body = request.body as Record<string, unknown>;

    expect(body.size).toBe("2048x1152");
    expect(body.quality).toBe("high");
  });

  it("keeps gpt-image-2 16:9 sizes exact across every resolution tier", () => {
    const model = getModelById("gpt-image-2")!;
    const expectedSizes = {
      "0.5K": "1280x720",
      "1K": "1536x864",
      "2K": "2048x1152",
      "4K": "3840x2160"
    } as const;

    Object.entries(expectedSizes).forEach(([resolution, expectedSize]) => {
      const draft = createDraft("gpt-image-2", {
        params: {
          ...createDefaultGenerationParams(model),
          ratio: "16:9",
          resolution: resolution as keyof typeof expectedSizes
        }
      });
      const request = openAIImageAdapter.buildRequest(draft);
      const body = request.body as Record<string, unknown>;

      expect(body.size).toBe(expectedSize);
    });
  });

  it("builds valid exact gpt-image-2 sizes for all enabled ratio and resolution combinations", () => {
    const model = getModelById("gpt-image-2")!;
    const ratios = model.capabilities.ratios.filter((option) => option.enabled && option.key !== "auto");
    const resolutions = model.capabilities.resolutions.filter(
      (option) => option.enabled && option.key !== "auto"
    );

    ratios.forEach((ratio) => {
      resolutions.forEach((resolution) => {
        const draft = createDraft("gpt-image-2", {
          params: {
            ...createDefaultGenerationParams(model),
            ratio: ratio.key,
            resolution: resolution.key
          }
        });
        const body = openAIImageAdapter.buildRequest(draft).body as Record<string, unknown>;
        const [width, height] = String(body.size).split("x").map(Number);
        const requestedAspectRatio = ratio.widthRatio! / ratio.heightRatio!;

        expect(width % 16).toBe(0);
        expect(height % 16).toBe(0);
        expect(width * height).toBeGreaterThanOrEqual(655_360);
        expect(width * height).toBeLessThanOrEqual(8_294_400);
        expect(Math.max(width, height)).toBeLessThanOrEqual(3_840);
        expect(Math.max(width / height, height / width)).toBeLessThanOrEqual(3);
        expect(width / height).toBeCloseTo(requestedAspectRatio, 8);
      });
    });
  });

  it("summarizes the actual adapter request model name", () => {
    const baseModel = getModelById("gpt-image-2")!;
    const model: ModelConfig = {
      ...baseModel,
      apiModelName: "gpt-image-2-4k"
    };
    const draft = createDraftForModel(model);
    const request = openAIImageAdapter.buildRequest(draft);
    const summary = summarizeAdapterRequest(openAIImageAdapter.name, request, draft);

    expect(summary.requestModelName).toBe("gpt-image-2-4k");
  });

  it("sends native OpenAI image fields without forbidden prompt-only params", () => {
    const draft = createDraft("gpt-image-2", {
      params: {
        ...createDefaultGenerationParams(getModelById("gpt-image-2")!),
        count: 3,
        ratio: "9:16",
        resolution: "1K",
        quality: "high",
        outputFormat: "webp",
        outputCompression: 80,
        background: "opaque",
        moderation: "low"
      }
    });
    const request = openAIImageAdapter.buildRequest(draft);
    const body = request.body as Record<string, unknown>;

    expect(body.prompt).toContain("生成一张产品海报");
    expect(body.prompt).toContain("画幅比例 9:16");
    expect(body.prompt).toContain("请求分辨率 1K");
    expect(body.prompt).toContain("图片质量 高");
    expect(body.prompt).not.toContain("生成数量");
    expect(body.prompt).not.toContain("审核强度");
    expect(body.prompt).not.toContain("响应格式");
    expect(body.n).toBe(3);
    expect(body.size).toBe("864x1536");
    expect(body.output_format).toBe("webp");
    expect(body.output_compression).toBe(80);
    expect(body.background).toBe("opaque");
    expect(body.moderation).toBe("low");
  });

  it("sends OpenAI reference images with the proxy-compatible images field", () => {
    const draft = createDraft("gpt-image-2", {
      referenceImages: [
        {
          id: "ref-1",
          name: "ref.png",
          mimeType: "image/png",
          format: "png",
          base64: `data:image/png;base64,${TEST_IMAGE_BASE64}`,
          order: 0
        }
      ]
    });
    const request = openAIImageAdapter.buildRequest(draft);
    const body = request.body as Record<string, unknown>;

    expect(request.url).toContain("/v1/images/edits");
    expect(body.images).toEqual([
      {
        image_url: `data:image/png;base64,${TEST_IMAGE_BASE64}`
      }
    ]);
    expect(body).not.toHaveProperty("image");
  });

  it("sends OpenAI native edit masks as multipart image and mask files", () => {
    const draft = createDraft("gpt-image-2", {
      referenceImages: [
        {
          id: "source-1",
          name: "source.png",
          mimeType: "image/png",
          format: "png",
          base64: `data:image/png;base64,${TEST_IMAGE_BASE64}`,
          order: 0
        }
      ],
      nativeMask: {
        image: {
          id: "mask-1",
          name: "mask.png",
          mimeType: "image/png",
          format: "png",
          base64: `data:image/png;base64,${TEST_IMAGE_BASE64}`,
          order: 0
        },
        sourceImageIndex: 0
      }
    });
    const request = openAIImageAdapter.buildRequest(draft);
    const form = request.body as FormData;

    expect(request.url).toContain("/v1/images/edits");
    expect(request.contentType).toBe("multipart/form-data");
    expect(request.headers).not.toHaveProperty("Content-Type");
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("model")).toBe("gpt-image-2");
    expect(form.get("prompt")).toContain("生成一张产品海报");
    expect(form.get("image")).toBeInstanceOf(Blob);
    expect(form.get("mask")).toBeInstanceOf(Blob);
  });

  it("builds OpenAI Responses image generation requests when selected", () => {
    const draft = createDraft("gpt-image-2", {
      endpointOverride: {
        baseURL: "https://proxy.example",
        endpointVariant: "responses"
      },
      params: {
        ...createDefaultGenerationParams(getModelById("gpt-image-2")!),
        ratio: "9:16",
        resolution: "4K",
        quality: "medium",
        outputFormat: "jpeg",
        outputCompression: 70,
        background: "auto"
      }
    });
    const request = openAIImageAdapter.buildRequest(draft);
    const body = request.body as {
      prompt?: string;
      input: unknown;
      tools: Array<Record<string, unknown>>;
    };

    expect(request.url).toBe("https://proxy.example/v1/responses");
    expect(body.prompt).toBeUndefined();
    expect(body.input).toBeTruthy();
    expect(body.tools[0]).toMatchObject({
      type: "image_generation",
      size: "2160x3840",
      quality: "medium",
      output_format: "jpeg",
      output_compression: 70,
      background: "auto"
    });
  });

  it("continues OpenAI Responses edits with previous_response_id", () => {
    const draft = createDraft("gpt-image-2", {
      endpointOverride: {
        baseURL: "https://proxy.example",
        endpointVariant: "responses"
      },
      continuation: {
        provider: "openai",
        modelId: "gpt-image-2",
        compatibilityKey: "openai|gpt-image-2|responses",
        strategy: "openai-response",
        responseId: "resp_previous"
      }
    });
    const request = openAIImageAdapter.buildRequest(draft);
    const body = request.body as Record<string, unknown>;

    expect(request.url).toBe("https://proxy.example/v1/responses");
    expect(body.previous_response_id).toBe("resp_previous");
  });

  it("maps OpenAI upstream errors through normalized error types", () => {
    const draft = createDraft("gpt-image-2");
    const validation = openAIImageAdapter.parseResponse(
      errorResponse(400, {
        error: {
          code: "invalid_request_error",
          message: "size is invalid"
        }
      }),
      draft
    );
    const auth = openAIImageAdapter.parseResponse(
      errorResponse(401, {
        error: {
          code: "invalid_api_key",
          message: "Incorrect API key"
        }
      }),
      draft
    );
    const rateLimit = openAIImageAdapter.parseResponse(
      errorResponse(429, {
        error: {
          code: "rate_limit_exceeded",
          message: "Too many requests"
        }
      }),
      draft
    );
    const network = openAIImageAdapter.parseResponse(
      errorResponse(502, {
        error: {
          code: "UPSTREAM_REQUEST_FAILED",
          message: "fetch failed"
        }
      }),
      draft
    );

    expect(validation.status).toBe("failed");
    expect(validation.error?.type).toBe("validation");
    expect(validation.error?.title).toBe("请求参数错误");
    expect(auth.error?.type).toBe("auth");
    expect(auth.error?.retryable).toBe(false);
    expect(rateLimit.error?.type).toBe("rate_limit");
    expect(rateLimit.error?.suggestion).not.toContain("image2Enterprise");
    expect(network.error?.type).toBe("network");
    expect(network.error?.mayHaveCharged).toBe(false);
  });

  it("parses OpenAI URL and base64 images", () => {
    const draft = createDraft("gpt-image-1-5");
    const urlResult = openAIImageAdapter.parseResponse(
      okResponse({
        data: [{ url: "https://example.test/image.png" }]
      }),
      draft
    );
    const base64Result = openAIImageAdapter.parseResponse(
      okResponse({
        data: [{ b64_json: TEST_IMAGE_BASE64 }]
      }),
      createDraft("gpt-image-1-5", {
        params: {
          ...createDefaultGenerationParams(getModelById("gpt-image-1-5")!),
          outputFormat: "webp"
        }
      })
    );

    expect(urlResult.status).toBe("success");
    expect(urlResult.images[0]?.url).toBe("https://example.test/image.png");
    expect(base64Result.status).toBe("success");
    expect(base64Result.images[0]?.url).toContain("data:image/webp;base64,");
    expect(base64Result.images[0]?.width).toBe(1);
    expect(base64Result.images[0]?.height).toBe(1);
  });

  it("parses OpenAI Responses image generation outputs", () => {
    const draft = createDraft("gpt-image-2");
    const result = openAIImageAdapter.parseResponse(
      okResponse({
        output: [
          {
            type: "image_generation_call",
            result: TEST_IMAGE_BASE64
          }
        ]
      }),
      draft
    );

    expect(result.status).toBe("success");
    expect(result.images[0]?.url).toContain("data:image/png;base64,");
  });

  it("expands multiple returned image payloads into separate records", () => {
    const draft = createDraft("gpt-image-2", {
      params: {
        ...createDefaultGenerationParams(getModelById("gpt-image-2")!),
        count: 2
      }
    });
    const result = openAIImageAdapter.parseResponse(
      okResponse({
        output: [
          {
            type: "image_generation_call",
            result: [TEST_IMAGE_BASE64, TEST_IMAGE_BASE64]
          }
        ]
      }),
      draft
    );

    expect(result.status).toBe("success");
    expect(result.images).toHaveLength(2);
    expect(result.images.map((image) => image.index)).toEqual([0, 1]);
  });

  it("builds Gemini contents parts with inline reference images", () => {
    const draft = createDraft("nano-banana-pro", {
      referenceImages: [
        {
          id: "ref-1",
          name: "ref.png",
          mimeType: "image/png",
          format: "png",
          base64: `data:image/png;base64,${TEST_IMAGE_BASE64}`,
          order: 0
        }
      ]
    });
    const request = geminiImageAdapter.buildRequest(draft);
    const body = request.body as {
      contents: Array<{ parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> }>;
    };

    expect(body.contents[0]?.parts[0]?.text).toContain("生成一张产品海报");
    expect(body.contents[0]?.parts[1]?.inlineData?.mimeType).toBe("image/png");
    expect(body.contents[0]?.parts[1]?.inlineData?.data).toBe(TEST_IMAGE_BASE64);
  });

  it("continues Gemini edits by prepending saved conversation contents", () => {
    const previousContents = [
      {
        role: "user",
        parts: [{ text: "先把背景改成蓝色。" }]
      },
      {
        role: "model",
        parts: [{ text: "已完成背景调整。" }]
      }
    ];
    const draft = createDraft("nano-banana-pro", {
      continuation: {
        provider: "google",
        modelId: "nano-banana-pro",
        compatibilityKey: "google|nano-banana-pro|gemini",
        strategy: "gemini-context",
        interactionId: "interaction-1",
        opaqueMetadata: {
          contents: previousContents
        }
      }
    });
    const request = geminiImageAdapter.buildRequest(draft);
    const body = request.body as {
      contents: Array<{ role: string; parts: Array<{ text?: string }> }>;
    };

    expect(body.contents).toHaveLength(3);
    expect(body.contents.slice(0, 2)).toEqual(previousContents);
    expect(body.contents[2]?.role).toBe("user");
    expect(body.contents[2]?.parts[0]?.text).toContain("生成一张产品海报");
  });

  it("maps Gemini candidatesTokenCount=0 to safety error", () => {
    const result = geminiImageAdapter.parseResponse(
      okResponse({
        candidates: [],
        usageMetadata: {
          totalTokenCount: 8,
          candidatesTokenCount: 0
        }
      }),
      createDraft("nano-banana-pro")
    );

    expect(result.status).toBe("failed");
    expect(result.error?.type).toBe("safety");
    expect(result.error?.title).toBe("谷歌拒绝出图");
  });

  it("parses Generic configured paths and fails empty responses with NO_IMAGE", () => {
    const draft = createDraft("seedream-5");
    const success = genericImageAdapter.parseResponse(
      okResponse({
        result: {
          images: [{ url: "https://example.test/seedream.png" }]
        }
      }),
      draft
    );
    const failed = genericImageAdapter.parseResponse(okResponse({ result: { images: [] } }), draft);

    expect(success.status).toBe("success");
    expect(success.images[0]?.url).toBe("https://example.test/seedream.png");
    expect(failed.status).toBe("failed");
    expect(failed.error?.code).toBe("NO_IMAGE");
  });

  it("extracts nested wildcard response paths", () => {
    const values = extractValuesByPath(
      {
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: "abc" } }]
            }
          }
        ]
      },
      "candidates[].content.parts[].inlineData.data"
    );

    expect(values).toEqual(["abc"]);
  });
});
