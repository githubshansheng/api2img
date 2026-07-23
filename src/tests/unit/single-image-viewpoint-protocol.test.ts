import { describe, expect, it } from "vitest";
import {
  buildSingleImageCameraPrompt,
  findSingleImagePromptConflict
} from "../../domain/single-image-viewpoint";

describe("single-image viewpoint camera protocol", () => {
  it("publishes a plain-language direct camera prompt", () => {
    const cameraPrompt = buildSingleImageCameraPrompt({
      x: -35,
      y: 135,
      z: 15
    });
    const prompt = cameraPrompt.deterministicPromptZh;

    expect(prompt).toContain(
      "相机直绘版本：10.6｜画面侧主指令、反镜头跟随与整场景新视锥重拍"
    );
    expect(prompt).toContain("任务类型：相机轨道重拍");
    expect(prompt).toContain(
      "先围绕原图场景中心移动相机"
    );
    expect(prompt).toContain(
      "将镜头转向中心人物/物品在原图画面中的左侧"
    );
    expect(prompt).toContain(
      "“镜像补全”只表示依据真实类别、左右对称关系、三维构造、材质与连接关系"
    );
    expect(prompt).toContain(
      "不是整图水平翻转、镜面倒影、复制对象或复制原图像素"
    );
    expect(prompt).toContain(
      "镜头始终看回原图中的同一场景中心"
    );
    expect(prompt).toContain(
      "移动相机后重新拍摄完整场景"
    );
    expect(prompt).toContain(
      "画面随镜头转动"
    );
    expect(prompt).toContain(
      "所有对象、中景、背景、地面、墙面、天花和画面边缘全部按新机位重建透视"
    );
    expect(prompt).toContain(
      "不能冻结原背景后只转动其中的人物、物品或局部"
    );
    expect(prompt).toContain(
      "新视锥中原图没有拍到的对象结构和环境区域"
    );
    expect(prompt).toContain(
      "依据原图的空间关系、环境风格、材质、光线与色彩合理想象并自然补全"
    );
    expect(prompt).toContain(
      "既包括新显露的对象真实结构，也包括新进入画幅的背景、地面、墙面、建筑、家具及其他环境范围"
    );
    expect(prompt).toContain(
      "不得用裁切、额外遮挡、模糊、空白、复制边缘或冻结背景逃避补全"
    );
    expect(prompt).toContain(
      "不要沿用原图的二维投影、遮挡顺序或背景排布"
    );
    expect(prompt.split("\n")).toHaveLength(16);
    expect(prompt).not.toMatch(
      /主体(?:右|左)侧表面|人体|器官|耳朵|下颌|肩部|风扇|网罩/
    );
    expect(findSingleImagePromptConflict(prompt)).toBeUndefined();
    expect(cameraPrompt.deterministicPromptEn).toContain(
      "move the camera and recapture the complete scene"
    );
    expect(cameraPrompt.deterministicPromptEn).toContain(
      "move the camera toward the LEFT side of the central person or object as located in the source frame"
    );
    expect(cameraPrompt.deterministicPromptEn).toContain(
      "Symmetric counterpart completion"
    );
    expect(cameraPrompt.deterministicPromptEn).toContain(
      "Recompute the 2D projection, occlusion order, and background layout from the target camera"
    );
    expect(cameraPrompt.deterministicPromptEn).toContain(
      "newly revealed real object structures and newly framed background"
    );
    expect(cameraPrompt.deterministicPromptEn).toContain(
      "near depth layers must shift toward the RIGHT side of the final image"
    );
    expect(findSingleImagePromptConflict(
      cameraPrompt.deterministicPromptEn
    )).toBeUndefined();
  });

  it.each([
    [{ x: 0, y: 0, z: 0 }, "基准正前方机位", "使用原图零度正面机位"],
    [
      { x: 0, y: 45, z: 0 },
      "对象右前方机位（原图观看者左侧轨道）",
      "画面左边移动 45.00°"
    ],
    [
      { x: 0, y: 90, z: 0 },
      "对象右侧机位（原图观看者左侧轨道）",
      "画面左边移动 90.00°"
    ],
    [
      { x: 0, y: 135, z: 0 },
      "对象右后方机位（原图观看者左侧轨道）",
      "画面左边移动 135.00°"
    ],
    [
      { x: 0, y: 180, z: 0 },
      "基准正后方机位",
      "正后方 180.00°"
    ],
    [
      { x: 0, y: -135, z: 0 },
      "对象左后方机位（原图观看者右侧轨道）",
      "画面右边移动 135.00°"
    ],
    [
      { x: 0, y: -90, z: 0 },
      "对象左侧机位（原图观看者右侧轨道）",
      "画面右边移动 90.00°"
    ],
    [
      { x: 0, y: -45, z: 0 },
      "对象左前方机位（原图观看者右侧轨道）",
      "画面右边移动 45.00°"
    ],
    [{ x: 75, y: 0, z: 0 }, "近顶视俯拍", "场景中心上方 75.00°"],
    [{ x: -75, y: 0, z: 0 }, "近底视仰拍", "场景中心下方 75.00°"]
  ] as const)(
    "describes %o as a whole-scene camera move",
    (rotation, label, cue) => {
      const prompt =
        buildSingleImageCameraPrompt(rotation).deterministicPromptZh;

      expect(prompt).toContain(label);
      expect(prompt).toContain(cue);
      expect(prompt).toContain(
        "前景、所有对象、中景、背景、地面、墙面、天花和画面边缘"
      );
      expect(prompt).not.toMatch(/主体(?:右|左)侧表面/);
      expect(prompt).not.toMatch(
        /禁止.{0,12}(?:改变|调整).{0,8}(?:姿态|朝向)/
      );
      expect(findSingleImagePromptConflict(prompt)).toBeUndefined();
    }
  );

  it("keeps roll as an optical-axis operation on the complete frame", () => {
    const prompt = buildSingleImageCameraPrompt({
      x: 20,
      y: 65,
      z: 45
    }).deterministicPromptZh;

    expect(prompt).toContain("Roll Z=+45.00°");
    expect(prompt).toContain(
      "整幅画框相对原图顺时针滚转"
    );
    expect(prompt).toContain(
      "前景、所有对象、中景、背景、地面、墙面、天花和画面边缘"
    );
  });

  it("adds a hard category-neutral projection check for a strict side view", () => {
    const prompt = buildSingleImageCameraPrompt({
      x: 0,
      y: 90,
      z: 0
    }).deterministicPromptZh;

    expect(prompt).toContain("严格 90° 侧面验收");
    expect(prompt).toContain(
      "镜头必须位于原图观看者左边"
    );
    expect(prompt).toContain(
      "被摄对象自身右边"
    );
    expect(prompt).toContain(
      "严禁走到原图观看者右边或对象自身左边"
    );
    expect(prompt).toContain(
      "原来正对镜头的大面积投影要明显收窄成边缘"
    );
    expect(prompt).toContain(
      "背景产生与观看者左侧轨道一致的视差"
    );
    expect(prompt).toContain(
      "近层必须相对远层向最终画面右边产生视差偏移"
    );
    expect(prompt).toContain(
      "前向深度轴也必须投向最终画面右边"
    );
    expect(prompt).toContain(
      "对象自身右边的新显露近侧结构应落在最终画面左侧轮廓"
    );
    expect(prompt).not.toMatch(
      /人体|器官|耳朵|下颌|肩部|风扇|网罩/
    );
    expect(findSingleImagePromptConflict(prompt)).toBeUndefined();
  });

  it("reverses the final screen-projection audit for a negative yaw", () => {
    const prompt = buildSingleImageCameraPrompt({
      x: 0,
      y: -56.2,
      z: 0
    });

    expect(prompt.deterministicPromptZh).toContain(
      "镜头向原图画面右边绕行后"
    );
    expect(prompt.deterministicPromptZh).toContain(
      "近层必须相对远层向最终画面左边产生视差偏移"
    );
    expect(prompt.deterministicPromptEn).toContain(
      "near depth layers must shift toward the LEFT side of the final image"
    );
  });

  it.each([
    ["主体右侧表面必须显露。", "generic-subject-surface"],
    ["必须显露主体左侧表面。", "generic-subject-surface"],
    [
      "禁止让主体主动改变姿态、朝向。",
      "source-projection-lock"
    ],
    [
      "Do not change the subject's pose or orientation.",
      "source-projection-lock"
    ],
    [
      "不得让主体整体、关节或可动部件随相机轨道同步补偿到正对镜头。",
      "source-projection-lock"
    ],
    [
      "不得转动主体或可动部件来抵消该投影缩短。",
      "source-projection-lock"
    ],
    [
      "不改变扇头姿态。",
      "source-projection-lock"
    ],
    [
      "Keep the fan head pose unchanged.",
      "source-projection-lock"
    ],
    [
      "保持图像1中的直立状态。",
      "source-projection-lock"
    ],
    [
      "不改变风扇头俯仰。",
      "source-projection-lock"
    ],
    [
      "保持产品原有偏航和倾斜状态。",
      "source-projection-lock"
    ],
    [
      "Keep the fan head pitch unchanged.",
      "source-projection-lock"
    ],
    [
      "Preserve the source object's upright orientation.",
      "source-projection-lock"
    ]
  ] as const)("detects the legacy conflict in %s", (prompt, conflict) => {
    expect(findSingleImagePromptConflict(prompt)).toBe(conflict);
  });
});
