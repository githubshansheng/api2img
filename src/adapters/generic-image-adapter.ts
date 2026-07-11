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
  endpointURL,
  parseConfiguredImageResponse,
  ratioToOpenAISize,
  referenceToTransportValue
} from "./adapter-utils";

const supportedApiTypes = new Set(["flux-kontext", "flux-2", "seedream", "generic-image"]);

export const genericImageAdapter: ImageAdapter = {
  name: "generic-image",

  supports(model: ModelConfig) {
    return supportedApiTypes.has(model.apiType) || model.endpointType === "custom";
  },

  buildRequest(draft: GenerationRequestDraft): AdapterHttpRequest {
    const body: Record<string, unknown> = {};
    const knownFields: Record<string, unknown> = {
      model: draft.model.apiModelName,
      prompt: buildPromptWithParamHints(draft, true),
      n: draft.params.count,
      size: ratioToOpenAISize(draft),
      quality: draft.params.quality === "auto" ? undefined : draft.params.quality,
      response_format: draft.params.responseFormat
    };

    draft.model.request.includeFields.forEach((field) => {
      const value = knownFields[field];

      if (value !== undefined) {
        body[field] = value;
      }
    });

    Object.entries(draft.params.customParams ?? {}).forEach(([field, value]) => {
      if (value !== undefined) {
        body[field] = value;
      }
    });

    if (draft.referenceImages.length > 0 && draft.model.request.imageInputMode !== "none") {
      body.images = draft.referenceImages.map(referenceToTransportValue);
    }

    draft.model.request.omitFields.forEach((field) => {
      delete body[field];
    });

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
    return parseConfiguredImageResponse(response, draft);
  },

  buildCurl(draft: GenerationRequestDraft, options: CurlBuildOptions) {
    return buildCurlForRequest(this.buildRequest(draft), options);
  }
};
