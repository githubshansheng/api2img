import { selectImageAdapter, summarizeAdapterRequest } from "../src/adapters";
import { getModelById } from "../src/config/models";
import { createDefaultGenerationParams } from "../src/domain";
import type {
  CreateGenerationResponse,
  GenerationError,
  GenerationRequestPayload
} from "../src/domain";
import { createGenerationError } from "../src/services/error-service";
import { buildGenerationRequestDraft } from "../src/services/generation-draft-service";
import {
  buildAcceptedGenerationResponse,
  defaultGenerationServerOptions,
  estimateGenerationCost,
  validateGenerationForm
} from "../src/services/generation-form-service";
import { applyModelRequestOverride } from "../src/services/model-settings-service";
import { sendAdapterHttpRequest } from "./adapter-http";

export type GenerationExecutionSuccess = {
  success: true;
  statusCode: 202;
  requestId: string;
  data: CreateGenerationResponse;
};

export type GenerationExecutionFailure = {
  success: false;
  statusCode: number;
  requestId: string;
  error: GenerationError;
};

export type GenerationExecutionResult = GenerationExecutionSuccess | GenerationExecutionFailure;

export async function executeGenerationRequest(
  input: Partial<GenerationRequestPayload>,
  signal?: AbortSignal
): Promise<GenerationExecutionResult> {
  const requestId = input.requestId ?? crypto.randomUUID();
  const model = input.modelId ? getModelById(input.modelId) : undefined;

  if (!model || !model.enabled) {
    return failure(
      400,
      requestId,
      "MODEL_NOT_FOUND",
      "模型不可用",
      "请选择一个可用模型后再创建生成请求"
    );
  }

  const runtimeModel = applyModelRequestOverride(model, input.modelOverride);
  const payload: GenerationRequestPayload = {
    requestId,
    modelId: runtimeModel.id,
    prompt: input.prompt ?? "",
    negativePrompt: input.negativePrompt,
    referenceImages: Array.isArray(input.referenceImages) ? input.referenceImages : [],
    params: input.params ?? createDefaultGenerationParams(runtimeModel),
    endpointOverride: input.endpointOverride,
    modelOverride: input.modelOverride,
    options: {
      ...defaultGenerationServerOptions,
      ...input.options
    },
    clientContext: input.clientContext
  };
  const validation = validateGenerationForm({
    model: runtimeModel,
    prompt: payload.prompt ?? "",
    referenceImages: payload.referenceImages,
    params: payload.params,
    requireApiKey: false
  });

  if (!validation.isValid) {
    const firstError = validation.errors[0];

    return {
      success: false,
      statusCode: 400,
      requestId,
      error: createGenerationError({
        type: "validation",
        code: firstError?.code ?? "GENERATION_VALIDATION_FAILED",
        title: "生成请求校验失败",
        message: firstError?.message ?? "请检查生成参数",
        retryable: false,
        statusCode: 400,
        safeDetails: validation.errors.map((issue) => `${issue.field}:${issue.code}`).join(";")
      })
    };
  }

  const costPreview = estimateGenerationCost(runtimeModel, payload.params);
  const accepted = buildAcceptedGenerationResponse(payload, costPreview, validation.warnings);
  const adapter = selectImageAdapter(runtimeModel);

  if (!adapter) {
    return failure(
      400,
      requestId,
      "ADAPTER_NOT_FOUND",
      "模型适配器不可用",
      "当前模型暂未配置可用的图片适配器"
    );
  }

  try {
    const draft = buildGenerationRequestDraft({
      payload,
      model: runtimeModel,
      apiKey: payload.endpointOverride?.apiKey,
      endpointOverride: payload.endpointOverride
    });
    const adapterRequest = adapter.buildRequest(draft);
    const upstreamResponse = await sendAdapterHttpRequest(adapterRequest, signal);
    const adapterResult = adapter.parseResponse(upstreamResponse, draft);

    return {
      success: true,
      statusCode: 202,
      requestId: accepted.requestId,
      data: {
        ...accepted,
        status: adapterResult.status,
        adapterRequest: summarizeAdapterRequest(adapter.name, adapterRequest, draft),
        result: adapterResult
      }
    };
  } catch (error) {
    return {
      success: false,
      statusCode: 500,
      requestId,
      error: createGenerationError({
        type: "unknown",
        code: "GENERATION_EXECUTION_FAILED",
        title: "生成请求执行失败",
        message: error instanceof Error ? error.message : "生成请求执行失败",
        retryable: true,
        statusCode: 500
      })
    };
  }
}

function failure(
  statusCode: number,
  requestId: string,
  code: string,
  title: string,
  message: string
): GenerationExecutionFailure {
  return {
    success: false,
    statusCode,
    requestId,
    error: createGenerationError({
      type: "validation",
      code,
      title,
      message,
      retryable: false,
      statusCode
    })
  };
}
