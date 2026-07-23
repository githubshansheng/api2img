import { describe, expect, it } from "vitest";
import {
  accumulateSingleImageRotation,
  buildSingleImageCameraPose,
  buildSingleImageCameraPrompt,
  buildSingleImageDirectionalConstraints,
  calculateShortestAxisRotationDelta,
  calculateSingleImageOutputSize,
  clampSingleImageCameraDistance,
  clampSingleImageRotationAngle,
  normalizeSingleImageRotationAngle
} from "../../domain/single-image-viewpoint";

describe("single-image viewpoint rotation math", () => {
  it("clamps each cumulative axis to two turns in either direction", () => {
    expect(clampSingleImageRotationAngle(900)).toBe(720);
    expect(clampSingleImageRotationAngle(-900)).toBe(-720);
    expect(clampSingleImageRotationAngle(Number.NaN)).toBe(0);
  });

  it("normalizes cumulative turns to an equivalent signed model pose", () => {
    expect(normalizeSingleImageRotationAngle(360)).toBe(0);
    expect(normalizeSingleImageRotationAngle(720)).toBe(0);
    expect(normalizeSingleImageRotationAngle(-360)).toBe(0);
    expect(normalizeSingleImageRotationAngle(-720)).toBe(0);
    expect(normalizeSingleImageRotationAngle(450)).toBe(90);
    expect(normalizeSingleImageRotationAngle(-450)).toBe(-90);
  });

  it("accumulates across the visual zero boundary in either direction", () => {
    expect(calculateShortestAxisRotationDelta(359, 1)).toBe(2);
    expect(calculateShortestAxisRotationDelta(1, 359)).toBe(-2);
    expect(accumulateSingleImageRotation(719, 359, 1)).toBe(720);
    expect(accumulateSingleImageRotation(720, 1, 359)).toBe(718);
    expect(accumulateSingleImageRotation(-720, 359, 1)).toBe(-718);
  });

  it("builds equivalent camera quaternions for repeated full turns", () => {
    const front = buildSingleImageCameraPose({ x: 0, y: 0, z: 0 });
    const twoTurns = buildSingleImageCameraPose({
      x: 720,
      y: -720,
      z: 360
    });

    expect(twoTurns.normalizedDegrees).toEqual({ x: 0, y: 0, z: 0 });
    expect(twoTurns.quaternion).toEqual(front.quaternion);
    expect(twoTurns.eulerOrder).toBe("YXZ");
  });

  it("moves positive yaw toward source-viewer left and object-own right", () => {
    const pose = buildSingleImageCameraPose({ x: 0, y: 90, z: 0 });
    const cameraPosition = rotateVectorByQuaternion(
      { x: 0, y: 0, z: -1 },
      pose.quaternion
    );
    const viewDirection = normalizeVector({
      x: -cameraPosition.x,
      y: -cameraPosition.y,
      z: -cameraPosition.z
    });
    const cameraScreenRight = crossVectors(viewDirection, {
      x: 0,
      y: 1,
      z: 0
    });
    const sourceFacingDepthAxis = { x: 0, y: 0, z: -1 };

    expect(cameraPosition.x).toBeCloseTo(1, 6);
    expect(cameraPosition.z).toBeCloseTo(0, 6);
    expect(dotVectors(sourceFacingDepthAxis, cameraScreenRight)).toBeGreaterThan(
      0
    );
    const prompt = buildSingleImageCameraPrompt({
      x: 0,
      y: 90,
      z: 0
    });

    expect(prompt.viewerOrbitDirectionZh).toBe("原图观看者左侧");
    expect(prompt.objectOrbitDirectionZh).toBe("被摄对象自身右侧");
    expect(prompt.deterministicPromptZh).toContain(
      "镜头沿轨道向画面左边移动 90.00°"
    );
    expect(prompt.deterministicPromptZh).toContain(
      "等于来到对象自身右边"
    );
    expect(prompt.deterministicPromptZh).toContain(
      "严禁走到画面右边或对象自身左边"
    );
  });

  it("projects the source-facing depth axis left for a negative yaw", () => {
    const pose = buildSingleImageCameraPose({ x: 0, y: -90, z: 0 });
    const cameraPosition = rotateVectorByQuaternion(
      { x: 0, y: 0, z: -1 },
      pose.quaternion
    );
    const viewDirection = normalizeVector({
      x: -cameraPosition.x,
      y: -cameraPosition.y,
      z: -cameraPosition.z
    });
    const cameraScreenRight = crossVectors(viewDirection, {
      x: 0,
      y: 1,
      z: 0
    });

    expect(cameraPosition.x).toBeCloseTo(-1, 6);
    expect(
      dotVectors({ x: 0, y: 0, z: -1 }, cameraScreenRight)
    ).toBeLessThan(0);
  });

  it.each([
    [0, "front"],
    [22.49, "front"],
    [22.5, "right-front"],
    [67.49, "right-front"],
    [67.5, "right"],
    [112.5, "right-back"],
    [157.5, "back"],
    [202.5, "left-back"],
    [247.5, "left"],
    [292.5, "left-front"],
    [337.49, "left-front"],
    [337.5, "front"]
  ] as const)(
    "maps yaw %s to the deterministic %s azimuth bin",
    (yaw, expected) => {
      expect(
        buildSingleImageCameraPrompt({ x: 0, y: yaw, z: 0 }).azimuthKey
      ).toBe(expected);
    }
  );

  it.each([
    [45, "right-front"],
    [90, "right"],
    [180, "back"],
    [-90, "left"]
  ] as const)("maps pure Y=%s to %s", (yaw, expected) => {
    expect(
      buildSingleImageCameraPrompt({ x: 0, y: yaw, z: 0 }).azimuthKey
    ).toBe(expected);
  });

  it.each([
    [-75, "near-bottom"],
    [-74.9, "low-angle"],
    [-15.01, "low-angle"],
    [-15, "eye-level"],
    [14.99, "eye-level"],
    [15, "elevated"],
    [44.99, "elevated"],
    [45, "high-angle"],
    [74.99, "high-angle"],
    [75, "near-top"]
  ] as const)(
    "maps pitch %s to the deterministic %s elevation bin",
    (pitch, expected) => {
      expect(
        buildSingleImageCameraPrompt({ x: pitch, y: 0, z: 0 })
          .elevationKey
      ).toBe(expected);
    }
  );

  it.each([
    [0, "wide"],
    [1.9, "wide"],
    [2, "medium"],
    [5.9, "medium"],
    [6, "close-up"],
    [10, "close-up"]
  ] as const)(
    "maps camera distance %s to the deterministic %s framing bin",
    (distance, expected) => {
      expect(
        buildSingleImageCameraPrompt(
          { x: 0, y: 0, z: 0 },
          distance
        ).distanceKey
      ).toBe(expected);
    }
  );

  it("clamps camera distance to the supported zero-to-ten range", () => {
    expect(clampSingleImageCameraDistance(-1)).toBe(0);
    expect(clampSingleImageCameraDistance(11)).toBe(10);
    expect(clampSingleImageCameraDistance(Number.NaN)).toBe(5);
  });

  it("derives final azimuth from the composed quaternion after crossing the top", () => {
    const prompt = buildSingleImageCameraPrompt({
      x: 120,
      y: 45,
      z: 0
    });

    expect(prompt.azimuthKey).toBe("left-back");
    expect(prompt.cameraAzimuthDegrees).toBeCloseTo(-135, 2);
    expect(prompt.cameraElevationDegrees).toBeCloseTo(60, 2);
    expect(prompt.azimuthKey).not.toBe("right-front");
  });

  it("keeps camera direction independent from optical-axis roll", () => {
    const unrolled = buildSingleImageCameraPrompt({
      x: 30,
      y: 65,
      z: 0
    });
    const rolled = buildSingleImageCameraPrompt({
      x: 30,
      y: 65,
      z: 405
    });

    expect(rolled.cameraAzimuthDegrees).toBe(
      unrolled.cameraAzimuthDegrees
    );
    expect(rolled.cameraElevationDegrees).toBe(
      unrolled.cameraElevationDegrees
    );
    expect(rolled.cameraRollDegrees).toBe(45);
    expect(rolled.rollLabelZh).toContain("顺时针");
  });

  it("emits subject-neutral projection and low-angle constraints", () => {
    const constraints = buildSingleImageDirectionalConstraints(
      buildSingleImageCameraPose({ x: -35, y: 65, z: 0 })
    );

    expect(constraints.relativeCameraMotion.join(" ")).toContain(
      "原图是唯一的零度相机基准"
    );
    expect(constraints.visibilityConstraints.join(" ")).toContain(
      "前景、关注对象、中景、背景、地面、环境物体和画面边界必须一起重新成像"
    );
    expect(constraints.visibilityConstraints.join(" ")).toContain(
      "原图未拍到但会进入目标新视锥的对象结构与环境区域"
    );
    expect(constraints.occlusionConstraints.join(" ")).toContain(
      "所有近远遮挡、入画、出画和重新显露关系必须按目标相机位置重新计算"
    );
    expect(constraints.perspectiveCues.join(" ")).toContain(
      "相机沿原图观看者左侧轨道移动"
    );
    expect(constraints.perspectiveCues.join(" ")).toContain(
      "低机位仰拍透视"
    );
    expect(
      [
        ...constraints.visibilityConstraints,
        ...constraints.occlusionConstraints,
        ...constraints.perspectiveCues
      ].join(" ")
    ).not.toMatch(/人体|解剖|脸|耳朵|下颌|肩部|鼻孔/);
    expect(constraints.visibilityConstraints.join(" ")).not.toContain(
      "主体右侧表面"
    );
    expect(constraints.forbiddenShortcuts.join(" ")).toContain(
      "只修改关注对象而保留源图背景构图"
    );
    expect(constraints.forbiddenShortcuts.join(" ")).not.toContain(
      "禁止改变姿态"
    );
    expect(constraints.forbiddenShortcuts.join(" ")).not.toContain(
      "禁止改变朝向"
    );
  });

  it("builds an auditable concise Chinese camera block", () => {
    const prompt = buildSingleImageCameraPrompt(
      { x: 720, y: -450, z: -45 },
      6
    );

    expect(prompt.azimuthKey).toBe("left");
    expect(prompt.distanceKey).toBe("close-up");
    expect(prompt.deterministicPromptZh).toContain(
      "【相机直绘｜中文】"
    );
    expect(prompt.deterministicPromptZh).toContain(
      "相机直绘版本：10.6｜画面侧主指令、反镜头跟随与整场景新视锥重拍"
    );
    expect(prompt.deterministicPromptZh).toContain(
      "把镜头沿轨道向画面右边移动 90.00°"
    );
    expect(prompt.deterministicPromptZh).toContain(
      "移动相机后重新拍摄完整场景"
    );
    expect(prompt.deterministicPromptZh).toContain(
      "画面随镜头转动"
    );
    expect(prompt.deterministicPromptZh).toContain(
      "全部按新机位重建透视、尺度、视差、遮挡与构图"
    );
    expect(prompt.deterministicPromptZh).toContain(
      "不要沿用原图的二维投影、遮挡顺序或背景排布"
    );
    expect(prompt.deterministicPromptZh).toContain(
      "新视锥中原图没有拍到的对象结构和环境区域"
    );
    expect(prompt.deterministicPromptZh).toContain(
      "合理想象并自然补全"
    );
    expect(prompt.deterministicPromptZh).toContain(
      "将镜头转向中心人物/物品在原图画面中的右侧"
    );
    expect(prompt.deterministicPromptZh).toContain(
      "“镜像补全”只表示依据真实类别、左右对称关系、三维构造、材质与连接关系"
    );
    expect(prompt.deterministicPromptZh).toContain(
      "不能冻结原背景后只转动其中的人物、物品或局部"
    );
    expect(prompt.deterministicPromptZh).toContain(
      "只改变单个对象角度而不重建整幅场景"
    );
    expect(prompt.deterministicPromptZh).toContain(
      "禁止：整图水平翻转、镜面倒影、复制人物或物品、二维旋转、卡片翻转、透视拉伸、剪贴、普通扩图"
    );
    expect(prompt.deterministicPromptZh).toContain("逆时针");
    expect(prompt.deterministicPromptZh.split("\n")).toHaveLength(16);
    expect(prompt.deterministicPromptZh).not.toMatch(
      /人体|解剖|脸|耳朵|下颌|肩部|鼻孔/
    );
    expect(prompt.deterministicPromptZh).not.toContain(
      "主体右侧表面"
    );
    expect(prompt.deterministicPromptZh).not.toContain(
      "禁止改变姿态朝向"
    );
    expect(prompt.deterministicPromptZh).not.toContain(
      "主体主动配合转身"
    );
    expect(prompt.deterministicPromptZh).not.toContain(
      "主体在世界空间中的状态必须保持不变"
    );
  });

  it("describes the image-4 camera parameters in unambiguous plain language", () => {
    const prompt = buildSingleImageCameraPrompt(
      { x: 7.1, y: 56.2, z: -362 },
      1.5,
      {
        sourceWidth: 1254,
        sourceHeight: 1254,
        outputSize: "2048x2048"
      }
    );

    expect(prompt.azimuthKey).toBe("right-front");
    expect(prompt.elevationKey).toBe("eye-level");
    expect(prompt.distanceKey).toBe("wide");
    expect(prompt.cumulativeRotationDegrees).toEqual({
      x: 7.1,
      y: 56.2,
      z: -362
    });
    expect(prompt.equivalentRotationDegrees).toEqual({
      x: 7.1,
      y: 56.2,
      z: -2
    });
    expect(prompt.sourceAspectRatioLabel).toBe("1:1");
    expect(prompt.outputSize).toBe("2048x2048");

    const zh = prompt.deterministicPromptZh;
    expect(zh).toContain("原图观看者的屏幕坐标");
    expect(zh).toContain("镜头沿轨道向画面左边移动 56.20°");
    expect(zh).toContain(
      "将镜头转向中心人物/物品在原图画面中的左侧"
    );
    expect(zh).toContain(
      "自动补全原图不可见的全部部分，包括背景"
    );
    expect(zh).toContain("等于来到对象自身右边");
    expect(zh).toContain("严禁走到画面右边或对象自身左边");
    expect(zh).toContain(
      "近层必须相对远层向最终画面右边产生视差偏移"
    );
    expect(zh).toContain(
      "前向深度轴也必须投向最终画面右边"
    );
    expect(zh).toContain(
      "对象自身右边的新显露近侧结构应落在最终画面左侧轮廓"
    );
    expect(zh).toContain("相机抬高到场景中心上方 7.10°");
    expect(zh).toContain("平视档内的轻微高机位");
    expect(zh).toContain("不得把角度归零，也不得夸大成明显俯拍");
    expect(zh).toContain("Roll Z=-362.00°");
    expect(zh).toContain("等效为 -2.00°");
    expect(zh).toContain("景别：远景。观察距离控制值：1.5/10");
    expect(zh).toContain("图像 1 的原始宽高比为 1:1");
    expect(zh).toContain("目标输出尺寸为 2048x2048");
    expect(zh).toContain("景深与焦点");
    expect(zh).not.toContain("观察距离与景别：景别");
    expect(zh).toContain(
      "目标机位能够看到"
    );

    const en = prompt.deterministicPromptEn;
    expect(en).toContain("toward the LEFT edge of the source frame");
    expect(en).toContain("object's own RIGHT");
    expect(en).toContain(
      "near depth layers must shift toward the RIGHT side of the final image"
    );
    expect(en).toContain("Roll Z=-362.00 degrees");
    expect(en).toContain("equivalent to -2.00 degrees");
    expect(en).toContain("Camera-distance control: 1.5/10");
    expect(en).toContain("source aspect ratio of 1:1");
    expect(en).not.toContain(
      "Camera distance and shot size: Shot size"
    );
    expect(en).toContain(
      "subtle elevated position within the eye-level band"
    );
  });

  it("preserves source aspect ratio within the supported three-to-one range", () => {
    expect(calculateSingleImageOutputSize(1600, 900)).toBe("2048x1152");
    expect(calculateSingleImageOutputSize(900, 1600)).toBe("1152x2048");
    expect(calculateSingleImageOutputSize(1000, 1000)).toBe("2048x2048");
    expect(calculateSingleImageOutputSize(4000, 500)).toBe("2048x688");
  });
});

