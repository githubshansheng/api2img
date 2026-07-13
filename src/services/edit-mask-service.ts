import type { EditMaskCombination } from "../domain";

export type AlphaMask = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type MaskPoint = {
  x: number;
  y: number;
};

export type MaskLayer = {
  mask: AlphaMask;
  mode?: EditMaskCombination;
  inverted?: boolean;
};

export type RGBAImageLike = {
  width: number;
  height: number;
  data: ArrayLike<number>;
};

export function createAlphaMask(
  width: number,
  height: number,
  fill = 0
): AlphaMask {
  const normalizedWidth = normalizeDimension(width);
  const normalizedHeight = normalizeDimension(height);
  const data = new Uint8ClampedArray(normalizedWidth * normalizedHeight);
  data.fill(clampByte(fill));
  return {
    width: normalizedWidth,
    height: normalizedHeight,
    data
  };
}

export function cloneAlphaMask(mask: AlphaMask): AlphaMask {
  assertMask(mask);
  return {
    width: mask.width,
    height: mask.height,
    data: new Uint8ClampedArray(mask.data)
  };
}

export function alphaMaskFromRGBA(image: RGBAImageLike): AlphaMask {
  const mask = createAlphaMask(image.width, image.height);

  if (image.data.length < mask.data.length * 4) {
    throw new Error("RGBA 图像数据长度不足。");
  }

  for (let index = 0; index < mask.data.length; index += 1) {
    mask.data[index] = clampByte(image.data[index * 4 + 3] ?? 0);
  }

  return mask;
}

export function alphaMaskToRGBA(
  mask: AlphaMask,
  options: {
    color?: [number, number, number];
    selectedTransparent?: boolean;
  } = {}
) {
  assertMask(mask);
  const color = options.color ?? [255, 255, 255];
  const data = new Uint8ClampedArray(mask.data.length * 4);

  for (let index = 0; index < mask.data.length; index += 1) {
    const target = index * 4;
    data[target] = clampByte(color[0]);
    data[target + 1] = clampByte(color[1]);
    data[target + 2] = clampByte(color[2]);
    data[target + 3] = options.selectedTransparent
      ? 255 - mask.data[index]!
      : mask.data[index]!;
  }

  return {
    width: mask.width,
    height: mask.height,
    data
  };
}

export function combineAlphaMasks(
  left: AlphaMask,
  right: AlphaMask,
  mode: EditMaskCombination
): AlphaMask {
  assertSameDimensions(left, right);
  const output = createAlphaMask(left.width, left.height);

  for (let index = 0; index < output.data.length; index += 1) {
    const leftAlpha = left.data[index]!;
    const rightAlpha = right.data[index]!;

    output.data[index] =
      mode === "add"
        ? Math.max(leftAlpha, rightAlpha)
        : mode === "subtract"
          ? Math.max(0, leftAlpha - rightAlpha)
          : Math.min(leftAlpha, rightAlpha);
  }

  return output;
}

export function composeMaskLayers(layers: MaskLayer[]): AlphaMask | undefined {
  if (layers.length === 0) {
    return undefined;
  }

  const first = layers[0]!;
  assertMask(first.mask);
  let output = createAlphaMask(
    first.mask.width,
    first.mask.height,
    first.mode === "intersect" ? 255 : 0
  );

  for (const layer of layers) {
    assertSameDimensions(output, layer.mask);
    output = combineAlphaMasks(
      output,
      layer.inverted ? invertAlphaMask(layer.mask) : layer.mask,
      layer.mode ?? "add"
    );
  }

  return output;
}

export function invertAlphaMask(mask: AlphaMask): AlphaMask {
  assertMask(mask);
  const output = createAlphaMask(mask.width, mask.height);

  for (let index = 0; index < mask.data.length; index += 1) {
    output.data[index] = 255 - mask.data[index]!;
  }

  return output;
}

