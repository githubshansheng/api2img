import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerationRequestPayload } from "../../domain";
import type { GenerationExecutionResult } from "../../../server/generation-executor";
import { GenerationSuiteAssetStore } from "../../../server/suite/suite-assets";
import { GenerationSuiteScheduler } from "../../../server/suite/suite-scheduler";
import {
  GenerationSuiteService,
  selectReferencesForSlot
} from "../../../server/suite/suite-service";
import { GenerationSuiteStore } from "../../../server/suite/suite-store";
import {
  createGenerationSet,
  createGenerationSuiteRequest,
  createSuiteImage,
  createSuiteReference,
  createSuiteSlot,
  createSuccessfulGenerationExecution,
  TINY_PNG_BASE64
} from "../helpers/generation-suite";

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

function createService(
  executeGeneration: (
    input: Partial<GenerationRequestPayload>,
    signal?: AbortSignal
  ) => Promise<GenerationExecutionResult>,
  createAssets?: (directory: string) => GenerationSuiteAssetStore
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "api2img-suite-service-"));
  const store = new GenerationSuiteStore(path.join(directory, "generation-suites.sqlite"));
  const scheduler = new GenerationSuiteScheduler(4);
  const assets =
    createAssets?.(directory) ??
    new GenerationSuiteAssetStore(path.join(directory, "assets"));
  const service = new GenerationSuiteService({
    store,
    assets,
    scheduler,
    executeGeneration
  });

  cleanups.push(() => {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  return { service, scheduler, assets, directory };
}

describe("generation suite service", () => {
  it("always reserves the first scene reference for the selected anchor", () => {
    const anchorImage = createSuiteImage("anchor-slot", {
      id: "selected-anchor",
      selected: true
    });
    const sceneSlot = createSuiteSlot("scene");
    const suite = createGenerationSet({
      selectedAnchorImageId: anchorImage.id,
      references: Array.from({ length: 12 }, (_, index) =>
        createSuiteReference(index, index < 3 ? "subject" : "style")
      ),
      slots: [
        createSuiteSlot("anchor", {
          status: "completed",
          selectedImageId: anchorImage.id,
          images: [anchorImage]
        }),
        sceneSlot
      ]
    });

    const selected = selectReferencesForSlot(suite, sceneSlot, 12);

    expect(selected).toHaveLength(12);
    expect(selected[0]).toMatchObject({
      id: anchorImage.id,
      type: "anchor",
      role: "anchor"
    });
    expect(selected.filter((item) => item.type === "reference")).toHaveLength(11);
    expect(selected.some((item) => item.id === "reference-11")).toBe(false);
  });

  it("waits for manual anchor selection when auto-select is disabled, then generates scenes", async () => {
    const executionInputs: Partial<GenerationRequestPayload>[] = [];
    const executeGeneration = vi.fn(async (input: Partial<GenerationRequestPayload>) => {
      executionInputs.push(input);
      return createSuccessfulGenerationExecution(input);
    });
    const { service, scheduler } = createService(executeGeneration);
    const created = await service.create(
      createGenerationSuiteRequest({
        options: {
          requireAnchorConfirmation: false,
          autoSelectFirstAnchor: false,
          perSuiteConcurrency: 2
        }
      })
    );

    expect(created.endpointOverride).toEqual({
      baseURL: "https://proxy.example/v1/images/generations"
    });
    expect(JSON.stringify(created)).not.toContain("test-secret-key");

    await service.start(created.id);
    await scheduler.waitForIdle();

    const awaitingAnchor = service.get(created.id);
    const anchorSlot = awaitingAnchor.slots.find(
      (slot) => slot.id === awaitingAnchor.anchorSlotId
    );
    const sceneSlot = awaitingAnchor.slots.find((slot) => slot.kind === "scene");

    expect(awaitingAnchor.status).toBe("awaiting_anchor");
    expect(anchorSlot?.status).toBe("awaiting_selection");
    expect(anchorSlot?.images).toHaveLength(2);
    expect(sceneSlot?.status).toBe("pending");
    expect(executeGeneration).toHaveBeenCalledTimes(1);

    const selectedAnchor = anchorSlot?.images[1];
    expect(selectedAnchor).toBeTruthy();
    await service.selectAnchor(created.id, {
      imageId: selectedAnchor!.id
    });
    await scheduler.waitForIdle();

    const completed = service.get(created.id);
    const completedScene = completed.slots.find((slot) => slot.kind === "scene");

    expect(completed.status).toBe("completed");
    expect(completed.selectedAnchorImageId).toBe(selectedAnchor?.id);
    expect(completedScene?.status).toBe("completed");
    expect(completedScene?.images).toHaveLength(1);
    expect(executeGeneration).toHaveBeenCalledTimes(2);
    expect(executionInputs[1]?.referenceImages?.[0]?.id).toBe(selectedAnchor?.id);
    expect(executionInputs[1]?.prompt).toContain("主视觉锚点");
  });

  it("does not rewrite a completed suite as cancelled", async () => {
    const executeGeneration = vi.fn(async (input: Partial<GenerationRequestPayload>) =>
      createSuccessfulGenerationExecution(input)
    );
    const { service, scheduler } = createService(executeGeneration);
    const created = await service.create(createGenerationSuiteRequest());

    await service.start(created.id);
    await scheduler.waitForIdle();

    expect(service.get(created.id).status).toBe("completed");
    await expect(service.cancel(created.id)).rejects.toMatchObject({
      statusCode: 409,
      code: "SUITE_NOT_CANCELLABLE"
    });
    expect(service.get(created.id).status).toBe("completed");
  });

  it("restores anchor selection after cancellation without regenerating completed candidates", async () => {
    const executeGeneration = vi.fn(async (input: Partial<GenerationRequestPayload>) =>
      createSuccessfulGenerationExecution(input)
    );
    const { service, scheduler } = createService(executeGeneration);
    const created = await service.create(
      createGenerationSuiteRequest({
        options: {
          requireAnchorConfirmation: true,
          autoSelectFirstAnchor: false,
          perSuiteConcurrency: 2
        }
      })
    );

    await service.start(created.id);
    await scheduler.waitForIdle();

    expect(service.get(created.id).status).toBe("awaiting_anchor");
    expect(executeGeneration).toHaveBeenCalledTimes(1);

    const cancelled = await service.cancel(created.id);
    const cancelledAnchor = cancelled.slots.find(
      (slot) => slot.id === cancelled.anchorSlotId
    );

    expect(cancelled.status).toBe("cancelled");
    expect(cancelledAnchor?.status).toBe("cancelled");

    await service.start(created.id, {
      endpointOverride: {
        baseURL: "https://proxy.example/v1/images/generations",
        apiKey: "restart-secret-key"
      }
    });
    await scheduler.waitForIdle();

    const resumed = service.get(created.id);
    const resumedAnchor = resumed.slots.find((slot) => slot.id === resumed.anchorSlotId);

    expect(resumed.status).toBe("awaiting_anchor");
    expect(resumedAnchor?.status).toBe("awaiting_selection");
    expect(resumedAnchor?.images).toHaveLength(2);
    expect(executeGeneration).toHaveBeenCalledTimes(1);
  });

  it("generates only missing candidates when an interrupted slot already has images", async () => {
    const executionInputs: Partial<GenerationRequestPayload>[] = [];
    const executeGeneration = vi.fn(async (input: Partial<GenerationRequestPayload>) => {
      executionInputs.push(input);
      return createSuccessfulGenerationExecution(input);
    });
    const { service, scheduler } = createService(executeGeneration);
    const created = await service.create(
      createGenerationSuiteRequest({
        options: {
          requireAnchorConfirmation: true,
          autoSelectFirstAnchor: false,
          perSuiteConcurrency: 2
        },
        slots: [
          {
            kind: "anchor",
            title: "主视觉锚点",
            description: "锁定主体外观",
            scenePrompt: "生成干净完整的产品主视觉。",
            candidateCount: 1
          },
          {
            kind: "scene",
            title: "桌面场景",
            description: "展示产品使用状态",
            scenePrompt: "将同一产品放在现代办公桌面中。",
            candidateCount: 3
          }
        ]
      })
    );

    await service.start(created.id);
    await scheduler.waitForIdle();

    const interrupted = service.get(created.id);
    const anchorSlot = interrupted.slots.find(
      (slot) => slot.id === interrupted.anchorSlotId
    );
    const sceneSlot = interrupted.slots.find((slot) => slot.kind === "scene");
    const selectedAnchor = anchorSlot?.images[0];

    expect(anchorSlot).toBeTruthy();
    expect(sceneSlot).toBeTruthy();
    expect(selectedAnchor).toBeTruthy();

    selectedAnchor!.selected = true;
    anchorSlot!.selectedImageId = selectedAnchor!.id;
    anchorSlot!.status = "completed";
    interrupted.selectedAnchorImageId = selectedAnchor!.id;
    interrupted.status = "interrupted";
    sceneSlot!.status = "interrupted";
    sceneSlot!.images = [
      createSuiteImage(sceneSlot!.id, {
        id: "scene-partial-image",
        candidateIndex: 0
      })
    ];
    service.store.save(interrupted);

    await service.start(created.id);
    await scheduler.waitForIdle();

    const completed = service.get(created.id);
    const completedScene = completed.slots.find((slot) => slot.id === sceneSlot!.id);
    const latestAttempt = completedScene?.attempts.at(-1);

    expect(completed.status).toBe("completed");
    expect(completedScene?.images).toHaveLength(3);
    expect(latestAttempt?.requestedCandidateCount).toBe(2);
    expect(executionInputs.at(-1)?.params?.count).toBe(2);
    expect(executeGeneration).toHaveBeenCalledTimes(2);
    expect(completed.progress.completedCandidates).toBe(
      completed.progress.totalCandidates
    );
  });

  it("rejects anchor selection before the anchor slot is ready", async () => {
    const executeGeneration = vi.fn(async (input: Partial<GenerationRequestPayload>) =>
      createSuccessfulGenerationExecution(input)
    );
    const { service } = createService(executeGeneration);
    const created = await service.create(createGenerationSuiteRequest());
    const running = service.get(created.id);
    const anchorSlot = running.slots.find((slot) => slot.id === running.anchorSlotId);

    expect(anchorSlot).toBeTruthy();
    anchorSlot!.status = "running";
    anchorSlot!.images = [createSuiteImage(anchorSlot!.id, { id: "early-anchor" })];
    running.status = "generating_anchor";
    service.store.save(running);

    await expect(
      service.selectAnchor(created.id, {
        imageId: "early-anchor"
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "SUITE_ANCHOR_NOT_READY"
    });

    expect(service.get(created.id).selectedAnchorImageId).toBeUndefined();
  });

  it("clears in-memory task groups when a suite is deleted", async () => {
    const executeGeneration = vi.fn(async (input: Partial<GenerationRequestPayload>) =>
      createSuccessfulGenerationExecution(input)
    );
    const { service } = createService(executeGeneration);
    const created = await service.create(createGenerationSuiteRequest());
    const taskGroups = (
      service as unknown as {
        taskGroups: Map<string, { suiteId: string }>;
      }
    ).taskGroups;

    taskGroups.set("orphan-attempt", { suiteId: created.id });
    await service.delete(created.id);

    expect(taskGroups.size).toBe(0);
    expect(() => service.get(created.id)).toThrowError("套图记录不存在");
  });

  it("waits for in-flight asset persistence before deleting all suite files", async () => {
    let resolvePersistStarted = () => {};
    let resolvePersist = () => {};
    const persistStarted = new Promise<void>((resolve) => {
      resolvePersistStarted = resolve;
    });
    const allowPersist = new Promise<void>((resolve) => {
      resolvePersist = resolve;
    });
    class DelayedAssetStore extends GenerationSuiteAssetStore {
      override async persistGeneratedImage(
        input: Parameters<GenerationSuiteAssetStore["persistGeneratedImage"]>[0]
      ) {
        resolvePersistStarted();
        await allowPersist;
        return super.persistGeneratedImage(input);
      }
    }
    const executeGeneration = vi.fn(async (input: Partial<GenerationRequestPayload>) =>
      createSuccessfulGenerationExecution(input)
    );
    const { service, assets } = createService(
      executeGeneration,
      (directory) => new DelayedAssetStore(path.join(directory, "assets"))
    );
    const created = await service.create(createGenerationSuiteRequest());

    await service.start(created.id);
    await persistStarted;

    let deleteSettled = false;
    const deletion = service.delete(created.id).then(() => {
      deleteSettled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(deleteSettled).toBe(false);

    resolvePersist();
    await deletion;

    expect(fs.readdirSync(assets.rootDirectory)).toEqual([]);
    expect(() => service.get(created.id)).toThrowError("套图记录不存在");
  });

  it("waits for all reference writes before rolling back a failed create", async () => {
    let resolveFailureObserved = () => {};
    let releaseSuccessfulWrite = () => {};
    const failureObserved = new Promise<void>((resolve) => {
      resolveFailureObserved = resolve;
    });
    const allowSuccessfulWrite = new Promise<void>((resolve) => {
      releaseSuccessfulWrite = resolve;
    });
    class PartiallyFailingReferenceAssetStore extends GenerationSuiteAssetStore {
      override async persistReference(
        suiteId: string,
        input: Parameters<GenerationSuiteAssetStore["persistReference"]>[1]
      ) {
        if (input.id === "reference-fail") {
          resolveFailureObserved();
          throw new Error("TEST_REFERENCE_PERSISTENCE_FAILED");
        }

        await allowSuccessfulWrite;
        return super.persistReference(suiteId, input);
      }
    }
    const executeGeneration = vi.fn(async (input: Partial<GenerationRequestPayload>) =>
      createSuccessfulGenerationExecution(input)
    );
    const { service, assets } = createService(
      executeGeneration,
      (directory) =>
        new PartiallyFailingReferenceAssetStore(path.join(directory, "assets"))
    );
    const creation = service.create(
      createGenerationSuiteRequest({
        referenceImages: [
          {
            id: "reference-success",
            role: "subject",
            name: "subject.png",
            mimeType: "image/png",
            format: "png",
            base64: TINY_PNG_BASE64,
            order: 0
          },
          {
            id: "reference-fail",
            role: "style",
            name: "style.png",
            mimeType: "image/png",
            format: "png",
            base64: TINY_PNG_BASE64,
            order: 1
          }
        ]
      })
    );

    await failureObserved;
    releaseSuccessfulWrite();

    await expect(creation).rejects.toMatchObject({
      statusCode: 400,
      code: "SUITE_REFERENCE_PERSIST_FAILED"
    });
    expect(fs.readdirSync(assets.rootDirectory)).toEqual([]);
  });

  it("rejects invalid reference roles before writing any suite assets", async () => {
    const executeGeneration = vi.fn(async (input: Partial<GenerationRequestPayload>) =>
      createSuccessfulGenerationExecution(input)
    );
    const { service, assets } = createService(executeGeneration);

    await expect(
      service.create(
        createGenerationSuiteRequest({
          referenceImages: [
            {
              id: "invalid-role-reference",
              role: "identity" as never,
              name: "subject.png",
              mimeType: "image/png",
              format: "png",
              base64: TINY_PNG_BASE64,
              order: 0
            }
          ]
        })
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "SUITE_REFERENCE_ROLE_INVALID"
    });
    expect(fs.readdirSync(assets.rootDirectory)).toEqual([]);
  });

  it("rejects invalid slot kinds at the API service boundary", async () => {
    const executeGeneration = vi.fn(async (input: Partial<GenerationRequestPayload>) =>
      createSuccessfulGenerationExecution(input)
    );
    const { service } = createService(executeGeneration);
    const request = createGenerationSuiteRequest();

    request.slots![1]!.kind = "poster" as never;

    await expect(service.create(request)).rejects.toMatchObject({
      statusCode: 400,
      code: "SUITE_SLOT_KIND_INVALID"
    });
  });

  it("removes generated assets when cancellation happens during persistence", async () => {
    let resolvePersisted = () => {};
    let releasePersistence = () => {};
    const persisted = new Promise<void>((resolve) => {
      resolvePersisted = resolve;
    });
    const allowPersistenceToReturn = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    class CancelDuringPersistenceAssetStore extends GenerationSuiteAssetStore {
      override async persistGeneratedImage(
        input: Parameters<GenerationSuiteAssetStore["persistGeneratedImage"]>[0]
      ) {
        const image = await super.persistGeneratedImage(input);
        resolvePersisted();
        await allowPersistenceToReturn;
        return image;
      }
    }
    const executeGeneration = vi.fn(async (input: Partial<GenerationRequestPayload>) =>
      createSuccessfulGenerationExecution(input)
    );
    const { service, scheduler, assets } = createService(
      executeGeneration,
      (directory) =>
        new CancelDuringPersistenceAssetStore(path.join(directory, "assets"))
    );
    const created = await service.create(createGenerationSuiteRequest());

    await service.start(created.id);
    await persisted;
    await service.cancel(created.id);
    releasePersistence();
    await scheduler.waitForIdle();

    expect(service.get(created.id).status).toBe("cancelled");
    expect(fs.readdirSync(assets.rootDirectory)).toEqual([]);
  });

  it("rolls back files when only part of a candidate batch persists", async () => {
    let resolveFirstPersisted = () => {};
    const firstPersisted = new Promise<void>((resolve) => {
      resolveFirstPersisted = resolve;
    });
    class PartiallyFailingAssetStore extends GenerationSuiteAssetStore {
      override async persistGeneratedImage(
        input: Parameters<GenerationSuiteAssetStore["persistGeneratedImage"]>[0]
      ) {
        if (input.candidateIndex === 1) {
          await firstPersisted;
          throw new Error("TEST_ASSET_PERSISTENCE_FAILED");
        }

        const image = await super.persistGeneratedImage(input);
        resolveFirstPersisted();
        return image;
      }
    }
    const executeGeneration = vi.fn(async (input: Partial<GenerationRequestPayload>) =>
      createSuccessfulGenerationExecution(input)
    );
    const { service, scheduler, assets } = createService(
      executeGeneration,
      (directory) => new PartiallyFailingAssetStore(path.join(directory, "assets"))
    );
    const created = await service.create(createGenerationSuiteRequest());

    await service.start(created.id);
    await scheduler.waitForIdle();

    const failed = service.get(created.id);
    const anchorSlot = failed.slots.find((slot) => slot.id === failed.anchorSlotId);

    expect(failed.status).toBe("failed");
    expect(anchorSlot?.status).toBe("failed");
    expect(anchorSlot?.images).toEqual([]);
    expect(fs.readdirSync(assets.rootDirectory)).toEqual([]);
  });

  it("keeps partial scene images retryable and only fills the missing candidates", async () => {
    let callCount = 0;
    const executeGeneration = vi.fn(async (input: Partial<GenerationRequestPayload>) => {
      callCount += 1;
      const execution = createSuccessfulGenerationExecution(input);

      if (callCount === 2 && execution.success && execution.data.result?.images) {
        execution.data.result.images = execution.data.result.images.slice(0, 1);
      }

      return execution;
    });
    const { service, scheduler } = createService(executeGeneration);
    const created = await service.create(
      createGenerationSuiteRequest({
        slots: [
          {
            kind: "anchor",
            title: "主视觉锚点",
            description: "锁定主体外观",
            scenePrompt: "生成干净完整的产品主视觉。",
            candidateCount: 1
          },
          {
            kind: "scene",
            title: "桌面场景",
            description: "展示产品使用状态",
            scenePrompt: "将同一产品放在现代办公桌面中。",
            candidateCount: 3
          }
        ]
      })
    );

    await service.start(created.id);
    await scheduler.waitForIdle();

    const partial = service.get(created.id);
    const partialScene = partial.slots.find((slot) => slot.kind === "scene");

    expect(partial.status).toBe("failed");
    expect(partialScene?.status).toBe("failed");
    expect(partialScene?.images).toHaveLength(1);
    expect(partialScene?.attempts.at(-1)).toMatchObject({
      status: "failed",
      requestedCandidateCount: 3,
      error: {
        code: "PARTIAL_IMAGE_RESULT"
      }
    });

    await service.retrySlot(created.id, partialScene!.id);
    await scheduler.waitForIdle();

    const completed = service.get(created.id);
    const completedScene = completed.slots.find((slot) => slot.id === partialScene!.id);

    expect(completed.status).toBe("completed");
    expect(completedScene?.status).toBe("completed");
    expect(completedScene?.images).toHaveLength(3);
    expect(completedScene?.attempts.at(-1)?.requestedCandidateCount).toBe(2);
    expect(executeGeneration).toHaveBeenCalledTimes(3);
  });

  it("accepts a non-standard runtime credential header without persisting it", async () => {
    const executeGeneration = vi.fn(async (input: Partial<GenerationRequestPayload>) =>
      createSuccessfulGenerationExecution(input)
    );
    const { service, scheduler } = createService(executeGeneration);
    const created = await service.create(
      createGenerationSuiteRequest({
        endpointOverride: {
          baseURL: "https://proxy.example/v1/images/generations",
          headers: {
            "X-Auth": "custom-runtime-secret"
          }
        }
      })
    );

    expect(created.endpointOverride).toEqual({
      baseURL: "https://proxy.example/v1/images/generations"
    });
    expect(JSON.stringify(created)).not.toContain("custom-runtime-secret");

    await service.start(created.id);
    await scheduler.waitForIdle();

    expect(executeGeneration).toHaveBeenCalled();
    expect(executeGeneration.mock.calls[0]?.[0].endpointOverride?.headers).toEqual({
      "X-Auth": "custom-runtime-secret"
    });
  });

  it("does not persist any custom headers or provider-specific credentials", async () => {
    const executeGeneration = vi.fn(async (input: Partial<GenerationRequestPayload>) =>
      createSuccessfulGenerationExecution(input)
    );
    const { service } = createService(executeGeneration);
    const created = await service.create(
      createGenerationSuiteRequest({
        endpointOverride: {
          baseURL: "https://proxy.example/v1/images/generations",
          headers: {
            "X-Goog-Api-Key": "google-secret",
            "Proxy-Authorization": "Bearer proxy-secret",
            "X-Auth-Token": "auth-secret",
            "X-Client-Secret": "client-secret",
            "X-Authorization": "Bearer x-auth-secret",
            "X-Token": "x-token-secret",
            "X-Suite-Test": "enabled"
          },
          editURL:
            "https://editor:edit-password@proxy.example/v1/images/edits?access_token=edit-secret&api-version=2026-01-01"
        }
      })
    );
    const serialized = JSON.stringify(created);

    expect("headers" in (created.endpointOverride ?? {})).toBe(false);
    expect(serialized).not.toContain("google-secret");
    expect(serialized).not.toContain("proxy-secret");
    expect(serialized).not.toContain("auth-secret");
    expect(serialized).not.toContain("client-secret");
    expect(serialized).not.toContain("x-auth-secret");
    expect(serialized).not.toContain("x-token-secret");
    expect(serialized).not.toContain("enabled");
    expect(serialized).not.toContain("edit-password");
    expect(serialized).not.toContain("edit-secret");
    expect(created.endpointOverride?.editURL).toBe(
      "https://proxy.example/v1/images/edits?api-version=2026-01-01"
    );
  });
});
