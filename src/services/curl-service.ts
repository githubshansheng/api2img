import { selectImageAdapter } from "../adapters";
import type {
  CurlState,
  EndpointOverride,
  GenerationParams,
  ModelConfig,
  ModelRequestOverride,
  ReferenceImage
} from "../domain";
import { buildGenerationRequestDraft } from "./generation-draft-service";
import { buildGenerationRequestPayload } from "./generation-form-service";
import { applyModelRequestOverride } from "./model-settings-service";

export const CURL_PLACEHOLDER_KEY = "sk-YOUR_API_KEY";

export type BuildCurlPreviewInput = {
  model: ModelConfig;
  prompt: string;
  negativePrompt?: string;
  referenceImages: ReferenceImage[];
  params: GenerationParams;
  apiKey?: string;
  endpointOverride?: EndpointOverride;
  modelOverride?: ModelRequestOverride;
  showRealKey: boolean;
};

export function buildCurlPreview(input: BuildCurlPreviewInput): CurlState {
  const runtimeModel = applyModelRequestOverride(input.model, input.modelOverride);
  const adapter = selectImageAdapter(runtimeModel);

  if (!adapter) {
    return {
      code: "",
      endpoint: runtimeModel.baseURL,
      method: "POST",
      showRealKey: input.showRealKey,
      copyStatus: "idle",
      requestModelName: runtimeModel.apiModelName,
      warning: "当前模型没有可用 cURL 适配器。"
    };
  }

  const payload = buildGenerationRequestPayload({
    model: runtimeModel,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    referenceImages: input.referenceImages,
    params: input.params,
    endpointOverride: input.endpointOverride,
    requestId: "curl-preview"
  });
  const draft = buildGenerationRequestDraft({
    payload,
    model: runtimeModel,
    apiKey: input.showRealKey ? input.apiKey : undefined,
    endpointOverride: {
      ...input.endpointOverride,
      apiKey: input.showRealKey ? input.endpointOverride?.apiKey : undefined
    }
  });
  const request = adapter.buildRequest(draft);
  const bodyFields = isRecord(request.body) ? Object.keys(request.body) : [];

  return {
    code: adapter.buildCurl(draft, {
      showRealKey: input.showRealKey,
      placeholderKey: CURL_PLACEHOLDER_KEY,
      pretty: true
    }),
    endpoint: request.url,
    method: request.method,
    showRealKey: input.showRealKey,
    copyStatus: "idle",
    warning: buildCurlWarning({
      model: runtimeModel,
      params: input.params,
      bodyFields,
      referenceImages: input.referenceImages
    }),
    adapterName: adapter.name,
    bodyFields,
    requestModelName: runtimeModel.apiModelName
  };
}

function buildCurlWarning(input: {
  model: ModelConfig;
  params: GenerationParams;
  bodyFields: string[];
  referenceImages: ReferenceImage[];
}) {
  const warnings: string[] = [];
  const bodyFieldSet = new Set(input.bodyFields);

  if (
    input.params.responseFormat &&
    input.model.request.removeResponseFormatWhenUnsupported &&
    !bodyFieldSet.has("response_format")
  ) {
    warnings.push("当前端点不接受 response_format，已自动移除。");
  }

  const omittedFields = input.model.request.omitFields.filter((field) => !bodyFieldSet.has(field));

  if (omittedFields.length > 0) {
    warnings.push(`已按模型限制移除 ${omittedFields.join(", ")}。`);
  }

  if (
    input.referenceImages.length > 0 &&
    input.referenceImages.some((image) => !image.base64 && !image.remoteURL)
  ) {
    warnings.push("本地参考图将在提交时转换，cURL 仅展示请求结构。");
  }

  return warnings[0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
