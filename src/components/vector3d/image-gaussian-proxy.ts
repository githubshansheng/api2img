export type ImagePixelData = {
  data: Uint8ClampedArray;
  height: number;
  width: number;
};

export type ImageGaussianProxyOptions = {
  maxPoints?: number;
  sceneHeight?: number;
};

export type ImageGaussianProxyData = {
  colors: Uint8Array;
  positions: Float32Array;
  rotations: Float32Array;
  scales: Float32Array;
  vertexCount: number;
};

type ProxyPoint = {
  alpha: number;
  blue: number;
  depth: number;
  edge: number;
  green: number;
  red: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  subject: number;
  x: number;
  y: number;
};

const DEFAULT_MAX_POINTS = 28_000;
const DEFAULT_SCENE_HEIGHT = 3.4;

export function buildImageGaussianSplat(
  image: ImagePixelData,
  options: ImageGaussianProxyOptions = {}
): ImageGaussianProxyData {
  const width = Math.floor(image.width);
  const height = Math.floor(image.height);
  const maxPoints = Math.max(1, Math.floor(options.maxPoints ?? DEFAULT_MAX_POINTS));
  const sceneHeight = Math.max(0.1, options.sceneHeight ?? DEFAULT_SCENE_HEIGHT);

  if (
    width < 1 ||
    height < 1 ||
    image.data.length < width * height * 4
  ) {
    throw new Error("图片像素数据无效，无法构建 Gaussian 代理。");
  }

  const baseBudget = Math.max(1, Math.floor(maxPoints / 1.3));
  const stride = Math.max(
    1,
    Math.ceil(Math.sqrt((width * height) / baseBudget))
  );
  const aspect = width / height;
  const sceneWidth = sceneHeight * aspect;
  const sampledWidth = Math.max(1, Math.ceil(width / stride));
  const sampledHeight = Math.max(1, Math.ceil(height / stride));
  const spacingX = sceneWidth / sampledWidth;
  const spacingY = sceneHeight / sampledHeight;
  const background = estimateBackgroundColor(image);
  const points: ProxyPoint[] = [];

  for (let pixelY = 0; pixelY < height && points.length < baseBudget; pixelY += stride) {
    for (let pixelX = 0; pixelX < width && points.length < baseBudget; pixelX += stride) {
      const pixel = readPixel(image, pixelX, pixelY);
      const sourceAlpha = pixel.alpha / 255;

      if (sourceAlpha < 0.04) {
        continue;
      }

      const luminance = calculateLuminance(pixel.red, pixel.green, pixel.blue);
      const edge = calculateEdgeMagnitude(image, pixelX, pixelY);
      const backgroundDistance = Math.sqrt(
        square(pixel.red - background.red) +
          square(pixel.green - background.green) +
          square(pixel.blue - background.blue)
      ) / 441.673;
      const normalizedX = width === 1 ? 0 : pixelX / (width - 1) - 0.5;
      // gsplat's camera projection flips the scene Y axis, so image rows must
      // increase upward in scene coordinates to remain upright on screen.
      const normalizedY = height === 1 ? 0 : pixelY / (height - 1) - 0.5;
      const radialForeground = clamp(
        1 - Math.sqrt(square(normalizedX * 1.35) + square(normalizedY * 1.15)),
        0,
        1
      );
      const subject = clamp(
        backgroundDistance * 0.55 + edge * 0.25 + radialForeground * 0.2,
        0,
        1
      );
      const deterministicNoise = hashNoise(pixelX, pixelY) - 0.5;
      const depth =
        (subject - 0.42) * 0.78 +
        (0.5 - luminance) * 0.1 +
        radialForeground * 0.08 +
        deterministicNoise * 0.035;
      const scaleBoost = clamp(0.34 - edge * 0.12, 0.22, 0.34);
      const outputAlpha = Math.round(
        clamp(sourceAlpha * (150 + subject * 95 + edge * 10), 48, 255)
      );

      points.push({
        alpha: outputAlpha,
        blue: pixel.blue,
        depth,
        edge,
        green: pixel.green,
        red: pixel.red,
        scaleX: spacingX * scaleBoost,
        scaleY: spacingY * scaleBoost,
        scaleZ: Math.min(spacingX, spacingY) * (0.25 + subject * 0.5),
        subject,
        x: normalizedX * sceneWidth,
        y: normalizedY * sceneHeight
      });
    }
  }

  if (points.length === 0) {
    throw new Error("图片没有可见像素，无法构建 Gaussian 代理。");
  }

  const basePointCount = points.length;

  for (let index = 0; index < basePointCount && points.length < maxPoints; index += 1) {
    const point = points[index]!;

    if (point.subject < 0.3 && point.edge < 0.14) {
      continue;
    }

    const layerDepth = 0.04 + point.subject * 0.09 + point.edge * 0.04;
    points.push({
      ...point,
      alpha: Math.max(16, Math.round(point.alpha * 0.62)),
      blue: Math.round(point.blue * 0.96),
      depth: point.depth - layerDepth,
      green: Math.round(point.green * 0.96),
      red: Math.round(point.red * 0.96),
      scaleX: point.scaleX * 1.08,
      scaleY: point.scaleY * 1.08,
      scaleZ: point.scaleZ * 1.35
    });
  }

  const vertexCount = Math.min(points.length, maxPoints);
  const positions = new Float32Array(vertexCount * 3);
  const rotations = new Float32Array(vertexCount * 4);
  const scales = new Float32Array(vertexCount * 3);
  const colors = new Uint8Array(vertexCount * 4);

  for (let index = 0; index < vertexCount; index += 1) {
    const point = points[index]!;
    const positionOffset = index * 3;
    const rotationOffset = index * 4;

    positions[positionOffset] = point.x;
    positions[positionOffset + 1] = point.y;
    positions[positionOffset + 2] = point.depth;
    scales[positionOffset] = point.scaleX;
    scales[positionOffset + 1] = point.scaleY;
    scales[positionOffset + 2] = point.scaleZ;
    rotations[rotationOffset] = 1;
    rotations[rotationOffset + 1] = 0;
    rotations[rotationOffset + 2] = 0;
    rotations[rotationOffset + 3] = 0;
    colors[rotationOffset] = point.red;
    colors[rotationOffset + 1] = point.green;
    colors[rotationOffset + 2] = point.blue;
    colors[rotationOffset + 3] = point.alpha;
  }

  return {
    colors,
    positions,
    rotations,
    scales,
    vertexCount
  };
}

