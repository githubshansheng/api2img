import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import {
  accumulateOutpaintRotation,
  calculateShortestRotationDelta,
  calculateMaximumFitScale,
  calculateRotatedBounds,
  clampOutpaintRotationAngle,
  toFabricRotationAngle
} from "../../domain/canvas-outpaint";
import {
  convertDebugMaskToEditMask,
  normalizeOutputSize
} from "../../../server/canvas-outpaint";

describe("canvas outpaint rotation math", () => {
  it("calculates the axis-aligned bounds of a rotated rectangle", () => {
    const bounds = calculateRotatedBounds(400, 200, 90);

    expect(bounds.width).toBeCloseTo(200, 6);
    expect(bounds.height).toBeCloseTo(400, 6);
  });

  it("returns a uniform scale that keeps a rotated image inside the padded canvas", () => {
    const scale = calculateMaximumFitScale({
      width: 1000,
      height: 500,
      angleDegrees: 45,
      canvasWidth: 800,
      canvasHeight: 800,
      padding: 32
    });
    const fitted = calculateRotatedBounds(1000, 500, 45, scale);

    expect(fitted.width).toBeLessThanOrEqual(736.000001);
    expect(fitted.height).toBeLessThanOrEqual(736.000001);
  });

  it("keeps multi-turn bounds equivalent to the matching visual angle", () => {
    const singleTurn = calculateRotatedBounds(400, 200, 90);
    const multiTurn = calculateRotatedBounds(400, 200, 450);

    expect(multiTurn.width).toBeCloseTo(singleTurn.width, 6);
    expect(multiTurn.height).toBeCloseTo(singleTurn.height, 6);
  });

  it.each([
    [0, 0],
    [360, 0],
    [720, 0],
    [-360, 0],
    [-720, 0],
    [450, 90],
    [-450, 270]
  ])("maps cumulative angle %s to Fabric angle %s", (input, expected) => {
    expect(toFabricRotationAngle(input)).toBe(expected);
  });

  it("calculates the shortest signed delta across the zero-degree boundary", () => {
    expect(calculateShortestRotationDelta(359, 1)).toBe(2);
    expect(calculateShortestRotationDelta(1, 359)).toBe(-2);
  });

  it("clamps accumulated rotations at two turns in either direction", () => {
    expect(clampOutpaintRotationAngle(900)).toBe(720);
    expect(clampOutpaintRotationAngle(-900)).toBe(-720);
    expect(accumulateOutpaintRotation(719, 359, 1)).toBe(720);
    expect(accumulateOutpaintRotation(-719, 1, 359)).toBe(-720);
    expect(accumulateOutpaintRotation(720, 1, 2)).toBe(720);
    expect(accumulateOutpaintRotation(-720, 359, 358)).toBe(-720);
  });

  it("reverses immediately after reaching a cumulative rotation boundary", () => {
    expect(accumulateOutpaintRotation(720, 2, 1)).toBe(719);
    expect(accumulateOutpaintRotation(-720, 358, 359)).toBe(-719);
  });
});

describe("canvas outpaint output size validation", () => {
  it.each([
    ["1024x640", "1024x640"],
    ["1536x512", "1536x512"],
    ["3840x2160", "3840x2160"],
    [undefined, "2048x2048"]
  ])("accepts supported GPT-Image-2 size %s", (input, expected) => {
    expect(normalizeOutputSize(input)).toBe(expected);
  });

  it.each([
    ["1024", "missing height"],
    ["1025x1024", "not a multiple of 16"],
    ["3856x2048", "edge exceeds 3840"],
    ["1024x624", "pixel count is below the minimum"],
    ["3840x2176", "pixel count is above the maximum"],
    ["1536x496", "aspect ratio exceeds 3:1"]
  ])("rejects unsupported size %s (%s)", (input) => {
    expect(() => normalizeOutputSize(input)).toThrow();
  });
});

describe("canvas outpaint mask conversion", () => {
  it("keeps black locked pixels opaque and makes white repaint pixels transparent", () => {
    const base = createSolidPNG(2, 1, [18, 24, 32, 255]);
    const debugMask = new PNG({ width: 2, height: 1 });

    debugMask.data.set([
      0, 0, 0, 255,
      255, 255, 255, 255
    ]);

    const result = convertDebugMaskToEditMask(
      PNG.sync.write(base),
      PNG.sync.write(debugMask)
    );
    const converted = PNG.sync.read(result.buffer);

    expect(converted.data[3]).toBe(255);
    expect(converted.data[7]).toBe(0);
    expect(Array.from(converted.data.slice(0, 3))).toEqual([255, 255, 255]);
    expect(Array.from(converted.data.slice(4, 7))).toEqual([255, 255, 255]);
  });

  it("rejects masks whose dimensions do not match the base image", () => {
    const base = PNG.sync.write(createSolidPNG(2, 2, [0, 0, 0, 255]));
    const mask = PNG.sync.write(createSolidPNG(1, 2, [255, 255, 255, 255]));

    expect(() => convertDebugMaskToEditMask(base, mask)).toThrow(
      "底图与遮罩尺寸必须完全一致"
    );
  });
});

function createSolidPNG(
  width: number,
  height: number,
  color: [number, number, number, number]
) {
  const image = new PNG({ width, height });

  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = color[0];
    image.data[offset + 1] = color[1];
    image.data[offset + 2] = color[2];
    image.data[offset + 3] = color[3];
  }

  return image;
}
