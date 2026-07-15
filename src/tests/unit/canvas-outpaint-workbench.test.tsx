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
import { CanvasOutpaintWorkbench } from "../../components/canvas-outpaint/CanvasOutpaintWorkbench";
import {
  SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER,
  buildSingleImageCameraPose,
  buildSingleImageCameraPrompt,
  type SingleImageViewpointAnalysis,
  type SingleImageViewpointResult,
  type XYZRotation
} from "../../domain";
import { SingleImageViewpointApiError } from "../../services/single-image-viewpoint-service";

const mocks = vi.hoisted(() => ({
  exportPoseGuide: vi.fn(),
  generate: vi.fn()
}));

vi.mock("../../services/single-image-viewpoint-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../services/single-image-viewpoint-service")>();

  return {
    ...actual,
    generateSingleImageViewpoint: mocks.generate
  };
});

vi.mock(
  "../../components/canvas-outpaint/SingleImagePoseViewport",
  async () => {
    const { forwardRef, useEffect, useImperativeHandle } =
      await import("react");

    return {
      SingleImagePoseViewport: forwardRef(function MockPoseViewport(
        props: {
          imageURL?: string;
          onReadyChange?: (ready: boolean) => void;
          onRotationChange: (rotation: XYZRotation) => void;
          rotation: XYZRotation;
        },
        ref
      ) {
        useImperativeHandle(ref, () => ({
          exportPoseGuide: mocks.exportPoseGuide
        }));

        useEffect(() => {
          props.onReadyChange?.(Boolean(props.imageURL));
        }, [props.imageURL]);

        return (
          <button
            data-testid="mock-pose-viewport"
            onClick={() =>
              props.onRotationChange({
                x: props.rotation.x,
                y: 90,
                z: props.rotation.z
              })
            }
            type="button"
          >
            Mock pose viewport
          </button>
        );
      })
    };
  }
);

const GUIDE_IMAGE = "data:image/png;base64,cG9zZS1ndWlkZQ==";
const CAMERA_VIEW_IMAGE = "data:image/png;base64,Y2FtZXJhLXZpZXc=";
const RESULT_IMAGE = "data:image/png;base64,cmVuZGVyZWQ=";
const TARGET_ROTATION: XYZRotation = { x: 720, y: -450, z: 45 };
const SERVER_RENDER_PROMPT =
  `【锁定相机协议｜服务端确定性生成，禁止改写】\n${SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER}\n服务端最终渲染提示词`;

const ANALYSIS: SingleImageViewpointAnalysis = {
  subjectCategory: "product_object",
  optimizedPrompt: "按请求的相机姿态重绘同一主体。",
  viewDescription: "right-side profile with a slight clockwise roll",
  sourceViewDescription: "left-side three-quarter source view",
  targetViewDescription: "right-side profile with a slight clockwise roll",
  relativeCameraMotion:
    "相机从图像 1 基准向主体右侧环绕。",
  visibilityConstraints: ["近侧结构扩大，远侧结构产生符合体积的重叠"],
  occlusionConstraints: ["远侧结构按真实空间关系被近侧轮廓遮挡"],
  identityConstraints: ["保持主体类别、身份、结构和材质"],
  hiddenSurfacePlan: ["Infer the newly visible side conservatively"],
  scenePlan: ["Preserve the original studio background"],
  uncertaintyNotes: ["The far side is not visible in the source"]
};

class MockImage {
  height = 900;
  naturalHeight = 900;
  naturalWidth = 1600;
  onerror: ((event: Event) => void) | null = null;
  onload: ((event: Event) => void) | null = null;
  width = 1600;

  set src(_value: string) {
    queueMicrotask(() => this.onload?.(new Event("load")));
  }
}

function createResult(
  rotation: XYZRotation = TARGET_ROTATION
): SingleImageViewpointResult {
  return {
    ...ANALYSIS,
    requestId: "single-view-success",
    image: RESULT_IMAGE,
    imageMimeType: "image/png",
    pose: buildSingleImageCameraPose(rotation),
    cameraPrompt: buildSingleImageCameraPrompt(rotation, 5),
    renderPrompt: SERVER_RENDER_PROMPT,
    reasoningModel: "gpt-5.6-sol",
    imageModel: "gpt-image-2",
    reasoningDurationMs: 120,
    renderingDurationMs: 280,
    totalDurationMs: 400
  };
}

function renderWorkbench() {
  const view = render(
    <CanvasOutpaintWorkbench
      apiKey="sk-test"
      defaultBaseURL="https://proxy.example/v1/responses"
      defaultEditURL="https://images.example/v1/images/edits"
      onOpenSettings={vi.fn()}
    />
  );
  const sourceInput = view.container.querySelector(
    'input[accept="image/png,image/jpeg,image/webp"]'
  ) as HTMLInputElement;

  return {
    ...view,
    sourceInput
  };
}

