// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getModelById } from "../../config/models";
import type {
  GenerateVector3DViewResult,
  ModelConfig,
  Vector3DCameraParameters
} from "../../domain";
import { VECTOR3D_VIEW_LIMITS } from "../../domain";
import {
  isVector3DImageModel,
  Vector3DViewpointWorkbench
} from "../../components/vector3d/Vector3DViewpointWorkbench";
import { Vector3DViewpointApiError } from "../../services/vector3d-viewpoint-service";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  generate: vi.fn(),
  viewportLoad: vi.fn()
}));

vi.mock("../../services/vector3d-viewpoint-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../services/vector3d-viewpoint-service")>();

  return {
    ...actual,
    generateVector3DView: mocks.generate
  };
});

vi.mock("../../components/vector3d/GaussianSplatViewport", async () => {
  const { forwardRef, useEffect, useImperativeHandle } = await import("react");

  return {
    GaussianSplatViewport: forwardRef(function MockGaussianSplatViewport(
      props: {
        onCameraChange: (camera: Vector3DCameraParameters) => void;
        onLoadStateChange: (state: {
          status: "idle" | "loading" | "ready" | "failed";
          progress: number;
          pointCount?: number;
          error?: string;
        }) => void;
        rebuildToken?: number;
        sourceImage?: {
          dataURL: string;
          height: number;
          width: number;
        };
      },
      ref
    ) {
      useImperativeHandle(ref, () => ({
        capture: mocks.capture,
        resetCamera: vi.fn()
      }));

      useEffect(() => {
        mocks.viewportLoad(props.sourceImage, props.rebuildToken);
        props.onCameraChange(CAMERA);
        props.onLoadStateChange(
          props.sourceImage
            ? viewportLoadState ?? {
                status: "ready",
                progress: 100,
                pointCount: 1200
              }
            : {
                status: "idle",
                progress: 0
              }
        );
      }, [props.rebuildToken, props.sourceImage]);

      return <canvas data-testid="mock-vector3d-canvas" />;
    })
  };
});

const CAMERA: Vector3DCameraParameters = {
  yaw: 32,
  pitch: -12,
  distance: 4.5,
  position: { x: 1, y: 0.5, z: -4 },
  rotation: { x: -0.2, y: 0.55, z: 0 },
  viewport: { width: 2048, height: 1152 }
};

const DRAFT_IMAGE = "data:image/png;base64,AQIDBA==";

let decodeShouldFail = false;
let decodeCount = 0;
let decodePaused = false;
let pendingDecodes: Array<() => void> = [];
let viewportLoadState:
  | {
      status: "idle" | "loading" | "ready" | "failed";
      progress: number;
      pointCount?: number;
      error?: string;
    }
  | undefined;

class MockImage {
  height = 900;
  naturalHeight = 900;
  naturalWidth = 1600;
  onerror: ((event: Event) => void) | null = null;
  onload: ((event: Event) => void) | null = null;
  width = 1600;

  set src(_value: string) {
    decodeCount += 1;
    const finishDecode = () => {
      if (decodeShouldFail) {
        this.onerror?.(new Event("error"));
      } else {
        this.onload?.(new Event("load"));
      }
    };

    if (decodePaused) {
      pendingDecodes.push(finishDecode);
    } else {
      queueMicrotask(finishDecode);
    }
  }
}

function cloneModel(id: string) {
  const model = getModelById(id);

  if (!model) {
    throw new Error(`Missing model fixture: ${id}`);
  }

  return structuredClone(model);
}

function renderWorkbench(input: {
  apiKey?: string;
  models?: ModelConfig[];
  onOpenSettings?: () => void;
  selectedModel?: ModelConfig;
} = {}) {
  const selectedModel = input.selectedModel ?? cloneModel("gpt-image-2");
  const models = input.models ?? [selectedModel];
  const onOpenSettings = input.onOpenSettings
    ? vi.fn(input.onOpenSettings)
    : vi.fn();
  const onSelectModel = vi.fn();
  const view = render(
    <Vector3DViewpointWorkbench
      endpointOverride={{
        apiKey: input.apiKey,
        baseURL: "https://proxy.example/v1",
        editURL: "https://proxy.example/v1/images/edits"
      }}
      models={models}
      onOpenSettings={onOpenSettings}
      onSelectModel={onSelectModel}
      selectedModel={selectedModel}
    />
  );
  const sourceInput = view.container.querySelector(
    'input[accept="image/png,image/jpeg,image/webp"]'
  ) as HTMLInputElement;

  return {
    ...view,
    onOpenSettings,
    onSelectModel,
    sourceInput
  };
}

