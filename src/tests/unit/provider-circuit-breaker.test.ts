import { describe, expect, it, vi } from "vitest";
import { EditProviderCircuitBreaker } from "../../../server/edit/provider-circuit-breaker";

describe("edit provider circuit breaker", () => {
  it("opens after repeated failures and closes after a successful half-open probe", () => {
    vi.useFakeTimers();

    try {
      const breaker = new EditProviderCircuitBreaker(2, 60_000, 1_000);

      breaker.recordFailure("openai");
      expect(() => breaker.assertAvailable("openai")).not.toThrow();
      breaker.recordFailure("openai");
      expect(() => breaker.assertAvailable("openai")).toThrow(
        expect.objectContaining({
          code: "EDIT_PROVIDER_CIRCUIT_OPEN",
          statusCode: 503
        })
      );
      expect(breaker.snapshot()[0]).toMatchObject({
        provider: "openai",
        state: "open",
        failures: 2
      });

      vi.advanceTimersByTime(1_001);
      expect(() => breaker.assertAvailable("openai")).not.toThrow();
      expect(breaker.snapshot()[0]?.state).toBe("half_open");

      breaker.recordSuccess("openai");
      expect(breaker.snapshot()[0]).toMatchObject({
        state: "closed",
        failures: 2,
        successes: 1,
        retryAt: undefined
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
