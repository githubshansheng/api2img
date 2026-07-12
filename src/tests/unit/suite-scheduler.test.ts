import { describe, expect, it, vi } from "vitest";
import { GenerationSuiteScheduler } from "../../../server/suite/suite-scheduler";

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function deferred(): Deferred {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

describe("generation suite scheduler", () => {
  it("enforces global and per-suite concurrency while continuing queued work", async () => {
    const scheduler = new GenerationSuiteScheduler(2);
    const gates = new Map<string, Deferred>();
    const started: string[] = [];
    let active = 0;
    let maxActive = 0;
    const activeBySuite = new Map<string, number>();
    const maxActiveBySuite = new Map<string, number>();

    const enqueue = (id: string, suiteId: string) => {
      const gate = deferred();
      gates.set(id, gate);
      scheduler.enqueue({
        id,
        suiteId,
        perSuiteConcurrency: 1,
        run: async () => {
          started.push(id);
          active += 1;
          maxActive = Math.max(maxActive, active);
          const nextSuiteActive = (activeBySuite.get(suiteId) ?? 0) + 1;
          activeBySuite.set(suiteId, nextSuiteActive);
          maxActiveBySuite.set(
            suiteId,
            Math.max(maxActiveBySuite.get(suiteId) ?? 0, nextSuiteActive)
          );

          await gate.promise;

          active -= 1;
          activeBySuite.set(suiteId, Math.max(0, nextSuiteActive - 1));
        }
      });
    };

    enqueue("suite-a-1", "suite-a");
    enqueue("suite-a-2", "suite-a");
    enqueue("suite-b-1", "suite-b");
    enqueue("suite-b-2", "suite-b");

    await vi.waitFor(() => {
      expect(started).toEqual(["suite-a-1", "suite-b-1"]);
    });
    expect(scheduler.getStats()).toMatchObject({
      active: 2,
      queued: 2,
      activeBySuite: {
        "suite-a": 1,
        "suite-b": 1
      }
    });

    gates.get("suite-a-1")?.resolve();
    await vi.waitFor(() => {
      expect(started).toContain("suite-a-2");
    });
    gates.get("suite-b-1")?.resolve();
    await vi.waitFor(() => {
      expect(started).toContain("suite-b-2");
    });

    gates.get("suite-a-2")?.resolve();
    gates.get("suite-b-2")?.resolve();
    await scheduler.waitForIdle();

    expect(maxActive).toBe(2);
    expect(Object.fromEntries(maxActiveBySuite)).toEqual({
      "suite-a": 1,
      "suite-b": 1
    });
    expect(scheduler.getStats()).toEqual({
      active: 0,
      queued: 0,
      activeBySuite: {}
    });
  });

  it("resolves suite-specific idle waits while other suites are still running", async () => {
    const scheduler = new GenerationSuiteScheduler(2);
    const suiteAGate = deferred();
    const suiteBGate = deferred();

    scheduler.enqueue({
      id: "suite-a-task",
      suiteId: "suite-a",
      perSuiteConcurrency: 1,
      run: () => suiteAGate.promise
    });
    scheduler.enqueue({
      id: "suite-b-task",
      suiteId: "suite-b",
      perSuiteConcurrency: 1,
      run: () => suiteBGate.promise
    });

    await vi.waitFor(() => {
      expect(scheduler.getStats().active).toBe(2);
    });

    let suiteAIdle = false;
    const suiteAIdlePromise = scheduler.waitForSuiteIdle("suite-a").then(() => {
      suiteAIdle = true;
    });

    suiteAGate.resolve();
    await suiteAIdlePromise;

    expect(suiteAIdle).toBe(true);
    expect(scheduler.getStats()).toMatchObject({
      active: 1,
      activeBySuite: {
        "suite-b": 1
      }
    });

    suiteBGate.resolve();
    await scheduler.waitForIdle();
  });
});
