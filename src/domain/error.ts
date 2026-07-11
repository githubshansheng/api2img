import type { ErrorType } from "./common";

export type ApiError = {
  id: string;
  type: ErrorType;
  code: string;
  title: string;
  message: string;
  suggestion?: string;
  retryable: boolean;
  mayHaveCharged?: boolean;
  safeDetails?: string;
  createdAt?: number;
};

export type GenerationError = ApiError & {
  statusCode?: number;
  upstreamStatus?: number;
  upstreamCode?: string;
  finishReason?: string;
  field?: string;
  rawExcerpt?: string;
};

export type ApiResponse<T> = {
  success: boolean;
  requestId: string;
  serverTime: string;
  data?: T;
  error?: ApiError | GenerationError;
};
