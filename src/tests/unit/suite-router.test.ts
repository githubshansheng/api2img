import fs from "node:fs";
import http, { type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerationSuiteEvent } from "../../domain";
import { createGenerationSuiteRouter } from "../../../server/suite/suite-router";
import {
  GenerationSuiteService,
  GenerationSuiteServiceError
} from "../../../server/suite/suite-service";
import { createGenerationSet } from "../helpers/generation-suite";

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

async function startRouterServer(service: GenerationSuiteService) {
  const app = express();
  app.use(express.json());
  app.use("/api/generation-suites", createGenerationSuiteRouter(service));
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  return `http://127.0.0.1:${address.port}/api/generation-suites`;
}

function createFakeService() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "api2img-suite-router-"));
  temporaryDirectories.push(directory);
  const suite = createGenerationSet();
  const listeners = new Set<(event: GenerationSuiteEvent) => void>();
  const service = {
    assets: {
      rootDirectory: directory
    },
    getTemplates: vi.fn(() => [
      {
        id: "consistent-subject-4",
        name: "通用同主体 4 张"
      }
    ]),
    list: vi.fn(() => [suite]),
    create: vi.fn(async () => suite),
    get: vi.fn((id: string) => {
      if (id !== suite.id) {
        throw new GenerationSuiteServiceError(404, "SUITE_NOT_FOUND", "套图记录不存在");
      }

      return suite;
    }),
    update: vi.fn(async () => suite),
    start: vi.fn(async () => suite),
    selectAnchor: vi.fn(async () => suite),
    retrySlot: vi.fn(async () => suite),
    cancel: vi.fn(async () => suite),
    delete: vi.fn(async () => undefined),
    subscribe: vi.fn((_id: string, listener: (event: GenerationSuiteEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    })
  } as unknown as GenerationSuiteService;

  return {
    suite,
    service,
    emit(event: GenerationSuiteEvent) {
      listeners.forEach((listener) => listener(event));
    }
  };
}

describe("generation suite router", () => {
  it("serves REST envelopes and normalizes service errors", async () => {
    const fake = createFakeService();
    const baseURL = await startRouterServer(fake.service);

    const templatesResponse = await fetch(`${baseURL}/templates`);
    const templatesBody = await templatesResponse.json();
    expect(templatesResponse.status).toBe(200);
    expect(templatesBody).toMatchObject({
      success: true,
      data: [
        {
          id: "consistent-subject-4"
        }
      ]
    });

    const createResponse = await fetch(baseURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        templateId: "consistent-subject-4",
        modelId: "gpt-image-2"
      })
    });
    expect(createResponse.status).toBe(201);
    expect(fake.service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: "consistent-subject-4",
        modelId: "gpt-image-2"
      })
    );

    const missingResponse = await fetch(`${baseURL}/missing-suite`);
    const missingBody = await missingResponse.json();
    expect(missingResponse.status).toBe(404);
    expect(missingBody).toMatchObject({
      success: false,
      error: {
        code: "SUITE_NOT_FOUND",
        statusCode: 404
      }
    });
  });

  it("streams an initial snapshot and subsequent suite events over SSE", async () => {
    const fake = createFakeService();
    const baseURL = await startRouterServer(fake.service);
    const controller = new AbortController();
    const response = await fetch(`${baseURL}/${fake.suite.id}/events`, {
      signal: controller.signal
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.body).toBeTruthy();

    const reader = response.body!.getReader();
    const state = { buffer: "" };
    const snapshotFrame = await readSseFrame(reader, state);
    expect(snapshotFrame).toContain('"type":"suite.snapshot"');
    expect(snapshotFrame).toContain(`"suiteId":"${fake.suite.id}"`);

    fake.emit({
      id: "event-updated",
      suiteId: fake.suite.id,
      type: "suite.updated",
      occurredAt: "2026-07-12T00:00:05.000Z",
      suite: {
        ...fake.suite,
        name: "实时更新后的套图"
      }
    });

    const updateFrame = await readSseFrame(reader, state);
    expect(updateFrame).toContain("event-updated");
    expect(updateFrame).toContain("实时更新后的套图");

    fake.emit({
      id: "event-deleted",
      suiteId: fake.suite.id,
      type: "suite.deleted",
      occurredAt: "2026-07-12T00:00:06.000Z"
    });

    const deletedFrame = await readSseFrame(reader, state);
    expect(deletedFrame).toContain("event-deleted");
    expect(deletedFrame).toContain('"type":"suite.deleted"');
    expect((await reader.read()).done).toBe(true);

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
