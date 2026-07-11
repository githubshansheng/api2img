import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAnalyticsEvents,
  loadAnalyticsEvents,
  logAnalyticsEvent,
  summarizeAnalyticsEvents
} from "../../services/analytics-service";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    })
  };
}

describe("analytics service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores sanitized events and trims long string properties", () => {
    vi.stubGlobal("window", {
      localStorage: createMemoryStorage()
    });

    const longPrompt = `${"小金毛".repeat(60)}\n  多余空白`;
    const events = logAnalyticsEvent("prompt_template_used", {
      prompt: longPrompt,
      count: 2,
      enabled: true,
      ignored: { nested: true },
      blank: "   "
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.properties.count).toBe(2);
    expect(events[0]?.properties.enabled).toBe(true);
    expect(events[0]?.properties.prompt).toMatch(/\.\.\.$/);
    expect(String(events[0]?.properties.prompt).length).toBeLessThanOrEqual(120);
    expect(events[0]?.properties).not.toHaveProperty("ignored");
    expect(events[0]?.properties).not.toHaveProperty("blank");
    expect(loadAnalyticsEvents()).toHaveLength(1);
  });

  it("summarizes important milestone events", () => {
    vi.stubGlobal("window", {
      localStorage: createMemoryStorage()
    });

    logAnalyticsEvent("batch_started");
    logAnalyticsEvent("curl_copied");
    logAnalyticsEvent("zip_download_finished");
    logAnalyticsEvent("prompt_template_used");

    const summary = summarizeAnalyticsEvents();

    expect(summary.totalEvents).toBe(4);
    expect(summary.batchStartCount).toBe(1);
    expect(summary.curlCopyCount).toBe(1);
    expect(summary.zipDownloadCount).toBe(1);
    expect(summary.templateUseCount).toBe(1);
    expect(summary.recentEvents).toHaveLength(4);
  });

  it("keeps the newest 200 events and can clear them", () => {
    vi.stubGlobal("window", {
      localStorage: createMemoryStorage()
    });

    for (let index = 0; index < 205; index += 1) {
      logAnalyticsEvent("curl_copied", { index });
    }

    expect(loadAnalyticsEvents()).toHaveLength(200);
    expect(clearAnalyticsEvents()).toEqual([]);
    expect(loadAnalyticsEvents()).toEqual([]);
  });
});