async function uploadSource(input: HTMLInputElement, name = "source.png") {
  const file = new File(["source-image"], name, { type: "image/png" });
  fireEvent.change(input, {
    target: {
      files: [file]
    }
  });

  await screen.findByText(name);
  await waitFor(() =>
    expect(
      (screen.getByRole("button", {
        name: "生成该角度的新视图"
      }) as HTMLButtonElement).disabled
    ).toBe(false)
  );
}

beforeEach(() => {
  vi.stubGlobal("Image", MockImage);
  mocks.exportPoseGuide.mockReset();
  mocks.exportPoseGuide.mockReturnValue({
    cameraViewImage: CAMERA_VIEW_IMAGE,
    image: GUIDE_IMAGE,
    width: 1536,
    height: 864
  });
  mocks.generate.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("single-image XYZ viewpoint workbench", () => {
  it("sends cumulative XYZ angles, a clean pose guide, and a full camera view", async () => {
    let resolveGeneration:
      | ((result: SingleImageViewpointResult) => void)
      | undefined;
    mocks.generate.mockImplementation(
      (
        _payload: unknown,
        handlers: {
          onStage?: (
            stage: "reasoning" | "rendering",
            message: string,
            analysis?: SingleImageViewpointAnalysis,
            cameraPrompt?: ReturnType<typeof buildSingleImageCameraPrompt>,
            renderPrompt?: string
          ) => void;
        }
      ) => {
        handlers.onStage?.(
          "rendering",
          "gpt-image-2 is redrawing the complete frame",
          ANALYSIS,
          buildSingleImageCameraPrompt(TARGET_ROTATION, 5),
          SERVER_RENDER_PROMPT
        );

        return new Promise((resolve) => {
          resolveGeneration = resolve;
        });
      }
    );
    const { sourceInput } = renderWorkbench();
    await uploadSource(sourceInput);

    fireEvent.change(screen.getByLabelText("X 轴累计角度"), {
      target: { value: "720" }
    });
    fireEvent.change(screen.getByLabelText("Y 轴角度数值"), {
      target: { value: "-450" }
    });
    fireEvent.change(screen.getByLabelText("Z 轴累计角度"), {
      target: { value: "45" }
    });
    fireEvent.click(screen.getByRole("button", {
      name: "生成该角度的新视图"
    }));

    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1));
    const [payload, , signal] = mocks.generate.mock.calls[0]!;
    expect(payload).toMatchObject({
      source_image: expect.stringMatching(/^data:image\/png;base64,/),
      pose_guide_image: GUIDE_IMAGE,
      camera_pose_image: CAMERA_VIEW_IMAGE,
      rotation_degrees: TARGET_ROTATION,
      camera_distance: 5,
      reasoning_model: "gpt-5.6-sol",
      image_model: "gpt-image-2",
      output_size: "2048x1152",
      endpoint_override: {
        baseURL: "https://proxy.example",
        editURL: "https://images.example/v1/images/edits"
      }
    });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(
      await screen.findByText(
        "[Step 2/2] gpt-image-2 正在重绘目标相机视角"
      )
    ).toBeTruthy();
    const promptIsland = document.querySelector(
      ".single-view-prompt-island pre"
    );
    expect(promptIsland?.textContent).toBe(SERVER_RENDER_PROMPT);

    await act(async () => {
      resolveGeneration?.(createResult());
      await Promise.resolve();
    });

    expect(
      (await screen.findByRole("img", {
        name: "AI 新视角"
      })) as HTMLImageElement
    ).toHaveProperty("src", RESULT_IMAGE);
    expect(screen.getByText("空间推演摘要")).toBeTruthy();
    expect(
      (screen.getByRole("link", { name: "下载" }) as HTMLAnchorElement).href
    ).toBe(RESULT_IMAGE);
  });

  it("refreshes the local camera protocol without calling the API", async () => {
    const { sourceInput } = renderWorkbench();
    await uploadSource(sourceInput);

    const promptIsland = () =>
      document.querySelector(".single-view-prompt-island pre")?.textContent ??
      "";
    const initialPrompt = promptIsland();

    fireEvent.change(screen.getByLabelText("Y 轴累计角度"), {
      target: { value: "90" }
    });

    await waitFor(() => {
      expect(promptIsland()).not.toBe(initialPrompt);
      expect(promptIsland()).toContain("基准右侧机位");
      expect(promptIsland()).toContain("Y=+90.00°");
    });

    fireEvent.change(screen.getByLabelText("景别控制值"), {
      target: { value: "8" }
    });

    await waitFor(() => {
      expect(promptIsland()).toContain("特写");
      expect(promptIsland()).toContain("距离控制值 8.0/10");
    });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("refreshes the local protocol for presets and viewport orbit changes", async () => {
    const { sourceInput } = renderWorkbench();
    await uploadSource(sourceInput);
    const promptIsland = () =>
      document.querySelector(".single-view-prompt-island pre")?.textContent ??
      "";

    fireEvent.click(screen.getByRole("button", { name: "背面 180°" }));

    await waitFor(() => {
      expect(promptIsland()).toContain("离散目标视角：基准正后方机位");
      expect(promptIsland()).toContain("Y=+180.00°");
    });

    fireEvent.click(screen.getByTestId("mock-pose-viewport"));

    await waitFor(() => {
      expect(promptIsland()).toContain("离散目标视角：基准右侧机位");
      expect(promptIsland()).toContain("Y=+90.00°");
    });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("marks the previous result and final prompt stale after a camera change", async () => {
    mocks.generate.mockResolvedValueOnce(createResult());
    const { sourceInput } = renderWorkbench();
    await uploadSource(sourceInput);

    fireEvent.click(
      screen.getByRole("button", { name: "生成该角度的新视图" })
    );

    expect(
      await screen.findByRole("img", {
        name: "AI 新视角"
      })
    ).toHaveProperty("src", RESULT_IMAGE);
    await waitFor(() => {
      expect(
        document.querySelector(".single-view-prompt-island pre")?.textContent
      ).toBe(SERVER_RENDER_PROMPT);
    });

    fireEvent.change(screen.getByLabelText("X 轴累计角度"), {
      target: { value: "45" }
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("img", {
          name: "AI 新视角"
        })
      ).toBeNull();
      expect(
        document.querySelector(".single-view-prompt-island pre")?.textContent
      ).not.toBe(SERVER_RENDER_PROMPT);
      expect(
        document.querySelector(".single-view-prompt-island pre")?.textContent
      ).toContain("X=+45.00°");
    });

    fireEvent.click(screen.getByRole("tab", { name: "最终提示词" }));
    expect(
      document.querySelector(".single-view-prompt-island pre")?.textContent
    ).toContain("服务端实际发送给 GPT Image 2");
  });

  it("clears a final prompt produced by an older camera protocol", async () => {
    mocks.generate.mockResolvedValueOnce({
      ...createResult(),
      renderPrompt:
        "【锁定相机协议｜服务端确定性生成，禁止改写】\n相机协议版本：2.2｜目标机位重新成像，屏幕投影必须重建\n主体右侧表面必须显露。\n禁止让主体主动改变姿态、朝向、构型或场景布局来伪装相机运动。"
    });
    const { sourceInput } = renderWorkbench();
    await uploadSource(sourceInput);

    fireEvent.click(
      screen.getByRole("button", { name: "生成该角度的新视图" })
    );

    expect(
      await screen.findByText(
        "检测到旧版提示词，已清除，请按当前目标机位重新生成"
      )
    ).toBeTruthy();
    expect(
      screen.queryByRole("img", {
        name: "AI 新视角"
      })
    ).toBeNull();
    await waitFor(() =>
      expect(
        document.querySelector(".single-view-prompt-island pre")?.textContent
      ).toContain(SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER)
    );
  });

  it("describes camera motion with protocol 2.4 reprojection semantics", () => {
    renderWorkbench();

    expect(
      screen.getByText(/主体世界状态保持连续/).textContent
    ).toContain(
      "屏幕朝向、轮廓、可见结构、遮挡与背景视差由目标相机重新投影"
    );
    expect(screen.queryByText(/主体主动转身/)).toBeNull();
  });

  it("invalidates generated output after distance and user-constraint changes", async () => {
    mocks.generate
      .mockResolvedValueOnce(createResult())
      .mockResolvedValueOnce(createResult());
    const { sourceInput } = renderWorkbench();
    await uploadSource(sourceInput);
    const generateButton = () =>
      screen.getByRole("button", { name: "生成该角度的新视图" });

    fireEvent.click(generateButton());
    expect(
      await screen.findByRole("img", { name: "AI 新视角" })
    ).toHaveProperty("src", RESULT_IMAGE);

    fireEvent.change(screen.getByLabelText("景别控制值"), {
      target: { value: "8" }
    });

    await waitFor(() =>
      expect(screen.queryByRole("img", { name: "AI 新视角" })).toBeNull()
    );
    expect(screen.getByText("参数已更新，等待重新生成")).toBeTruthy();

    fireEvent.click(generateButton());
    expect(
      await screen.findByRole("img", { name: "AI 新视角" })
    ).toHaveProperty("src", RESULT_IMAGE);

    fireEvent.change(screen.getByLabelText("视角重绘约束"), {
      target: { value: "保持同一人物，但保留新的中文补充约束。" }
    });

    await waitFor(() =>
      expect(screen.queryByRole("img", { name: "AI 新视角" })).toBeNull()
    );
    expect(
      document.querySelector(".single-view-prompt-island pre")?.textContent
    ).not.toBe(SERVER_RENDER_PROMPT);
  });

  it("resets XYZ, Roll, and framing to their zero-view defaults", async () => {
    const { sourceInput } = renderWorkbench();
    await uploadSource(sourceInput);

    fireEvent.change(screen.getByLabelText("X 轴累计角度"), {
      target: { value: "120" }
    });
    fireEvent.change(screen.getByLabelText("Y 轴累计角度"), {
      target: { value: "-450" }
    });
    fireEvent.change(screen.getByLabelText("Z 轴累计角度"), {
      target: { value: "315" }
    });
    fireEvent.change(screen.getByLabelText("景别控制值"), {
      target: { value: "9" }
    });
    fireEvent.click(screen.getByRole("button", { name: "重置 XYZ 机位" }));

    expect(screen.getByLabelText("X 轴累计角度")).toHaveProperty("value", "0");
    expect(screen.getByLabelText("Y 轴累计角度")).toHaveProperty("value", "0");
    expect(screen.getByLabelText("Z 轴累计角度")).toHaveProperty("value", "0");
    expect(screen.getByLabelText("景别控制值")).toHaveProperty("value", "5");
    expect(
      document.querySelector(".single-view-prompt-island pre")?.textContent
    ).toContain("离散目标视角：基准正前方机位 + 平视 + 中景");
    expect(
      document.querySelector(".single-view-prompt-island pre")?.textContent
    ).toContain("Roll 0°");
  });

  it("copies and collapses the prompt tool island", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    const { sourceInput } = renderWorkbench();
    await uploadSource(sourceInput);
    const currentPrompt =
      document.querySelector(".single-view-prompt-island pre")?.textContent ??
      "";

    fireEvent.click(
      screen.getByRole("button", { name: "复制当前提示词" })
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(currentPrompt));

    fireEvent.click(
      screen.getByRole("button", { name: "收起提示词工具岛" })
    );
    expect(document.querySelector(".single-view-prompt-island pre")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "展开提示词工具岛" })
    );
    expect(
      document.querySelector(".single-view-prompt-island pre")?.textContent
    ).toBe(currentPrompt);
  });

  it("cancels the visible request and reports the cancelled state", async () => {
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
    const { sourceInput } = renderWorkbench();
    await uploadSource(sourceInput);

    fireEvent.click(screen.getByRole("button", {
      name: "生成该角度的新视图"
    }));
    fireEvent.click(await screen.findByRole("button", { name: "取消生成" }));

    expect(
      await screen.findByText("当前生成已取消，可调整姿态后重新开始")
    ).toBeTruthy();
  });

  it("does not let an aborted request overwrite the idle state after replacing the source", async () => {
    let rejectGeneration: ((reason?: unknown) => void) | undefined;
    mocks.generate.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectGeneration = reject;
        })
    );
    const view = renderWorkbench();
    await uploadSource(view.sourceInput);

    fireEvent.click(screen.getByRole("button", {
      name: "生成该角度的新视图"
    }));
    await screen.findByRole("button", { name: "取消生成" });
    await uploadSource(view.sourceInput, "replacement.png");

    await act(async () => {
      rejectGeneration?.(new DOMException("Aborted", "AbortError"));
      await Promise.resolve();
    });

    expect(
      view.container.querySelector(".single-view-live-state")?.classList
    ).toContain("status-idle");
    expect(
      screen.queryByText("当前生成已取消，可调整姿态后重新开始")
    ).toBeNull();
  });

  it("shows retry diagnostics from the single-image viewpoint API", async () => {
    mocks.generate.mockRejectedValueOnce(
      new SingleImageViewpointApiError("上游图像服务繁忙", {
        code: "SINGLE_VIEW_IMAGE_UPSTREAM_503",
        retryable: true
      })
    );
    const { sourceInput } = renderWorkbench();
    await uploadSource(sourceInput);

    fireEvent.click(screen.getByRole("button", {
      name: "生成该角度的新视图"
    }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("上游图像服务繁忙");
    expect(alert.textContent).toContain(
      "错误码 SINGLE_VIEW_IMAGE_UPSTREAM_503"
    );
    expect(alert.textContent).toContain("该错误可以重试");
  });
});