async function uploadSource(input: HTMLInputElement, name = "source.png") {
  const file = new File(["valid-image"], name, { type: "image/png" });
  fireEvent.change(input, {
    target: {
      files: [file]
    }
  });
  await screen.findByText(new RegExp(`图片高斯代理已就绪：${name}`));
  return file;
}

async function prepareGeneration(input: HTMLInputElement) {
  await uploadSource(input);
  await waitFor(() =>
    expect(
      (screen.getByRole("button", {
        name: "捕获当前镜头"
      }) as HTMLButtonElement).disabled
    ).toBe(false)
  );
  fireEvent.click(screen.getByRole("button", { name: "捕获当前镜头" }));
  await screen.findByText("已捕获当前相机矩阵与 Gaussian 代理草图");
}

function successfulResult(): GenerateVector3DViewResult {
  return {
    requestId: "request-success",
    image: "data:image/png;base64,AQID",
    imageMimeType: "image/png",
    optimizedPrompt: "Repair the object.",
    viewDescription: "right rear view",
    repairNotes: ["Close holes"],
    reasoningModel: "gpt-5.5",
    imageModel: "custom-image-model",
    reasoningDurationMs: 100,
    renderingDurationMs: 200,
    totalDurationMs: 300
  };
}

beforeEach(() => {
  decodeShouldFail = false;
  decodeCount = 0;
  decodePaused = false;
  pendingDecodes = [];
  viewportLoadState = {
    status: "ready",
    progress: 100,
    pointCount: 1200
  };
  vi.stubGlobal("Image", MockImage);
  mocks.capture.mockReset();
  mocks.capture.mockReturnValue({
    image: DRAFT_IMAGE,
    camera: CAMERA
  });
  mocks.generate.mockReset();
  mocks.viewportLoad.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Vector3D source uploads", () => {
  it("accepts the first upload and fires again for the same file after resetting the input", async () => {
    const { sourceInput } = renderWorkbench();
    const file = await uploadSource(sourceInput);

    expect(sourceInput.value).toBe("");
    expect(decodeCount).toBe(1);

    fireEvent.change(sourceInput, {
      target: {
        files: [file]
      }
    });

    await waitFor(() => expect(decodeCount).toBe(2));
    expect(sourceInput.value).toBe("");
    expect(screen.getByText("1600 × 900 · 11 B")).toBeTruthy();
  });

  it("announces reading and ready states through an aria-live region", async () => {
    decodePaused = true;
    const { sourceInput } = renderWorkbench();
    const file = new File(["slow-image"], "slow.png", {
      type: "image/png"
    });

    fireEvent.change(sourceInput, {
      target: {
        files: [file]
      }
    });

    const readingStatus = await screen.findByText("正在读取 slow.png");
    expect(readingStatus.getAttribute("aria-live")).toBe("polite");
    await waitFor(() => expect(pendingDecodes).toHaveLength(1));

    await act(async () => {
      pendingDecodes.shift()?.();
      await Promise.resolve();
    });

    expect(
      await screen.findByText("图片高斯代理已就绪：slow.png")
    ).toBeTruthy();
  });

  it("supports drag-and-drop, replacement, and deletion", async () => {
    const { sourceInput } = renderWorkbench();
    const dropzone = screen.getByTestId("vector3d-source-dropzone");
    const dropped = new File(["drop-image"], "dropped.webp", {
      type: "image/webp"
    });

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [dropped]
      }
    });
    await screen.findByText("图片高斯代理已就绪：dropped.webp");

    await uploadSource(sourceInput, "replacement.jpg");
    expect(screen.getAllByText("replacement.jpg")).toHaveLength(2);

    fireEvent.click(screen.getByTitle("删除导入图片"));
    expect(screen.getByText("导入图片已移除")).toBeTruthy();
    expect(screen.getByText("拖放或选择一张图片")).toBeTruthy();
  });

  it("rejects unsupported and oversized files without replacing the last valid image", async () => {
    const { sourceInput } = renderWorkbench();
    await uploadSource(sourceInput, "kept.png");

    const invalid = new File(["gif"], "invalid.gif", { type: "image/gif" });
    fireEvent.change(sourceInput, {
      target: {
        files: [invalid]
      }
    });
    await screen.findAllByText(/原始参考图仅支持 PNG、JPEG 或 WebP/);
    expect(screen.getAllByText("kept.png")).toHaveLength(2);

    const oversized = new File(["large"], "large.png", { type: "image/png" });
    Object.defineProperty(oversized, "size", {
      configurable: true,
      value: 20 * 1024 * 1024 + 1
    });
    fireEvent.change(sourceInput, {
      target: {
        files: [oversized]
      }
    });
    await screen.findAllByText(/原始参考图不能超过 20 MB/);
    expect(screen.getAllByText("kept.png")).toHaveLength(2);
  });

  it("reports decode failures and preserves a previously decoded source", async () => {
    const { sourceInput } = renderWorkbench();
    await uploadSource(sourceInput, "kept.png");
    decodeShouldFail = true;

    const corrupt = new File(["not-an-image"], "corrupt.png", {
      type: "image/png"
    });
    fireEvent.change(sourceInput, {
      target: {
        files: [corrupt]
      }
    });

    await screen.findAllByText(/图片无法解码/);
    expect(screen.getAllByText("kept.png")).toHaveLength(2);
  });

  it("clears the previous draft and result and rebuilds after replacement", async () => {
    mocks.generate.mockResolvedValueOnce(successfulResult());
    const view = renderWorkbench({ apiKey: "sk-test" });
    await prepareGeneration(view.sourceInput);

    fireEvent.click(screen.getByRole("button", { name: "生成电影级新视角" }));
    await screen.findByRole("img", { name: "材质与盲区重塑" });

    await uploadSource(view.sourceInput, "replacement.png");

    await waitFor(() =>
      expect(
        screen.queryByRole("img", { name: "材质与盲区重塑" })
      ).toBeNull()
    );
    expect(
      screen.queryByRole("img", { name: "当前视角结构骨架" })
    ).toBeNull();
    expect(
      view.container.querySelector(".vector3d-live-status")?.classList
    ).toContain("status-idle");
  });

  it("clears a previous result after deleting the source image", async () => {
    mocks.generate.mockResolvedValueOnce(successfulResult());
    const view = renderWorkbench({ apiKey: "sk-test" });
    await prepareGeneration(view.sourceInput);

    fireEvent.click(screen.getByRole("button", { name: "生成电影级新视角" }));
    await screen.findByRole("img", { name: "材质与盲区重塑" });

    fireEvent.click(screen.getByTitle("删除导入图片"));

    await waitFor(() =>
      expect(
        screen.queryByRole("img", { name: "材质与盲区重塑" })
      ).toBeNull()
    );
    expect(screen.getByText("导入图片已移除")).toBeTruthy();
    expect(
      screen.queryByRole("img", { name: "当前视角结构骨架" })
    ).toBeNull();
  });

  it("rejects a capture when source and draft images exceed 32 MB combined", async () => {
    const { sourceInput } = renderWorkbench();
    const source = new File(["small-payload"], "large-source.png", {
      type: "image/png"
    });
    Object.defineProperty(source, "size", {
      configurable: true,
      value: VECTOR3D_VIEW_LIMITS.sourceImageBytes
    });
    fireEvent.change(sourceInput, {
      target: {
        files: [source]
      }
    });
    await screen.findByText("图片高斯代理已就绪：large-source.png");

    const draftBytes =
      VECTOR3D_VIEW_LIMITS.combinedImageBytes -
      VECTOR3D_VIEW_LIMITS.sourceImageBytes +
      1;
    const base64Length = Math.ceil((draftBytes * 4) / 3);
    mocks.capture.mockReturnValueOnce({
      image: `data:image/png;base64,${"A".repeat(base64Length)}`,
      camera: CAMERA
    });

    fireEvent.click(screen.getByRole("button", { name: "捕获当前镜头" }));

    expect(
      await screen.findByText(/捕获草图与原始参考图合计超过 32 MB/)
    ).toBeTruthy();
    expect(
      screen.queryByRole("img", { name: "当前视角结构骨架" })
    ).toBeNull();
  });
});

