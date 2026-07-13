import type { EditQualityAssessment } from "../domain";
import type {
  AlphaMask,
  RGBAImageLike
} from "./edit-mask-service";

type ComparableImagePixels = {
  source: RGBAImageLike;
  result: RGBAImageLike;
  resampled: boolean;
};

type EditQualityInput = ComparableImagePixels & {
  sourceVersionId: string;
  selectionMask?: AlphaMask;
  evaluatedAt?: string;
  changedThreshold?: number;
};

export type EditQualityResult = {
  assessment: EditQualityAssessment;
  difference: RGBAImageLike;
};

export function evaluateEditQuality(input: EditQualityInput): EditQualityResult {
  assertComparableImages(input.source, input.result);
  assertSelectionMask(input.selectionMask, input.source.width, input.source.height);
  const pixelCount = input.source.width * input.source.height;
  const changedThreshold = clamp(
    Number.isFinite(input.changedThreshold) ? input.changedThreshold! : 24,
    1,
    441
  );
  const changed = new Uint8Array(pixelCount);
  const differences = new Float64Array(pixelCount);
  let changedPixels = 0;

  for (let index = 0; index < pixelCount; index += 1) {
    const difference = pixelDifference(
      input.source.data,
      input.result.data,
      index
    );
    differences[index] = difference;

    if (difference >= changedThreshold) {
      changed[index] = 1;
      changedPixels += 1;
    }
  }

  const changedPixelRatio = changedPixels / pixelCount;
  const warnings: string[] = [];
  let technicalScore: number | undefined;
  let selectionCoverage: number | undefined;
  let outsideDriftRate: number | undefined;
  let protectedConsistencyScore: number | undefined;
  let edgeBlendScore: number | undefined;

  if (input.selectionMask) {
    const localMetrics = calculateLocalMetrics(
      input.selectionMask,
      changed,
      differences
    );
    selectionCoverage = localMetrics.selectionCoverage;
    outsideDriftRate = localMetrics.outsideDriftRate;
    protectedConsistencyScore = 1 - outsideDriftRate;
    edgeBlendScore = localMetrics.edgeBlendScore;
    technicalScore = Math.round(
      100 *
        clamp(
          protectedConsistencyScore * 0.55 +
            selectionCoverage * 0.25 +
            edgeBlendScore * 0.2,
          0,
          1
        )
    );

    if (outsideDriftRate > 0.03) {
      warnings.push("选区外变化超过 3%，建议检查主体、文字和构图是否发生漂移。");
    }
    if (selectionCoverage < 0.05) {
      warnings.push("选区内可检测变化较少，结果可能没有充分执行编辑指令。");
    }
    if (edgeBlendScore < 0.7) {
      warnings.push("选区边缘变化不够平滑，建议增加羽化或缩小单轮修改幅度。");
    }
  } else {
    warnings.push("整图编辑仅提供差异热区和变化比例，不自动判断创意或指令遵循质量。");
  }

  if (input.resampled) {
    warnings.push("结果图尺寸与源图不同，质量检查已缩放对齐，像素指标仅供参考。");
  }

  return {
    assessment: {
      schemaVersion: 1,
      evaluator: "pixel-diff-v1",
      evaluatedAt: input.evaluatedAt ?? new Date().toISOString(),
      sourceVersionId: input.sourceVersionId,
      technicalScore,
      changedPixelRatio: roundRatio(changedPixelRatio),
      selectionCoverage: optionalRatio(selectionCoverage),
      outsideDriftRate: optionalRatio(outsideDriftRate),
      protectedConsistencyScore: optionalRatio(protectedConsistencyScore),
      edgeBlendScore: optionalRatio(edgeBlendScore),
      resampled: input.resampled,
      warnings
    },
    difference: buildDifferenceHeatmap(
      input.source.width,
      input.source.height,
      differences
    )
  };
}

export async function loadComparableImagePixels(
  sourceURL: string,
  resultURL: string
): Promise<ComparableImagePixels> {
  const [sourceImage, resultImage] = await Promise.all([
    loadImage(sourceURL),
    loadImage(resultURL)
  ]);
  const width = sourceImage.naturalWidth;
  const height = sourceImage.naturalHeight;

  if (width < 1 || height < 1) {
    throw new Error("源版本图片尺寸无效。");
  }

  return {
    source: drawImagePixels(sourceImage, width, height),
    result: drawImagePixels(resultImage, width, height),
    resampled:
      resultImage.naturalWidth !== width || resultImage.naturalHeight !== height
  };
}

export function imagePixelsToDataURL(image: RGBAImageLike) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("无法创建差异热区画布。");
  }

  const pixels = new Uint8ClampedArray(image.width * image.height * 4);

  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = Number(image.data[index] ?? 0);
  }

  context.putImageData(
    new ImageData(pixels, image.width, image.height),
    0,
    0
  );
  return canvas.toDataURL("image/png");
}

