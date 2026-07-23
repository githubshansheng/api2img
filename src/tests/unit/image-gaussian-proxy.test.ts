import { describe, expect, it } from "vitest";
import {
  buildImageGaussianSplat,
  calculateProxySampleSize,
  type ImagePixelData
} from "../../components/vector3d/image-gaussian-proxy";

function createPixels(
  width: number,
  height: number,
  pixelAt: (x: number, y: number) => [number, number, number, number]
): ImagePixelData {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data.set(pixelAt(x, y), offset);
    }
  }

  return { data, height, width };
}

describe("image Gaussian proxy construction", () => {
  it("builds deterministic, correctly sized finite splat buffers", () => {
    const image = createPixels(12, 8, (x, y) => [
      x * 17,
      y * 25,
      (x + y) * 11,
      255
    ]);
    const first = buildImageGaussianSplat(image, { maxPoints: 80 });
    const second = buildImageGaussianSplat(image, { maxPoints: 80 });

    expect(first.vertexCount).toBeGreaterThan(0);
    expect(first.vertexCount).toBeLessThanOrEqual(80);
    expect(first.positions).toHaveLength(first.vertexCount * 3);
    expect(first.rotations).toHaveLength(first.vertexCount * 4);
    expect(first.scales).toHaveLength(first.vertexCount * 3);
    expect(first.colors).toHaveLength(first.vertexCount * 4);
    expect(Array.from(first.positions)).toEqual(Array.from(second.positions));
    expect(Array.from(first.scales)).toEqual(Array.from(second.scales));
    expect(Array.from(first.colors)).toEqual(Array.from(second.colors));
    expect(Array.from(first.positions).every(Number.isFinite)).toBe(true);
    expect(Array.from(first.scales).every((value) => Number.isFinite(value) && value > 0)).toBe(true);
  });

  it("preserves source colors and uses gsplat's wxyz identity quaternion order", () => {
    const image = createPixels(2, 1, (x) =>
      x === 0 ? [245, 12, 34, 255] : [8, 210, 90, 255]
    );
    const proxy = buildImageGaussianSplat(image, { maxPoints: 8 });

    expect(Array.from(proxy.colors.slice(0, 8))).toEqual([
      245, 12, 34, expect.any(Number),
      8, 210, 90, expect.any(Number)
    ]);
    expect(Array.from(proxy.rotations.slice(0, 8))).toEqual([
      1, 0, 0, 0,
      1, 0, 0, 0
    ]);
  });

  it("maps the top image row below the bottom row so gsplat renders it upright", () => {
    const image = createPixels(1, 2, (_x, y) =>
      y === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]
    );
    const proxy = buildImageGaussianSplat(image, { maxPoints: 8 });

    expect(proxy.positions[1]).toBeLessThan(proxy.positions[4]!);
    expect(Array.from(proxy.colors.slice(0, 8))).toEqual([
      255, 0, 0, expect.any(Number),
      0, 0, 255, expect.any(Number)
    ]);
  });

  it("creates a meaningful non-flat depth range from image cues", () => {
    const image = createPixels(18, 12, (x, y) => {
      const center = x > 5 && x < 13 && y > 3 && y < 9;
      return center ? [235, 55, 40, 255] : [18, 24, 32, 255];
    });
    const proxy = buildImageGaussianSplat(image, { maxPoints: 300 });
    const depths = Array.from(
      { length: proxy.vertexCount },
      (_, index) => proxy.positions[index * 3 + 2]!
    );

    expect(Math.max(...depths) - Math.min(...depths)).toBeGreaterThan(0.08);
  });

  it("skips transparent pixels and enforces the point-count cap", () => {
    const image = createPixels(20, 20, (x, y) =>
      x === 0 && y === 0 ? [255, 0, 0, 0] : [20, 180, 90, 255]
    );
    const proxy = buildImageGaussianSplat(image, { maxPoints: 25 });

    expect(proxy.vertexCount).toBeLessThanOrEqual(25);
    const colors = Array.from(proxy.colors);

    for (let offset = 0; offset < colors.length; offset += 4) {
      expect(colors.slice(offset, offset + 3)).not.toEqual([255, 0, 0]);
      expect(colors[offset + 3]).toBeGreaterThan(0);
    }
  });

  it("downsamples large images while preserving their aspect ratio", () => {
    const sample = calculateProxySampleSize(4000, 2000, 28_000);
    const squareSample = calculateProxySampleSize(1254, 1254, 28_000);
    const baseBudget = Math.floor(28_000 / 1.3);

    expect(sample.width * sample.height).toBeLessThanOrEqual(baseBudget);
    expect(sample.width / sample.height).toBeCloseTo(2, 1);
    expect(squareSample.width * squareSample.height).toBeLessThanOrEqual(
      baseBudget
    );
    expect(squareSample.width * squareSample.height).toBeGreaterThan(20_000);
  });
});