describe("Vector3D image-driven Gaussian proxy", () => {
  it("rebuilds the proxy when the same image is selected twice", async () => {
    const { sourceInput } = renderWorkbench();
    const file = await uploadSource(sourceInput, "scene.png");

    expect(mocks.viewportLoad).toHaveBeenCalledTimes(2);
    expect(sourceInput.value).toBe("");
    expect(screen.getAllByText("scene.png")).toHaveLength(2);

    fireEvent.change(sourceInput, {
      target: {
        files: [file]
      }
    });

    await waitFor(() => expect(mocks.viewportLoad).toHaveBeenCalledTimes(3));
    expect(sourceInput.value).toBe("");
  });

  it("shows a failed proxy state and retries the same decoded image", async () => {
    const { sourceInput } = renderWorkbench();
    viewportLoadState = {
      status: "failed",
      progress: 0,
      error: "像素采样失败"
    };

    fireEvent.change(sourceInput, {
      target: {
        files: [new File(["image"], "broken.png", { type: "image/png" })]
      }
    });

    expect(await screen.findByText("PROXY BUILD FAILED")).toBeTruthy();
    expect(screen.getAllByText("像素采样失败").length).toBeGreaterThan(0);

    viewportLoadState = {
      status: "ready",
      progress: 100,
      pointCount: 2400
    };
    fireEvent.click(screen.getByRole("button", { name: "重试构建" }));

    await waitFor(() =>
      expect(
        screen.getByText("2,400 IMAGE-DRIVEN SPLATS")
      ).toBeTruthy()
    );
    expect(screen.queryByText("PROXY BUILD FAILED")).toBeNull();
  });

  it("keeps capture disabled while the image proxy is building", async () => {
    viewportLoadState = {
      status: "loading",
      progress: 48
    };
    const { sourceInput } = renderWorkbench();

    fireEvent.change(sourceInput, {
      target: {
        files: [new File(["image"], "building.png", { type: "image/png" })]
      }
    });

    await screen.findByText("48%");
    expect(
      (screen.getByRole("button", {
        name: "捕获当前镜头"
      }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("removes the legacy PLY input and uses the uploaded image as the generation source", async () => {
    mocks.generate.mockResolvedValueOnce(successfulResult());
    const view = renderWorkbench({ apiKey: "sk-test" });

    expect(view.container.querySelector('input[accept=".ply"]')).toBeNull();
    const source = await uploadSource(view.sourceInput, "identity.png");
    fireEvent.click(screen.getByRole("button", { name: "捕获当前镜头" }));
    fireEvent.click(screen.getByRole("button", { name: "生成电影级新视角" }));

    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1));
    expect(mocks.generate.mock.calls[0]?.[0]).toMatchObject({
      source_image: expect.stringMatching(/^data:image\/png;base64,/),
      draft_image: DRAFT_IMAGE
    });
    expect(source.name).toBe("identity.png");
  });
});

describe("Vector3D generation readiness", () => {
  it("accepts renamed OpenAI image-edit models and excludes incompatible providers", () => {
    const renamed = cloneModel("gpt-image-2");
    renamed.id = "studio-cinematic-editor";
    renamed.apiModelName = "provider-image-edit-v4";
    renamed.displayName = "Studio Cinematic Editor";
    const gemini = cloneModel("nano-banana-pro");
    const seedream = cloneModel("seedream-5");
    const disabled = structuredClone(renamed);
    disabled.enabled = false;
    const singleReference = structuredClone(renamed);
    singleReference.capabilities.maxReferenceImages = 1;
    const noWholeImageEdit = structuredClone(renamed);
    noWholeImageEdit.editCapabilities.supportsWholeImageEdit = false;

    expect(isVector3DImageModel(renamed)).toBe(true);
    expect(isVector3DImageModel(gemini)).toBe(false);
    expect(isVector3DImageModel(seedream)).toBe(false);
    expect(isVector3DImageModel(disabled)).toBe(false);
    expect(isVector3DImageModel(singleReference)).toBe(false);
    expect(isVector3DImageModel(noWholeImageEdit)).toBe(false);

    renderWorkbench({
      models: [gemini, renamed, seedream],
      selectedModel: renamed
    });

    const options = screen
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toEqual(["Studio Cinematic Editor"]);
    expect(screen.getByText("FINAL / Studio Cinematic Editor")).toBeTruthy();
  });

  it("reports source, draft, and compatible-model blockers in order", async () => {
    const { sourceInput } = renderWorkbench({
      apiKey: "sk-test",
      models: []
    });

    fireEvent.click(screen.getByRole("button", { name: "生成电影级新视角" }));
    expect(
      await screen.findByText("暂时无法生成：缺少原始参考图。")
    ).toBeTruthy();

    await uploadSource(sourceInput);
    fireEvent.click(screen.getByRole("button", { name: "生成电影级新视角" }));
    expect(
      await screen.findByText("暂时无法生成：尚未捕获代理镜头草图。")
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "捕获当前镜头" }));
    await screen.findByText("已捕获当前相机矩阵与 Gaussian 代理草图");
    fireEvent.click(screen.getByRole("button", { name: "生成电影级新视角" }));
    expect(
      await screen.findByText("暂时无法生成：缺少兼容的图片编辑模型。")
    ).toBeTruthy();
  });

  it("shows concrete blockers and opens API settings instead of silently doing nothing", async () => {
    const { onOpenSettings, sourceInput } = renderWorkbench();
    await prepareGeneration(sourceInput);

    fireEvent.click(screen.getByRole("button", { name: "生成电影级新视角" }));
    await screen.findByText("暂时无法生成：API Key 未配置。");

    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("cancels an active request and exposes a cancelled state", async () => {
    mocks.generate.mockImplementation(
      (
        _payload: unknown,
        _handlers: unknown,
        signal: AbortSignal
      ) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    );
    const { sourceInput } = renderWorkbench({ apiKey: "sk-test" });
    await prepareGeneration(sourceInput);

    fireEvent.click(screen.getByRole("button", { name: "生成电影级新视角" }));
    await screen.findByRole("button", { name: "取消生成" });
    fireEvent.click(screen.getByRole("button", { name: "取消生成" }));

    await screen.findByText("当前生成已取消，可调整输入后重新开始");
  });

  it("does not let a cancelled request overwrite an immediate retry", async () => {
    let rejectFirst: ((reason?: unknown) => void) | undefined;
    let resolveSecond:
      | ((result: GenerateVector3DViewResult) => void)
      | undefined;
    mocks.generate
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          })
      );
    const { sourceInput } = renderWorkbench({ apiKey: "sk-test" });
    await prepareGeneration(sourceInput);

    fireEvent.click(screen.getByRole("button", { name: "生成电影级新视角" }));
    fireEvent.click(await screen.findByRole("button", { name: "取消生成" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "生成电影级新视角" })
    );
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(2));

    await act(async () => {
      rejectFirst?.(new DOMException("Aborted", "AbortError"));
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "取消生成" })).toBeTruthy();

    await act(async () => {
      resolveSecond?.(successfulResult());
      await Promise.resolve();
    });
    await screen.findByRole("img", { name: "材质与盲区重塑" });
  });

  it("uses the configured display name in rendering status and final output", async () => {
    const renamed = cloneModel("gpt-image-2");
    renamed.id = "studio-cinematic-editor";
    renamed.apiModelName = "provider-image-edit-v4";
    renamed.displayName = "Studio Cinematic Editor";
    let resolveGeneration:
      | ((result: GenerateVector3DViewResult) => void)
      | undefined;
    mocks.generate.mockImplementation(
      (
        _payload: unknown,
        handlers: {
          onStage?: (
            stage: "reasoning" | "rendering",
            message: string
          ) => void;
        }
      ) => {
        handlers.onStage?.("rendering", "provider-image-edit-v4 is rendering");
        return new Promise((resolve) => {
          resolveGeneration = resolve;
        });
      }
    );
    const { sourceInput } = renderWorkbench({
      apiKey: "sk-test",
      models: [renamed],
      selectedModel: renamed
    });
    await prepareGeneration(sourceInput);

    fireEvent.click(screen.getByRole("button", { name: "生成电影级新视角" }));
    expect(await screen.findAllByText(
      "Studio Cinematic Editor 正在以 Gaussian 代理草图为镜头锚点重塑材质与隐藏区域"
    )).toHaveLength(2);

    await act(async () => {
      resolveGeneration?.(successfulResult());
      await Promise.resolve();
    });
    await screen.findByText("FINAL / Studio Cinematic Editor");
  });

  it("renders retryable stream diagnostics and retries with the same prepared inputs", async () => {
    mocks.generate
      .mockRejectedValueOnce(
        new Vector3DViewpointApiError("上游服务繁忙", {
          code: "VECTOR3D_IMAGE_UPSTREAM_503",
          requestId: "request-diagnostic",
          retryable: true
        })
      )
      .mockResolvedValueOnce(successfulResult());
    const { sourceInput } = renderWorkbench({ apiKey: "sk-test" });
    await prepareGeneration(sourceInput);

    fireEvent.click(screen.getByRole("button", { name: "生成电影级新视角" }));
    await screen.findByText("上游服务繁忙");
    expect(screen.getByText(/错误码 VECTOR3D_IMAGE_UPSTREAM_503/)).toBeTruthy();
    expect(screen.getByText(/请求 ID request-diagnostic/)).toBeTruthy();
    expect(screen.getByText("该错误可以重试")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("img", { name: "材质与盲区重塑" });
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  });
});
