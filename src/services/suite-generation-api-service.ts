import type {
  ApiError,
  CreateGenerationSuiteRequest,
  GenerationError,
  GenerationSet,
  GenerationSuiteEvent,
  GenerationSuiteTemplate,
  RetryGenerationSuiteSlotRequest,
  SelectSuiteAnchorRequest,
  StartGenerationSuiteRequest,
  UpdateGenerationSuiteRequest
} from "../domain";
import { readApiResponse } from "./api-response-service";

const SUITE_API_BASE = "/api/generation-suites";

export class GenerationSuiteApiError extends Error {
  readonly apiError?: ApiError | GenerationError;

  constructor(message: string, apiError?: ApiError | GenerationError) {
    super(message);
    this.name = "GenerationSuiteApiError";
    this.apiError = apiError;
  }
}

export function listGenerationSuiteTemplates() {
  return requestSuiteApi<GenerationSuiteTemplate[]>(`${SUITE_API_BASE}/templates`, {
    requestLabel: "获取套图模板"
  });
}

export function listGenerationSuites(limit = 50) {
  return requestSuiteApi<GenerationSet[]>(`${SUITE_API_BASE}?limit=${encodeURIComponent(limit)}`, {
    requestLabel: "获取套图记录"
  });
}

export function getGenerationSuite(id: string) {
  return requestSuiteApi<GenerationSet>(`${SUITE_API_BASE}/${encodeURIComponent(id)}`, {
    requestLabel: "获取套图详情"
  });
}

export function createGenerationSuite(payload: CreateGenerationSuiteRequest) {
  return requestSuiteApi<GenerationSet>(SUITE_API_BASE, {
    method: "POST",
    body: payload,
    requestLabel: "创建套图"
  });
}

export function updateGenerationSuite(id: string, payload: UpdateGenerationSuiteRequest) {
  return requestSuiteApi<GenerationSet>(`${SUITE_API_BASE}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: payload,
    requestLabel: "更新套图"
  });
}

export function startGenerationSuite(id: string, payload: StartGenerationSuiteRequest) {
  return requestSuiteApi<GenerationSet>(`${SUITE_API_BASE}/${encodeURIComponent(id)}/start`, {
    method: "POST",
    body: payload,
    requestLabel: "开始套图生成"
  });
}

export function selectGenerationSuiteAnchor(id: string, payload: SelectSuiteAnchorRequest) {
  return requestSuiteApi<GenerationSet>(`${SUITE_API_BASE}/${encodeURIComponent(id)}/anchor`, {
    method: "POST",
    body: payload,
    requestLabel: "确认主视觉锚点"
  });
}

export function retryGenerationSuiteSlot(
  id: string,
  slotId: string,
  payload: RetryGenerationSuiteSlotRequest
) {
  return requestSuiteApi<GenerationSet>(
    `${SUITE_API_BASE}/${encodeURIComponent(id)}/slots/${encodeURIComponent(slotId)}/retry`,
    {
      method: "POST",
      body: payload,
      requestLabel: "重试套图场景"
    }
  );
}

export function cancelGenerationSuite(id: string) {
  return requestSuiteApi<GenerationSet>(`${SUITE_API_BASE}/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: {},
    requestLabel: "取消套图生成"
  });
}

export function deleteGenerationSuite(id: string) {
  return requestSuiteApi<{ id: string; deleted: boolean }>(
    `${SUITE_API_BASE}/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      requestLabel: "删除套图"
    }
  );
}

export function subscribeGenerationSuiteEvents(
  id: string,
  handlers: {
    onEvent: (event: GenerationSuiteEvent) => void;
    onOpen?: () => void;
    onError?: () => void;
  }
) {
  const source = new EventSource(`${SUITE_API_BASE}/${encodeURIComponent(id)}/events`);

  source.onopen = () => {
    handlers.onOpen?.();
  };
  source.onmessage = (message) => {
    try {
      handlers.onEvent(JSON.parse(message.data) as GenerationSuiteEvent);
    } catch {
      handlers.onError?.();
    }
  };
  source.onerror = () => {
    handlers.onError?.();
  };

  return () => source.close();
}

async function requestSuiteApi<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    requestLabel: string;
  }
) {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const body = await readApiResponse<T>(response, {
    requestLabel: options.requestLabel
  });

  if (!response.ok || !body.success || body.data === undefined) {
    throw new GenerationSuiteApiError(body.error?.message ?? `${options.requestLabel}失败`, body.error);
  }

  return body.data;
}
