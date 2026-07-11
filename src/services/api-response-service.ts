import type { ApiResponse } from "../domain";

type ApiResponseParseOptions = {
  requestLabel: string;
};

export async function readApiResponse<T>(
  response: Response,
  options: ApiResponseParseOptions
): Promise<ApiResponse<T>> {
  let rawText = "";

  try {
    rawText = await response.text();
  } catch (error) {
    return createInvalidApiResponse<T>({
      code: "API_RESPONSE_READ_FAILED",
      title: "读取响应失败",
      message: `${options.requestLabel} 响应读取失败：${getErrorMessage(error)}`,
      statusCode: response.status,
      retryable: true
    });
  }

  if (!rawText.trim()) {
    return createInvalidApiResponse<T>({
      code: "EMPTY_API_RESPONSE",
      title: "接口返回空响应",
      message: `${options.requestLabel} 没有返回 JSON 内容，请检查本地 BFF、代理服务或上游是否中断连接。`,
      statusCode: response.status,
      retryable: true
    });
  }

  try {
    return JSON.parse(rawText) as ApiResponse<T>;
  } catch {
    return createInvalidApiResponse<T>({
      code: "INVALID_API_JSON",
      title: "接口返回非 JSON 响应",
      message: `${options.requestLabel} 返回内容不是合法 JSON，请检查接口路径、代理配置或服务端错误页。`,
      statusCode: response.status,
      retryable: true,
      rawExcerpt: rawText.slice(0, 300)
    });
  }
}

function createInvalidApiResponse<T>(input: {
  code: string;
  title: string;
  message: string;
  statusCode: number;
  retryable: boolean;
  rawExcerpt?: string;
}): ApiResponse<T> {
  return {
    success: false,
    requestId: `client-${Date.now()}`,
    serverTime: new Date().toISOString(),
    error: {
      id: `client-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: "network",
      code: input.code,
      title: input.title,
      message: input.message,
      retryable: input.retryable,
      statusCode: input.statusCode || undefined,
      rawExcerpt: input.rawExcerpt
    }
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "未知读取错误";
}
