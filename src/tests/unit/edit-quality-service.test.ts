import { describe, expect, it } from "vitest";
import type { RGBAImageLike } from "../../services/edit-mask-service";
import { createAlphaMask } from "../../services/edit-mask-service";
import { evaluateEditQuality } from "../../services/edit-quality-service";

describe("edit quality service", () => {
  it("reports no changed pixels for an identical whole-image result", () => {
    const source = createImage(4, 4);
    const result = evaluateEditQuality({
      sourceVersionId: "source-version",
      source,
      result: cloneImage(source),
      resampled: false,
      evaluatedAt: "2026-07-14T00:00:00.000Z"
    });

    expect(result.assessment).toMatchObject({
      changedPixelRatio: 0,
      resampled: false,
      evaluatedAt: "2026-07-14T00:00:00.000Z"
    });
    expect(result.assessment.technicalScore).toBeUndefined();
    expect(result.assessment.warnings).toContain(
      "整图编辑仅提供差异热区和变化比例，不自动判断创意或指令遵循质量。"
    );
    expect(
      Array.from(result.difference.data).every(
        (value) =>
          value === 0 || value === 255 || value === 220 || value === 32
      )
    ).toBe(true);
  });

  it("scores an edit confined to the selected area without outside drift", () => {
    const source = createImage(4, 4);
    const edited = cloneImage(source);
    const mask = createAlphaMask(4, 4);

    setSelected(mask.data, 4, [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2]
    ]);
    paintPixels(edited, [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2]
    ]);

    const result = evaluateEditQuality({
      sourceVersionId: "source-version",
      source,
      result: edited,
      selectionMask: mask,
      resampled: false
    });

    expect(result.assessment.changedPixelRatio).toBe(0.25);
    expect(result.assessment.selectionCoverage).toBe(1);
    expect(result.assessment.outsideDriftRate).toBe(0);
    expect(result.assessment.protectedConsistencyScore).toBe(1);
    expect(result.assessment.technicalScore).toBeGreaterThanOrEqual(80);
    expect(result.assessment.warnings.join(" ")).not.toContain("选区外变化");
  });

  it("warns when detectable changes drift outside the selection", () => {
    const source = createImage(4, 4);
    const edited = cloneImage(source);
    const mask = createAlphaMask(4, 4);

    setSelected(mask.data, 4, [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2]
    ]);
    paintPixels(edited, [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
      [0, 0]
    ]);

    const result = evaluateEditQuality({
      sourceVersionId: "source-version",
      source,
      result: edited,
      selectionMask: mask,
      resampled: false
    });

    expect(result.assessment.outsideDriftRate).toBeCloseTo(1 / 12, 4);
    expect(result.assessment.protectedConsistencyScore).toBeCloseTo(11 / 12, 4);
    expect(result.assessment.warnings).toContain(
      "选区外变化超过 3%，建议检查主体、文字和构图是否发生漂移。"
    );
  });

  it("returns a bounded edge blend score for a hard mask boundary", () => {
    const source = createImage(5, 5);
    const edited = cloneImage(source);
    const mask = createAlphaMask(5, 5);

    setSelected(mask.data, 5, [[2, 2]]);
    paintPixels(edited, [[2, 2]]);

    const result = evaluateEditQuality({
      sourceVersionId: "source-version",
      source,
      result: edited,
      selectionMask: mask,
      resampled: false
    });

    expect(result.assessment.edgeBlendScore).toBeGreaterThanOrEqual(0);
    expect(result.assessment.edgeBlendScore).toBeLessThan(0.7);
    expect(result.assessment.warnings).toContain(
      "选区边缘变化不够平滑，建议增加羽化或缩小单轮修改幅度。"
    );
  });

  it("marks resampled comparisons as approximate", () => {
    const source = createImage(2, 2);
    const result = evaluateEditQuality({
      sourceVersionId: "source-version",
      source,
      result: cloneImage(source),
      resampled: true
    });

    expect(result.assessment.resampled).toBe(true);
    expect(result.assessment.warnings).toContain(
      "结果图尺寸与源图不同，质量检查已缩放对齐，像素指标仅供参考。"
    );
  });
});

function createImage(width: number, height: number): RGBAImageLike {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let index = 0; index < width * height; index += 1) {
    data[index * 4 + 3] = 255;
  }

  return {
    width,
    height,
    data
  };
}

function cloneImage(image: RGBAImageLike): RGBAImageLike {
  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data)
  };
}

function setSelected(
  data: Uint8ClampedArray,
  width: number,
  points: Array<[number, number]>
) {
  points.forEach(([x, y]) => {
    data[y * width + x] = 255;
  });
}

function paintPixels(
  image: RGBAImageLike,
  points: Array<[number, number]>
) {
  points.forEach(([x, y]) => {
    const index = (y * image.width + x) * 4;
    (image.data as Uint8ClampedArray)[index] = 255;
    (image.data as Uint8ClampedArray)[index + 1] = 255;
    (image.data as Uint8ClampedArray)[index + 2] = 255;
  });
}
