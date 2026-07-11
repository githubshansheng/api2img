import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerationError, GenerationParams } from "../../domain";
import {
  clearHistoryRecords,
  createHistoryRecord,
  loadHistoryRecords,
  saveHistoryRecord,
  toHistoryListItems
} from "../../services/history-service";

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

const params: GenerationParams = {
  ratio: "1:1",
  resolution: "1K",
  quality: "high",
  count: 1
};

describe("history service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves success records and exposes list summaries", () => {
    vi.stubGlobal("window", {
      localStorage: createMemoryStorage()
    });

    const record = createHistoryRecord({
      requestId: "req-success",
      status: "success",
      modelId: "gpt-image-2",
      modelDisplayName: "GPT Image 2",
      prompt: "  小金毛在海边晒太阳  ",
      params,
      resultImages: [
        {
          id: "img-1",
          sourceType: "url",
          url: "https://cdn.example/image.png",
          index: 0,
          temporary: true,
          saved: false,
          expiresAt: "2026-07-07T00:00:00.000Z"
        }
      ],
      estimatedCostText: "¥0.05",
      durationMs: 1234,
      acceptedAt: "2026-07-06T12:00:00.000Z"
    });

    const saved = saveHistoryRecord(record);
    const items = toHistoryListItems(saved);

    expect(loadHistoryRecords()).toHaveLength(1);
    expect(items[0]).toMatchObject({
      requestId: "req-success",
      status: "success",
      modelDisplayName: "GPT Image 2",
      promptSummary: "小金毛在海边晒太阳",
      thumbnailURL: "https://cdn.example/image.png",
      costText: "¥0.05",
      durationMs: 1234,
      temporary: true
    });
  });

  it("stores failed records with sanitized errors", () => {
    vi.stubGlobal("window", {
      localStorage: createMemoryStorage()
    });

    const error: GenerationError = {
      id: "err-1",
      type: "auth",
      code: "bad sk-secret-value",
      title: "API Key 认证失败",
      message: "Invalid token sk-secret-value",
      retryable: false,
      statusCode: 401,
      createdAt: Date.now()
    };
    const record = createHistoryRecord({
      requestId: "req-failed",
      status: "failed",
      modelId: "gpt-image-2",
      modelDisplayName: "GPT Image 2",
      prompt: "失败用例",
      params,
      error
    });

    saveHistoryRecord(record);
    const raw = JSON.stringify(loadHistoryRecords());

    expect(raw).toContain("req-failed");
    expect(raw).not.toContain("sk-secret-value");
    expect(loadHistoryRecords()[0]?.error?.statusCode).toBe(401);
  });

  it("clears history records", () => {
    vi.stubGlobal("window", {
      localStorage: createMemoryStorage()
    });

    saveHistoryRecord(
      createHistoryRecord({
        requestId: "req-clear",
        status: "failed",
        modelId: "gpt-image-2",
        modelDisplayName: "GPT Image 2",
        prompt: "清空测试",
        params
      })
    );

    clearHistoryRecords();

    expect(loadHistoryRecords()).toEqual([]);
  });
});
