import type {
  AdapterHttpRequest,
  AdapterHttpResponse,
  AdapterResult,
  CurlBuildOptions,
  GenerationRequestDraft,
  ImageAdapter,
  ModelConfig
} from "../domain";
import {
  buildCurlForRequest,
  buildJsonHeaders,
  buildPromptWithParamHints,
  collectGeneratedImages,
  createGenerationError,
  endpointURL,
  extractFirstNumber,
  extractStringValues,
  failedResult,
  parseConfiguredImageResponse,
  stripDataUrlPrefix,
  summarizeResponse
} from "./adapter-utils";

const finishReasonErrors: Record<
  string,
  {
    code: string;
    title: string;
    message: string;
    suggestion: string;
    type: "safety" | "upstream";
  }
> = {
  PROHIBITED_CONTENT: {
    code: "PROHIBITED_CONTENT",
    title: "违禁内容",
    message: "上游安全策略拒绝了本次图片生成。",
    suggestion: "请调整提示词，避免违法、暴力、成人或受保护内容。",
    type: "safety"
  },
  SAFETY: {
    code: "SAFETY",
    title: "安全过滤",
    message: "上游安全过滤阻止了图片输出。",
    suggestion: "请弱化敏感描述，明确合法、安全的生成意图。",
    type: "safety"
  },
  NO_IMAGE: {
    code: "NO_IMAGE",
    title: "未生成图片",
    message: "Gemini 返回了文本或空结果，没有返回图片。",
    suggestion: "请在提示词中明确要求生成或编辑图片。",
    type: "upstream"
  },
  RECITATION: {
    code: "RECITATION",
    title: "受保护内容",
    message: "上游判断提示词可能复现受保护内容。",
    suggestion: "请改写提示词，避免要求复刻具体作品、角色或受保护图像。",
    type: "safety"
  },
  MAX_TOKENS: {
    code: "MAX_TOKENS",
    title: "输出被截断",
    message: "上游输出达到限制，图片未能完整返回。",
    suggestion: "请缩短输入、减少参考图或降低生成复杂度后重试。",
    type: "upstream"
  }
};

export const geminiImageAdapter: ImageAdapter = {
  name: "gemini-image",

  supports(model: ModelConfig) {
    return model.apiType === "gemini-native" || model.endpointType === "gemini-generate-content";
  },

  buildRequest(draft: GenerationRequestDraft): AdapterHttpRequest {
    const parts: unknown[] = [
      {
        text: buildPromptWithParamHints(draft, true)
      }
    ];
    const imageConfig: Record<string, string> = {};

    draft.referenceImages.forEach((reference) => {
      if (reference.base64) {
        parts.push({
          inlineData: {
            mimeType: reference.mimeType,
            data: stripDataUrlPrefix(reference.base64)
          }
        });
        return;
      }

      if (reference.remoteURL) {
        parts.push({
          fileData: {
            mimeType: reference.mimeType,
            fileUri: reference.remoteURL
          }
        });
      }
    });

    if (draft.params.ratio !== "auto") {
      imageConfig.aspectRatio = draft.params.ratio;
    }

    if (draft.params.resolution !== "auto") {
      imageConfig.resolution = draft.params.resolution;
    }

    const body: Record<string, unknown> = {
      contents: [
        {
          role: "user",
          parts
        }
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"]
      }
    };

    if (Object.keys(imageConfig).length > 0) {
      body.imageConfig = imageConfig;
    }

    return {
      method: "POST",
      url: endpointURL(draft.model, draft),
      headers: buildJsonHeaders(draft),
      body,
      contentType: draft.model.request.contentType,
      timeoutMs: draft.model.request.timeoutMs
    };
  },

  parseResponse(response: AdapterHttpResponse, draft: GenerationRequestDraft): AdapterResult {
    if (response.statusCode >= 400) {
      return parseConfiguredImageResponse(response, draft);
    }

    const candidatesTokenCount = extractFirstNumber(response.body, ["usageMetadata.candidatesTokenCount"]);

    if (candidatesTokenCount === 0) {
      return failedResult(
        draft,
        response,
        createGenerationError({
          type: "safety",
          code: "GOOGLE_IMAGE_BLOCKED",
          title: "谷歌拒绝出图",
          message: "Gemini 返回 candidatesTokenCount=0，表示没有可用图片候选。",
          suggestion: "请调整提示词或参考图，避免敏感内容，并明确图片生成目标。",
          retryable: false,
          mayHaveCharged: true,
          statusCode: response.statusCode,
          upstreamStatus: response.statusCode,
          safeDetails: "usageMetadata.candidatesTokenCount=0"
        })
      );
    }

    const images = collectGeneratedImages(response.body, draft);
    const finishReason = extractStringValues(response.body, draft.model.response.finishReasonPaths).find(
      (reason) => reason && reason !== "STOP"
    );
    const mappedFinishReason = finishReason ? finishReasonErrors[finishReason] : undefined;

    if (images.length === 0 && mappedFinishReason) {
      return failedResult(
        draft,
        response,
        createGenerationError({
          type: mappedFinishReason.type,
          code: mappedFinishReason.code,
          title: mappedFinishReason.title,
          message: mappedFinishReason.message,
          suggestion: mappedFinishReason.suggestion,
          retryable: mappedFinishReason.type === "upstream",
          mayHaveCharged: true,
          statusCode: response.statusCode,
          upstreamStatus: response.statusCode,
          upstreamCode: finishReason,
          finishReason,
          safeDetails: `finishReason=${finishReason}`
        })
      );
    }

    const parsed = parseConfiguredImageResponse(response, draft, "Gemini 未返回图片");

    if (mappedFinishReason && parsed.status !== "failed") {
      return {
        ...parsed,
        rawResponseSummary: {
          summary: summarizeResponse(response.body),
          finishReason
        }
      };
    }

    return parsed;
  },

  buildCurl(draft: GenerationRequestDraft, options: CurlBuildOptions) {
    return buildCurlForRequest(this.buildRequest(draft), options);
  }
};
