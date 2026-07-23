export type DebugLogLevel = "debug" | "info" | "warn" | "error";

export type DebugLogCategory =
  | "app"
  | "network"
  | "runtime"
  | "single-view";

export type DebugLogEntry = {
  id: string;
  timestamp: string;
  level: DebugLogLevel;
  category: DebugLogCategory;
  message: string;
  requestId?: string;
  durationMs?: number;
  details?: Record<string, unknown>;
};

export type DebugLogInput = Omit<DebugLogEntry, "id" | "timestamp"> & {
  timestamp?: string;
};

const DEBUG_LOG_STORAGE_KEY = "api2image.frontend-debug-log.v1";
const DEBUG_LOG_LIMIT = 300;
const DEBUG_PANEL_OPEN_EVENT = "api2image:open-debug-log";
const SENSITIVE_KEY_PATTERN =
  /(?:api[_-]?key|authorization|cookie|password|secret|session|token)/i;
const IMAGE_DATA_KEY_PATTERN =
  /^(?:image|source_image|pose_guide_image|camera_pose_image|mask_image|original_image|base_image|sourceImage|poseGuideImage|cameraPoseImage|maskImage|originalImage|baseImage|dataURL|base64|binary|blob|fileContent)$/i;
const SAFE_QUERY_PARAMETERS = new Set(["page", "stream"]);
const listeners = new Set<(entries: DebugLogEntry[]) => void>();
let sequence = 0;
let entries = loadStoredEntries();

type DebugWindow = Window & {
  __api2ImageDebugLoggingInstalled?: boolean;
};

export function appendDebugLog(input: DebugLogInput) {
  const entry: DebugLogEntry = {
    id: `${Date.now().toString(36)}-${(sequence++).toString(36)}`,
    timestamp: input.timestamp ?? new Date().toISOString(),
    level: input.level,
    category: input.category,
    message: sanitizeDebugString(input.message, 800),
    requestId: input.requestId
      ? sanitizeDebugString(input.requestId, 160)
      : undefined,
    durationMs:
      typeof input.durationMs === "number" &&
      Number.isFinite(input.durationMs)
        ? Math.max(0, Math.round(input.durationMs))
        : undefined,
    details: input.details
      ? (sanitizeDebugValue(input.details) as Record<string, unknown>)
      : undefined
  };

  entries = [...entries, entry].slice(-DEBUG_LOG_LIMIT);
  persistEntries();
  notifyListeners();
  return entry;
}

export function getDebugLogs() {
  return [...entries];
}

export function subscribeDebugLogs(
  listener: (nextEntries: DebugLogEntry[]) => void
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearDebugLogs() {
  entries = [];
  persistEntries();
  notifyListeners();
}

export function openFrontendDebugPanel() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DEBUG_PANEL_OPEN_EVENT));
  }
}

export function subscribeFrontendDebugPanelOpen(listener: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  window.addEventListener(DEBUG_PANEL_OPEN_EVENT, listener);
  return () => window.removeEventListener(DEBUG_PANEL_OPEN_EVENT, listener);
}

export function formatDebugLogExport(logs = getDebugLogs()) {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      environment: getFrontendDebugEnvironment(),
      entries: logs
    },
    null,
    2
  );
}

export function getFrontendDebugEnvironment() {
  if (typeof window === "undefined") {
    return {
      runtime: "non-browser"
    };
  }

  return {
    origin: window.location.origin,
    path: sanitizeDebugUrl(window.location.href),
    online: navigator.onLine,
    language: navigator.language,
    userAgent: sanitizeDebugString(navigator.userAgent, 500),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio
    }
  };
}

export async function runFrontendConnectionCheck() {
  const startedAt = Date.now();
  appendDebugLog({
    level: "info",
    category: "runtime",
    message: "开始前端连接自检",
    details: getFrontendDebugEnvironment()
  });

  try {
    const response = await fetch("/api/health", {
      cache: "no-store",
      headers: {
        "X-Frontend-Debug-Probe": "1"
      }
    });
    const body = (await response.json().catch(() => undefined)) as
      | Record<string, unknown>
      | undefined;
    const result = appendDebugLog({
      level: response.ok ? "info" : "error",
      category: "runtime",
      message: response.ok ? "前端连接自检通过" : "前端连接自检失败",
      durationMs: Date.now() - startedAt,
      details: {
        endpoint: "/api/health",
        status: response.status,
        statusText: response.statusText,
        response: body
      }
    });

    return {
      ok: response.ok,
      entry: result
    };
  } catch (error) {
    const result = appendDebugLog({
      level: "error",
      category: "runtime",
      message: "前端连接自检无法访问后端",
      durationMs: Date.now() - startedAt,
      details: {
        endpoint: "/api/health",
        online: navigator.onLine,
        error: describeDebugError(error)
      }
    });

    return {
      ok: false,
      entry: result
    };
  }
}

