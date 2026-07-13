import { PNG } from "pngjs";
import type {
  EditMaskCombination,
  GenerationReferenceInput
} from "../../src/domain";

export type NativeMaskLayerInput = {
  image: GenerationReferenceInput;
  mode?: EditMaskCombination;
};

export function composeNativeMaskLayers(
  layers: NativeMaskLayerInput[],
  expectedDimensions?: {
    width?: number;
    height?: number;
  }
): GenerationReferenceInput {
  if (layers.length === 0) {
    throw new Error("EDIT_NATIVE_MASK_REQUIRED");
  }

  const decoded = layers.map(({ image, mode }) => ({
    image: decodePNG(image),
    mode: mode ?? "add"
  }));
  const width = decoded[0]!.image.width;
  const height = decoded[0]!.image.height;

  if (
    decoded.some(
      (layer) =>
        layer.image.width !== width || layer.image.height !== height
    ) ||
    (expectedDimensions?.width !== undefined &&
      expectedDimensions.width !== width) ||
    (expectedDimensions?.height !== undefined &&
      expectedDimensions.height !== height)
  ) {
    throw new Error("EDIT_NATIVE_MASK_DIMENSION_MISMATCH");
  }

  const selectedAlpha = new Uint8ClampedArray(width * height);

  if (decoded[0]!.mode === "intersect") {
    selectedAlpha.fill(255);
  }

  decoded.forEach(({ image, mode }) => {
    for (let index = 0; index < selectedAlpha.length; index += 1) {
      const current = selectedAlpha[index]!;
      const layer = image.data[index * 4 + 3]!;
      selectedAlpha[index] =
        mode === "add"
          ? Math.max(current, layer)
          : mode === "subtract"
            ? Math.max(0, current - layer)
            : Math.min(current, layer);
    }
  });

  const output = new PNG({ width, height });

  for (let index = 0; index < selectedAlpha.length; index += 1) {
    const offset = index * 4;
    output.data[offset] = 255;
    output.data[offset + 1] = 255;
    output.data[offset + 2] = 255;
    output.data[offset + 3] = 255 - selectedAlpha[index]!;
  }

  const encoded = PNG.sync.write(output);

  return {
    id: crypto.randomUUID(),
    name: "effective-edit-mask.png",
    mimeType: "image/png",
    format: "png",
    sizeBytes: encoded.byteLength,
    width,
    height,
    base64: encoded.toString("base64"),
    order: 0
  };
}

function decodePNG(image: GenerationReferenceInput) {
  if (!image.base64 || image.mimeType.toLowerCase() !== "image/png") {
    throw new Error("EDIT_NATIVE_MASK_PNG_REQUIRED");
  }

  const marker = ";base64,";
  const payload = image.base64.includes(marker)
    ? image.base64.slice(image.base64.indexOf(marker) + marker.length)
    : image.base64;

  try {
    return PNG.sync.read(Buffer.from(payload.replace(/\s/g, ""), "base64"));
  } catch {
    throw new Error("EDIT_NATIVE_MASK_DECODE_FAILED");
  }
}
