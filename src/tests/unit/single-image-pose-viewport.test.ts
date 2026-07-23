import { describe, expect, it } from "vitest";
import {
  applyPoseDragDelta,
  applyRollRingVisualAngle
} from "../../components/canvas-outpaint/SingleImagePoseViewport";

describe("single-image pose viewport drag accumulation", () => {
  it("leaves the positive boundary immediately when pointer motion reverses", () => {
    const atBoundary = { x: 0, y: 720, z: 0 };
    const stillClamped = applyPoseDragDelta(
      atBoundary,
      20,
      0,
      false,
      1
    );
    const reversed = applyPoseDragDelta(
      stillClamped,
      -1,
      0,
      false,
      1
    );

    expect(stillClamped.y).toBe(720);
    expect(reversed.y).toBe(719);
  });

  it("leaves the negative boundary immediately and applies roll incrementally", () => {
    const atBoundary = { x: -720, y: 0, z: -720 };
    const stillClamped = applyPoseDragDelta(
      atBoundary,
      -20,
      20,
      false,
      1
    );
    const reversed = applyPoseDragDelta(
      stillClamped,
      0,
      -1,
      false,
      1
    );
    const rollReversed = applyPoseDragDelta(
      atBoundary,
      1,
      0,
      true,
      1
    );

    expect(stillClamped.x).toBe(-720);
    expect(reversed.x).toBe(-719);
    expect(rollReversed.z).toBe(-719);
  });

  it("preserves Roll during ordinary orbit dragging", () => {
    expect(
      applyPoseDragDelta({ x: 10, y: 20, z: 135 }, 12, -8, false, 1)
    ).toEqual({
      x: 18,
      y: 32,
      z: 135
    });
  });

  it("uses independent visual samples for the Roll ring at both boundaries", () => {
    const positiveBoundary = applyRollRingVisualAngle(
      { x: 10, y: 20, z: 720 },
      1,
      359
    );
    const negativeBoundary = applyRollRingVisualAngle(
      { x: 10, y: 20, z: -720 },
      359,
      1
    );

    expect(positiveBoundary).toEqual({ x: 10, y: 20, z: 718 });
    expect(negativeBoundary).toEqual({ x: 10, y: 20, z: -718 });
  });
});
