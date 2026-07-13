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
  extractFirstString,
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
    const nativeMaskRequest =
      !useResponsesEndpoint && buildNativeMaskRequest(draft, prompt);

    if (nativeMaskRequest) {
      return nativeMaskRequest;
    }

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

    if (
      useResponsesEndpoint &&
      draft.continuation?.strategy === "openai-response" &&
      draft.continuation.responseId
    ) {
      body.previous_response_id = draft.continuation.responseId;
    }

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
    const parsed = parseConfiguredImageResponse(response, draft);

    if (response.statusCode >= 400) {
      return parsed;
    }

    return {
      ...parsed,
      continuation: {
        responseId: extractFirstString(response.body, ["id", "response.id"]),
        imageGenerationCallId: extractFirstString(response.body, [
          "output[].id",
          "output[].call_id",
          "output[].image_generation_call.id"
        ])
      }
    };
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

function buildNativeMaskRequest(
  draft: GenerationRequestDraft,
  prompt: string
): AdapterHttpRequest | undefined {
  const source = draft.referenceImages[draft.nativeMask?.sourceImageIndex ?? 0];
  const mask = draft.nativeMask?.image;

  if (!source?.base64 || !mask?.base64) {
    return undefined;
  }

  const form = new FormData();
  form.append("model", draft.model.apiModelName);
  form.append("prompt", prompt);
  form.append("image", base64ToBlob(source.base64, source.mimeType), source.name);
  form.append("mask", base64ToBlob(mask.base64, mask.mimeType), mask.name);
  const size = ratioToOpenAISize(draft);

  if (size) {
    form.append("size", size);
  }

  if (draft.params.quality !== "auto") {
    form.append("quality", draft.params.quality);
  }

  if (draft.params.outputFormat) {
    form.append("output_format", normalizeImageOutputFormat(draft.params.outputFormat));
  }

  const headers = buildJsonHeaders(draft);
  delete headers["Content-Type"];

  return {
    method: "POST",
    url: endpointURL(draft.model, draft, true),
    headers,
    body: form,
    contentType: "multipart/form-data",
    timeoutMs: draft.model.request.timeoutMs
  };
}

function base64ToBlob(value: string, mimeType: string) {
  const clean = value.includes(";base64,")
    ? value.slice(value.indexOf(";base64,") + ";base64,".length)
    : value;
  const bytes = Uint8Array.from(atob(clean), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}
