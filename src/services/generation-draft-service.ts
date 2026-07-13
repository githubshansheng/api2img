import type {
  EndpointOverride,
  GenerationRequestDraft,
  GenerationRequestPayload,
  ModelConfig,
  PreparedReferenceImage
} from "../domain";

export type BuildGenerationRequestDraftInput = {
  payload: GenerationRequestPayload;
  model: ModelConfig;
  apiKey?: string;
  endpointOverride?: EndpointOverride;
};

export function buildGenerationRequestDraft(input: BuildGenerationRequestDraftInput): GenerationRequestDraft {
  return {
    requestId: input.payload.requestId ?? createRuntimeId(),
    mode: "single",
    model: input.model,
    prompt: input.payload.prompt?.trim() ?? "",
    negativePrompt: input.payload.negativePrompt?.trim() || undefined,
    referenceImages: prepareDraftReferences(input.payload.referenceImages),
    nativeMask: input.payload.nativeMask
      ? {
          image: prepareDraftReferences([input.payload.nativeMask.image])[0]!,
          sourceImageIndex: input.payload.nativeMask.sourceImageIndex,
          inverted: input.payload.nativeMask.inverted
        }
      : undefined,
    continuation: input.payload.continuation,
    params: input.payload.params,
    apiKey: input.apiKey,
    endpointOverride: input.endpointOverride ?? input.payload.endpointOverride,
    createdAt: Date.now()
  };
}

function prepareDraftReferences(referenceImages: GenerationRequestPayload["referenceImages"]): PreparedReferenceImage[] {
  return [...referenceImages]
    .sort((a, b) => a.order - b.order)
    .map((image, index) => ({
      id: image.id,
      name: image.name,
      mimeType: image.mimeType,
      format: image.format,
      sizeBytes: image.sizeBytes,
      width: image.width,
      height: image.height,
      base64: stripDataUrlPrefix(image.base64),
      remoteURL: image.remoteURL,
      order: index
    }));
}

function stripDataUrlPrefix(value?: string) {
  if (!value) {
    return undefined;
  }

  const marker = ";base64,";
  const markerIndex = value.indexOf(marker);

  if (markerIndex < 0) {
    return value;
  }

  return value.slice(markerIndex + marker.length);
}

function createRuntimeId() {
  return globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