function rotateVectorByQuaternion(
  vector: { x: number; y: number; z: number },
  quaternion: { x: number; y: number; z: number; w: number }
) {
  const dot =
    quaternion.x * vector.x +
    quaternion.y * vector.y +
    quaternion.z * vector.z;
  const quaternionLength =
    quaternion.x * quaternion.x +
    quaternion.y * quaternion.y +
    quaternion.z * quaternion.z;
  const cross = {
    x: quaternion.y * vector.z - quaternion.z * vector.y,
    y: quaternion.z * vector.x - quaternion.x * vector.z,
    z: quaternion.x * vector.y - quaternion.y * vector.x
  };

  return {
    x:
      2 * dot * quaternion.x +
      (quaternion.w * quaternion.w - quaternionLength) * vector.x +
      2 * quaternion.w * cross.x,
    y:
      2 * dot * quaternion.y +
      (quaternion.w * quaternion.w - quaternionLength) * vector.y +
      2 * quaternion.w * cross.y,
    z:
      2 * dot * quaternion.z +
      (quaternion.w * quaternion.w - quaternionLength) * vector.z +
      2 * quaternion.w * cross.z
  };
}

function normalizeVector(vector: { x: number; y: number; z: number }) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length
  };
}

function crossVectors(
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number }
) {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x
  };
}

function dotVectors(
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number }
) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}
