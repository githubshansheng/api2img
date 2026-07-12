import type { AdapterHttpRequest, AdapterHttpResponse } from "../src/domain";
import { findInvalidHeaderValueCharacter } from "../src/services/http-header-service";

export async function sendAdapterHttpRequest(
  request: AdapterHttpRequest,
  externalSignal?: AbortSignal
): Promise<AdapterHttpResponse> {
  const startedAt = Date.now();
  const invalidHeader = findInvalidAdapterHeader(request);

  if (invalidHeader) {
    return {
      statusCode: 400,
      headers: {},
      body: {
        error: {
          code: "INVALID_HTTP_HEADER_VALUE",
          message:
            invalidHeader.name.toLowerCase() === "authorization"
              ? "API Key 包含中文、换行或其它非法请求头字符，请重新粘贴真实 Key。"
              : `请求头 ${invalidHeader.name} 包含非法字符，请检查模型配置。`
        }
      },
      durationMs: Date.now() - startedAt
    };
  }

  const controller = new AbortController();
  let timeoutReached = false;
  let externallyCancelled = false;
  const timeout = setTimeout(() => {
    timeoutReached = true;
    controller.abort();
  }, request.timeoutMs);
  const handleExternalAbort = () => {
    externallyCancelled = true;
    controller.abort();
  };

  externalSignal?.addEventListener("abort", handleExternalAbort, { once: true });

  if (externalSignal?.aborted) {
    handleExternalAbort();
  }

  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: serializeAdapterRequestBody(request),
      signal: controller.signal
    });

    return {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await parseUpstreamBody(response),
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    const statusCode = externallyCancelled ? 499 : timeoutReached ? 504 : 502;
    const code = externallyCancelled
      ? "REQUEST_CANCELLED"
      : timeoutReached
        ? "UPSTREAM_TIMEOUT"
        : "UPSTREAM_REQUEST_FAILED";
    const message = externallyCancelled
      ? "生成请求已取消。"
      : timeoutReached
        ? "上游生成请求超时。"
        : getErrorMessage(error);

    return {
      statusCode,
      headers: {},
      body: {
        error: {
          code,
          message,
          details: buildUpstreamFailureDetails(error, request)
        }
      },
      durationMs: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", handleExternalAbort);
  }
}

function findInvalidAdapterHeader(request: AdapterHttpRequest) {
  for (const [name, value] of Object.entries(request.headers)) {
    const invalid = findInvalidHeaderValueCharacter(value);

    if (invalid) {
      return {
        name,
        value,
        invalid
      };
    }
  }

  return undefined;
}

function serializeAdapterRequestBody(request: AdapterHttpRequest) {
  if (typeof request.body === "string") {
    return request.body;
  }

  if (request.body instanceof FormData) {
    return request.body;
  }

  return JSON.stringify(request.body);
}

async function parseUpstreamBody(response: Response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return { rawText: text };
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { rawText: text };
  }
}

function getErrorName(error: unknown) {
  if (typeof error === "object" && error !== null && "name" in error) {
    return String((error as { name?: unknown }).name);
  }

  return "";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "无法连接上游图片生成服务。";
}

function buildUpstreamFailureDetails(error: unknown, request: AdapterHttpRequest) {
  return [
    "source=bff",
    `target=${describeRequestTarget(request.url)}`,
    `method=${request.method}`,
    `timeoutMs=${request.timeoutMs}`,
    getErrorName(error) ? `error.name=${truncateDiagnosticValue(getErrorName(error), 80)}` : undefined,
    getErrorCauseCode(error) ? `cause.code=${truncateDiagnosticValue(getErrorCauseCode(error) ?? "", 80)}` : undefined,
    getErrorCauseMessage(error)
      ? `cause.message=${truncateDiagnosticValue(getErrorCauseMessage(error) ?? "", 160)}`
      : undefined
  ]
    .filter(Boolean)
    .join("; ");
}

function describeRequestTarget(url: string) {
  try {
    const parsed = new URL(url);

    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return truncateDiagnosticValue(url.split("?")[0] ?? url, 160);
  }
}

function getErrorCauseCode(error: unknown) {
  const cause = error instanceof Error ? error.cause : undefined;

  if (typeof cause === "object" && cause !== null && "code" in cause) {
    return String((cause as { code?: unknown }).code);
  }

  return undefined;
}

function getErrorCauseMessage(error: unknown) {
  const cause = error instanceof Error ? error.cause : undefined;

  if (cause instanceof Error && cause.message) {
    return cause.message;
  }

  if (typeof cause === "object" && cause !== null && "message" in cause) {
    return String((cause as { message?: unknown }).message);
  }

  return undefined;
}

function truncateDiagnosticValue(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