export function installFrontendDebugLogging() {
  if (typeof window === "undefined") {
    return;
  }

  const debugWindow = window as DebugWindow;

  if (debugWindow.__api2ImageDebugLoggingInstalled) {
    return;
  }

  debugWindow.__api2ImageDebugLoggingInstalled = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => {
    const startedAt = Date.now();
    const request = input instanceof Request ? input : undefined;
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const endpoint = sanitizeDebugUrl(rawUrl);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const requestDetails = {
      endpoint,
      method,
      body: describeRequestBody(init?.body),
      headerNames: collectHeaderNames(init?.headers ?? request?.headers)
    };

    appendDebugLog({
      level: "debug",
      category: "network",
      message: `${method} ${endpoint} 请求开始`,
      details: requestDetails
    });

    try {
      const response = await originalFetch(input, init);
      const durationMs = Date.now() - startedAt;
      const requestId =
        response.headers.get("x-request-id") ??
        response.headers.get("request-id") ??
        undefined;

      appendDebugLog({
        level: response.ok
          ? "info"
          : response.status >= 500
            ? "error"
            : "warn",
        category: "network",
        message: `${method} ${endpoint} 返回 ${response.status}`,
        requestId,
        durationMs,
        details: {
          ...requestDetails,
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          redirected: response.redirected,
          responseType: response.type,
          contentType: response.headers.get("content-type"),
          contentLength: response.headers.get("content-length"),
          retryAfter: response.headers.get("retry-after")
        }
      });

      return response;
    } catch (error) {
      const aborted =
        error instanceof DOMException
          ? error.name === "AbortError"
          : error instanceof Error && error.name === "AbortError";

      appendDebugLog({
        level: aborted ? "warn" : "error",
        category: "network",
        message: aborted
          ? `${method} ${endpoint} 请求已取消`
          : `${method} ${endpoint} 网络请求失败`,
        durationMs: Date.now() - startedAt,
        details: {
          ...requestDetails,
          online: navigator.onLine,
          origin: window.location.origin,
          aborted,
          error: describeDebugError(error)
        }
      });

      throw error;
    }
  }) as typeof window.fetch;

  window.addEventListener("error", (event) => {
    appendDebugLog({
      level: "error",
      category: "runtime",
      message: "浏览器运行时错误",
      details: {
        message: event.message,
        file: event.filename ? sanitizeDebugUrl(event.filename) : undefined,
        line: event.lineno,
        column: event.colno,
        error: describeDebugError(event.error)
      }
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    appendDebugLog({
      level: "error",
      category: "runtime",
      message: "未处理的 Promise 拒绝",
      details: {
        error: describeDebugError(event.reason)
      }
    });
  });

  window.addEventListener("online", () => {
    appendDebugLog({
      level: "info",
      category: "runtime",
      message: "浏览器网络状态恢复为在线"
    });
  });

  window.addEventListener("offline", () => {
    appendDebugLog({
      level: "warn",
      category: "runtime",
      message: "浏览器网络状态变为离线"
    });
  });

  appendDebugLog({
    level: "info",
    category: "app",
    message: "前端 Debug 日志已启用",
    details: getFrontendDebugEnvironment()
  });
}

export function sanitizeDebugUrl(value: string) {
  try {
    const base =
      typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost";
    const url = new URL(value, base);

    for (const [key] of [...url.searchParams.entries()]) {
      if (!SAFE_QUERY_PARAMETERS.has(key)) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }

    if (
      typeof window !== "undefined" &&
      url.origin === window.location.origin
    ) {
      return `${url.pathname}${url.search}${url.hash}`;
    }

    return url.toString();
  } catch {
    return sanitizeDebugString(value, 600);
  }
}

export function sanitizeDebugValue(
  value: unknown,
  key = "",
  depth = 0,
  seen = new WeakSet<object>()
): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return "[REDACTED]";
  }

  if (IMAGE_DATA_KEY_PATTERN.test(key)) {
    return describeBinaryLikeValue(value);
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return sanitizeDebugString(value);
  }

  if (typeof value === "undefined") {
    return undefined;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return `[${typeof value}]`;
  }

  if (value instanceof Error) {
    return describeDebugError(value);
  }

  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return {
      type: value.type || "application/octet-stream",
      size: value.size
    };
  }

  if (depth >= 5) {
    return "[MAX_DEPTH]";
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[CIRCULAR]";
    }

    seen.add(value);

    if (Array.isArray(value)) {
      return value
        .slice(0, 40)
        .map((item) => sanitizeDebugValue(item, key, depth + 1, seen));
    }

    const next: Record<string, unknown> = {};

    for (const [entryKey, entryValue] of Object.entries(value).slice(0, 60)) {
      next[entryKey] = sanitizeDebugValue(
        entryValue,
        entryKey,
        depth + 1,
        seen
      );
    }

    return next;
  }

  return sanitizeDebugString(String(value));
}

