import type { ApiError, ApiResponse, CreateGenerationResponse, GenerationError, GenerationRequestPayload } from "../domain";
import type {
  ReasoningRequestPayload,
  RecognitionRequestPayload,
  ResponsesRequestResult
} from "./responses-api-service";
import { readApiResponse } from "./api-response-service";

export class GenerationApiError extends Error {
  apiError?: ApiError | GenerationError;

  constructor(message: string, apiError?: ApiError | GenerationError) {
    super(message);
    this.name = "GenerationApiError";
    this.apiError = apiError;
  }
}

export async function createGenerationRequest(
  payload: GenerationRequestPayload
): Promise<CreateGenerationResponse> {
  const response = await fetch("/api/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const body = await readApiResponse<CreateGenerationResponse>(response, {
    requestLabel: "创建生成请求"
  });

  if (!response.ok || !body.success || !body.data) {
    throw new GenerationApiError(body.error?.message ?? "创建生成请求失败", body.error);
  }

  return body.data;
}

export async function analyzeRecognitionRequest(
  payload: RecognitionRequestPayload,
  signal?: AbortSignal
): Promise<ResponsesRequestResult> {
  return postJsonApi<RecognitionRequestPayload, ResponsesRequestResult>("/api/recognition/analyze", payload, signal);
}

export async function runReasoningRequest(
  payload: ReasoningRequestPayload,
  signal?: AbortSignal
): Promise<ResponsesRequestResult> {
  return postJsonApi<ReasoningRequestPayload, ResponsesRequestResult>("/api/reasoning/test", payload, signal);
}

async function postJsonApi<TPayload, TResult>(
  path: string,
  payload: TPayload,
  signal?: AbortSignal
): Promise<TResult> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    signal,
    body: JSON.stringify(payload)
  });
  const body = await readApiResponse<TResult>(response, {
    requestLabel: path
  });

  if (!response.ok || !body.success || !body.data) {
    throw new GenerationApiError(body.error?.message ?? "API request failed", body.error);
  }

  return body.data;
}
