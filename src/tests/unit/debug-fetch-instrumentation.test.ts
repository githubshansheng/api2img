// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDebugLogs,
  getDebugLogs,
  installFrontendDebugLogging
} from "../../services/debug-log-service";

describe("frontend fetch diagnostics", () => {
  beforeEach(() => {
    clearDebugLogs();
  });

  it("records Failed to fetch with a redacted endpoint and request metadata", async () => {
    const nativeFetch = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", nativeFetch);
    window.fetch = nativeFetch;

    installFrontendDebugLogging();

    await expect(
      window.fetch("/api/single-image-viewpoint?stream=1&api_key=secret", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          api_key: "secret",
          source_image: "data:image/png;base64,abcdef"
        })
      })
    ).rejects.toThrow("Failed to fetch");

    const networkFailure = getDebugLogs().find(
      (entry) =>
        entry.category === "network" &&
        entry.level === "error"
    );
    const serialized = JSON.stringify(networkFailure);

    expect(networkFailure?.message).toContain("网络请求失败");
    expect(networkFailure?.details).toEqual(
      expect.objectContaining({
        aborted: false,
        body: {
          type: "string",
          size: expect.any(Number)
        },
        error: expect.objectContaining({
          name: "TypeError",
          message: "Failed to fetch"
        })
      })
    );
    expect(serialized).not.toContain("Bearer secret");
    expect(serialized).not.toContain("data:image/png;base64");
    expect(serialized).not.toContain("api_key=secret");
  });
});
