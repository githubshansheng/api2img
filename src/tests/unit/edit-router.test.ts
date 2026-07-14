import fs from "node:fs";
import http, { type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditSessionEvent } from "../../domain";
import { EditAssetStore } from "../../../server/edit/edit-assets";
import { createEditSessionRouter } from "../../../server/edit/edit-router";
import {
  EditSessionService,
  EditSessionServiceError
} from "../../../server/edit/edit-service";
import { EditSessionStore } from "../../../server/edit/edit-store";
import { createEditVisitorMiddleware } from "../../../server/edit/edit-visitor";
import {
  createEditImageInput,
  createEditSessionFixture
} from "../helpers/image-editing";

const servers: Server[] = [];
const temporaryDirectories: string[] = [];
const stores: EditSessionStore[] = [];

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
  stores.splice(0).forEach((store) => store.close());
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

function createIsolatedService() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "api2img-edit-isolation-"));
  const store = new EditSessionStore(path.join(directory, "edit-sessions.sqlite"));
  temporaryDirectories.push(directory);
  stores.push(store);

  return {
    service: new EditSessionService({
      store,
      assets: new EditAssetStore(path.join(directory, "assets"))
    }),
    store
  };
}

async function createBrowser(baseURL: string) {
  const response = await fetch(baseURL);

  return {
    cookie: readVisitorCookie(response),
    response
  };
}

function fetchAsBrowser(
  url: string,
  cookie: string,
  options: RequestInit = {}
) {
  const headers = new Headers(options.headers);
  headers.set("Cookie", cookie);
  return fetch(url, {
    ...options,
    headers
  });
}