function calculateLocalMetrics(
  mask: AlphaMask,
  changed: Uint8Array,
  differences: Float64Array
) {
  let selectedWeight = 0;
  let changedSelectedWeight = 0;
  let outsideWeight = 0;
  let changedOutsideWeight = 0;

  for (let index = 0; index < mask.data.length; index += 1) {
    const selected = mask.data[index]! / 255;
    const outside = 1 - selected;
    selectedWeight += selected;
    outsideWeight += outside;
    changedSelectedWeight += changed[index]! * selected;
    changedOutsideWeight += changed[index]! * outside;
  }

  return {
    selectionCoverage:
      selectedWeight > 0 ? changedSelectedWeight / selectedWeight : 0,
    outsideDriftRate:
      outsideWeight > 0 ? changedOutsideWeight / outsideWeight : 0,
    edgeBlendScore: calculateEdgeBlendScore(mask, differences)
  };
}

function calculateEdgeBlendScore(
  mask: AlphaMask,
  differences: Float64Array
) {
  let variation = 0;
  let boundaryPixels = 0;

  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      const index = y * mask.width + x;

      if (!isBoundaryPixel(mask, x, y)) {
        continue;
      }

      const neighbors = neighborIndexes(mask.width, mask.height, x, y);
      const neighborAverage =
        neighbors.reduce((sum, item) => sum + differences[item]!, 0) /
        Math.max(1, neighbors.length);
      variation += Math.abs(differences[index]! - neighborAverage) / 441;
      boundaryPixels += 1;
    }
  }

  return boundaryPixels > 0
    ? clamp(1 - variation / boundaryPixels, 0, 1)
    : 1;
}

function isBoundaryPixel(mask: AlphaMask, x: number, y: number) {
  const index = y * mask.width + x;
  const alpha = mask.data[index]!;

  if (alpha > 0 && alpha < 255) {
    return true;
  }

  const selected = alpha >= 128;
  return neighborIndexes(mask.width, mask.height, x, y).some(
    (neighbor) => (mask.data[neighbor]! >= 128) !== selected
  );
}

function neighborIndexes(
  width: number,
  height: number,
  x: number,
  y: number
) {
  const indexes: number[] = [];

  if (x > 0) {
    indexes.push(y * width + x - 1);
  }
  if (x + 1 < width) {
    indexes.push(y * width + x + 1);
  }
  if (y > 0) {
    indexes.push((y - 1) * width + x);
  }
  if (y + 1 < height) {
    indexes.push((y + 1) * width + x);
  }
  return indexes;
}

function buildDifferenceHeatmap(
  width: number,
  height: number,
  differences: Float64Array
): RGBAImageLike {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let index = 0; index < differences.length; index += 1) {
    const intensity = clamp(differences[index]! / 255, 0, 1);
    const target = index * 4;
    data[target] = 255;
    data[target + 1] = Math.round(220 * (1 - intensity));
    data[target + 2] = 32;
    data[target + 3] = intensity < 0.03 ? 0 : Math.round(48 + intensity * 207);
  }

  return {
    width,
    height,
    data
  };
}

function pixelDifference(
  source: ArrayLike<number>,
  result: ArrayLike<number>,
  pixelIndex: number
) {
  const index = pixelIndex * 4;
  const red = Number(source[index] ?? 0) - Number(result[index] ?? 0);
  const green =
    Number(source[index + 1] ?? 0) - Number(result[index + 1] ?? 0);
  const blue =
    Number(source[index + 2] ?? 0) - Number(result[index + 2] ?? 0);
  const alpha =
    (Number(source[index + 3] ?? 255) -
      Number(result[index + 3] ?? 255)) *
    0.5;
  return Math.sqrt(red * red + green * green + blue * blue + alpha * alpha);
}

function drawImagePixels(
  image: HTMLImageElement,
  width: number,
  height: number
): RGBAImageLike {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("无法读取版本图片像素。");
  }

  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法读取用于质量检查的版本图片。"));
    image.src = url;
  });
}

function assertComparableImages(
  source: RGBAImageLike,
  result: RGBAImageLike
) {
  const expectedLength = source.width * source.height * 4;

  if (
    source.width < 1 ||
    source.height < 1 ||
    source.width !== result.width ||
    source.height !== result.height ||
    source.data.length < expectedLength ||
    result.data.length < expectedLength
  ) {
    throw new Error("源版本与结果版本的像素尺寸不一致。");
  }
}

function assertSelectionMask(
  mask: AlphaMask | undefined,
  width: number,
  height: number
) {
  if (
    mask &&
    (mask.width !== width ||
      mask.height !== height ||
      mask.data.length !== width * height)
  ) {
    throw new Error("质量检查蒙版尺寸与源版本不一致。");
  }
}

function optionalRatio(value: number | undefined) {
  return value === undefined ? undefined : roundRatio(value);
}

function roundRatio(value: number) {
  return Math.round(clamp(value, 0, 1) * 10_000) / 10_000;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
