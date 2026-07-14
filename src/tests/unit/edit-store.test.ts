import fs from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { EditAssetStore } from "../../../server/edit/edit-assets";
import { EditSessionService } from "../../../server/edit/edit-service";
import {
  EditSessionStore,
  LEGACY_EDIT_OWNER_ID
} from "../../../server/edit/edit-store";
import { createEditImageInput } from "../helpers/image-editing";

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

describe("edit session sqlite store", () => {
  it("freezes sessions from schemas without anonymous visitor ownership", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "api2img-edit-store-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "edit-sessions.sqlite");
    const database = new Database(databasePath);

    database.exec(`
      CREATE TABLE edit_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        default_model_id TEXT NOT NULL,
        current_version_id TEXT NOT NULL,
        current_branch_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );
    `);
    database.prepare(`
      INSERT INTO edit_sessions (
        id, title, status, default_model_id, current_version_id, current_branch_id,
        created_at, updated_at, archived_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "legacy-session",
      "Legacy session",
      "active",
      "gpt-image-2",
      "legacy-version",
      "legacy-branch",
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
      null
    );
    database.close();

    const store = new EditSessionStore(databasePath);

    expect(store.get("legacy-session", "new-browser-owner")).toBeUndefined();
    expect(store.list(10, "new-browser-owner")).toEqual([]);
    expect(store.getAny("legacy-session")).toMatchObject({
      id: "legacy-session",
      workspaceId: "local-workspace"
    });
    expect(store.get("legacy-session")).toMatchObject({
      id: "legacy-session"
    });
    store.close();
  });

  it("claims a frozen legacy session only for a verified visitor cookie", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "api2img-edit-store-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "edit-sessions.sqlite");
    const store = new EditSessionStore(databasePath);
    const ownerId = randomBytes(32).toString("base64url");
    const secret = "legacy-claim-test-secret";
    const signature = createHmac("sha256", secret)
      .update(`v1.${ownerId}`)
      .digest("base64url");
    const cookie = `api2img_edit_visitor=v1.${ownerId}.${signature}`;
    const sessionId = "legacy-claim-session";

    store.close();
    const database = new Database(databasePath);
    database.prepare(`
      INSERT INTO edit_sessions (
        id, owner_id, workspace_id, title, status, default_model_id,
        current_version_id, current_branch_id, created_at, updated_at, archived_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      LEGACY_EDIT_OWNER_ID,
      "local-workspace",
      "Frozen legacy session",
      "active",
      "gpt-image-2",
      "legacy-version",
      "legacy-branch",
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
      null
    );
    database.close();

    const result = spawnSync(
      process.execPath,
      [
        path.resolve(process.cwd(), "scripts", "claim-legacy-edit-session.mjs"),
        "--database",
        databasePath,
        "--session",
        sessionId,
        "--cookie",
        cookie
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          API2IMG_EDIT_SESSION_SECRET: secret
        }
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Claimed legacy edit session ${sessionId}.`);

    const claimedStore = new EditSessionStore(databasePath);
    expect(claimedStore.get(sessionId, ownerId)).toMatchObject({
      id: sessionId,
      workspaceId: `edit-workspace-${createHmac("sha256", secret)
        .update(`workspace:${ownerId}`)
        .digest("hex")
        .slice(0, 32)}`
    });
    expect(claimedStore.get(sessionId, LEGACY_EDIT_OWNER_ID)).toBeUndefined();
    claimedStore.close();
  });

  it("hydrates schema v1 sessions and creates the v2 workspace defaults", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "api2img-edit-store-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "edit-sessions.sqlite");
    const assets = new EditAssetStore(path.join(directory, "assets"));
    const firstStore = new EditSessionStore(databasePath);
    const firstService = new EditSessionService({
      store: firstStore,
      assets
    });
    const created = await firstService.create({
      modelId: "gpt-image-2",
      source: createEditImageInput("legacy-source")
    });
    firstStore.close();

    const legacyDatabase = new Database(databasePath);
    legacyDatabase.prepare(
      "DELETE FROM edit_session_extras WHERE session_id = ?"
    ).run(created.id);
    legacyDatabase.prepare("DELETE FROM edit_workspaces").run();
    legacyDatabase.pragma("user_version = 1");
    legacyDatabase.close();

    const migratedStore = new EditSessionStore(databasePath);
    const migratedService = new EditSessionService({
      store: migratedStore,
      assets
    });
    const migrated = migratedService.get(created.id);
    const workspace = migratedStore.getWorkspace();

    expect(migrated).toMatchObject({
      schemaVersion: 1,
      workspaceId: "local-workspace",
      protectedPresets: [],
      comments: [],
      approvals: [],
      shareLinks: [],
      auditLog: [],
      workflow: {
        state: "draft"
      }
    });
    expect(migrated.versions[0]).toMatchObject({
      tags: [],
      favorite: false,
      reviewState: "draft"
    });
    expect(workspace).toMatchObject({
      id: "local-workspace",
      name: "默认团队空间",
      quota: {
        maxConcurrentJobs: 8,
        dailyCandidateLimit: 500
      }
    });
    expect(workspace.members[0]).toMatchObject({
      id: "local-owner",
      role: "owner"
    });
    migratedStore.close();
  });

  it("preserves two-parent versions and marks in-flight work interrupted", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "api2img-edit-store-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "edit-sessions.sqlite");
    const assets = new EditAssetStore(path.join(directory, "assets"));
    const firstStore = new EditSessionStore(databasePath);
    const firstService = new EditSessionService({
      store: firstStore,
      assets
    });
    const session = await firstService.create({
      modelId: "gpt-image-2",
      source: createEditImageInput("source")
    });
    const now = new Date().toISOString();
    const rootVersionId = session.currentVersionId;
    const sourceAsset = session.assets[0]!;
    const leftAssetId = "asset-left";
    const rightAssetId = "asset-right";
    const mergeAssetId = "asset-merge";

    session.assets.push(
      { ...sourceAsset, id: leftAssetId, kind: "result" },
      { ...sourceAsset, id: rightAssetId, kind: "result" },
      { ...sourceAsset, id: mergeAssetId, kind: "result" }
    );
    session.versions.push(
      {
        id: "version-left",
        sessionId: session.id,
        assetId: leftAssetId,
        parentVersionIds: [rootVersionId],
        candidateIndex: 0,
        label: "左分支",
        createdAt: now
      },
      {
        id: "version-right",
        sessionId: session.id,
        assetId: rightAssetId,
        parentVersionIds: [rootVersionId],
        candidateIndex: 0,
        label: "右分支",
        createdAt: now
      },
      {
        id: "version-merge",
        sessionId: session.id,
        turnId: "turn-running",
        assetId: mergeAssetId,
        parentVersionIds: ["version-left", "version-right"],
        candidateIndex: 0,
        label: "合并版本",
        createdAt: now
      }
    );
    session.turns.push({
      id: "turn-running",
      clientTurnId: "client-running",
      sessionId: session.id,
      branchId: session.currentBranchId,
      sourceVersionIds: ["version-left", "version-right"],
      mode: "merge",
      status: "running",
      modelId: "gpt-image-2",
      modelDisplayName: "GPT Image 2",
      params: {
        ratio: "1:1",
        resolution: "1K",
        quality: "high",
        count: 1
      },
      candidateCount: 1,
      originalInstruction: "合并两个版本",
      regions: [],
      jobIds: ["job-running"],
      createdAt: now,
      updatedAt: now
    });
    session.jobs.push({
      id: "job-running",
      sessionId: session.id,
      turnId: "turn-running",
      candidateIndex: 0,
      status: "running",
      attempts: [
        {
          id: "attempt-running",
          attemptNumber: 1,
          status: "running",
          requestId: "request-running",
          startedAt: now
        }
      ],
      createdAt: now,
      updatedAt: now
    });
    firstStore.save(session);
    firstStore.close();

    const restartedStore = new EditSessionStore(databasePath);
    const restartedService = new EditSessionService({
      store: restartedStore,
      assets
    });
    const recovered = restartedService.get(session.id);
    const mergeVersion = recovered.versions.find(
      (version) => version.id === "version-merge"
    );

    expect(mergeVersion?.parentVersionIds).toEqual([
      "version-left",
      "version-right"
    ]);
    expect(recovered.turns[0]?.status).toBe("interrupted");
    expect(recovered.jobs[0]?.status).toBe("interrupted");
    expect(recovered.jobs[0]?.attempts[0]?.completedAt).toBeTruthy();
    restartedStore.close();
  });
});
