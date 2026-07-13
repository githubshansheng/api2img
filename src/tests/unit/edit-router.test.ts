import fs from "node:fs";
import http, { type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditSessionEvent } from "../../domain";
import { createEditSessionRouter } from "../../../server/edit/edit-router";
import {
  EditSessionService,
  EditSessionServiceError
} from "../../../server/edit/edit-service";
import { createEditSessionFixture } from "../helpers/image-editing";

const servers: Server[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections?.();
        })
    )
  );
  temporaryDirectories.splice(0).forEach((directory) => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

async function startRouterServer(service: EditSessionService) {
  const app = express();
  app.use(express.json());
  app.use("/api/edit-sessions", createEditSessionRouter(service));
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  return `http://127.0.0.1:${address.port}/api/edit-sessions`;
}

function createFakeService() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "api2img-edit-router-"));
  temporaryDirectories.push(directory);
  const session = createEditSessionFixture();
  session.shareLinks = [
    {
      id: "share-view",
      sessionId: session.id,
      token: "token-view",
      permission: "view",
      createdBy: "owner",
      createdAt: session.createdAt
    },
    {
      id: "share-comment",
      sessionId: session.id,
      token: "token-comment",
      permission: "comment",
      createdBy: "owner",
      createdAt: session.createdAt
    },
    {
      id: "share-edit",
      sessionId: session.id,
      token: "token-edit",
      permission: "edit",
      createdBy: "owner",
      createdAt: session.createdAt
    }
  ];
  session.auditLog = [
    {
      id: "audit-secret",
      sessionId: session.id,
      actorId: "owner",
      action: "share.created",
      summary: "不应通过分享接口暴露",
      createdAt: session.createdAt
    }
  ];
  const listeners = new Set<(event: EditSessionEvent) => void>();
  const sharePermissions = new Map(
    session.shareLinks.map((link) => [link.token, link.permission])
  );
  const createTurn = vi.fn(async () => session);
  const createComment = vi.fn(async () => session);
  const sharedSession = {
    ...session,
    shareLinks: [],
    auditLog: []
  };
  const service = {
    assets: {
      rootDirectory: directory
    },
    list: vi.fn(() => []),
    get: vi.fn((id: string) => {
      if (id !== session.id) {
        throw new EditSessionServiceError(
          404,
          "EDIT_SESSION_NOT_FOUND",
          "修图会话不存在"
        );
      }

      return session;
    }),
    create: vi.fn(async () => session),
    update: vi.fn(async () => session),
    createTurn,
    createComment,
    updateComment: vi.fn(async () => session),
    updateWorkflow: vi.fn(async () => session),
    createShareLink: vi.fn(async () => ({
      session,
      link: session.shareLinks![0]
    })),
    answerClarification: vi.fn(async () => session),
    cancelTurn: vi.fn(async () => session),
    retryJob: vi.fn(async () => session),
    checkoutVersion: vi.fn(async () => session),
    createBranch: vi.fn(async () => session),
    updateBranch: vi.fn(async () => session),
    delete: vi.fn(async () => undefined),
    getShareAccess: vi.fn((token: string) => {
      const permission = sharePermissions.get(token);

      if (!permission) {
        throw new EditSessionServiceError(
          404,
          "EDIT_SHARE_NOT_FOUND",
          "分享链接不存在、已撤销或已过期"
        );
      }

      return {
        permission,
        sessionId: session.id
      };
    }),
    getSharedSession: vi.fn((token: string) => {
      const permission = sharePermissions.get(token);

      if (!permission) {
        throw new EditSessionServiceError(
          404,
          "EDIT_SHARE_NOT_FOUND",
          "分享链接不存在、已撤销或已过期"
        );
      }

      return {
        permission,
        session: sharedSession
      };
    }),
    subscribe: vi.fn(
      (_id: string, listener: (event: EditSessionEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    )
  } as unknown as EditSessionService;

  return {
    session,
    service,
    createTurn,
    createComment,
    emit(event: EditSessionEvent) {
      listeners.forEach((listener) => listener(event));
    }
  };
}

describe("edit session router", () => {
  it("normalizes REST service errors", async () => {
    const fake = createFakeService();
    const baseURL = await startRouterServer(fake.service);
    const response = await fetch(`${baseURL}/missing-session`);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({
      success: false,
      error: {
        code: "EDIT_SESSION_NOT_FOUND",
        statusCode: 404
      }
    });
  });

  it("streams snapshot, update, and delete events over SSE", async () => {
    const fake = createFakeService();
    const baseURL = await startRouterServer(fake.service);
    const controller = new AbortController();
    const response = await fetch(`${baseURL}/${fake.session.id}/events`, {
      signal: controller.signal
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const state = { buffer: "" };
    const snapshotFrame = await readSseFrame(reader, state);

    expect(snapshotFrame).toContain('"type":"edit.snapshot"');
    expect(snapshotFrame).toContain(`"sessionId":"${fake.session.id}"`);

    fake.emit({
      id: "edit-event-updated",
      sessionId: fake.session.id,
      type: "session.updated",
      occurredAt: "2026-07-13T00:00:01.000Z",
      session: {
        ...fake.session,
        title: "实时更新后的修图会话"
      }
    });
    const updateFrame = await readSseFrame(reader, state);
    expect(updateFrame).toContain("实时更新后的修图会话");

    fake.emit({
      id: "edit-event-deleted",
      sessionId: fake.session.id,
      type: "session.deleted",
      occurredAt: "2026-07-13T00:00:02.000Z"
    });
    const deleteFrame = await readSseFrame(reader, state);
    expect(deleteFrame).toContain('"type":"session.deleted"');
    expect((await reader.read()).done).toBe(true);
    controller.abort();
  });

  it("enforces view, comment, and edit permissions for shared requests", async () => {
    const fake = createFakeService();
    const baseURL = await startRouterServer(fake.service);
    const sessionURL = `${baseURL}/${fake.session.id}`;
    const sharedHeaders = (token: string) => ({
      "Content-Type": "application/json",
      "X-Edit-Share-Token": token
    });

    const sharedView = await fetch(sessionURL, {
      headers: sharedHeaders("token-view")
    });
    const sharedViewBody = await sharedView.json();
    expect(sharedView.status).toBe(200);
    expect(sharedViewBody.data.shareLinks).toEqual([]);
    expect(sharedViewBody.data.auditLog).toEqual([]);

    const viewComment = await fetch(`${sessionURL}/comments`, {
      method: "POST",
      headers: sharedHeaders("token-view"),
      body: JSON.stringify({ body: "只读链接不应允许评论" })
    });
    expect(viewComment.status).toBe(403);

    const commentCreate = await fetch(`${sessionURL}/comments`, {
      method: "POST",
      headers: sharedHeaders("token-comment"),
      body: JSON.stringify({ body: "请再微调一下背景。" })
    });
    expect(commentCreate.status).toBe(201);
    expect(fake.createComment).toHaveBeenCalledOnce();

    const commentTurn = await fetch(`${sessionURL}/turns`, {
      method: "POST",
      headers: sharedHeaders("token-comment"),
      body: JSON.stringify({})
    });
    expect(commentTurn.status).toBe(403);

    const editTurn = await fetch(`${sessionURL}/turns`, {
      method: "POST",
      headers: sharedHeaders("token-edit"),
      body: JSON.stringify({})
    });
    expect(editTurn.status).toBe(202);
    expect(fake.createTurn).toHaveBeenCalledOnce();

    const editWorkflow = await fetch(`${sessionURL}/workflow`, {
      method: "POST",
      headers: sharedHeaders("token-edit"),
      body: JSON.stringify({ action: "publish" })
    });
    expect(editWorkflow.status).toBe(403);

    const editShare = await fetch(`${sessionURL}/share-links`, {
      method: "POST",
      headers: sharedHeaders("token-edit"),
      body: JSON.stringify({ permission: "view" })
    });
    expect(editShare.status).toBe(403);

    const editDelete = await fetch(sessionURL, {
      method: "DELETE",
      headers: sharedHeaders("token-edit")
    });
    expect(editDelete.status).toBe(403);
  });

  it("sanitizes shared SSE snapshots", async () => {
    const fake = createFakeService();
    const baseURL = await startRouterServer(fake.service);
    const controller = new AbortController();
    const response = await fetch(
      `${baseURL}/${fake.session.id}/events?shareToken=token-view`,
      { signal: controller.signal }
    );
    const reader = response.body!.getReader();
    const frame = await readSseFrame(reader, { buffer: "" });

    expect(response.status).toBe(200);
    expect(frame).toContain('"shareLinks":[]');
    expect(frame).toContain('"auditLog":[]');
    expect(frame).not.toContain("token-view");
    expect(frame).not.toContain("audit-secret");
    controller.abort();
  });
});

async function readSseFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  state: { buffer: string }
) {
  const decoder = new TextDecoder();

  while (!state.buffer.includes("\n\n")) {
    const chunk = await reader.read();

    if (chunk.done) {
      break;
    }

    state.buffer += decoder.decode(chunk.value, { stream: true });
  }

  const separatorIndex = state.buffer.indexOf("\n\n");

  if (separatorIndex < 0) {
    const remaining = state.buffer;
    state.buffer = "";
    return remaining;
  }

  const frame = state.buffer.slice(0, separatorIndex);
  state.buffer = state.buffer.slice(separatorIndex + 2);
  return frame;
}
