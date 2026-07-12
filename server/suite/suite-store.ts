import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { GenerationSet } from "../../src/domain";
import { createGenerationError } from "../../src/services/error-service";
import { calculateGenerationSuiteProgress } from "../../src/services/suite-generation-service";

type SuiteRow = {
  data_json: string;
};

export class GenerationSuiteStore {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("busy_timeout = 5000");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS generation_suites (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_generation_suites_updated_at
        ON generation_suites(updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_generation_suites_status
        ON generation_suites(status);
    `);
  }

  save(suite: GenerationSet) {
    const statement = this.database.prepare(`
      INSERT INTO generation_suites (id, status, data_json, created_at, updated_at)
      VALUES (@id, @status, @dataJson, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        data_json = excluded.data_json,
        updated_at = excluded.updated_at
    `);

    statement.run({
      id: suite.id,
      status: suite.status,
      dataJson: JSON.stringify(suite),
      createdAt: suite.createdAt,
      updatedAt: suite.updatedAt
    });

    return suite;
  }

  get(id: string) {
    const row = this.database
      .prepare("SELECT data_json FROM generation_suites WHERE id = ?")
      .get(id) as SuiteRow | undefined;

    return row ? parseSuite(row.data_json) : undefined;
  }

  list(limit = 50) {
    const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 200);
    const rows = this.database
      .prepare("SELECT data_json FROM generation_suites ORDER BY updated_at DESC LIMIT ?")
      .all(safeLimit) as SuiteRow[];

    return rows.map((row) => parseSuite(row.data_json));
  }

  delete(id: string) {
    return this.database.prepare("DELETE FROM generation_suites WHERE id = ?").run(id).changes > 0;
  }

  markRunningSuitesInterrupted() {
    const rows = this.database
      .prepare(
        `SELECT data_json
         FROM generation_suites
         WHERE status IN ('queued', 'generating_anchor', 'generating_scenes')`
      )
      .all() as SuiteRow[];
    const now = new Date().toISOString();

    const updateMany = this.database.transaction((suites: GenerationSet[]) => {
      suites.forEach((suite) => {
        suite.status = "interrupted";
        suite.updatedAt = now;
        suite.lastError = createGenerationError({
          type: "unknown",
          code: "SUITE_PROCESS_INTERRUPTED",
          title: "套图任务已中断",
          message: "服务进程在任务完成前退出，请重新开始未完成的场景。",
          suggestion: "重新提交运行配置后可继续生成。",
          retryable: true
        });
        suite.slots.forEach((slot) => {
          if (slot.status === "queued" || slot.status === "running") {
            slot.status = "interrupted";
          }
          slot.attempts.forEach((attempt) => {
            if (attempt.status === "queued" || attempt.status === "running") {
              attempt.status = "interrupted";
              attempt.completedAt = now;
            }
          });
        });
        suite.progress = calculateGenerationSuiteProgress(suite.slots);
        this.save(suite);
      });
    });
    const suites = rows.map((row) => parseSuite(row.data_json));

    updateMany(suites);
    return suites.length;
  }

  close() {
    this.database.close();
  }
}

function parseSuite(value: string) {
  return JSON.parse(value) as GenerationSet;
}
