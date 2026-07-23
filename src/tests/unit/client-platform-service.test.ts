import { describe, expect, it } from "vitest";
import { detectClientPlatform } from "../../services/client-platform-service";

describe("client platform service", () => {
  it("detects macOS from user agent client hints", () => {
    expect(
      detectClientPlatform({
        platform: "MacIntel",
        userAgent: "Mozilla/5.0",
        userAgentData: {
          platform: "macOS"
        }
      })
    ).toBe("macos");
  });

  it("detects macOS from the legacy browser platform", () => {
    expect(
      detectClientPlatform({
        maxTouchPoints: 0,
        platform: "MacIntel",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
      })
    ).toBe("macos");
  });

  it("does not apply desktop macOS density to an iPad reporting MacIntel", () => {
    expect(
      detectClientPlatform({
        maxTouchPoints: 5,
        platform: "MacIntel",
        userAgent: "Mozilla/5.0 (Macintosh; CPU OS 18_0 like Mac OS X) Mobile"
      })
    ).toBe("other");
  });

  it("keeps non-Apple desktop platforms unchanged", () => {
    expect(
      detectClientPlatform({
        platform: "Win32",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      })
    ).toBe("other");
  });
});
