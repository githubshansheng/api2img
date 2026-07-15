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

  it("moves the virtual camera toward the subject's right for positive yaw", () => {
    const pose = buildSingleImageCameraPose({ x: 0, y: 90, z: 0 });
    const cameraPosition = rotateVectorByQuaternion(
      { x: 0, y: 0, z: -1 },
      pose.quaternion
    );

    expect(cameraPosition.x).toBeCloseTo(1, 6);
    expect(cameraPosition.z).toBeCloseTo(0, 6);
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
      "向右侧环绕"
    );
    expect(constraints.visibilityConstraints.join(" ")).toContain(
      "从下方真实可见"
    );
    expect(constraints.occlusionConstraints.join(" ")).toContain(
      "不得保留零度正面投影"
    );
    expect(constraints.perspectiveCues.join(" ")).toContain(
      "低机位向上观察透视"
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
      "相机变化必须真实改变屏幕投影"
    );
    expect(constraints.forbiddenShortcuts.join(" ")).not.toContain(
      "禁止改变姿态"
    );
    expect(constraints.forbiddenShortcuts.join(" ")).not.toContain(
      "禁止改变朝向"
    );
  });

  it("builds an auditable Chinese locked-camera block", () => {
    const prompt = buildSingleImageCameraPrompt(
      { x: 720, y: -450, z: -45 },
      6
    );

    expect(prompt.azimuthKey).toBe("left");
    expect(prompt.distanceKey).toBe("close-up");
    expect(prompt.deterministicPromptZh).toContain(
      "【锁定相机协议｜服务端确定性生成，禁止改写】"
    );
    expect(prompt.deterministicPromptZh).toContain(
      "相机协议版本：2.4"
    );
    expect(prompt.deterministicPromptZh).toContain("目标相机重新投影");
    expect(prompt.deterministicPromptZh).toContain(
      "原图屏幕姿态和屏幕朝向不锁定"
    );
    expect(prompt.deterministicPromptZh).toContain(
      "主体轮廓、投影宽度、可见区域、遮挡顺序与背景视差必须由目标相机重新投影"
    );
    expect(prompt.deterministicPromptZh).toContain("Y=-450.00°");
    expect(prompt.deterministicPromptZh).toContain(
      "等价周期姿态为 X=0.00°，Y=-90.00°，Z=-45.00°"
    );
    expect(prompt.deterministicPromptZh).toContain("逆时针");
    expect(prompt.deterministicPromptZh).toContain(
      "禁止水平镜像、二维平面旋转"
    );
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
