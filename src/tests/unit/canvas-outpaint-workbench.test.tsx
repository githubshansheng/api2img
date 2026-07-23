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
  SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER_EN,
  buildSingleImageCameraPose,
  buildSingleImageCameraPrompt,
  type SingleImageViewpointAnalysis,
  type SingleImagePromptLanguage,
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
const RESULT_IMAGES: Record<SingleImagePromptLanguage, string> = {
  zh: "data:image/png;base64,cmVuZGVyZWQtemg=",
  en: "data:image/png;base64,cmVuZGVyZWQtZW4="
};
const TARGET_ROTATION: XYZRotation = { x: 720, y: -450, z: 45 };

function createServerRenderPrompt(
  rotation: XYZRotation,
  cameraDistance = 5,
  language: SingleImagePromptLanguage = "zh",
  outputSize = "2048x1152"
) {
  const prompt = buildSingleImageCameraPrompt(rotation, cameraDistance, {
    sourceWidth: 1600,
    sourceHeight: 900,
    outputSize
  });
  const cameraProtocol =
    language === "en"
      ? prompt.deterministicPromptEn
      : prompt.deterministicPromptZh;

  return `${cameraProtocol}\n${language === "en" ? "Server final render prompt" : "服务端最终渲染提示词"}`;
}

