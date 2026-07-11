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
  base64ToDataUrl,
  buildCurlForRequest,
  buildJsonHeaders,
  buildPromptWithParamHints,
  endpointURL,
  normalizeImageOutputFormat,
  parseConfiguredImageResponse,
  ratioToOpenAISize
} from "./adapter-utils";

export const openAIImageAdapter: ImageAdapter = {
  name: "openai-image",

  supports(model: ModelConfig) {
    return model.apiType === "openai-image" || model.apiType === "openai-image-edit";
  },

  buildRequest(draft: GenerationRequestDraft): AdapterHttpRequest {
    const useResponsesEndpoint =
      draft.endpointOverride?.endpointVariant === "responses" || draft.model.endpointType === "responses";
    const prompt = buildPromptWithParamHints(draft, true);
    const body: Record<string, unknown> = useResponsesEndpoint
      ? {
          model: draft.model.apiModelName,
          input: buildResponsesInput(prompt, draft),
          tools: [buildResponsesImageTool(draft)],
          tool_choice: {
            type: "image_generation"
          }
        }
      : {
          model: draft.model.apiModelName,
          prompt
        };
    const size = ratioToOpenAISize(draft);
    const hasReferenceImages = draft.referenceImages.length > 0;

    if (!useResponsesEndpoint && draft.model.capabilities.maxOutputs > 1 && !draft.model.request.omitFields.includes("n")) {
      body.n = draft.params.count;
    }

    if (!useResponsesEndpoint && size) {
      body.size = size;
    }

    if (
      !useResponsesEndpoint &&
      draft.params.quality !== "auto" &&
      !draft.model.request.omitFields.includes("quality")
    ) {
      body.quality = draft.params.quality;
    }

    if (
      draft.params.responseFormat &&
      !draft.model.request.removeResponseFormatWhenUnsupported &&
      draft.model.capabilities.responseFormats.includes(draft.params.responseFormat)
    ) {
      body.response_format = draft.params.responseFormat;
    }

    if (!useResponsesEndpoint) {
      applyOpenAIImageGenerationParams(body, draft);
    }

    if (!useResponsesEndpoint && hasReferenceImages) {
      body.images = draft.referenceImages.map(openAIReferenceToImageURL);
    }

    return {
      method: "POST",
      url: endpointURL(
        draft.model,
        draft,
        !useResponsesEndpoint && draft.model.request.preferEditEndpointWhenHasReference
      ),
      headers: buildJsonHeaders(draft),
      body,
      contentType: draft.model.request.contentType,
      timeoutMs: draft.model.request.timeoutMs
    };
  },

  parseResponse(response: AdapterHttpResponse, draft: GenerationRequestDraft): AdapterResult {
    return parseConfiguredImageResponse(response, draft);
  },

  buildCurl(draft: GenerationRequestDraft, options: CurlBuildOptions) {
    return buildCurlForRequest(this.buildRequest(draft), options);
  }
};

function buildResponsesImageTool(draft: GenerationRequestDraft) {
  const tool: Record<string, unknown> = {
    type: "image_generation"
  };
  const size = ratioToOpenAISize(draft);

  if (size) {
    tool.size = size;
  }

  if (draft.params.quality !== "auto" && !draft.model.request.omitFields.includes("quality")) {
    tool.quality = draft.params.quality;
  }

  if (draft.params.outputFormat) {
    tool.output_format = normalizeImageOutputFormat(draft.params.outputFormat);
  }

  if (shouldSendOutputCompression(draft)) {
    tool.output_compression = draft.params.outputCompression;
  }

  const background = resolveOpenAIBackground(draft);

  if (background) {
    tool.background = background;
  }

  return tool;
}

function applyOpenAIImageGenerationParams(body: Record<string, unknown>, draft: GenerationRequestDraft) {
  const outputFormat = normalizeImageOutputFormat(draft.params.outputFormat);

  if (outputFormat) {
    body.output_format = outputFormat;
  }

  if (shouldSendOutputCompression(draft)) {
    body.output_compression = draft.params.outputCompression;
  }

  const background = resolveOpenAIBackground(draft);

  if (background) {
    body.background = background;
  }

  if (draft.params.moderation) {
    body.moderation = draft.params.moderation;
  }

  if (draft.params.user?.trim()) {
    body.user = draft.params.user.trim();
  }
}

function shouldSendOutputCompression(draft: GenerationRequestDraft) {
  const outputFormat = normalizeImageOutputFormat(draft.params.outputFormat);

  return (
    draft.params.outputCompression !== undefined &&
    (outputFormat === "jpeg" || outputFormat === "webp")
  );
}

function resolveOpenAIBackground(draft: GenerationRequestDraft) {
  if (!draft.params.background) {
    return undefined;
  }

  if (draft.params.background === "transparent" && !draft.model.featureFlags.supportsTransparentBackground) {
    return undefined;
  }

  return draft.params.background;
}

function openAIReferenceToImageURL(reference: GenerationRequestDraft["referenceImages"][number]) {
  return {
    image_url: referenceToImageURL(reference)
  };
}

function referenceToImageURL(reference: GenerationRequestDraft["referenceImages"][number]) {
  const remoteURL = reference.remoteURL?.trim();

  if (remoteURL) {
    return remoteURL;
  }

  return base64ToDataUrl(reference.base64?.trim() ?? "", reference.mimeType);
}

function buildResponsesInput(prompt: string, draft: GenerationRequestDraft) {
  if (draft.referenceImages.length === 0) {
    return prompt;
  }

  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: prompt
        },
        ...draft.referenceImages.map((reference) => ({
          type: "input_image",
          image_url: referenceToImageURL(reference)
        }))
      ]
    }
  ];
}