export function resizeAlphaMask(
  mask: AlphaMask,
  width: number,
  height: number
): AlphaMask {
  assertMask(mask);
  const normalizedWidth = normalizeDimension(width);
  const normalizedHeight = normalizeDimension(height);

  if (mask.width === normalizedWidth && mask.height === normalizedHeight) {
    return cloneAlphaMask(mask);
  }

  const output = createAlphaMask(normalizedWidth, normalizedHeight);

  for (let y = 0; y < normalizedHeight; y += 1) {
    const sourceY = Math.min(
      mask.height - 1,
      Math.floor(((y + 0.5) * mask.height) / normalizedHeight)
    );

    for (let x = 0; x < normalizedWidth; x += 1) {
      const sourceX = Math.min(
        mask.width - 1,
        Math.floor(((x + 0.5) * mask.width) / normalizedWidth)
      );
      output.data[y * normalizedWidth + x] =
        mask.data[sourceY * mask.width + sourceX]!;
    }
  }

  return output;
}

export function expandAlphaMask(mask: AlphaMask, radius: number): AlphaMask {
  return morphology(mask, radius, "max");
}

export function shrinkAlphaMask(mask: AlphaMask, radius: number): AlphaMask {
  return morphology(mask, radius, "min");
}

export function featherAlphaMask(mask: AlphaMask, radius: number): AlphaMask {
  assertMask(mask);
  const normalizedRadius = normalizeRadius(radius);

  if (normalizedRadius === 0) {
    return cloneAlphaMask(mask);
  }

  let output = cloneAlphaMask(mask);

  for (let pass = 0; pass < 3; pass += 1) {
    output = boxBlur(output, normalizedRadius);
  }

  return output;
}

export function transformAlphaMask(
  mask: AlphaMask,
  options: {
    expansionPixels?: number;
    featherRadius?: number;
    inverted?: boolean;
  }
): AlphaMask {
  let output = cloneAlphaMask(mask);
  const expansion = Math.trunc(options.expansionPixels ?? 0);

  if (expansion > 0) {
    output = expandAlphaMask(output, expansion);
  } else if (expansion < 0) {
    output = shrinkAlphaMask(output, Math.abs(expansion));
  }

  if ((options.featherRadius ?? 0) > 0) {
    output = featherAlphaMask(output, options.featherRadius ?? 0);
  }

  return options.inverted ? invertAlphaMask(output) : output;
}

export function rasterizeRectangle(
  width: number,
  height: number,
  start: MaskPoint,
  end: MaskPoint
): AlphaMask {
  const mask = createAlphaMask(width, height);
  const minX = clampInteger(Math.min(start.x, end.x), 0, mask.width);
  const maxX = clampInteger(Math.max(start.x, end.x), 0, mask.width);
  const minY = clampInteger(Math.min(start.y, end.y), 0, mask.height);
  const maxY = clampInteger(Math.max(start.y, end.y), 0, mask.height);

  for (let y = minY; y < maxY; y += 1) {
    mask.data.fill(255, y * mask.width + minX, y * mask.width + maxX);
  }

  return mask;
}

export function rasterizePolygon(
  width: number,
  height: number,
  points: MaskPoint[]
): AlphaMask {
  const mask = createAlphaMask(width, height);

  if (points.length < 3) {
    return mask;
  }

  const minX = clampInteger(
    Math.min(...points.map((point) => point.x)),
    0,
    mask.width - 1
  );
  const maxX = clampInteger(
    Math.max(...points.map((point) => point.x)),
    0,
    mask.width - 1
  );
  const minY = clampInteger(
    Math.min(...points.map((point) => point.y)),
    0,
    mask.height - 1
  );
  const maxY = clampInteger(
    Math.max(...points.map((point) => point.y)),
    0,
    mask.height - 1
  );

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (pointInPolygon(x + 0.5, y + 0.5, points)) {
        mask.data[y * mask.width + x] = 255;
      }
    }
  }

  return mask;
}

