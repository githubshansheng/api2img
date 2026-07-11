import { afterEach, describe, expect, it, vi } from "vitest";
import { fallbackBootstrapConfig, fetchBootstrapConfig } from "../../services/config-service";

describe("config service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back when bootstrap returns an empty response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 502,
        text: async () => ""
      }))
    );

    await expect(fetchBootstrapConfig()).resolves.toBe(fallbackBootstrapConfig);
  });

  it("falls back when bootstrap returns non-json content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => "<html>server error</html>"
      }))
    );

    await expect(fetchBootstrapConfig()).resolves.toBe(fallbackBootstrapConfig);
  });
});
