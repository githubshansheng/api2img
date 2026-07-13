import type { EditProviderHealth } from "../../src/domain";

type CircuitRecord = EditProviderHealth & {
  recentFailureTimes: number[];
};

export class EditProviderCircuitBreaker {
  private readonly records = new Map<string, CircuitRecord>();

  constructor(
    private readonly failureThreshold = 3,
    private readonly windowMs = 60_000,
    private readonly cooldownMs = 30_000
  ) {}

  assertAvailable(provider: string) {
    const record = this.requireRecord(provider);
    const now = Date.now();

    if (record.state === "open") {
      const retryAt = record.retryAt ? new Date(record.retryAt).getTime() : 0;

      if (retryAt > now) {
        const error = new Error(`供应商 ${provider} 暂时熔断，请稍后重试。`);
        Object.assign(error, {
          code: "EDIT_PROVIDER_CIRCUIT_OPEN",
          statusCode: 503,
          retryAt: record.retryAt
        });
        throw error;
      }

      record.state = "half_open";
    }
  }

  recordSuccess(provider: string) {
    const record = this.requireRecord(provider);
    record.successes += 1;
    record.state = "closed";
    record.recentFailureTimes = [];
    record.openedAt = undefined;
    record.retryAt = undefined;
    record.lastSuccessAt = new Date().toISOString();
  }

  recordFailure(provider: string) {
    const record = this.requireRecord(provider);
    const now = Date.now();
    record.failures += 1;
    record.lastFailureAt = new Date(now).toISOString();
    record.recentFailureTimes = [
      ...record.recentFailureTimes.filter((value) => now - value <= this.windowMs),
      now
    ];

    if (
      record.state === "half_open" ||
      record.recentFailureTimes.length >= this.failureThreshold
    ) {
      record.state = "open";
      record.openedAt = new Date(now).toISOString();
      record.retryAt = new Date(now + this.cooldownMs).toISOString();
    }
  }

  snapshot() {
    return [...this.records.values()].map(
      ({ recentFailureTimes: _recentFailureTimes, ...record }) => ({ ...record })
    );
  }

  private requireRecord(provider: string) {
    const existing = this.records.get(provider);

    if (existing) {
      return existing;
    }

    const created: CircuitRecord = {
      provider,
      state: "closed",
      failures: 0,
      successes: 0,
      recentFailureTimes: []
    };
    this.records.set(provider, created);
    return created;
  }
}