export function magicWandSelect(
  image: RGBAImageLike,
  seed: MaskPoint,
  tolerance = 32
): AlphaMask {
  const mask = createAlphaMask(image.width, image.height);
  const seedX = clampInteger(seed.x, 0, mask.width - 1);
  const seedY = clampInteger(seed.y, 0, mask.height - 1);
  const seedIndex = seedY * mask.width + seedX;
  const seedPixel = readPixel(image.data, seedIndex);
  const visited = new Uint8Array(mask.data.length);
  const queue = new Int32Array(mask.data.length);
  const threshold = Math.max(0, tolerance);
  let head = 0;
  let tail = 0;

  queue[tail++] = seedIndex;
  visited[seedIndex] = 1;

  while (head < tail) {
    const index = queue[head++]!;

    if (colorDistance(readPixel(image.data, index), seedPixel) > threshold) {
      continue;
    }

    mask.data[index] = 255;
    const x = index % mask.width;
    const y = Math.floor(index / mask.width);

    if (x > 0) {
      tail = enqueue(index - 1, visited, queue, tail);
    }
    if (x + 1 < mask.width) {
      tail = enqueue(index + 1, visited, queue, tail);
    }
    if (y > 0) {
      tail = enqueue(index - mask.width, visited, queue, tail);
    }
    if (y + 1 < mask.height) {
      tail = enqueue(index + mask.width, visited, queue, tail);
    }
  }

  return mask;
}

export function approximateSubjectSelect(
  image: RGBAImageLike,
  tolerance = 36
): AlphaMask {
  const width = normalizeDimension(image.width);
  const height = normalizeDimension(image.height);
  const sampleIndexes = [
    0,
    width - 1,
    (height - 1) * width,
    height * width - 1
  ];
  const background = sampleIndexes.reduce(
    (total, index) => {
      const pixel = readPixel(image.data, index);
      return [
        total[0] + pixel[0] / sampleIndexes.length,
        total[1] + pixel[1] / sampleIndexes.length,
        total[2] + pixel[2] / sampleIndexes.length,
        total[3] + pixel[3] / sampleIndexes.length
      ] as [number, number, number, number];
    },
    [0, 0, 0, 0] as [number, number, number, number]
  );
  const candidates = createAlphaMask(width, height);

  for (let index = 0; index < candidates.data.length; index += 1) {
    const pixel = readPixel(image.data, index);

    if (pixel[3] > 16 && colorDistance(pixel, background) >= tolerance) {
      candidates.data[index] = 255;
    }
  }

  return retainLargestComponent(candidates);
}

export function readAlphaMaskFromCanvas(canvas: HTMLCanvasElement): AlphaMask {
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("无法读取蒙版画布。");
  }

  return alphaMaskFromRGBA(
    context.getImageData(0, 0, canvas.width, canvas.height)
  );
}

export function writeAlphaMaskToCanvas(
  canvas: HTMLCanvasElement,
  mask: AlphaMask,
  options: {
    color?: [number, number, number];
    selectedTransparent?: boolean;
  } = {}
) {
  assertSameDimensions(
    createAlphaMask(canvas.width, canvas.height),
    mask
  );
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("无法写入蒙版画布。");
  }

  const rgba = alphaMaskToRGBA(mask, options);
  context.putImageData(
    new ImageData(rgba.data, rgba.width, rgba.height),
    0,
    0
  );
}

export async function loadAlphaMaskFromURL(url: string): Promise<AlphaMask> {
  const image = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("无法创建蒙版读取画布。");
  }

  context.drawImage(image, 0, 0);
  return alphaMaskFromRGBA(
    context.getImageData(0, 0, canvas.width, canvas.height)
  );
}

export function alphaMaskToDataURL(
  mask: AlphaMask,
  options: {
    color?: [number, number, number];
    selectedTransparent?: boolean;
  } = {}
) {
  const canvas = document.createElement("canvas");
  canvas.width = mask.width;
  canvas.height = mask.height;
  writeAlphaMaskToCanvas(canvas, mask, options);
  return canvas.toDataURL("image/png");
}