const SERVER_RENDER_PROMPT = createServerRenderPrompt(TARGET_ROTATION);

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
  rotation: XYZRotation = TARGET_ROTATION,
  cameraDistance = 5,
  promptLanguage: SingleImagePromptLanguage = "zh"
): SingleImageViewpointResult {
  return {
    ...ANALYSIS,
    requestId: "single-view-success",
    image: RESULT_IMAGES[promptLanguage],
    imageMimeType: "image/png",
    pose: buildSingleImageCameraPose(rotation),
    cameraPrompt: buildSingleImageCameraPrompt(rotation, cameraDistance, {
      sourceWidth: 1600,
      sourceHeight: 900,
      outputSize: "2048x1152"
    }),
    renderPrompt: createServerRenderPrompt(
      rotation,
      cameraDistance,
      promptLanguage
    ),
    promptLanguage,
    outputSize: "2048x1152",
    reasoningModel: "disabled",
    imageModel: "gpt-image-2",
    reasoningDurationMs: 0,
    renderingDurationMs: 280,
    totalDurationMs: 280
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
        name: "中英文各生成一张并对比"
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
  it("keeps the default user constraint separate from the whole-scene camera protocol", () => {
    renderWorkbench();

    expect(
      (
        screen.getByRole("textbox", {
          name: "中文补充约束"
        }) as HTMLTextAreaElement
      ).value
    ).toContain("延续同一现实瞬间");
    expect(
      (
        screen.getByRole("textbox", {
          name: "English additional constraint"
        }) as HTMLTextAreaElement
      ).value
    ).toContain("Continue the same real-world moment");
    expect(
      screen.getByText(/画面随镜头移动而重新成像和构图/)
    ).toBeTruthy();
    expect(
      screen.getByText(/不是让画面中的某一个对象在原背景中单独转动/)
    ).toBeTruthy();
  });

  it("shows shared gpt-5.6-sol reasoning before the two Image 2 renders", async () => {
    const pending: Array<{
      language: SingleImagePromptLanguage;
      handlers: {
        onStage?: (
          stage: "reasoning" | "rendering",
          message: string,
          analysis?: SingleImageViewpointAnalysis,
          cameraPrompt?: ReturnType<typeof buildSingleImageCameraPrompt>,
          renderPrompt?: string,
          promptLanguage?: SingleImagePromptLanguage
        ) => void;
      };
      resolve: (value: SingleImageViewpointResult) => void;
    }> = [];
    mocks.generate.mockImplementation(
      (
        payload: { prompt_language: SingleImagePromptLanguage },
        handlers: (typeof pending)[number]["handlers"]
      ) =>
        new Promise<SingleImageViewpointResult>((resolve) => {
          pending.push({
            language: payload.prompt_language,
            handlers,
            resolve
          });
        })
    );
    const { sourceInput } = renderWorkbench();
    await uploadSource(sourceInput);

    fireEvent.click(
      screen.getByRole("button", { name: "中英文各生成一张并对比" })
    );

    await waitFor(() => expect(pending).toHaveLength(2));
    expect(
      screen.getByText(/gpt-5.6-sol 正在共享分析原图、目标投影与完整机位图/)
    ).toBeTruthy();
    expect(
      document.querySelector(".single-view-live-state")?.className
    ).toContain("status-reasoning");
    expect(
      screen.getByText(/gpt-5.6-sol 正在生成中英文共享视觉事实包/)
    ).toBeTruthy();

    act(() => {
      for (const item of pending) {
        item.handlers.onStage?.(
          "rendering",
          `gpt-image-2 正在使用${item.language === "en" ? "英文" : "中文"}提示词从目标新机位重新拍摄整个场景`,
          ANALYSIS,
          buildSingleImageCameraPrompt({ x: 0, y: 0, z: 0 }, 5),
          createServerRenderPrompt(
            { x: 0, y: 0, z: 0 },
            5,
            item.language
          ),
          item.language
        );
      }
    });

    expect(
      document.querySelector(".single-view-live-state")?.className
    ).toContain("status-rendering");
    expect(
      screen.getByText(/gpt-image-2 正在执行中文提示词重拍/)
    ).toBeTruthy();

    await act(async () => {
      for (const item of pending) {
        item.resolve(
          createResult({ x: 0, y: 0, z: 0 }, 5, item.language)
        );
      }
    });

    await waitFor(() =>
      expect(
        screen.getByText("英文主结果与中文对照均已完成")
      ).toBeTruthy()
    );
  });

  it("sends cumulative XYZ angles, a clean pose guide, and a full camera view", async () => {
    mocks.generate.mockImplementation(
      (
        payload: { prompt_language: SingleImagePromptLanguage },
        handlers: {
          onStage?: (
            stage: "reasoning" | "rendering",
            message: string,
            analysis?: SingleImageViewpointAnalysis,
            cameraPrompt?: ReturnType<typeof buildSingleImageCameraPrompt>,
            renderPrompt?: string,
            promptLanguage?: SingleImagePromptLanguage
          ) => void;
        }
      ) => {
        const language = payload.prompt_language;
        const renderPrompt = createServerRenderPrompt(
          TARGET_ROTATION,
          5,
          language
        );
        handlers.onStage?.(
          "rendering",
          `gpt-image-2 正在使用${language === "en" ? "英文" : "中文"}提示词从目标新机位重新拍摄整个场景`,
          ANALYSIS,
          buildSingleImageCameraPrompt(TARGET_ROTATION, 5),
          renderPrompt,
          language
        );

        return Promise.resolve(createResult(TARGET_ROTATION, 5, language));
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
      name: "中英文各生成一张并对比"
    }));

    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(2));
    const callsByLanguage = Object.fromEntries(
      mocks.generate.mock.calls.map((call) => [
        call[0].prompt_language,
        call
      ])
    ) as Record<SingleImagePromptLanguage, typeof mocks.generate.mock.calls[number]>;

    for (const language of ["zh", "en"] as const) {
      const [payload, , signal] = callsByLanguage[language]!;
      expect(payload).toMatchObject({
        source_image: expect.stringMatching(/^data:image\/png;base64,/),
        pose_guide_image: GUIDE_IMAGE,
        camera_pose_image: CAMERA_VIEW_IMAGE,
        rotation_degrees: TARGET_ROTATION,
        camera_distance: 5,
        source_width: 1600,
        source_height: 900,
        prompt_language: language,
        reasoning_model: "gpt-5.6-sol",
        image_model: "gpt-image-2",
        output_size: "2048x1152",
        endpoint_override: {
          baseURL: "https://proxy.example",
          editURL: "https://images.example/v1/images/edits"
        }
      });
      expect(signal).toBeInstanceOf(AbortSignal);
    }

    expect(callsByLanguage.zh[0].user_prompt).toContain("延续同一现实瞬间");
    expect(callsByLanguage.en[0].user_prompt).toContain(
      "Continue the same real-world moment"
    );
    expect(
      (await screen.findByRole("img", {
        name: "中文对照结果"
      })) as HTMLImageElement
    ).toHaveProperty("src", RESULT_IMAGES.zh);
    expect(
      (await screen.findByRole("img", {
        name: "English 主结果（推荐）"
      })) as HTMLImageElement
    ).toHaveProperty("src", RESULT_IMAGES.en);
    expect(screen.queryByText("空间推演摘要")).toBeNull();
    expect(screen.getByText(/gpt-image-2 整场景重拍/)).toBeTruthy();
    expect(
      (screen.getByRole("link", { name: "中文对照" }) as HTMLAnchorElement).href
    ).toBe(RESULT_IMAGES.zh);
    expect(
      (screen.getByRole("link", { name: "EN 主结果" }) as HTMLAnchorElement).href
    ).toBe(RESULT_IMAGES.en);

    fireEvent.click(screen.getByRole("tab", { name: "EN" }));
    expect(
      document.querySelector(".single-view-prompt-island pre")?.textContent
    ).toBe(createServerRenderPrompt(TARGET_ROTATION, 5, "en"));
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
      expect(promptIsland()).toContain(
        "对象右侧机位（原图观看者左侧轨道）"
      );
      expect(promptIsland()).toContain("画面左边移动 90.00°");
    });

    fireEvent.change(screen.getByLabelText("观察距离与景别控制值"), {
      target: { value: "8" }
    });

    await waitFor(() => {
      expect(promptIsland()).toContain("特写");
      expect(promptIsland()).toContain(
        "景别：特写。观察距离控制值：8.0/10"
      );
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
      expect(promptIsland()).toContain("目标标签为基准正后方机位");
      expect(promptIsland()).toContain("正后方 180.00°");
    });

    fireEvent.click(screen.getByTestId("mock-pose-viewport"));

    await waitFor(() => {
      expect(promptIsland()).toContain(
        "目标标签为对象右侧机位（原图观看者左侧轨道）"
      );
      expect(promptIsland()).toContain("画面左边移动 90.00°");
    });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("marks the previous result and final prompt stale after a camera change", async () => {
    const initialRotation: XYZRotation = { x: 0, y: 0, z: 0 };
    const initialRenderPrompt = createServerRenderPrompt(
      initialRotation,
      5,
      "en"
    );
    mocks.generate.mockImplementation(
      (payload: { prompt_language: SingleImagePromptLanguage }) =>
        Promise.resolve(
          createResult(initialRotation, 5, payload.prompt_language)
        )
    );
    const { sourceInput } = renderWorkbench();
    await uploadSource(sourceInput);

    fireEvent.click(
      screen.getByRole("button", { name: "中英文各生成一张并对比" })
    );

    expect(
      await screen.findByRole("img", {
        name: "中文对照结果"
      })
    ).toHaveProperty("src", RESULT_IMAGES.zh);
    await waitFor(() => {
      expect(
        document.querySelector(".single-view-prompt-island pre")?.textContent
      ).toBe(initialRenderPrompt);
    });

    fireEvent.change(screen.getByLabelText("X 轴累计角度"), {
      target: { value: "45" }
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("img", {
          name: "中文对照结果"
        })
      ).toHaveProperty("src", RESULT_IMAGES.zh);
      expect(
        screen.getByText("相机或生成参数已更新，上一机位结果已保留")
      ).toBeTruthy();
      expect(screen.getByText("上一机位结果")).toBeTruthy();
      const retainedPreview = screen
        .getByRole("img", { name: "English 主结果（推荐）" })
        .closest("figure");
      expect(retainedPreview?.textContent).toContain(
        "X 0° · Y 0° · Z 0°"
      );
      expect(retainedPreview?.textContent).not.toContain("X 45°");
    });

    fireEvent.click(screen.getByRole("tab", { name: "相机协议" }));
    await waitFor(() => {
      expect(
        document.querySelector(".single-view-prompt-island pre")?.textContent
      ).not.toBe(initialRenderPrompt);
      expect(
        document.querySelector(".single-view-prompt-island pre")?.textContent
      ).toContain("raise the camera 45.00 degrees above the scene center");
    });

    fireEvent.click(screen.getByRole("tab", { name: "最终提示词" }));
    expect(
      document.querySelector(".single-view-prompt-island pre")?.textContent
    ).toBe(initialRenderPrompt);
    expect(
      document.querySelector(".single-view-prompt-island em")?.textContent
    ).toBe("上一机位");
  });

  it("clears legacy camera semantics even when the marker is current", async () => {
    mocks.generate.mockImplementation(
      (payload: { prompt_language: SingleImagePromptLanguage }) =>
        Promise.resolve(
          payload.prompt_language === "zh"
            ? {
                ...createResult(TARGET_ROTATION, 5, "zh"),
                renderPrompt:
                  `【锁定相机协议｜服务端确定性生成，禁止改写】\n${SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER}\n主体右侧表面必须显露。\n禁止让主体主动改变姿态、朝向、构型或场景布局来伪装相机运动。`
              }
            : createResult(TARGET_ROTATION, 5, "en")
        )
    );
    const { sourceInput } = renderWorkbench();
    await uploadSource(sourceInput);

    fireEvent.click(
      screen.getByRole("button", { name: "中英文各生成一张并对比" })
    );

    expect(
      await screen.findByText(
        "检测到不兼容的服务端提示词，已移除对应结果"
      )
    ).toBeTruthy();
    expect(
      screen.queryByRole("img", {
        name: "中文对照结果"
      })
    ).toBeNull();
    await waitFor(() =>
      expect(
        document.querySelector(".single-view-prompt-island pre")?.textContent
      ).toContain(SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER_EN)
    );
  });

  it("describes protocol 7.0 as a whole-scene camera recapture", () => {
    renderWorkbench();

    expect(
      screen.getByText(/XYZ 直接改变虚拟相机机位/).textContent
    ).toContain(
      "整幅画面随镜头移动而重新成像和构图"
    );
    expect(
      screen.getByText(/XYZ 直接改变虚拟相机机位/).textContent
    ).toContain(
      "不是让画面中的某一个对象在原背景中单独转动"
    );
    expect(
      screen.getByText(/XYZ 直接改变虚拟相机机位/).textContent
    ).toContain("不锁定原图朝屏幕的方向");
    expect(screen.queryByText(/主体世界状态保持连续/)).toBeNull();
  });

  it("preserves generated output after distance and user-constraint changes", async () => {
    mocks.generate.mockImplementation(
      (payload: {
        camera_distance: number;
        prompt_language: SingleImagePromptLanguage;
      }) =>
        Promise.resolve(
          createResult(
            { x: 0, y: 0, z: 0 },
            payload.camera_distance,
            payload.prompt_language
          )
        )
    );
    const { sourceInput } = renderWorkbench();
    await uploadSource(sourceInput);
    const generateButton = () =>
      screen.getByRole("button", {
        name: "中英文各生成一张并对比"
      });

    fireEvent.click(generateButton());
    expect(
      await screen.findByRole("img", { name: "中文对照结果" })
    ).toHaveProperty("src", RESULT_IMAGES.zh);

    fireEvent.change(screen.getByLabelText("观察距离与景别控制值"), {
      target: { value: "8" }
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("img", { name: "中文对照结果" })
      ).toHaveProperty("src", RESULT_IMAGES.zh);
      expect(
        screen.getByText("相机或生成参数已更新，上一机位结果已保留")
      ).toBeTruthy();
      expect(screen.getByText("上一机位结果")).toBeTruthy();
    });

    fireEvent.click(generateButton());
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(4));
    await screen.findByText("英文主结果与中文对照均已完成");
    expect(screen.queryByText("上一机位结果")).toBeNull();

    fireEvent.change(screen.getByLabelText("中文补充约束"), {
      target: { value: "延续同一场景，但保留新的中文补充约束。" }
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("img", { name: "中文对照结果" })
      ).toHaveProperty("src", RESULT_IMAGES.zh);
      expect(screen.getByText("上一机位结果")).toBeTruthy();
    });
    expect(
      document.querySelector(".single-view-prompt-island pre")?.textContent
    ).toBe(createServerRenderPrompt({ x: 0, y: 0, z: 0 }, 8, "en"));
  });

  it("opens generated previews in a detail dialog and exposes downloads", async () => {
    mocks.generate.mockImplementation(
      (payload: { prompt_language: SingleImagePromptLanguage }) =>
        Promise.resolve(
          createResult(TARGET_ROTATION, 5, payload.prompt_language)
        )
    );
    const { sourceInput } = renderWorkbench();
    await uploadSource(sourceInput);

    fireEvent.click(
      screen.getByRole("button", { name: "中英文各生成一张并对比" })
    );

    const preview = await screen.findByRole("img", {
      name: "English 主结果（推荐）"
    });
    expect(preview).toHaveProperty("src", RESULT_IMAGES.en);

    const previewDownload = screen.getByRole("link", {
      name: "下载English 主结果（推荐）"
    }) as HTMLAnchorElement;
    expect(previewDownload.href).toBe(RESULT_IMAGES.en);
    expect(previewDownload.download).toBe(
      "single-image-view-en-single-view-success.png"
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "放大查看English 主结果（推荐）"
      })
    );

    const dialog = screen.getByRole("dialog", {
      name: "English 主结果（推荐）详情"
    });
    expect(dialog).toBeTruthy();
    expect(
      screen.getByRole("img", {
        name: "English 主结果（推荐）详情"
      })
    ).toHaveProperty("src", RESULT_IMAGES.en);
    expect(dialog.textContent).toContain("X 720° · Y -450° · Z 45°");
    expect(dialog.textContent).toContain("disabled → gpt-image-2");
    expect(dialog.textContent).toContain("single-view-success");

    const detailDownload = screen.getByRole("link", {
      name: "下载"
    }) as HTMLAnchorElement;
    expect(detailDownload.href).toBe(RESULT_IMAGES.en);
    expect(detailDownload.download).toBe(
      "single-image-view-en-single-view-success.png"
    );

    fireEvent.click(screen.getByRole("button", { name: "关闭图片详情" }));
    expect(
      screen.queryByRole("dialog", {
        name: "English 主结果（推荐）详情"
      })
    ).toBeNull();
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
    fireEvent.change(screen.getByLabelText("观察距离与景别控制值"), {
      target: { value: "9" }
    });
    fireEvent.click(screen.getByRole("button", { name: "重置 XYZ 机位" }));

    expect(screen.getByLabelText("X 轴累计角度")).toHaveProperty("value", "0");
    expect(screen.getByLabelText("Y 轴累计角度")).toHaveProperty("value", "0");
    expect(screen.getByLabelText("Z 轴累计角度")).toHaveProperty("value", "0");
    expect(
      screen.getByLabelText("观察距离与景别控制值")
    ).toHaveProperty("value", "5");
    expect(
      document.querySelector(".single-view-prompt-island pre")?.textContent
    ).toContain("景别：中景。观察距离控制值：5.0/10");
    expect(
      document.querySelector(".single-view-prompt-island pre")?.textContent
    ).toContain("大白话机位：使用原图零度正面机位");
    expect(
      document.querySelector(".single-view-prompt-island pre")?.textContent
    ).toContain("Roll Z=0.00°");
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
      name: "中英文各生成一张并对比"
    }));
    fireEvent.click(await screen.findByRole("button", { name: "取消生成" }));

    expect(
      await screen.findByText("当前生成已取消，可调整姿态后重新开始")
    ).toBeTruthy();
  });

  it("does not let an aborted request overwrite the idle state after replacing the source", async () => {
    const rejectGenerations: Array<(reason?: unknown) => void> = [];
    mocks.generate.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectGenerations.push(reject);
        })
    );
    const view = renderWorkbench();
    await uploadSource(view.sourceInput);

    fireEvent.click(screen.getByRole("button", {
      name: "中英文各生成一张并对比"
    }));
    await screen.findByRole("button", { name: "取消生成" });
    await uploadSource(view.sourceInput, "replacement.png");

    await act(async () => {
      rejectGenerations.forEach((rejectGeneration) =>
        rejectGeneration(new DOMException("Aborted", "AbortError"))
      );
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
    mocks.generate.mockRejectedValue(
      new SingleImageViewpointApiError("上游图像服务繁忙", {
        code: "SINGLE_VIEW_IMAGE_UPSTREAM_503",
        retryable: true
      })
    );
    const { sourceInput } = renderWorkbench();
    await uploadSource(sourceInput);

    fireEvent.click(screen.getByRole("button", {
      name: "中英文各生成一张并对比"
    }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("上游图像服务繁忙");
    expect(alert.textContent).toContain(
      "错误码 SINGLE_VIEW_IMAGE_UPSTREAM_503"
    );
    expect(alert.textContent).toContain("该错误可以重试");
  });
});
