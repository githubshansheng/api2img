export type GenerationSuiteQueueTask = {
  id: string;
  suiteId: string;
  perSuiteConcurrency: number;
  run(signal: AbortSignal): Promise<void>;
};

export type GenerationSuiteSchedulerStats = {
  active: number;
  queued: number;
  activeBySuite: Record<string, number>;
};

export class GenerationSuiteScheduler {
  private readonly globalConcurrency: number;
  private readonly queue: GenerationSuiteQueueTask[] = [];
  private readonly activeTasks = new Map<string, { task: GenerationSuiteQueueTask; controller: AbortController }>();
  private readonly activeBySuite = new Map<string, number>();
  private idleResolvers: Array<() => void> = [];
  private readonly suiteIdleResolvers = new Map<string, Array<() => void>>();

  constructor(globalConcurrency = 4) {
    this.globalConcurrency = Math.max(1, Math.floor(globalConcurrency));
  }

  enqueue(task: GenerationSuiteQueueTask) {
    if (this.queue.some((queuedTask) => queuedTask.id === task.id) || this.activeTasks.has(task.id)) {
      return false;
    }

    this.queue.push(task);
    this.pump();
    return true;
  }

  cancelSuite(suiteId: string) {
    let removed = 0;

    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index]?.suiteId === suiteId) {
        this.queue.splice(index, 1);
        removed += 1;
      }
    }

    this.activeTasks.forEach(({ task, controller }) => {
      if (task.suiteId === suiteId) {
        controller.abort();
      }
    });

    this.resolveIdleIfNeeded();
    return removed;
  }

  getStats(): GenerationSuiteSchedulerStats {
    return {
      active: this.activeTasks.size,
      queued: this.queue.length,
      activeBySuite: Object.fromEntries(this.activeBySuite)
    };
  }

  waitForIdle() {
    if (this.queue.length === 0 && this.activeTasks.size === 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  waitForSuiteIdle(suiteId: string) {
    if (!this.hasSuiteWork(suiteId)) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      const resolvers = this.suiteIdleResolvers.get(suiteId) ?? [];
      resolvers.push(resolve);
      this.suiteIdleResolvers.set(suiteId, resolvers);
    });
  }

  private pump() {
    while (this.activeTasks.size < this.globalConcurrency) {
      const nextIndex = this.queue.findIndex((task) => {
        const activeForSuite = this.activeBySuite.get(task.suiteId) ?? 0;
        return activeForSuite < Math.max(1, task.perSuiteConcurrency);
      });

      if (nextIndex < 0) {
        break;
      }

      const [task] = this.queue.splice(nextIndex, 1);

      if (!task) {
        break;
      }

      const controller = new AbortController();
      this.activeTasks.set(task.id, { task, controller });
      this.activeBySuite.set(task.suiteId, (this.activeBySuite.get(task.suiteId) ?? 0) + 1);

      void task
        .run(controller.signal)
        .catch(() => undefined)
        .finally(() => {
          this.activeTasks.delete(task.id);
          const remaining = Math.max(0, (this.activeBySuite.get(task.suiteId) ?? 1) - 1);

          if (remaining === 0) {
            this.activeBySuite.delete(task.suiteId);
          } else {
            this.activeBySuite.set(task.suiteId, remaining);
          }

          this.pump();
          this.resolveIdleIfNeeded();
        });
    }
  }

  private resolveIdleIfNeeded() {
    this.resolveSuiteIdleIfNeeded();

    if (this.queue.length > 0 || this.activeTasks.size > 0) {
      return;
    }

    const resolvers = this.idleResolvers;
    this.idleResolvers = [];
    resolvers.forEach((resolve) => resolve());
  }

  private resolveSuiteIdleIfNeeded() {
    for (const [suiteId, resolvers] of this.suiteIdleResolvers) {
      if (this.hasSuiteWork(suiteId)) {
        continue;
      }

      this.suiteIdleResolvers.delete(suiteId);
      resolvers.forEach((resolve) => resolve());
    }
  }

  private hasSuiteWork(suiteId: string) {
    return (
      (this.activeBySuite.get(suiteId) ?? 0) > 0 ||
      this.queue.some((task) => task.suiteId === suiteId)
    );
  }
}