export function readSourceImageData(
  image: HTMLImageElement
): ImageData | undefined {
  if (image.naturalWidth < 1 || image.naturalHeight < 1) {
    return undefined;
  }

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    return undefined;
  }

  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法读取蒙版图片。"));
    image.src = url;
  });
}

function morphology(
  mask: AlphaMask,
  radius: number,
  mode: "max" | "min"
): AlphaMask {
  assertMask(mask);
  const normalizedRadius = normalizeRadius(radius);

  if (normalizedRadius === 0) {
    return cloneAlphaMask(mask);
  }

  const horizontal = new Uint8ClampedArray(mask.data.length);
  const output = createAlphaMask(mask.width, mask.height);
  const outside = mode === "max" ? 0 : 0;

  for (let y = 0; y < mask.height; y += 1) {
    const row = mask.data.subarray(y * mask.width, (y + 1) * mask.width);
    horizontal.set(
      slidingExtrema(row, normalizedRadius, mode, outside),
      y * mask.width
    );
  }

  const column = new Uint8ClampedArray(mask.height);

  for (let x = 0; x < mask.width; x += 1) {
    for (let y = 0; y < mask.height; y += 1) {
      column[y] = horizontal[y * mask.width + x]!;
    }

    const filtered = slidingExtrema(
      column,
      normalizedRadius,
      mode,
      outside
    );

    for (let y = 0; y < mask.height; y += 1) {
      output.data[y * mask.width + x] = filtered[y]!;
    }
  }

  return output;
}

function boxBlur(mask: AlphaMask, radius: number): AlphaMask {
  const horizontal = new Float64Array(mask.data.length);
  const output = createAlphaMask(mask.width, mask.height);

  for (let y = 0; y < mask.height; y += 1) {
    const offset = y * mask.width;
    let sum = 0;

    for (let x = -radius; x <= radius; x += 1) {
      sum += x >= 0 && x < mask.width ? mask.data[offset + x]! : 0;
    }

    for (let x = 0; x < mask.width; x += 1) {
      horizontal[offset + x] = sum / (radius * 2 + 1);
      const removeX = x - radius;
      const addX = x + radius + 1;
      sum -=
        removeX >= 0 && removeX < mask.width
          ? mask.data[offset + removeX]!
          : 0;
      sum +=
        addX >= 0 && addX < mask.width
          ? mask.data[offset + addX]!
          : 0;
    }
  }

  for (let x = 0; x < mask.width; x += 1) {
    let sum = 0;

    for (let y = -radius; y <= radius; y += 1) {
      sum += y >= 0 && y < mask.height ? horizontal[y * mask.width + x]! : 0;
    }

    for (let y = 0; y < mask.height; y += 1) {
      output.data[y * mask.width + x] = clampByte(
        sum / (radius * 2 + 1)
      );
      const removeY = y - radius;
      const addY = y + radius + 1;
      sum -=
        removeY >= 0 && removeY < mask.height
          ? horizontal[removeY * mask.width + x]!
          : 0;
      sum +=
        addY >= 0 && addY < mask.height
          ? horizontal[addY * mask.width + x]!
          : 0;
    }
  }

  return output;
}

function slidingExtrema(
  input: Uint8ClampedArray,
  radius: number,
  mode: "max" | "min",
  outside: number
) {
  const padded = new Uint8ClampedArray(input.length + radius * 2);
  padded.fill(clampByte(outside));
  padded.set(input, radius);
  const output = new Uint8ClampedArray(input.length);
  const deque = new Int32Array(padded.length);
  let head = 0;
  let tail = 0;
  const windowSize = radius * 2 + 1;

  for (let index = 0; index < padded.length; index += 1) {
    while (head < tail && deque[head]! <= index - windowSize) {
      head += 1;
    }

    while (
      head < tail &&
      (mode === "max"
        ? padded[deque[tail - 1]!]! <= padded[index]!
        : padded[deque[tail - 1]!]! >= padded[index]!)
    ) {
      tail -= 1;
    }

    deque[tail++] = index;
    const outputIndex = index - windowSize + 1;

    if (outputIndex >= 0 && outputIndex < output.length) {
      output[outputIndex] = padded[deque[head]!]!;
    }
  }

  return output;
}

