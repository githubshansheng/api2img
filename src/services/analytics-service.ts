export type AnalyticsEventName =
  | "generation_started"
  | "batch_started"
  | "curl_copied"
  | "prompt_template_opened"
  | "prompt_template_used"
  | "zip_download_started"
  | "zip_download_finished"
  | "history_detail_opened"
  | "asset_template_saved"
  | "asset_template_used"
  | "compare_started"
  | "recognition_draft_created"
  | "image_recognition_started"
  | "image_recognition_completed"
  | "reasoning_draft_created"
  | "reasoning_request_started"
  | "reasoning_request_completed"
  | "storage_settings_tested";

export type AnalyticsEvent = {
  id: string;
  name: AnalyticsEventName;
  createdAt: string;
  properties: Record<string, string | number | boolean>;
};

export type AnalyticsSummary = {
  totalEvents: number;
  templateUseCount: number;
  curlCopyCount: number;
  zipDownloadCount: number;
  batchStartCount: number;
  recentEvents: AnalyticsEvent[];
};

const ANALYTICS_STORAGE_KEY = "api2image:analytics:v1";
const MAX_ANALYTICS_EVENTS = 200;

function canUseLocalStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function createEventId() {
  return globalThis.crypto?.randomUUID?.() ?? `event-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizePropertyValue(value: unknown): string | number | boolean | undefined {
  if (typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const compact = value.replace(/\s+/g, " ").trim();

  if (!compact) {
    return undefined;
  }

  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

function sanitizeProperties(properties?: Record<string, unknown>) {
  const safeEntries = Object.entries(properties ?? {})
    .map(([key, value]) => [key, sanitizePropertyValue(value)] as const)
    .filter((entry): entry is readonly [string, string | number | boolean] => entry[1] !== undefined);

  return Object.fromEntries(safeEntries);
}

function sanitizeEvents(events: AnalyticsEvent[]) {
  return events
    .filter((event) => event?.id && event?.name && event?.createdAt)
    .map((event) => ({
      ...event,
      properties: sanitizeProperties(event.properties)
    }))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, MAX_ANALYTICS_EVENTS);
}

export function loadAnalyticsEvents(): AnalyticsEvent[] {
  if (!canUseLocalStorage()) {
    return [];
  }

  const raw = window.localStorage.getItem(ANALYTICS_STORAGE_KEY);

  if (!raw) {
    return [];
  }

  try {
    const events = JSON.parse(raw) as AnalyticsEvent[];
    return Array.isArray(events) ? sanitizeEvents(events) : [];
  } catch {
    return [];
  }
}

export function logAnalyticsEvent(
  name: AnalyticsEventName,
  properties?: Record<string, unknown>
): AnalyticsEvent[] {
  const event: AnalyticsEvent = {
    id: createEventId(),
    name,
    createdAt: new Date().toISOString(),
    properties: sanitizeProperties(properties)
  };
  const events = sanitizeEvents([event, ...loadAnalyticsEvents()]);

  if (canUseLocalStorage()) {
    window.localStorage.setItem(ANALYTICS_STORAGE_KEY, JSON.stringify(events));
  }

  return events;
}

export function clearAnalyticsEvents() {
  if (canUseLocalStorage()) {
    window.localStorage.removeItem(ANALYTICS_STORAGE_KEY);
  }

  return [];
}

export function summarizeAnalyticsEvents(events = loadAnalyticsEvents()): AnalyticsSummary {
  return {
    totalEvents: events.length,
    templateUseCount: events.filter((event) => event.name === "prompt_template_used").length,
    curlCopyCount: events.filter((event) => event.name === "curl_copied").length,
    zipDownloadCount: events.filter((event) => event.name === "zip_download_finished").length,
    batchStartCount: events.filter((event) => event.name === "batch_started").length,
    recentEvents: events.slice(0, 8)
  };
}
