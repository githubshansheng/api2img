import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PNG } from "pngjs";
import { getModelById } from "../../config/models";
import type {
  EditImageInput,
  GenerationRequestPayload
} from "../../domain";
import { EditAssetStore } from "../../../server/edit/edit-assets";
import { EditExecutor } from "../../../server/edit/edit-executor";
import { EditSessionService } from "../../../server/edit/edit-service";
import { EditSessionStore } from "../../../server/edit/edit-store";
import type { GenerationExecutionResult } from "../../../server/generation-executor";
import { GenerationSuiteScheduler } from "../../../server/suite/suite-scheduler";
import {
  createSuccessfulGenerationExecution
} from "../helpers/generation-suite";
import {
  createEditImageInput,
  createEditTurnRequest
} from "../helpers/image-editing";

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

function createService(
  executeGeneration: (
    input: Partial<GenerationRequestPayload>,
    signal?: AbortSignal
  ) => Promise<GenerationExecutionResult>,
  createAssets?: (directory: string) => EditAssetStore
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "api2img-edit-service-"));
  const store = new EditSessionStore(path.join(directory, "edit-sessions.sqlite"));
  const scheduler = new GenerationSuiteScheduler(4);
  const assets =
    createAssets?.(directory) ??
    new EditAssetStore(path.join(directory, "assets"));
  const executor = new EditExecutor({
    assets,
    executeGeneration
  });
  const service = new EditSessionService({
    store,
    assets,
    scheduler,
    executor
  });

  cleanups.push(() => {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  return { service, scheduler, assets, store, directory };
}

describe("edit session service", () => {
  it("persists native OpenAI continuation when the model defaults to Responses", async () => {
    const model = getModelById("gpt-image-2")!;
    const originalEndpointType = model.endpointType;
    const originalContinuationMode = model.editCapabilities.continuationMode;
    const executeGeneration = vi.fn(
      async (input: Partial<GenerationRequestPayload>) => {
        const execution = createSuccessfulGenerationExecution(input);

        if (!execution.success) {
          throw new Error("Expected successful generation fixture");
        }

        execution.data.result!.continuation = {
          responseId: "resp-native-continuation"
        };
        return execution;
      }
    );

    model.endpointType = "responses";
    model.editCapabilities.continuationMode = "openai-response";

    try {
      const { service, scheduler } = createService(executeGeneration);
      const created = await service.create({
        modelId: model.id,
        source: createEditImageInput("source")
      });

      await service.createTurn(
        created.id,
        createEditTurnRequest(created, {
          candidateCount: 1
        })
      );
      await scheduler.waitForIdle();

      const completed = service.get(created.id);
      expect(completed.continuations).toHaveLength(1);
      expect(completed.continuations[0]).toMatchObject({
        strategy: "openai-response",
        responseId: "resp-native-continuation"
      });
    } finally {
      model.endpointType = originalEndpointType;
      model.editCapabilities.continuationMode = originalContinuationMode;
    }
  });

  it("reuses native OpenAI continuation across five checked-out edit turns", async () => {
    const model = getModelById("gpt-image-2")!;
    const originalEndpointType = model.endpointType;
    const originalContinuationMode = model.editCapabilities.continuationMode;
    const continuations: Array<string | undefined> = [];
    let callCount = 0;
    const executeGeneration = vi.fn(
      async (input: Partial<GenerationRequestPayload>) => {
        callCount += 1;
        continuations.push(input.continuation?.responseId);
        const execution = createSuccessfulGenerationExecution(input);

        if (!execution.success) {
          throw new Error("Expected successful generation fixture");
        }

        execution.data.result!.continuation = {
          responseId: `resp-${callCount}`
        };
        return execution;
      }
    );

    model.endpointType = "responses";
    model.editCapabilities.continuationMode = "openai-response";

    try {
      const { service, scheduler } = createService(executeGeneration);
      let session = await service.create({
        modelId: model.id,
        source: createEditImageInput("source")
      });

      for (let turnIndex = 1; turnIndex <= 5; turnIndex += 1) {
        await service.createTurn(
          session.id,
          createEditTurnRequest(session, {
            clientTurnId: `continuation-turn-${turnIndex}`,
            candidateCount: 1,
            originalInstruction: `连续修图第 ${turnIndex} 轮`
          })
        );
        await scheduler.waitForIdle();
        session = service.get(session.id);
        const turn = session.turns.find(
          (item) => item.clientTurnId === `continuation-turn-${turnIndex}`
        )!;
        const versionId = session.jobs.find(
          (job) => job.turnId === turn.id
        )!.resultVersionId!;
        session = await service.checkoutVersion(session.id, versionId);
      }

      expect(session.turns).toHaveLength(5);
      expect(session.turns.every((turn) => turn.status === "succeeded")).toBe(
        true
      );
      expect(continuations).toEqual([
        undefined,
        "resp-1",
        "resp-2",
        "resp-3",
        "resp-4"
      ]);
      expect(session.currentVersionId).toBe(
        session.jobs.at(-1)?.resultVersionId
      );
    } finally {
      model.endpointType = originalEndpointType;
      model.editCapabilities.continuationMode = originalContinuationMode;
    }
  });

  it("falls back to the checked-out image when native continuation is expired", async () => {
    const model = getModelById("gpt-image-2")!;
    const originalEndpointType = model.endpointType;
    const originalContinuationMode = model.editCapabilities.continuationMode;
    const requests: Array<Partial<GenerationRequestPayload>> = [];
    let callCount = 0;
    const executeGeneration = vi.fn(
      async (input: Partial<GenerationRequestPayload>) => {
        callCount += 1;
        requests.push(input);
        const execution = createSuccessfulGenerationExecution(input);

        if (!execution.success) {
          throw new Error("Expected successful generation fixture");
        }

        execution.data.result!.continuation = {
          responseId: `resp-expiry-${callCount}`
        };
        return execution;
      }
    );

    model.endpointType = "responses";
    model.editCapabilities.continuationMode = "openai-response";

    try {
      const { service, scheduler, store } = createService(executeGeneration);
      let session = await service.create({
        modelId: model.id,
        source: createEditImageInput("source")
      });

      await service.createTurn(
        session.id,
        createEditTurnRequest(session, {
          clientTurnId: "expiry-turn-1",
          candidateCount: 1
        })
      );
      await scheduler.waitForIdle();
      session = service.get(session.id);
      const firstResultId = session.jobs[0]!.resultVersionId!;
      session = await service.checkoutVersion(session.id, firstResultId);
      session.continuations.find(
        (continuation) => continuation.versionId === firstResultId
      )!.expiresAt = "2000-01-01T00:00:00.000Z";
      store.save(session);

      await service.createTurn(
        session.id,
        createEditTurnRequest(session, {
          clientTurnId: "expiry-turn-2",
          candidateCount: 1
        })
      );
      await scheduler.waitForIdle();

      expect(requests[1]?.continuation).toBeUndefined();
      expect(requests[1]?.referenceImages).toHaveLength(1);
      expect(requests[1]?.referenceImages?.[0]?.base64).toBeTruthy();
    } finally {
      model.endpointType = originalEndpointType;
      model.editCapabilities.continuationMode = originalContinuationMode;
    }
  });

  it("does not reuse continuation after an endpoint or model switch", async () => {
    const model = getModelById("gpt-image-2")!;
    const originalEndpointType = model.endpointType;
    const originalContinuationMode = model.editCapabilities.continuationMode;
    const requests: Array<Partial<GenerationRequestPayload>> = [];
    let callCount = 0;
    const executeGeneration = vi.fn(
      async (input: Partial<GenerationRequestPayload>) => {
        callCount += 1;
        requests.push(input);
        const execution = createSuccessfulGenerationExecution(input);

        if (!execution.success) {
          throw new Error("Expected successful generation fixture");
        }

        execution.data.result!.continuation = {
          responseId: `resp-switch-${callCount}`
        };
        return execution;
      }
    );

    model.endpointType = "responses";
    model.editCapabilities.continuationMode = "openai-response";

    try {
      const { service, scheduler } = createService(executeGeneration);
      let session = await service.create({
        modelId: model.id,
        source: createEditImageInput("source")
      });

      await service.createTurn(
        session.id,
        createEditTurnRequest(session, {
          clientTurnId: "switch-turn-1",
          candidateCount: 1,
          endpointOverride: {
            apiKey: "test-secret",
            baseURL: "https://endpoint-a.example",
            endpointVariant: "responses"
          }
        })
      );
      await scheduler.waitForIdle();
      session = service.get(session.id);
      session = await service.checkoutVersion(
        session.id,
        session.jobs.at(-1)!.resultVersionId!
      );

      await service.createTurn(
        session.id,
        createEditTurnRequest(session, {
          clientTurnId: "switch-turn-2",
          candidateCount: 1,
          endpointOverride: {
            apiKey: "test-secret",
            baseURL: "https://endpoint-b.example",
            endpointVariant: "responses"
          }
        })
      );
      await scheduler.waitForIdle();
      session = service.get(session.id);
      session = await service.checkoutVersion(
        session.id,
        session.jobs.at(-1)!.resultVersionId!
      );

      await service.createTurn(
        session.id,
        createEditTurnRequest(session, {
          clientTurnId: "switch-turn-3",
          modelId: "nano-banana-pro",
          modelDisplayName: "Nano Banana Pro",
          candidateCount: 1,
          endpointOverride: {
            apiKey: "test-secret",
            baseURL: "https://google-endpoint.example"
          }
        })
      );
      await scheduler.waitForIdle();

      expect(requests[0]?.continuation).toBeUndefined();
      expect(requests[1]?.continuation).toBeUndefined();
      expect(requests[2]?.continuation).toBeUndefined();
      expect(requests[2]?.modelId).toBe("nano-banana-pro");
    } finally {
      model.endpointType = originalEndpointType;
      model.editCapabilities.continuationMode = originalContinuationMode;
    }
  });

  it("creates parallel detached candidates, then creates a two-parent merge", async () => {
    let activeExecutions = 0;
    let peakExecutions = 0;
    const executeGeneration = vi.fn(
      async (input: Partial<GenerationRequestPayload>) => {
        activeExecutions += 1;
        peakExecutions = Math.max(peakExecutions, activeExecutions);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeExecutions -= 1;
        return createSuccessfulGenerationExecution(input);
      }
    );
    const { service, scheduler } = createService(executeGeneration);
    const created = await service.create({
      modelId: "gpt-image-2",
      source: createEditImageInput("source")
    });
    const rootVersionId = created.currentVersionId;
    const firstTurnRequest = createEditTurnRequest(created, {
      candidateCount: 3,
      endpointOverride: {
        apiKey: "runtime-api-key",
        headers: {
          "X-Auth": "runtime-header-secret"
        }
      }
    });

    await service.createTurn(created.id, firstTurnRequest);
    await scheduler.waitForIdle();

    const candidatesReady = service.get(created.id);
    const firstTurn = candidatesReady.turns[0]!;
    const candidateVersions = candidatesReady.versions.filter(
      (version) => version.turnId === firstTurn.id
    );

    expect(peakExecutions).toBeGreaterThan(1);
    expect(firstTurn.status).toBe("succeeded");
    expect(candidateVersions).toHaveLength(3);
    expect(candidateVersions.every(
      (version) => version.parentVersionIds[0] === rootVersionId
    )).toBe(true);
    expect(candidatesReady.currentVersionId).toBe(rootVersionId);
    expect(JSON.stringify(candidatesReady)).not.toContain("runtime-api-key");
    expect(JSON.stringify(candidatesReady)).not.toContain("runtime-header-secret");

    await service.createTurn(
      created.id,
      createEditTurnRequest(candidatesReady, {
        clientTurnId: "merge-turn",
        sourceVersionIds: [
          candidateVersions[0]!.id,
          candidateVersions[1]!.id
        ],
        mode: "merge",
        candidateCount: 1,
        originalInstruction: "以第一个版本为主，融合第二个版本的背景光线。",
        regions: []
      })
    );
    await scheduler.waitForIdle();

    const merged = service.get(created.id);
    const mergeTurn = merged.turns.find(
      (turn) => turn.clientTurnId === "merge-turn"
    )!;
    const mergeVersion = merged.versions.find(
      (version) => version.turnId === mergeTurn.id
    );

    expect(mergeTurn.status).toBe("succeeded");
    expect(mergeVersion?.parentVersionIds).toEqual([
      candidateVersions[0]!.id,
      candidateVersions[1]!.id
    ]);
  });

  it("supports one through four candidates and preserves successes on partial failure", async () => {
    const successfulExecution = vi.fn(
      async (input: Partial<GenerationRequestPayload>) =>
        createSuccessfulGenerationExecution(input)
    );
    const first = createService(successfulExecution);

    for (let candidateCount = 1; candidateCount <= 4; candidateCount += 1) {
      const session = await first.service.create({
        modelId: "gpt-image-2",
        source: createEditImageInput(`candidate-source-${candidateCount}`)
      });
      await first.service.createTurn(
        session.id,
        createEditTurnRequest(session, {
          clientTurnId: `candidate-count-${candidateCount}`,
          candidateCount
        })
      );
      await first.scheduler.waitForIdle();
      const completed = first.service.get(session.id);

      expect(completed.turns[0]?.candidateCount).toBe(candidateCount);
      expect(completed.jobs).toHaveLength(candidateCount);
      expect(
        completed.versions.filter((version) => version.turnId).length
      ).toBe(candidateCount);
    }

    let partialCall = 0;
    const partialExecution = vi.fn(
      async (input: Partial<GenerationRequestPayload>) => {
        partialCall += 1;

        if (partialCall === 2) {
          throw new Error("candidate failed");
        }

        return createSuccessfulGenerationExecution(input);
      }
    );
    const partial = createService(partialExecution);
    const session = await partial.service.create({
      modelId: "gpt-image-2",
      source: createEditImageInput("partial-source")
    });

    await partial.service.createTurn(
      session.id,
      createEditTurnRequest(session, {
        clientTurnId: "partial-candidates",
        candidateCount: 4
      })
    );
    await partial.scheduler.waitForIdle();
    const completed = partial.service.get(session.id);

    expect(completed.turns[0]?.status).toBe("partial_success");
    expect(
      completed.jobs.filter((job) => job.status === "succeeded")
    ).toHaveLength(3);
    expect(
      completed.jobs.filter((job) => job.status === "failed")
    ).toHaveLength(1);
    expect(
      completed.versions.filter((version) => version.turnId).length
    ).toBe(3);
  });

  it("treats duplicate clientTurnId submissions as idempotent", async () => {
    const executeGeneration = vi.fn(
      async (input: Partial<GenerationRequestPayload>) =>
        createSuccessfulGenerationExecution(input)
    );
    const { service, scheduler } = createService(executeGeneration);
    const created = await service.create({
      modelId: "gpt-image-2",
      source: createEditImageInput("source")
    });
    const request = createEditTurnRequest(created, {
      clientTurnId: "stable-client-turn-id",
      candidateCount: 2
    });

    await Promise.all([
      service.createTurn(created.id, request),
      service.createTurn(created.id, request)
    ]);
    await scheduler.waitForIdle();
    await service.createTurn(created.id, request);
    const completed = service.get(created.id);

    expect(completed.turns).toHaveLength(1);
    expect(completed.jobs).toHaveLength(2);
    expect(executeGeneration).toHaveBeenCalledTimes(2);
  });

  it("rejects regions beyond model capacity before writing mask assets", async () => {
    const executeGeneration = vi.fn(
      async (input: Partial<GenerationRequestPayload>) =>
        createSuccessfulGenerationExecution(input)
    );
    const { service, assets } = createService(executeGeneration);
    const created = await service.create({
      modelId: "gpt-image-2",
      source: createEditImageInput("source")
    });
    const filesBefore = fs.readdirSync(assets.rootDirectory);

    await expect(
      service.createTurn(
        created.id,
        createEditTurnRequest(created, {
          modelId: "flux-kontext-pro",
          modelDisplayName: "Flux Kontext Pro",
          mode: "local",
          regions: Array.from({ length: 4 }, (_, index) => ({
            id: `region-${index}`,
            label: `区域 ${index + 1}`,
            color: "#22d3ee",
            instruction: "调整颜色",
            mask: createEditImageInput(`mask-${index}`, index)
          }))
        })
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "EDIT_MODEL_REGION_LIMIT_EXCEEDED"
    });
    expect(fs.readdirSync(assets.rootDirectory)).toEqual(filesBefore);
  });

  it("composes every canonical local region into one native mask", async () => {
    const requests: Array<Partial<GenerationRequestPayload>> = [];
    const executeGeneration = vi.fn(
      async (input: Partial<GenerationRequestPayload>) => {
        requests.push(input);
        return createSuccessfulGenerationExecution(input);
      }
    );
    const { service, scheduler } = createService(executeGeneration);
    const created = await service.create({
      modelId: "gpt-image-2",
      source: createTwoPixelImage("native-source", [255, 255])
    });

    await service.createTurn(
      created.id,
      createEditTurnRequest(created, {
        clientTurnId: "canonical-native-mask",
        candidateCount: 1,
        mode: "local",
        regions: [
          {
            id: "add-left",
            label: "左侧",
            color: "#22d3ee",
            instruction: "调亮",
            mask: createTwoPixelImage("add-left-mask", [255, 0]),
            combinationMode: "add",
            maskSemantics: "selection-alpha"
          },
          {
            id: "add-right",
            label: "右侧",
            color: "#f97316",
            instruction: "提高饱和度",
            mask: createTwoPixelImage("add-right-mask", [0, 255]),
            combinationMode: "add",
            maskSemantics: "selection-alpha"
          },
          {
            id: "subtract-left",
            label: "排除左侧",
            color: "#eab308",
            instruction: "保持不变",
            mask: createTwoPixelImage("subtract-left-mask", [255, 0]),
            combinationMode: "subtract",
            maskSemantics: "selection-alpha"
          }
        ]
      })
    );
    await scheduler.waitForIdle();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.referenceImages).toHaveLength(1);
    expect(requests[0]?.nativeMask?.inverted).toBe(false);
    const nativeMask = PNG.sync.read(
      Buffer.from(requests[0]!.nativeMask!.image.base64!, "base64")
    );
    expect([nativeMask.data[3], nativeMask.data[7]]).toEqual([255, 0]);
    expect(
      service.get(created.id).turns[0]?.regions.map((region) => ({
        id: region.id,
        combinationMode: region.combinationMode,
        maskSemantics: region.maskSemantics
      }))
    ).toEqual([
      {
        id: "add-left",
        combinationMode: "add",
        maskSemantics: "selection-alpha"
      },
      {
        id: "add-right",
        combinationMode: "add",
        maskSemantics: "selection-alpha"
      },
      {
        id: "subtract-left",
        combinationMode: "subtract",
        maskSemantics: "selection-alpha"
      }
    ]);
  });

  it("lists archived sessions, blocks edits, and allows editing after restore", async () => {
    const executeGeneration = vi.fn(
      async (input: Partial<GenerationRequestPayload>) =>
        createSuccessfulGenerationExecution(input)
    );
    const { service, scheduler } = createService(executeGeneration);
    const created = await service.create({
      modelId: "gpt-image-2",
      source: createEditImageInput("archive-source")
    });

    const archived = await service.update(created.id, { archived: true });

    expect(archived.status).toBe("archived");
    expect(archived.archivedAt).toBeTruthy();
    expect(service.list().find((session) => session.id === created.id)).toMatchObject({
      status: "archived"
    });
    await expect(
      service.createTurn(
        created.id,
        createEditTurnRequest(archived, {
          clientTurnId: "archived-turn",
          candidateCount: 1
        })
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "EDIT_SESSION_NOT_ACTIVE"
    });
    expect(executeGeneration).not.toHaveBeenCalled();

    const restored = await service.update(created.id, { archived: false });
    expect(restored.status).toBe("active");
    expect(restored.archivedAt).toBeUndefined();

    await service.createTurn(
      created.id,
      createEditTurnRequest(restored, {
        clientTurnId: "restored-turn",
        candidateCount: 1
      })
    );
    await scheduler.waitForIdle();

    const completed = service.get(created.id);
    expect(completed.turns.find(
      (turn) => turn.clientTurnId === "restored-turn"
    )?.status).toBe("succeeded");
    expect(
      completed.auditLog?.filter(
        (event) =>
          event.action === "session.updated" &&
          (event.metadata?.changes as string[] | undefined)?.some((change) =>
            ["archived", "restored"].includes(change)
          )
      ).map((event) => event.metadata?.changes)
    ).toEqual([["archived"], ["restored"]]);
  });

  it("removes a generated file when cancellation lands after persistence", async () => {
    let resolvePersisted = () => {};
    let releasePersistence = () => {};
    const persisted = new Promise<void>((resolve) => {
      resolvePersisted = resolve;
    });
    const allowPersistenceToReturn = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });

    class CancelDuringPersistenceAssetStore extends EditAssetStore {
      override async persistGenerated(
        input: Parameters<EditAssetStore["persistGenerated"]>[0]
      ) {
        const asset = await super.persistGenerated(input);
        resolvePersisted();
        await allowPersistenceToReturn;
        return asset;
      }
    }

    const executeGeneration = vi.fn(
      async (input: Partial<GenerationRequestPayload>) =>
        createSuccessfulGenerationExecution(input)
    );
    const { service, scheduler, assets } = createService(
      executeGeneration,
      (directory) =>
        new CancelDuringPersistenceAssetStore(path.join(directory, "assets"))
    );
    const created = await service.create({
      modelId: "gpt-image-2",
      source: createEditImageInput("source")
    });
    const sourceFiles = fs.readdirSync(assets.rootDirectory);
    const submitted = await service.createTurn(
      created.id,
      createEditTurnRequest(created, {
        candidateCount: 1
      })
    );
    const turnId = submitted.turns[0]!.id;

    await persisted;
    const cancellation = service.cancelTurn(created.id, turnId);
    await waitFor(() => service.get(created.id).turns[0]?.status === "canceled");
    releasePersistence();
    await cancellation;
    await scheduler.waitForIdle();

    const canceled = service.get(created.id);
    expect(canceled.turns[0]?.status).toBe("canceled");
    expect(canceled.versions).toHaveLength(1);
    expect(fs.readdirSync(assets.rootDirectory)).toEqual(sourceFiles);
  });

  it("persists a sanitized technical quality assessment for a direct child version", async () => {
    const executeGeneration = vi.fn(
      async (input: Partial<GenerationRequestPayload>) =>
        createSuccessfulGenerationExecution(input)
    );
    const { service, scheduler } = createService(executeGeneration);
    const created = await service.create({
      modelId: "gpt-image-2",
      source: createEditImageInput("source")
    });
    const sourceVersionId = created.currentVersionId;

    await service.createTurn(
      created.id,
      createEditTurnRequest(created, {
        candidateCount: 1
      })
    );
    await scheduler.waitForIdle();

    const completed = service.get(created.id);
    const resultVersion = completed.versions.find(
      (version) => version.parentVersionIds[0] === sourceVersionId
    )!;
    const assessed = await service.updateVersion(
      created.id,
      resultVersion.id,
      {
        qualityAssessment: {
          schemaVersion: 1,
          evaluator: "pixel-diff-v1",
          evaluatedAt: "2026-07-14T01:02:03.000Z",
          sourceVersionId,
          technicalScore: 83.4,
          changedPixelRatio: 0.123456,
          selectionCoverage: 0.9,
          outsideDriftRate: 0.02,
          protectedConsistencyScore: 0.98,
          edgeBlendScore: 0.81234,
          resampled: false,
          warnings: ["  检查文字边缘  ", "检查文字边缘"]
        }
      }
    );
    const persisted = assessed.versions.find(
      (version) => version.id === resultVersion.id
    );

    expect(persisted?.qualityAssessment).toEqual({
      schemaVersion: 1,
      evaluator: "pixel-diff-v1",
      evaluatedAt: "2026-07-14T01:02:03.000Z",
      sourceVersionId,
      technicalScore: 83,
      changedPixelRatio: 0.1235,
      selectionCoverage: 0.9,
      outsideDriftRate: 0.02,
      protectedConsistencyScore: 0.98,
      edgeBlendScore: 0.8123,
      resampled: false,
      warnings: ["检查文字边缘"]
    });
    expect(assessed.auditLog?.at(-1)).toMatchObject({
      action: "version.quality_evaluated",
      targetId: resultVersion.id,
      metadata: {
        evaluator: "pixel-diff-v1",
        sourceVersionId,
        technicalScore: 83,
        changedPixelRatio: 0.1235,
        warningCount: 1
      }
    });

    await expect(
      service.updateVersion(created.id, resultVersion.id, {
        qualityAssessment: {
          ...persisted!.qualityAssessment!,
          sourceVersionId: resultVersion.id
        }
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "EDIT_QUALITY_SOURCE_INVALID"
    });
  });

  it("applies quota, version governance, collaboration, review, and share rules", async () => {
    const executeGeneration = vi.fn(
      async (input: Partial<GenerationRequestPayload>) =>
        createSuccessfulGenerationExecution(input)
    );
    const { service } = createService(executeGeneration);
    const created = await service.create({
      modelId: "gpt-image-2",
      source: createEditImageInput("source")
    });
    const versionId = created.currentVersionId;

    const updatedVersion = await service.updateVersion(created.id, versionId, {
      label: "产品主视觉",
      tags: ["电商", "主图", "电商"],
      favorite: true,
      note: "保留作为发布候选",
      actorId: "editor-1"
    });
    expect(updatedVersion.versions[0]).toMatchObject({
      label: "产品主视觉",
      tags: ["电商", "主图"],
      favorite: true,
      note: "保留作为发布候选"
    });

    const commented = await service.createComment(created.id, {
      versionId,
      authorId: "reviewer-1",
      authorName: "审核人",
      body: "请确认 Logo 清晰度。"
    });
    const commentId = commented.comments![0]!.id;
    const resolved = await service.updateComment(created.id, commentId, {
      resolved: true,
      actorId: "editor-1"
    });
    expect(resolved.comments![0]?.resolvedAt).toBeTruthy();

    const approved = await service.createApproval(created.id, {
      versionId,
      reviewerId: "reviewer-1",
      reviewerName: "审核人",
      decision: "approved",
      note: "可以发布"
    });
    expect(approved.workflow?.state).toBe("approved");
    const published = await service.updateWorkflow(created.id, {
      action: "publish",
      versionId,
      actorId: "owner"
    });
    expect(published.workflow).toMatchObject({
      state: "published",
      publishedVersionId: versionId
    });
    expect(published.versions[0]?.reviewState).toBe("published");

    const shared = await service.createShareLink(created.id, {
      permission: "comment",
      createdBy: "owner"
    });
    expect(service.getShareAccess(shared.link.token)).toEqual({
      permission: "comment",
      sessionId: created.id
    });
    const sharedSnapshot = service.getSharedSession(shared.link.token);
    expect(sharedSnapshot.session.shareLinks).toEqual([]);
    expect(sharedSnapshot.session.auditLog).toEqual([]);

    await service.updateShareLink(created.id, shared.link.id, {
      revoked: true,
      actorId: "owner"
    });
    expect(() => service.getShareAccess(shared.link.token)).toThrow(
      expect.objectContaining({
        code: "EDIT_SHARE_NOT_FOUND"
      })
    );

    service.updateWorkspace({
      quota: {
        maxConcurrentJobs: 1
      }
    });
    await expect(
      service.createTurn(
        created.id,
        createEditTurnRequest(service.get(created.id), {
          candidateCount: 2
        })
      )
    ).rejects.toMatchObject({
      statusCode: 429,
      code: "EDIT_CONCURRENT_JOB_QUOTA_EXCEEDED"
    });
  });

  it("removes expired detached versions through lifecycle cleanup", async () => {
    const executeGeneration = vi.fn(
      async (input: Partial<GenerationRequestPayload>) =>
        createSuccessfulGenerationExecution(input)
    );
    const { service, assets } = createService(executeGeneration);
    const created = await service.create({
      modelId: "gpt-image-2",
      source: createEditImageInput("source")
    });
    const detachedAsset = await assets.persistInput({
      sessionId: created.id,
      kind: "result",
      image: createEditImageInput("detached")
    });
    const session = service.get(created.id);
    const detachedVersionId = "version-detached-expired";

    session.assets.push(detachedAsset);
    session.versions.push({
      id: detachedVersionId,
      sessionId: session.id,
      assetId: detachedAsset.id,
      parentVersionIds: [session.currentVersionId],
      candidateIndex: 0,
      label: "过期候选",
      tags: [],
      favorite: false,
      reviewState: "draft",
      createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString()
    });
    service.store.save(session);
    service.updateWorkspace({
      lifecycle: {
        detachedVersionRetentionDays: 1,
        autoCleanupEnabled: true
      }
    });

    const result = await service.runLifecycleCleanup();
    const cleaned = service.get(created.id);

    expect(result.removedVersions).toBe(1);
    expect(cleaned.versions.some((version) => version.id === detachedVersionId)).toBe(false);
    expect(cleaned.assets.some((asset) => asset.id === detachedAsset.id)).toBe(false);
  });
});

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  throw new Error("Timed out waiting for edit service state");
}

function createTwoPixelImage(
  id: string,
  alpha: [number, number]
): EditImageInput {
  const png = new PNG({ width: 2, height: 1 });

  alpha.forEach((value, index) => {
    const offset = index * 4;
    png.data[offset] = 255;
    png.data[offset + 1] = 255;
    png.data[offset + 2] = 255;
    png.data[offset + 3] = value;
  });

  const encoded = PNG.sync.write(png);

  return {
    id,
    name: `${id}.png`,
    mimeType: "image/png",
    format: "png",
    sizeBytes: encoded.byteLength,
    width: 2,
    height: 1,
    base64: encoded.toString("base64"),
    order: 0
  };
}