function readVisitorCookie(response: Response) {
  const setCookie = response.headers.get("set-cookie");

  if (!setCookie) {
    throw new Error("Expected the edit visitor middleware to issue a cookie.");
  }

  return setCookie.split(";")[0]!;
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

  it("isolates anonymous visitor sessions, workspaces, mutations, SSE, and assets", async () => {
    const { service, store } = createIsolatedService();
    const baseURL = await startRouterServer(service);
    const browserA = await createBrowser(baseURL);
    const browserB = await createBrowser(baseURL);
    const createResponse = await fetchAsBrowser(baseURL, browserA.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelId: "gpt-image-2",
        source: createEditImageInput("visitor-a-source")
      })
    });
    const createdBody = await createResponse.json();
    const session = createdBody.data;
    const assetURL = new URL(session.assets[0].url, baseURL).toString();

    expect(createResponse.status).toBe(201);

    const listA = await fetchAsBrowser(baseURL, browserA.cookie);
    const listB = await fetchAsBrowser(baseURL, browserB.cookie);
    expect((await listA.json()).data).toHaveLength(1);
    expect((await listB.json()).data).toEqual([]);

    const forbiddenRequests = [
      fetchAsBrowser(`${baseURL}/${session.id}`, browserB.cookie),
      fetchAsBrowser(`${baseURL}/${session.id}`, browserB.cookie, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "other browser" })
      }),
      fetchAsBrowser(`${baseURL}/${session.id}/turns`, browserB.cookie, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      }),
      fetchAsBrowser(`${baseURL}/${session.id}/branches`, browserB.cookie, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      }),
      fetchAsBrowser(`${baseURL}/${session.id}/comments`, browserB.cookie, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      }),
      fetchAsBrowser(`${baseURL}/${session.id}/export`, browserB.cookie),
      fetchAsBrowser(`${baseURL}/${session.id}/events`, browserB.cookie),
      fetchAsBrowser(`${baseURL}/${session.id}`, browserB.cookie, {
        method: "DELETE"
      })
    ];

    for (const response of await Promise.all(forbiddenRequests)) {
      expect(response.status).toBe(404);
    }

    const ownerUpdate = await fetchAsBrowser(`${baseURL}/${session.id}`, browserA.cookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "visitor A updated session" })
    });
    expect(ownerUpdate.status).toBe(200);
    expect((await ownerUpdate.json()).data.title).toBe("visitor A updated session");

    const workspaceUpdate = await fetchAsBrowser(
      `${baseURL}/platform/workspace`,
      browserA.cookie,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Visitor A workspace",
          quota: { dailyCandidateLimit: 1 }
        })
      }
    );
    expect(workspaceUpdate.status).toBe(200);

    const templateResponse = await fetchAsBrowser(
      `${baseURL}/platform/templates`,
      browserA.cookie,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Visitor A template",
          instruction: "Improve the lighting."
        })
      }
    );
    expect(templateResponse.status).toBe(201);

    const brandAssetResponse = await fetchAsBrowser(
      `${baseURL}/platform/brand-assets`,
      browserA.cookie,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Visitor A asset",
          kind: "reference",
          sessionId: session.id,
          versionId: session.currentVersionId,
          assetURL: session.assets[0].url
        })
      }
    );
    expect(brandAssetResponse.status).toBe(201);

    const platformA = await fetchAsBrowser(`${baseURL}/platform`, browserA.cookie);
    const platformB = await fetchAsBrowser(`${baseURL}/platform`, browserB.cookie);
    const platformAData = (await platformA.json()).data;
    const platformBData = (await platformB.json()).data;
    expect(platformAData.workspace).toMatchObject({
      name: "Visitor A workspace",
      quota: { dailyCandidateLimit: 1 }
    });
    expect(platformAData.workspace.templates).toHaveLength(1);
    expect(platformAData.workspace.brandAssets).toHaveLength(1);
    expect(platformAData.metrics.sessionCount).toBe(1);
    expect(platformBData.workspace.name).not.toBe("Visitor A workspace");
    expect(platformBData.workspace.templates).toEqual([]);
    expect(platformBData.workspace.brandAssets).toEqual([]);
    expect(platformBData.metrics.sessionCount).toBe(0);

    expect((await fetchAsBrowser(assetURL, browserA.cookie)).status).toBe(200);
    expect((await fetchAsBrowser(assetURL, browserB.cookie)).status).toBe(404);
    expect((await fetch(`${assetURL}?shareToken=invalid-share-token`)).status).toBe(404);

    const shareResponse = await fetchAsBrowser(
      `${baseURL}/${session.id}/share-links`,
      browserA.cookie,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permission: "view" })
      }
    );
    const share = (await shareResponse.json()).data.link;
    expect(shareResponse.status).toBe(201);
    expect(
      (await fetch(`${assetURL}?shareToken=${encodeURIComponent(share.token)}`)).status
    ).toBe(200);

    const secondSessionResponse = await fetchAsBrowser(baseURL, browserA.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelId: "gpt-image-2",
        source: createEditImageInput("visitor-a-second-source")
      })
    });
    const secondSession = (await secondSessionResponse.json()).data;
    const secondAssetURL = new URL(secondSession.assets[0].url, baseURL).toString();
    expect(
      (
        await fetch(
          `${secondAssetURL}?shareToken=${encodeURIComponent(share.token)}`
        )
      ).status
    ).toBe(404);

    const expiredShare = await fetchAsBrowser(
      `${baseURL}/${session.id}/share-links`,
      browserA.cookie,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permission: "view" })
      }
    );
    const expiredShareToken = (await expiredShare.json()).data.link.token;
    const storedSession = store.getAny(session.id)!;
    const expiredLink = storedSession.shareLinks!.find(
      (link) => link.token === expiredShareToken
    )!;
    expiredLink.expiresAt = "2020-01-01T00:00:00.000Z";
    store.save(storedSession);
    expect(
      (
        await fetch(
          `${assetURL}?shareToken=${encodeURIComponent(expiredShareToken)}`
        )
      ).status
    ).toBe(404);

    const revokeResponse = await fetchAsBrowser(
      `${baseURL}/${session.id}/share-links/${share.id}`,
      browserA.cookie,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revoked: true })
      }
    );
    expect(revokeResponse.status).toBe(200);
    expect(
      (await fetch(`${assetURL}?shareToken=${encodeURIComponent(share.token)}`)).status
    ).toBe(404);
  });

  it("signs, renews, and replaces anonymous visitor cookies", async () => {
    const { service } = createIsolatedService();
    const baseURL = await startRouterServer(service);
    const first = await fetch(baseURL);
    const firstCookie = readVisitorCookie(first);
    const setCookie = first.headers.get("set-cookie")!;

    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/api/edit-sessions");
    expect(setCookie).not.toContain("Secure");

    const renewed = await fetchAsBrowser(baseURL, firstCookie);
    expect(readVisitorCookie(renewed)).toBe(firstCookie);

    const tamperedCookie = `${firstCookie.slice(0, -1)}x`;
    const tampered = await fetchAsBrowser(baseURL, tamperedCookie);
    expect((await tampered.json()).data).toEqual([]);
    expect(readVisitorCookie(tampered)).not.toBe(firstCookie);
  });

  it("requires a visitor secret and marks the cookie Secure in production", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSecret = process.env.API2IMG_EDIT_SESSION_SECRET;

    try {
      process.env.NODE_ENV = "production";
      delete process.env.API2IMG_EDIT_SESSION_SECRET;
      expect(() => createEditVisitorMiddleware()).toThrow(
        "API2IMG_EDIT_SESSION_SECRET is required"
      );

      process.env.API2IMG_EDIT_SESSION_SECRET = "production-test-secret";
      const app = express();
      app.use(createEditVisitorMiddleware());
      app.get("/", (_req, res) => res.status(204).end());
      const server = http.createServer(app);
      servers.push(server);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/`);

      expect(response.headers.get("set-cookie")).toContain("Secure");
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }

      if (originalSecret === undefined) {
        delete process.env.API2IMG_EDIT_SESSION_SECRET;
      } else {
        process.env.API2IMG_EDIT_SESSION_SECRET = originalSecret;
      }
    }
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
