import { describe, expect, it } from "vitest";
import {
  buildSingleImageCameraPrompt,
  SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER,
  SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER_EN,
  type SingleImageCameraPrompt
} from "../../domain";
import {
  assertCurrentSingleImageCameraProtocol,
  inspectSingleImageCameraProtocol
} from "../../services/single-image-viewpoint-service";

function cameraPrompt(prompt: string): SingleImageCameraPrompt {
  return {
    ...buildSingleImageCameraPrompt({ x: 0, y: 90, z: 0 }),
    deterministicPromptZh: prompt,
    deterministicPromptEn: SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER_EN
  };
}

describe("single-image viewpoint API protocol guard", () => {
  it("accepts camera and render prompts produced by the current protocol", () => {
    expect(() =>
      assertCurrentSingleImageCameraProtocol({
        cameraPrompt: cameraPrompt(SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER),
        renderPrompt: `最终提示词\n${SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER}`
      })
    ).not.toThrow();

    expect(() =>
      assertCurrentSingleImageCameraProtocol({
        cameraPrompt: cameraPrompt(SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER),
        promptLanguage: "en",
        renderPrompt: `Final prompt\n${SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER_EN}`
      })
    ).not.toThrow();
  });

  it("rejects an older backend protocol before it reaches the prompt island", () => {
    expect(() =>
      assertCurrentSingleImageCameraProtocol({
        cameraPrompt: cameraPrompt(
          "相机协议版本：3.1｜目标相机决定最终屏幕朝向"
        ),
        renderPrompt:
          "相机协议版本：3.1\n主体右侧表面必须显露。\n禁止改变姿态和朝向。"
      })
    ).toThrowError(
      expect.objectContaining({
        code: "SINGLE_VIEW_CAMERA_PROTOCOL_MISMATCH"
      })
    );
  });

  it("rejects protocol 3.3 results after the target-projection contract changes", () => {
    expect(() =>
      assertCurrentSingleImageCameraProtocol({
        cameraPrompt: cameraPrompt(
          "相机协议版本：3.3｜XYZ 指定目标观察机位：最终二维朝向必须随目标机位重建，不继承原图屏幕朝向"
        ),
        renderPrompt:
          "相机协议版本：3.3｜XYZ 指定目标观察机位：最终二维朝向必须随目标机位重建，不继承原图屏幕朝向"
      })
    ).toThrowError(
      expect.objectContaining({
        code: "SINGLE_VIEW_CAMERA_PROTOCOL_MISMATCH"
      })
    );
  });

  it("rejects a render prompt that omits the exact current camera block", () => {
    const exactCameraBlock = [
      SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER,
      "离散目标视角：基准右侧机位 + 平视 + 中景。",
      "精确相机方向：方位角 +90.00°。"
    ].join("\n");

    expect(() =>
      assertCurrentSingleImageCameraProtocol({
        cameraPrompt: cameraPrompt(exactCameraBlock),
        renderPrompt: [
          SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER,
          "离散目标视角：基准正前方机位 + 平视 + 中景。",
          "精确相机方向：方位角 +0.00°。"
        ].join("\n")
      })
    ).toThrowError(
      expect.objectContaining({
        code: "SINGLE_VIEW_CAMERA_PROTOCOL_MISMATCH"
      })
    );
    expect(
      inspectSingleImageCameraProtocol({
        cameraPrompt: cameraPrompt(exactCameraBlock),
        renderPrompt: [
          SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER,
          "离散目标视角：基准正前方机位 + 平视 + 中景。",
          "精确相机方向：方位角 +0.00°。"
        ].join("\n")
      })
    ).toBe("render-camera-block-mismatch");
  });

  it("rejects legacy surface templates and screen-pose locks even with a current marker", () => {
    expect(() =>
      assertCurrentSingleImageCameraProtocol({
        cameraPrompt: cameraPrompt(SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER),
        renderPrompt: [
          SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER,
          "主体右侧表面必须显露。",
          "禁止让主体主动改变姿态、朝向。",
          "主体在世界空间中的状态必须保持不变。"
        ].join("\n")
      })
    ).toThrowError(
      expect.objectContaining({
        code: "SINGLE_VIEW_CAMERA_PROTOCOL_MISMATCH"
      })
    );
  });
});
