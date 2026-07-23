import express from "express";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVector3DViewpointRouter } from "../../../server/vector3d/vector3d-router";

const mocks = vi.hoisted(() => ({
  generate: vi.fn()
}));

vi.mock("../../../server/vector3d/vector3d-service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../server/vector3d/vector3d-service")
    >();

  return {
    ...actual,
    generateVector3DView: mocks.generate
  };
});

const servers: Server[] = [];

afterEach(async () => {
  mocks.generate.mockReset();

  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        })
    )
  );
});

describe("Vector3D viewpoint router", () => {
  it("aborts the service signal when a streaming browser request disconnects", async () => {
    let serviceSignal: AbortSignal | undefined;
    let resolveServiceAbort: (() => void) | undefined;
    const serviceAborted = new Promise<void>((resolve) => {
      resolveServiceAbort = resolve;
    });

    mocks.generate.mockImplementation(
      (
        _input: unknown,
        onStage:
          | ((event: {
              stage: "reasoning" | "rendering";
              message: string;
            }) => void)
          | undefined,
        signal: AbortSignal
      ) => {
        serviceSignal = signal;
        onStage?.({
          stage: "reasoning",
          message: "reasoning started"
        });

        return new Promise((_resolve, reject) => {
          const handleAbort = () => {
            resolveServiceAbort?.();
            reject(new DOMException("Aborted", "AbortError"));
          };

          if (signal.aborted) {
            handleAbort();
          } else {
            signal.addEventListener("abort", handleAbort, { once: true });
          }
        });
      }
    );

    const app = express();
    app.use(express.json());
    app.use("/api/generate-3d-view", createVector3DViewpointRouter());
    const server = await listen(app);
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Test server did not expose a TCP port.");
    }

    const controller = new AbortController();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/generate-3d-view?stream=1`,
      {
        method: "POST",
        headers: {
          Accept: "application/x-ndjson",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          requestId: "router-disconnect-test"
        }),
        signal: controller.signal
      }
    );
    const reader = response.body?.getReader();

    expect(response.status).toBe(200);
    expect(reader).toBeTruthy();
    expect(
      new TextDecoder().decode((await reader!.read()).value)
    ).toContain('"stage":"reasoning"');

    controller.abort();

    await expect(
      Promise.race([
        serviceAborted,
        new Promise((_resolve, reject) => {
          setTimeout(
            () => reject(new Error("Service signal was not aborted.")),
            2000
          );
        })
      ])
    ).resolves.toBeUndefined();
    expect(serviceSignal?.aborted).toBe(true);
  });
});

function listen(app: ReturnType<typeof express>) {
  return new Promise<Server>((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
}
