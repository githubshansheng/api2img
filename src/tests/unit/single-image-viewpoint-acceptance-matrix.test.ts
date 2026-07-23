import { describe, expect, it } from "vitest";
import type { XYZRotation } from "../../domain";
import {
  buildSingleImageCameraPose,
  findSingleImagePromptConflict
} from "../../domain";
import { buildSingleImageDirectRenderPrompt } from "../../../server/single-image-viewpoint/single-image-viewpoint-service";

type ReferenceKind = "portrait" | "fan";

const MATRIX: Array<{
  key: string;
  rotation: XYZRotation;
  distance: number;
  expected: string[];
}> = [
  {
    key: "front",
    rotation: { x: 0, y: 0, z: 0 },
    distance: 5,
    expected: [
      "主指令：保持原图零度正面机位",
      "相机参数：Pitch +0.00°，Roll +0.00°，中景"
    ]
  },
  {
    key: "side",
    rotation: { x: 0, y: 90, z: 0 },
    distance: 5,
    expected: [
      "核心口令：将镜头转向中心人物/物品的左侧",
      "相机沿该侧轨道环绕 90.00°",
      "镜头位于原图画面左侧",
      "前景、中心对象、环境、背景、地面和画面边缘"
    ]
  },
  {
    key: "top",
    rotation: { x: 75, y: 0, z: 0 },
    distance: 5,
    expected: [
      "主指令：保持原图零度正面机位",
      "相机参数：Pitch +75.00°，Roll +0.00°，中景"
    ]
  },
  {
    key: "bottom",
    rotation: { x: -75, y: 0, z: 0 },
    distance: 5,
    expected: [
      "主指令：保持原图零度正面机位",
      "相机参数：Pitch -75.00°，Roll +0.00°，中景"
    ]
  },
  {
    key: "wide",
    rotation: { x: 0, y: 0, z: 0 },
    distance: 1,
    expected: [
      "主指令：保持原图零度正面机位",
      "相机参数：Pitch +0.00°，Roll +0.00°，远景",
      "补全目标机位可见、但图像 1 未拍到或被遮挡的全部范围"
    ]
  },
  {
    key: "medium",
    rotation: { x: 0, y: 0, z: 0 },
    distance: 5,
    expected: [
      "主指令：保持原图零度正面机位",
      "相机参数：Pitch +0.00°，Roll +0.00°，中景",
      "第一张图是画面元素与完整环境的事实参考"
    ]
  },
  {
    key: "close-up",
    rotation: { x: 0, y: 0, z: 0 },
    distance: 8,
    expected: [
      "主指令：保持原图零度正面机位",
      "相机参数：Pitch +0.00°，Roll +0.00°，特写",
      "通过新视锥重拍完整且固定的三维场景"
    ]
  }
];

describe("single-image viewpoint whole-scene acceptance matrix", () => {
  it.each(
    MATRIX.flatMap((matrixCase) =>
      (["portrait", "fan"] as const).map(
        (reference) => [reference, matrixCase] as const
      )
    )
  )(
    "uses the same category-neutral camera protocol for %s at $key",
    (_reference: ReferenceKind, matrixCase) => {
      const prompt = buildSingleImageDirectRenderPrompt(
        buildSingleImageCameraPose(matrixCase.rotation),
        "延续原图环境、材质、光线和色彩，不增加无关概念。",
        matrixCase.distance
      );

      for (const expected of matrixCase.expected) {
        expect(prompt).toContain(expected);
      }

      expect(prompt).toContain("【唯一最高优先级任务｜相机新视角重拍】");
      expect(prompt).toContain(
        "第一张图是画面元素与完整环境的事实参考"
      );
      expect(prompt).toContain(
        "通过新视锥重拍完整且固定的三维场景"
      );
      expect(prompt).toContain(
        "前景、中心对象、环境、背景、地面和画面边缘必须一起更新透视、视差、尺度、遮挡和构图"
      );
      expect(prompt).toContain(
        "补全目标机位可见、但图像 1 未拍到或被遮挡的全部范围"
      );
      expect(prompt).toContain(
        "依据真实类别和原图证据进行三维对侧补全"
      );
      expect(prompt).toContain(
        "若结果仍接近原图正面、背景仍冻结在原构图"
      );
      expect(prompt).toContain(
        "不是整图水平翻转、镜面倒影、复制对象或复制原图像素"
      );
      expect(prompt).toContain(
        "不要照抄引导图中的卡片、坐标轴、旋转环"
      );
      expect(prompt).not.toMatch(
        /主体(?:右|左)侧表面|耳朵|下颌|肩部|鼻孔|网罩|轮毂|风扇头/
      );
      expect(prompt).not.toMatch(
        /(?:禁止|不得|不要).{0,12}(?:改变|调整).{0,8}(?:姿态|朝向)/
      );
      expect(findSingleImagePromptConflict(prompt)).toBeUndefined();
    }
  );
});
