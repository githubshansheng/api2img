import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GenerationSuiteAssetStore } from "../../../server/suite/suite-assets";
import { GenerationSuiteService } from "../../../server/suite/suite-service";
import { GenerationSuiteStore } from "../../../server/suite/suite-store";
import {
  createGenerationSet,
  createSuiteImage,
  createSuiteSlot
} from "../helpers/generation-suite";

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

describe("generation suite sqlite store", () => {
  it("marks in-flight suites and attempts as interrupted after a service restart", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "api2img-suite-store-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "generation-suites.sqlite");
    const firstStore = new GenerationSuiteStore(databasePath);
    const anchorImage = createSuiteImage("anchor-slot", {
      id: "selected-anchor",
      selected: true
    });
    const suite = createGenerationSet({
      status: "generating_scenes",
      selectedAnchorImageId: anchorImage.id,
      slots: [
        createSuiteSlot("anchor", {
          status: "completed",
          selectedImageId: anchorImage.id,
          images: [anchorImage]
        }),
        createSuiteSlot("scene", {
          status: "running",
          attempts: [
            {
              id: "attempt-running",
              attemptNumber: 1,
              status: "running",
              prompt: "测试",
              referenceIds: [anchorImage.id],
              requestedCandidateCount: 1,
              requestIds: ["request-running"],
              imageIds: [],
              queuedAt: "2026-07-12T00:00:01.000Z",
              startedAt: "2026-07-12T00:00:02.000Z"
            }
          ]
        })
      ]
    });

    firstStore.save(suite);
    firstStore.close();

    const restartedStore = new GenerationSuiteStore(databasePath);
    const service = new GenerationSuiteService({
      store: restartedStore,
      assets: new GenerationSuiteAssetStore(path.join(directory, "assets"))
    });
    const recovered = service.get(suite.id);

    expect(recovered.status).toBe("interrupted");
    expect(recovered.lastError?.code).toBe("SUITE_PROCESS_INTERRUPTED");
    expect(recovered.slots[1]?.status).toBe("interrupted");
    expect(recovered.slots[1]?.attempts[0]?.status).toBe("interrupted");
    expect(recovered.slots[1]?.attempts[0]?.completedAt).toBeTruthy();
    restartedStore.close();
  });

  it("preserves an awaiting-anchor suite across a service restart", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "api2img-suite-store-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "generation-suites.sqlite");
    const firstStore = new GenerationSuiteStore(databasePath);
    const anchorImage = createSuiteImage("anchor-slot", {
      id: "anchor-candidate"
    });
    const suite = createGenerationSet({
      status: "awaiting_anchor",
      slots: [
        createSuiteSlot("anchor", {
          status: "awaiting_selection",
          images: [anchorImage]
        }),
        createSuiteSlot("scene", {
          status: "pending"
        })
      ]
    });

    firstStore.save(suite);
    firstStore.close();

    const restartedStore = new GenerationSuiteStore(databasePath);
    const service = new GenerationSuiteService({
      store: restartedStore,
      assets: new GenerationSuiteAssetStore(path.join(directory, "assets"))
    });
    const recovered = service.get(suite.id);

    expect(recovered.status).toBe("awaiting_anchor");
    expect(recovered.lastError).toBeUndefined();
    expect(recovered.slots[0]?.status).toBe("awaiting_selection");
    expect(recovered.slots[0]?.images).toHaveLength(1);
    expect(recovered.slots[1]?.status).toBe("pending");
    restartedStore.close();
  });
});
