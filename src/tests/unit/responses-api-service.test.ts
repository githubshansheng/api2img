import { describe, expect, it } from "vitest";
import { getModelById } from "../../config/models";
import {
  RESPONSES_REQUEST_TIMEOUT_MS,
  buildReasoningHttpRequest,
  buildReasoningResponsesBody,
  buildRecognitionChatCompletionsBody,
  buildRecognitionHttpRequest,
  buildRecognitionResponsesBody,
  buildResponsesHttpRequest,
  imageToResponsesImageUrl,
  parseUtilityTextResult,
  parseResponsesTextResult,
  type ResponsesImageInput
} from "../../services/responses-api-service";

const TEST_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const imageInput: ResponsesImageInput = {
  id: "ref-1",
  name: "ref.png",
  mimeType: "image/png",
  sizeBytes: 128,
  width: 1,
  height: 1,
  base64: TEST_IMAGE_BASE64,
  order: 0
};

describe("responses api service", () => {
  it("builds recognition bodies with text and non-empty image data URLs", () => {
    const body = buildRecognitionResponsesBody({
      modelName: "gpt-image-2",
      role: "object",
      question: "请识别图片主体",
      images: [imageInput]
    }) as {
      model: string;
      input: Array<{ role: string; content: Array<Record<string, string>> }>;
    };

    expect(body.model).toBe("gpt-image-2");
    expect(body.input[0]?.role).toBe("user");
    expect(body.input[0]?.content[0]).toMatchObject({
      type: "input_text"
    });
    expect(body.input[0]?.content[1]).toEqual({
      type: "input_image",
      image_url: `data:image/png;base64,${TEST_IMAGE_BASE64}`
    });
  });

  it("builds recognition Chat Completions requests from base URL prefixes", () => {
    const model = getModelById("gpt-image-2")!;
    const body = buildRecognitionChatCompletionsBody({
      modelName: "gpt-5.2",
      role: "universal",
      question: "请识别图片主体",
      images: [imageInput]
    }) as {
      model: string;
      messages: Array<{ content: Array<Record<string, unknown>> }>;
    };
    const request = buildRecognitionHttpRequest({
      model,
      body,
      endpointOverride: {
        baseURL: "https://proxy.example/v1/images/generations",
        apiKey: "sk-test"
      }
    });

    expect(body.model).toBe("gpt-5.2");
    expect(body.messages[0]?.content[0]).toMatchObject({
      type: "text"
    });
    expect(body.messages[0]?.content[1]).toEqual({
      type: "image_url",
      image_url: {
        url: `data:image/png;base64,${TEST_IMAGE_BASE64}`
      }
    });
    expect(request.url).toBe("https://proxy.example/v1/chat/completions");
    expect(request.headers.Authorization).toBe("Bearer sk-test");
  });

  it("rejects empty base64 image inputs before sending upstream", () => {
    expect(() =>
      imageToResponsesImageUrl({
        ...imageInput,
        base64: "data:image/png;base64,   "
      })
    ).toThrow(/missing non-empty base64/i);
  });

  it("builds reasoning bodies with effort and clamped max output tokens", () => {
    const body = buildReasoningResponsesBody({
      modelName: "o3-mini",
      effort: "high",
      maxTokens: 99999,
      prompt: "请给出推理测试结论",
      referenceImages: [imageInput]
    }) as {
      model: string;
      reasoning: { effort: string };
      max_output_tokens: number;
      input: Array<{ content: Array<Record<string, string>> }>;
    };

    expect(body.model).toBe("o3-mini");
    expect(body.reasoning.effort).toBe("high");
    expect(body.max_output_tokens).toBe(32000);
    expect(body.input[0]?.content[0]).toMatchObject({
      type: "input_text",
      text: "请给出推理测试结论"
    });
    expect(body.input[0]?.content[1]?.type).toBe("input_image");
  });

  it("builds OpenAI Chat reasoning requests when that API style is selected", () => {
    const model = getModelById("gpt-image-2")!;
    const request = buildReasoningHttpRequest({
      model,
      platform: "openai",
      modelName: "gpt-5.5",
      effort: "high",
      maxTokens: 4096,
      prompt: "请推理",
      apiStyle: "chat-completions",
      endpointOverride: {
        baseURL: "https://proxy.example",
        apiKey: "sk-test"
      }
    });

    expect(request.url).toBe("https://proxy.example/v1/chat/completions");
    expect(request.body).toMatchObject({
      model: "gpt-5.5",
      reasoning_effort: "high",
      max_completion_tokens: 4096
    });
  });

  it("builds Anthropic and Gemini reasoning requests with platform headers", () => {
    const model = getModelById("gpt-image-2")!;
    const anthropic = buildReasoningHttpRequest({
      model,
      platform: "anthropic",
      modelName: "claude-opus-4-8",
      effort: "xhigh",
      maxTokens: 99999,
      prompt: "请推理",
      wantSummary: true,
      endpointOverride: {
        baseURL: "https://api.example/v1/responses",
        apiKey: "sk-test"
      }
    });
    const gemini = buildReasoningHttpRequest({
      model,
      platform: "gemini",
      modelName: "gemini-3.1-pro-preview",
      effort: "medium",
      maxTokens: 2048,
      prompt: "请推理",
      endpointOverride: {
        baseURL: "https://api.example",
        apiKey: "sk-test"
      }
    });

    expect(anthropic.url).toBe("https://api.example/v1/messages");
    expect(anthropic.headers["x-api-key"]).toBe("sk-test");
    expect(anthropic.body).toMatchObject({
      model: "claude-opus-4-8",
      max_tokens: 32000,
      thinking: {
        type: "adaptive",
        display: "summarized"
      }
    });
    expect(gemini.url).toBe("https://api.example/v1beta/models/gemini-3.1-pro-preview:generateContent");
    expect(gemini.headers["x-goog-api-key"]).toBe("sk-test");
    expect(gemini.body).toMatchObject({
      generationConfig: {
        maxOutputTokens: 2048,
        thinkingConfig: {
          thinkingBudget: 4096
        }
      }
    });
  });

  it("builds POST /v1/responses requests with the fixed 30 minute timeout", () => {
    const model = getModelById("gpt-image-2")!;
    const request = buildResponsesHttpRequest({
      model,
      body: {
        model: "gpt-image-2",
        input: "ping"
      },
      endpointOverride: {
        baseURL: "https://proxy.example",
        apiKey: "sk-test"
      }
    });

    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://proxy.example/v1/responses");
    expect(request.timeoutMs).toBe(RESPONSES_REQUEST_TIMEOUT_MS);
    expect(request.headers.Authorization).toBe("Bearer sk-test");
  });

  it("parses direct and nested Responses text with usage", () => {
    const direct = parseResponsesTextResult({
      output_text: "直接文本",
      usage: {
        input_tokens: 3,
        output_tokens: 5,
        total_tokens: 8
      }
    });
    const nested = parseResponsesTextResult({
      output: [
        {
          content: [
            {
              type: "output_text",
              text: "第一段"
            },
            {
              type: "output_text",
              output_text: "第二段"
            }
          ]
        }
      ]
    });

    expect(direct.outputText).toBe("直接文本");
    expect(direct.usage).toMatchObject({
      promptTokens: 3,
      completionTokens: 5,
      totalTokens: 8
    });
    expect(nested.outputText).toBe("第一段\n第二段");
  });

  it("parses the upstream Responses message shape returned by ai.heigh.vip", () => {
    const parsed = parseResponsesTextResult({
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "OK"
            }
          ]
        }
      ]
    });

    expect(parsed.outputText).toBe("OK");
  });

  it("parses Chat, Anthropic and Gemini utility text results", () => {
    const chat = parseUtilityTextResult(
      {
        choices: [
          {
            message: {
              content: "答案",
              reasoning_content: "推理摘要"
            }
          }
        ],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 2,
          total_tokens: 3
        }
      },
      "openai-chat-completions"
    );
    const anthropic = parseUtilityTextResult(
      {
        content: [
          { type: "thinking", thinking: "思考" },
          { type: "text", text: "结论" }
        ],
        usage: {
          input_tokens: 4,
          output_tokens: 5
        }
      },
      "anthropic-messages"
    );
    const gemini = parseUtilityTextResult(
      {
        candidates: [
          {
            content: {
              parts: [
                { text: "内部思考", thought: true },
                { text: "最终回答" }
              ]
            }
          }
        ],
        usageMetadata: {
          promptTokenCount: 6,
          candidatesTokenCount: 7,
          totalTokenCount: 13
        }
      },
      "gemini-generate-content"
    );

    expect(chat).toMatchObject({ outputText: "答案", thinkingText: "推理摘要" });
    expect(anthropic).toMatchObject({ outputText: "结论", thinkingText: "思考" });
    expect(anthropic.usage?.totalTokens).toBe(9);
    expect(gemini).toMatchObject({ outputText: "最终回答", thinkingText: "内部思考" });
    expect(gemini.usage?.totalTokens).toBe(13);
  });
});