function retainLargestComponent(mask: AlphaMask): AlphaMask {
  const visited = new Uint8Array(mask.data.length);
  const queue = new Int32Array(mask.data.length);
  let largest: number[] = [];

  for (let start = 0; start < mask.data.length; start += 1) {
    if (visited[start] || mask.data[start] === 0) {
      continue;
    }

    const component: number[] = [];
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;

    while (head < tail) {
      const index = queue[head++]!;
      component.push(index);
      const x = index % mask.width;
      const y = Math.floor(index / mask.width);

      if (x > 0 && mask.data[index - 1] && !visited[index - 1]) {
        tail = enqueue(index - 1, visited, queue, tail);
      }
      if (
        x + 1 < mask.width &&
        mask.data[index + 1] &&
        !visited[index + 1]
      ) {
        tail = enqueue(index + 1, visited, queue, tail);
      }
      if (
        y > 0 &&
        mask.data[index - mask.width] &&
        !visited[index - mask.width]
      ) {
        tail = enqueue(index - mask.width, visited, queue, tail);
      }
      if (
        y + 1 < mask.height &&
        mask.data[index + mask.width] &&
        !visited[index + mask.width]
      ) {
        tail = enqueue(index + mask.width, visited, queue, tail);
      }
    }

    if (component.length > largest.length) {
      largest = component;
    }
  }

  const output = createAlphaMask(mask.width, mask.height);
  largest.forEach((index) => {
    output.data[index] = mask.data[index]!;
  });
  return output;
}

function pointInPolygon(x: number, y: number, points: MaskPoint[]) {
  let inside = false;

  for (
    let current = 0, previous = points.length - 1;
    current < points.length;
    previous = current++
  ) {
    const currentPoint = points[current]!;
    const previousPoint = points[previous]!;
    const intersects =
      currentPoint.y > y !== previousPoint.y > y &&
      x <
        ((previousPoint.x - currentPoint.x) * (y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y || Number.EPSILON) +
          currentPoint.x;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function readPixel(data: ArrayLike<number>, pixelIndex: number) {
  const index = pixelIndex * 4;
  return [
    Number(data[index] ?? 0),
    Number(data[index + 1] ?? 0),
    Number(data[index + 2] ?? 0),
    Number(data[index + 3] ?? 255)
  ] as [number, number, number, number];
}

function colorDistance(
  left: [number, number, number, number],
  right: [number, number, number, number]
) {
  const red = left[0] - right[0];
  const green = left[1] - right[1];
  const blue = left[2] - right[2];
  const alpha = (left[3] - right[3]) * 0.5;
  return Math.sqrt(red * red + green * green + blue * blue + alpha * alpha);
}

function enqueue(
  index: number,
  visited: Uint8Array,
  queue: Int32Array,
  tail: number
) {
  if (!visited[index]) {
    visited[index] = 1;
    queue[tail] = index;
    return tail + 1;
  }

  return tail;
}

function assertMask(mask: AlphaMask) {
  if (
    !Number.isInteger(mask.width) ||
    !Number.isInteger(mask.height) ||
    mask.width < 1 ||
    mask.height < 1 ||
    mask.data.length !== mask.width * mask.height
  ) {
    throw new Error("蒙版尺寸或数据无效。");
  }
}

function assertSameDimensions(left: AlphaMask, right: AlphaMask) {
  assertMask(left);
  assertMask(right);

  if (left.width !== right.width || left.height !== right.height) {
    throw new Error("参与运算的蒙版尺寸必须一致。");
  }
}

function normalizeDimension(value: number) {
  return Math.max(1, Math.floor(Number.isFinite(value) ? value : 1));
}

function normalizeRadius(value: number) {
  return Math.max(0, Math.min(128, Math.floor(Number.isFinite(value) ? value : 0)));
}

function clampInteger(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