export function describeDebugError(error: unknown) {
  if (error instanceof Error) {
    const cause =
      "cause" in error && error.cause !== undefined
        ? sanitizeDebugValue(error.cause, "cause")
        : undefined;

    return {
      name: error.name,
      message: sanitizeDebugString(error.message, 1200),
      stack: error.stack
        ? sanitizeDebugString(error.stack, 4000)
        : undefined,
      cause
    };
  }

  return sanitizeDebugValue(error, "error");
}

function sanitizeDebugString(value: string, maxLength = 1600) {
  const trimmed = value
    .replace(
      /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi,
      "[IMAGE_DATA_URL_REDACTED]"
    )
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[a-z0-9_-]{12,}\b/gi, "[API_KEY_REDACTED]");

  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength)}...[TRUNCATED ${trimmed.length - maxLength} chars]`
    : trimmed;
}

function describeBinaryLikeValue(value: unknown) {
  if (typeof value === "string") {
    if (value.startsWith("data:")) {
      const separator = value.indexOf(";");
      const mimeType = value.slice(5, separator > 0 ? separator : 80);
      return `[DATA_URL_REDACTED type=${mimeType || "unknown"} chars=${value.length}]`;
    }

    return `[CONTENT_REDACTED chars=${value.length}]`;
  }

  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return `[BLOB_REDACTED type=${value.type || "unknown"} bytes=${value.size}]`;
  }

  return "[BINARY_CONTENT_REDACTED]";
}

function describeRequestBody(body?: BodyInit | null) {
  if (!body) {
    return {
      type: "none",
      size: 0
    };
  }

  if (typeof body === "string") {
    return {
      type: "string",
      size: body.length
    };
  }

  if (body instanceof URLSearchParams) {
    return {
      type: "url-search-params",
      size: body.toString().length
    };
  }

  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return {
      type: "blob",
      size: body.size,
      mimeType: body.type
    };
  }

  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return {
      type: "form-data",
      fieldNames: [...body.keys()].slice(0, 40)
    };
  }

  if (body instanceof ArrayBuffer) {
    return {
      type: "array-buffer",
      size: body.byteLength
    };
  }

  if (ArrayBuffer.isView(body)) {
    return {
      type: body.constructor.name,
      size: body.byteLength
    };
  }

  return {
    type: body.constructor?.name ?? typeof body
  };
}

function collectHeaderNames(headers?: HeadersInit) {
  if (!headers) {
    return [];
  }

  try {
    return [...new Headers(headers).keys()].slice(0, 40);
  } catch {
    return ["[UNREADABLE_HEADERS]"];
  }
}

function loadStoredEntries(): DebugLogEntry[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(DEBUG_LOG_STORAGE_KEY) ?? "[]"
    ) as unknown;

    return Array.isArray(parsed)
      ? (parsed as DebugLogEntry[]).slice(-DEBUG_LOG_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function persistEntries() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(
      DEBUG_LOG_STORAGE_KEY,
      JSON.stringify(entries)
    );
  } catch {
    // Debug logging must never interrupt the primary workflow.
  }
}

function notifyListeners() {
  const snapshot = getDebugLogs();

  for (const listener of listeners) {
    listener(snapshot);
  }
}
