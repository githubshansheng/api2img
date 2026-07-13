import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { EditAssetStore } from "../../../server/edit/edit-assets";
import { EditSessionService } from "../../../server/edit/edit-service";
import { EditSessionStore } from "../../../server/edit/edit-store";
import { createEditImageInput } from "../helpers/image-editing";

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

describe("edit session sqlite store", () => {
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
