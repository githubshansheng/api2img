import { describe, expect, it } from "vitest";
import {
  alphaMaskFromRGBA,
  alphaMaskToRGBA,
  approximateSubjectSelect,
  combineAlphaMasks,
  composeMaskLayers,
  createAlphaMask,
  expandAlphaMask,
  featherAlphaMask,
  invertAlphaMask,
  magicWandSelect,
  rasterizePolygon,
  rasterizeRectangle,
  shrinkAlphaMask
} from "../../services/edit-mask-service";

describe("edit mask service", () => {
  it("combines additive, subtractive, and intersecting layers", () => {
    const left = createAlphaMask(3, 1);
    const right = createAlphaMask(3, 1);
    left.data.set([255, 255, 0]);
    right.data.set([0, 255, 255]);

    expect([...combineAlphaMasks(left, right, "add").data]).toEqual([
      255, 255, 255
    ]);
    expect([...combineAlphaMasks(left, right, "subtract").data]).toEqual([
      255, 0, 0
    ]);
    expect([...combineAlphaMasks(left, right, "intersect").data]).toEqual([
      0, 255, 0
    ]);
    expect([
      ...composeMaskLayers([
        { mask: left, mode: "add" },
        { mask: right, mode: "subtract" }
      ])!.data
    ]).toEqual([255, 0, 0]);
  });

  it("inverts selection alpha for native transparent edit masks", () => {
    const mask = createAlphaMask(2, 1);
    mask.data.set([255, 0]);

    expect([...invertAlphaMask(mask).data]).toEqual([0, 255]);
    expect([...alphaMaskToRGBA(mask, { selectedTransparent: true }).data]).toEqual([
      255, 255, 255, 0,
      255, 255, 255, 255
    ]);
    expect([
      ...alphaMaskFromRGBA({
        width: 2,
        height: 1,
        data: [10, 20, 30, 64, 40, 50, 60, 192]
      }).data
    ]).toEqual([64, 192]);
  });

  it("expands, shrinks, and feathers hard selections", () => {
    const mask = createAlphaMask(5, 5);
    mask.data[2 * 5 + 2] = 255;

    const expanded = expandAlphaMask(mask, 1);
    expect([...expanded.data].filter(Boolean)).toHaveLength(9);

    const shrunk = shrinkAlphaMask(expanded, 1);
    expect([...shrunk.data].filter(Boolean)).toHaveLength(1);

    const feathered = featherAlphaMask(mask, 1);
    expect(feathered.data[2 * 5 + 2]).toBeGreaterThan(0);
    expect(feathered.data[2 * 5 + 1]).toBeGreaterThan(0);
    expect(feathered.data[0]).toBeLessThan(feathered.data[2 * 5 + 2]!);
  });

  it("rasterizes rectangle and lasso selections", () => {
    const rectangle = rasterizeRectangle(
      6,
      6,
      { x: 1, y: 1 },
      { x: 4, y: 3 }
    );
    expect([...rectangle.data].filter(Boolean)).toHaveLength(6);

    const polygon = rasterizePolygon(6, 6, [
      { x: 1, y: 1 },
      { x: 5, y: 1 },
      { x: 3, y: 5 }
    ]);
    expect([...polygon.data].filter(Boolean).length).toBeGreaterThan(4);
    expect(polygon.data[2 * 6 + 3]).toBe(255);
    expect(polygon.data[5 * 6 + 0]).toBe(0);
  });

  it("selects contiguous colors with the magic wand", () => {
    const image = {
      width: 3,
      height: 2,
      data: new Uint8ClampedArray([
        10, 10, 10, 255,
        12, 12, 12, 255,
        220, 220, 220, 255,
        11, 11, 11, 255,
        180, 180, 180, 255,
        221, 221, 221, 255
      ])
    };
    const selected = magicWandSelect(image, { x: 0, y: 0 }, 8);

    expect([...selected.data]).toEqual([255, 255, 0, 255, 0, 0]);
  });

  it("keeps the largest foreground component for subject selection", () => {
    const pixels = new Uint8ClampedArray(5 * 5 * 4);

    for (let index = 0; index < 25; index += 1) {
      pixels.set([245, 245, 245, 255], index * 4);
    }

    [6, 7, 11, 12, 18].forEach((index) => {
      pixels.set([30, 40, 50, 255], index * 4);
    });

    const selected = approximateSubjectSelect(
      { width: 5, height: 5, data: pixels },
      40
    );

    expect([...selected.data].filter(Boolean)).toHaveLength(4);
    expect(selected.data[6]).toBe(255);
    expect(selected.data[18]).toBe(0);
  });
});
