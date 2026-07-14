import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  EditAsset,
  EditBranch,
  EditJob,
  EditMessage,
  EditSession,
  EditSessionSummary,
  EditTurn,
  EditWorkspace,
  ImageVersion,
  ProviderContinuation
} from "../../src/domain";
import { createGenerationError } from "../../src/services/error-service";

type SessionRow = {
  id: string;
  owner_id: string;
  workspace_id: string;
  title: string;
  status: EditSession["status"];
  default_model_id: string;
  current_version_id: string;
  current_branch_id: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type JsonRow = {
  data_json: string;
};

type VersionParentRow = {
  version_id: string;
  parent_version_id: string;
  parent_order: number;
};

type WorkspaceRow = {
  data_json: string;
};

type AssetSessionRow = {
  session_id: string;
  owner_id: string;
};

export const LEGACY_EDIT_OWNER_ID = "legacy-frozen";
export class EditSessionStore {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("busy_timeout = 5000");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS edit_sessions (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL DEFAULT '${LEGACY_EDIT_OWNER_ID}',
        workspace_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ID}',
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        default_model_id TEXT NOT NULL,
        current_version_id TEXT NOT NULL,
        current_branch_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE IF NOT EXISTS edit_assets (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES edit_sessions(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        url TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS edit_versions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES edit_sessions(id) ON DELETE CASCADE,
        turn_id TEXT,
        asset_id TEXT NOT NULL REFERENCES edit_assets(id),
        candidate_index INTEGER NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS edit_version_parents (
        version_id TEXT NOT NULL REFERENCES edit_versions(id) ON DELETE CASCADE,
        parent_version_id TEXT NOT NULL REFERENCES edit_versions(id),
        parent_order INTEGER NOT NULL,
        PRIMARY KEY (version_id, parent_order)
      );

      CREATE TABLE IF NOT EXISTS edit_branches (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES edit_sessions(id) ON DELETE CASCADE,
        head_version_id TEXT NOT NULL REFERENCES edit_versions(id),
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS edit_turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES edit_sessions(id) ON DELETE CASCADE,
        client_turn_id TEXT NOT NULL,
        status TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (session_id, client_turn_id)
      );

      CREATE TABLE IF NOT EXISTS edit_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES edit_sessions(id) ON DELETE CASCADE,
        turn_id TEXT,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS edit_jobs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES edit_sessions(id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL,
        status TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS edit_continuations (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES edit_sessions(id) ON DELETE CASCADE,
        version_id TEXT NOT NULL REFERENCES edit_versions(id) ON DELETE CASCADE,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS edit_session_extras (
        session_id TEXT PRIMARY KEY REFERENCES edit_sessions(id) ON DELETE CASCADE,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS edit_workspaces (
        id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_edit_sessions_updated_at
        ON edit_sessions(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_edit_sessions_status
        ON edit_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_edit_versions_session
        ON edit_versions(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_edit_turns_session
        ON edit_turns(session_id, created_at);
    `);
    const editJobColumns = this.database.pragma(
      "table_info(edit_jobs)"
    ) as Array<{ name: string }>;
    const sessionColumns = this.database.pragma(
      "table_info(edit_sessions)"
    ) as Array<{ name: string }>;

    if (!sessionColumns.some((column) => column.name === "owner_id")) {
      this.database.exec(
        `ALTER TABLE edit_sessions ADD COLUMN owner_id TEXT NOT NULL DEFAULT '${LEGACY_EDIT_OWNER_ID}'`
      );
    }

    if (!sessionColumns.some((column) => column.name === "workspace_id")) {
      this.database.exec(
        `ALTER TABLE edit_sessions ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ID}'`
      );
    }

    if (!editJobColumns.some((column) => column.name === "candidate_index")) {
      this.database.exec(
        "ALTER TABLE edit_jobs ADD COLUMN candidate_index INTEGER NOT NULL DEFAULT 0"
      );
    }

    this.database.exec(`
      UPDATE edit_sessions
      SET owner_id = '${LEGACY_EDIT_OWNER_ID}'
      WHERE owner_id IS NULL OR trim(owner_id) = '';

      UPDATE edit_sessions
      SET workspace_id = '${DEFAULT_WORKSPACE_ID}'
      WHERE workspace_id IS NULL OR trim(workspace_id) = '';

      CREATE INDEX IF NOT EXISTS idx_edit_sessions_owner_updated_at
        ON edit_sessions(owner_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_edit_sessions_workspace_updated_at
        ON edit_sessions(workspace_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_edit_jobs_turn
        ON edit_jobs(turn_id, candidate_index);
    `);
    this.database.pragma("user_version = 3");
  }

  save(session: EditSession, ownerId?: string) {
    const transaction = this.database.transaction((value: EditSession) => {
      this.database.prepare(`
        INSERT INTO edit_sessions (
          id, owner_id, workspace_id, title, status, default_model_id, current_version_id, current_branch_id,
          created_at, updated_at, archived_at
        )
        VALUES (
          @id, COALESCE(@ownerId, '${LEGACY_EDIT_OWNER_ID}'), @workspaceId, @title, @status, @defaultModelId, @currentVersionId, @currentBranchId,
          @createdAt, @updatedAt, @archivedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          owner_id = COALESCE(@ownerId, edit_sessions.owner_id),
          workspace_id = excluded.workspace_id,
          title = excluded.title,
          status = excluded.status,
          default_model_id = excluded.default_model_id,
          current_version_id = excluded.current_version_id,
          current_branch_id = excluded.current_branch_id,
          updated_at = excluded.updated_at,
          archived_at = excluded.archived_at
      `).run({
        id: value.id,
        ownerId: ownerId ?? null,
        workspaceId: value.workspaceId ?? DEFAULT_WORKSPACE_ID,
        title: value.title,
        status: value.status,
        defaultModelId: value.defaultModelId,
        currentVersionId: value.currentVersionId,
        currentBranchId: value.currentBranchId,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
        archivedAt: value.archivedAt ?? null
      });

      this.database.prepare(`
        DELETE FROM edit_version_parents
        WHERE version_id IN (SELECT id FROM edit_versions WHERE session_id = ?)
      `).run(value.id);

      [
        "edit_continuations",
        "edit_messages",
        "edit_jobs",
        "edit_turns",
        "edit_branches",
        "edit_versions",
        "edit_assets"
      ].forEach((table) => {
        this.database.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(value.id);
      });

      const insertAsset = this.database.prepare(`
        INSERT INTO edit_assets (id, session_id, kind, url, data_json, created_at)
        VALUES (@id, @sessionId, @kind, @url, @dataJson, @createdAt)
      `);
      value.assets.forEach((asset) => insertAsset.run({
        ...toJsonRecord(asset),
        kind: asset.kind,
        url: asset.url
      }));

      const insertVersion = this.database.prepare(`
        INSERT INTO edit_versions (
          id, session_id, turn_id, asset_id, candidate_index, data_json, created_at
        )
        VALUES (
          @id, @sessionId, @turnId, @assetId, @candidateIndex, @dataJson, @createdAt
        )
      `);
      value.versions.forEach((version) => {
        insertVersion.run({
          ...toJsonRecord(version),
          turnId: version.turnId ?? null,
          assetId: version.assetId,
          candidateIndex: version.candidateIndex
        });
      });

      const insertParent = this.database.prepare(`
        INSERT INTO edit_version_parents (version_id, parent_version_id, parent_order)
        VALUES (?, ?, ?)
      `);
      value.versions.forEach((version) => {
        version.parentVersionIds.forEach((parentId, index) => {
          insertParent.run(version.id, parentId, index);
        });
      });

      const insertBranch = this.database.prepare(`
        INSERT INTO edit_branches (id, session_id, head_version_id, data_json, updated_at)
        VALUES (@id, @sessionId, @headVersionId, @dataJson, @updatedAt)
      `);
      value.branches.forEach((branch) => {
        insertBranch.run({
          ...toJsonRecord(branch),
          headVersionId: branch.headVersionId,
          updatedAt: branch.updatedAt
        });
      });

      const insertTurn = this.database.prepare(`
        INSERT INTO edit_turns (
          id, session_id, client_turn_id, status, data_json, created_at, updated_at
        )
        VALUES (
          @id, @sessionId, @clientTurnId, @status, @dataJson, @createdAt, @updatedAt
        )
      `);
      value.turns.forEach((turn) => insertTurn.run({
        ...toJsonRecord(turn),
        clientTurnId: turn.clientTurnId,
        status: turn.status,
        updatedAt: turn.updatedAt
      }));

      const insertMessage = this.database.prepare(`
        INSERT INTO edit_messages (id, session_id, turn_id, data_json, created_at)
        VALUES (@id, @sessionId, @turnId, @dataJson, @createdAt)
      `);
      value.messages.forEach((message) => insertMessage.run({
        ...toJsonRecord(message),
        turnId: message.turnId ?? null
      }));

      const insertJob = this.database.prepare(`
        INSERT INTO edit_jobs (
          id, session_id, turn_id, candidate_index, status, data_json,
          created_at, updated_at
        )
        VALUES (
          @id, @sessionId, @turnId, @candidateIndex, @status, @dataJson,
          @createdAt, @updatedAt
        )
      `);
      value.jobs.forEach((job) => insertJob.run({
        ...toJsonRecord(job),
        turnId: job.turnId,
        candidateIndex: job.candidateIndex,
        status: job.status,
        updatedAt: job.updatedAt
      }));

      const insertContinuation = this.database.prepare(`
        INSERT INTO edit_continuations (
          id, session_id, version_id, data_json, created_at
        )
        VALUES (@id, @sessionId, @versionId, @dataJson, @createdAt)
      `);
      value.continuations.forEach((continuation) => insertContinuation.run({
        ...toJsonRecord(continuation),
        versionId: continuation.versionId
      }));

      this.database.prepare(`
        INSERT INTO edit_session_extras (session_id, data_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          data_json = excluded.data_json,
          updated_at = excluded.updated_at
      `).run(
        value.id,
        JSON.stringify({
          schemaVersion: value.schemaVersion,
          workspaceId: value.workspaceId,
          protectedPresets: value.protectedPresets ?? [],
          comments: value.comments ?? [],
          approvals: value.approvals ?? [],
          shareLinks: value.shareLinks ?? [],
          auditLog: value.auditLog ?? [],
          workflow: value.workflow ?? { state: "draft" }
        }),
        value.updatedAt
      );
    });

    transaction(session);
    return session;
  }

  get(id: string, ownerId = LEGACY_EDIT_OWNER_ID) {
    return this.read(id, ownerId);
  }

  getAny(id: string) {
    return this.read(id);
  }

  private read(id: string, ownerId?: string) {
    const row = this.database
      .prepare(
        ownerId
          ? "SELECT * FROM edit_sessions WHERE id = ? AND owner_id = ?"
          : "SELECT * FROM edit_sessions WHERE id = ?"
      )
      .get(...(ownerId ? [id, ownerId] : [id])) as SessionRow | undefined;

    if (!row) {
      return undefined;
    }

    const versions = this.readJsonRows<ImageVersion>(
      "SELECT data_json FROM edit_versions WHERE session_id = ? ORDER BY created_at",
      id
    );
    const parents = this.database
      .prepare(`
        SELECT version_id, parent_version_id, parent_order
        FROM edit_version_parents
        WHERE version_id IN (SELECT id FROM edit_versions WHERE session_id = ?)
        ORDER BY version_id, parent_order
      `)
      .all(id) as VersionParentRow[];
    const parentMap = new Map<string, string[]>();

    parents.forEach((parent) => {
      const values = parentMap.get(parent.version_id) ?? [];
      values[parent.parent_order] = parent.parent_version_id;
      parentMap.set(parent.version_id, values);
    });

    const extras = this.database
      .prepare("SELECT data_json FROM edit_session_extras WHERE session_id = ?")
      .get(id) as JsonRow | undefined;
    const parsedExtras = extras
      ? (JSON.parse(extras.data_json) as Partial<EditSession>)
      : {};

    return normalizeSession({
      schemaVersion: parsedExtras.schemaVersion ?? 1,
      id: row.id,
      workspaceId: row.workspace_id ?? parsedExtras.workspaceId ?? DEFAULT_WORKSPACE_ID,
      title: row.title,
      status: row.status,
      defaultModelId: row.default_model_id,
      currentVersionId: row.current_version_id,
      currentBranchId: row.current_branch_id,
      branches: this.readJsonRows<EditBranch>(
        "SELECT data_json FROM edit_branches WHERE session_id = ? ORDER BY updated_at",
        id
      ),
      turns: this.readJsonRows<EditTurn>(
        "SELECT data_json FROM edit_turns WHERE session_id = ? ORDER BY created_at",
        id
      ),
      messages: this.readJsonRows<EditMessage>(
        "SELECT data_json FROM edit_messages WHERE session_id = ? ORDER BY created_at",
        id
      ),
      versions: versions.map((version) => ({
        ...version,
        parentVersionIds: parentMap.get(version.id) ?? []
      })),
      jobs: this.readJsonRows<EditJob>(
        "SELECT data_json FROM edit_jobs WHERE session_id = ? ORDER BY created_at",
        id
      ),
      assets: this.readJsonRows<EditAsset>(
        "SELECT data_json FROM edit_assets WHERE session_id = ? ORDER BY created_at",
        id
      ),
      continuations: this.readJsonRows<ProviderContinuation>(
        "SELECT data_json FROM edit_continuations WHERE session_id = ? ORDER BY created_at",
        id
      ),
      protectedPresets: parsedExtras.protectedPresets ?? [],
      comments: parsedExtras.comments ?? [],
      approvals: parsedExtras.approvals ?? [],
      shareLinks: parsedExtras.shareLinks ?? [],
      auditLog: parsedExtras.auditLog ?? [],
      workflow: parsedExtras.workflow ?? { state: "draft" },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at ?? undefined
    } satisfies EditSession);
  }

  list(limit = 50, ownerId = LEGACY_EDIT_OWNER_ID) {
    const safeLimit = Math.min(
      Math.max(1, Math.floor(limit)),
      100
    );
    const ids = this.database
      .prepare(
        "SELECT id FROM edit_sessions WHERE owner_id = ? ORDER BY updated_at DESC LIMIT ?"
      )
      .all(ownerId, safeLimit) as Array<{ id: string }>;

    return ids.flatMap(({ id }) => {
      const session = this.get(id, ownerId);
      return session ? [toSummary(session)] : [];
    });
  }

  getAll(limit = 1000, ownerId = LEGACY_EDIT_OWNER_ID) {
    return this.readAll(limit, "owner_id = ?", [ownerId]);
  }

  getAllAny(limit = 1000) {
    return this.readAll(limit);
  }

  getAllByWorkspace(workspaceId: string, limit = 1000) {
    return this.readAll(limit, "workspace_id = ?", [workspaceId]);
  }

  private readAll(limit: number, where?: string, values: unknown[] = []) {
    const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 10_000);
    const ids = this.database
      .prepare(
        `SELECT id FROM edit_sessions${where ? ` WHERE ${where}` : ""} ORDER BY updated_at DESC LIMIT ?`
      )
      .all(...values, safeLimit) as Array<{ id: string }>;

    return ids.flatMap(({ id }) => {
      const session = this.getAny(id);
      return session ? [session] : [];
    });
  }

  getWorkspace(id = DEFAULT_WORKSPACE_ID) {
    const row = this.database
      .prepare("SELECT data_json FROM edit_workspaces WHERE id = ?")
      .get(id) as WorkspaceRow | undefined;

    if (row) {
      return normalizeWorkspace(JSON.parse(row.data_json) as EditWorkspace);
    }

    const workspace = createDefaultWorkspace(id);
    this.saveWorkspace(workspace);
    return workspace;
  }

  saveWorkspace(workspace: EditWorkspace) {
    const normalized = normalizeWorkspace(workspace);
    this.database.prepare(`
      INSERT INTO edit_workspaces (id, data_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        data_json = excluded.data_json,
        updated_at = excluded.updated_at
    `).run(normalized.id, JSON.stringify(normalized), normalized.updatedAt);
    return normalized;
  }

  delete(id: string, ownerId = LEGACY_EDIT_OWNER_ID) {
    return this.database
      .prepare("DELETE FROM edit_sessions WHERE id = ? AND owner_id = ?")
      .run(id, ownerId).changes > 0;
  }

  findAssetSession(assetURL: string) {
    return this.database
      .prepare(`
        SELECT edit_assets.session_id, edit_sessions.owner_id
        FROM edit_assets
        JOIN edit_sessions ON edit_sessions.id = edit_assets.session_id
        WHERE edit_assets.url = ?
        LIMIT 1
      `)
      .get(assetURL) as AssetSessionRow | undefined;
  }

  markInFlightInterrupted() {
    const rows = this.database
      .prepare(`
        SELECT DISTINCT session_id
        FROM edit_turns
        WHERE status IN ('analyzing', 'queued', 'running', 'persisting')
      `)
      .all() as Array<{ session_id: string }>;
    const now = new Date().toISOString();

    rows.forEach(({ session_id }) => {
      const session = this.getAny(session_id);

      if (!session) {
        return;
      }

      session.turns.forEach((turn) => {
        if (["analyzing", "queued", "running", "persisting"].includes(turn.status)) {
          turn.status = "interrupted";
          turn.updatedAt = now;
          turn.error = interruptedError();
        }
      });
      session.jobs.forEach((job) => {
        if (["queued", "running", "persisting"].includes(job.status)) {
          job.status = "interrupted";
          job.updatedAt = now;
          job.error = interruptedError();
          job.attempts.forEach((attempt) => {
            if (["queued", "running", "persisting"].includes(attempt.status)) {
              attempt.status = "interrupted";
              attempt.completedAt = now;
              attempt.error = interruptedError();
            }
          });
        }
      });
      session.updatedAt = now;
      this.save(session);
    });

    return rows.length;
  }

  close() {
    this.database.close();
  }

  private readJsonRows<T>(sql: string, id: string) {
    return (this.database.prepare(sql).all(id) as JsonRow[]).map(
      (row) => JSON.parse(row.data_json) as T
    );
  }
}

export const DEFAULT_WORKSPACE_ID = "local-workspace";

function createDefaultWorkspace(id = DEFAULT_WORKSPACE_ID): EditWorkspace {
  const now = new Date().toISOString();

  return {
    id,
    name: "默认团队空间",
    members: [
      {
        id: "local-owner",
        name: "本地所有者",
        role: "owner",
        createdAt: now
      }
    ],
    templates: [],
    brandAssets: [],
    quota: {
      maxConcurrentJobs: 8,
      maxSessionConcurrentTurns: 1,
      dailyCandidateLimit: 500,
      storageLimitBytes: 20 * 1024 * 1024 * 1024
    },
    lifecycle: {
      detachedVersionRetentionDays: 30,
      failedAssetRetentionDays: 7,
      autoCleanupEnabled: false
    },
    createdAt: now,
    updatedAt: now
  };
}

function normalizeWorkspace(workspace: EditWorkspace): EditWorkspace {
  const fallback = createDefaultWorkspace(workspace.id || DEFAULT_WORKSPACE_ID);

  return {
    ...fallback,
    ...workspace,
    members: Array.isArray(workspace.members) ? workspace.members : fallback.members,
    templates: Array.isArray(workspace.templates) ? workspace.templates : [],
    brandAssets: Array.isArray(workspace.brandAssets) ? workspace.brandAssets : [],
    quota: {
      ...fallback.quota,
      ...workspace.quota
    },
    lifecycle: {
      ...fallback.lifecycle,
      ...workspace.lifecycle
    }
  };
}

function normalizeSession(session: EditSession): EditSession {
  return {
    ...session,
    schemaVersion: session.schemaVersion ?? 1,
    workspaceId: session.workspaceId ?? DEFAULT_WORKSPACE_ID,
    protectedPresets: session.protectedPresets ?? [],
    comments: session.comments ?? [],
    approvals: session.approvals ?? [],
    shareLinks: session.shareLinks ?? [],
    auditLog: session.auditLog ?? [],
    workflow: session.workflow ?? { state: "draft" },
    versions: session.versions.map((version) => ({
      ...version,
      tags: version.tags ?? [],
      favorite: version.favorite ?? false,
      reviewState: version.reviewState ?? "draft"
    })),
    turns: session.turns.map((turn) => ({
      ...turn,
      regions: turn.regions.map((region, index) => ({
        ...region,
        selectionMethod: region.selectionMethod ?? "brush",
        combinationMode: region.combinationMode ?? "add",
        priority: region.priority ?? index,
        featherRadius: region.featherRadius ?? 0,
        expansionPixels: region.expansionPixels ?? 0,
        inverted: region.inverted ?? false
      }))
    }))
  };
}

function toJsonRecord(value: {
  id: string;
  sessionId: string;
  createdAt: string;
}) {
  return {
    id: value.id,
    sessionId: value.sessionId,
    createdAt: value.createdAt,
    dataJson: JSON.stringify(value)
  };
}

function toSummary(session: EditSession): EditSessionSummary {
  const currentVersion = session.versions.find(
    (version) => version.id === session.currentVersionId
  );
  const currentAsset = session.assets.find(
    (asset) => asset.id === currentVersion?.assetId
  );

  return {
    id: session.id,
    title: session.title,
    status: session.status,
    defaultModelId: session.defaultModelId,
    currentVersionId: session.currentVersionId,
    currentBranchId: session.currentBranchId,
    thumbnailURL: currentAsset?.url,
    versionCount: session.versions.length,
    turnCount: session.turns.length,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    archivedAt: session.archivedAt
  };
}

function interruptedError() {
  return createGenerationError({
    type: "unknown",
    code: "EDIT_PROCESS_INTERRUPTED",
    title: "修图任务已中断",
    message: "服务进程在任务完成前退出，任务没有自动重放。",
    suggestion: "确认上游账单后手动重试，避免重复扣费。",
    retryable: true,
    mayHaveCharged: true
  });
}
