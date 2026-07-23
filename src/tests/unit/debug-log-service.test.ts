import { beforeEach, describe, expect, it } from "vitest";
import {
  appendDebugLog,
  clearDebugLogs,
  getDebugLogs,
  sanitizeDebugUrl,
  sanitizeDebugValue
} from "../../services/debug-log-service";

describe("frontend debug log service", () => {
  beforeEach(() => {
    clearDebugLogs();
  });

  it("redacts secrets and image payloads before storing details", () => {
    appendDebugLog({
      level: "error",
      category: "single-view",
      message: "request failed",
      details: {
        api_key: "sk-super-secret-value",
        authorization: "Bearer should-not-appear",
        source_image: "data:image/png;base64,abcdef",
        nested: {
          accessToken: "private-token",
          cameraPoseImage: "data:image/png;base64,xyz"
        }
      }
    });

    expect(getDebugLogs()[0]?.details).toEqual({
      api_key: "[REDACTED]",
      authorization: "[REDACTED]",
      source_image: "[DATA_URL_REDACTED type=image/png chars=28]",
      nested: {
        accessToken: "[REDACTED]",
        cameraPoseImage: "[DATA_URL_REDACTED type=image/png chars=25]"
      }
    });
  });

  it("keeps safe query values and redacts unknown URL parameters", () => {
    expect(
      sanitizeDebugUrl(
        "https://example.com/v1/images?stream=1&api_key=secret&trace=abc"
      )
    ).toBe(
      "https://example.com/v1/images?stream=1&api_key=%5BREDACTED%5D&trace=%5BREDACTED%5D"
    );
  });

  it("handles circular diagnostic details without throwing", () => {
    const details: Record<string, unknown> = {
      status: "failed"
    };
    details.self = details;

    expect(sanitizeDebugValue(details)).toEqual({
      status: "failed",
      self: "[CIRCULAR]"
    });
  });
});