export function calculateProxySampleSize(
  width: number,
  height: number,
  maxPoints = DEFAULT_MAX_POINTS
) {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const baseBudget = Math.max(1, Math.floor(maxPoints / 1.3));
  const scale = Math.min(
    1,
    Math.sqrt(baseBudget / (safeWidth * safeHeight))
  );

  return {
    width: Math.max(1, Math.floor(safeWidth * scale)),
    height: Math.max(1, Math.floor(safeHeight * scale))
  };
}

function estimateBackgroundColor(image: ImagePixelData) {
  const samples = [
    readPixel(image, 0, 0),
    readPixel(image, image.width - 1, 0),
    readPixel(image, 0, image.height - 1),
    readPixel(image, image.width - 1, image.height - 1)
  ];

  return {
    red: average(samples.map((pixel) => pixel.red)),
    green: average(samples.map((pixel) => pixel.green)),
    blue: average(samples.map((pixel) => pixel.blue))
  };
}

function calculateEdgeMagnitude(
  image: ImagePixelData,
  x: number,
  y: number
) {
  const left = readLuminance(image, x - 1, y);
  const right = readLuminance(image, x + 1, y);
  const top = readLuminance(image, x, y - 1);
  const bottom = readLuminance(image, x, y + 1);
  return clamp(Math.abs(right - left) + Math.abs(bottom - top), 0, 1);
}

function readLuminance(image: ImagePixelData, x: number, y: number) {
  const pixel = readPixel(image, x, y);
  return calculateLuminance(pixel.red, pixel.green, pixel.blue);
}

function calculateLuminance(red: number, green: number, blue: number) {
  return (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
}

function readPixel(image: ImagePixelData, x: number, y: number) {
  const safeX = clamp(Math.floor(x), 0, image.width - 1);
  const safeY = clamp(Math.floor(y), 0, image.height - 1);
  const offset = (safeY * image.width + safeX) * 4;

  return {
    red: image.data[offset] ?? 0,
    green: image.data[offset + 1] ?? 0,
    blue: image.data[offset + 2] ?? 0,
    alpha: image.data[offset + 3] ?? 0
  };
}

function hashNoise(x: number, y: number) {
  let value = Math.imul(x + 1, 374_761_393) ^ Math.imul(y + 1, 668_265_263);
  value = Math.imul(value ^ (value >>> 13), 1_274_126_177);
  return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_295;
}

function average(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function square(value: number) {
  return value * value;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
