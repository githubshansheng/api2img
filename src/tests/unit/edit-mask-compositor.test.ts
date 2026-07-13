import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import type { GenerationReferenceInput } from "../../domain";
import { composeNativeMaskLayers } from "../../../server/edit/edit-mask-compositor";

describe("native edit mask compositor", () => {
  it("combines canonical add and subtract layers into OpenAI mask alpha", () => {
    const composed = composeNativeMaskLayers(
      [
        {
          image: createMaskImage("add-left", [255, 0]),
          mode: "add"
        },
        {
          image: createMaskImage("add-right", [0, 255]),
          mode: "add"
        },
        {
          image: createMaskImage("subtract-left", [255, 0]),
          mode: "subtract"
        }
      ],
      {
        width: 2,
        height: 1
      }
    );
    const decoded = PNG.sync.read(Buffer.from(composed.base64!, "base64"));

    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(1);
    expect([decoded.data[3], decoded.data[7]]).toEqual([255, 0]);
  });

  it("starts an intersect-only composition from a fully selected mask", () => {
    const composed = composeNativeMaskLayers([
      {
        image: createMaskImage("intersect-right", [0, 255]),
        mode: "intersect"
      }
    ]);
    const decoded = PNG.sync.read(Buffer.from(composed.base64!, "base64"));

    expect([decoded.data[3], decoded.data[7]]).toEqual([255, 0]);
  });
});

function createMaskImage(
  id: string,
  selectedAlpha: [number, number]
): GenerationReferenceInput {
  const png = new PNG({ width: 2, height: 1 });

  selectedAlpha.forEach((alpha, index) => {
    const offset = index * 4;
    png.data[offset] = 255;
    png.data[offset + 1] = 255;
    png.data[offset + 2] = 255;
    png.data[offset + 3] = alpha;
  });

  const encoded = PNG.sync.write(png);

  return {
    id,
    name: `${id}.png`,
    mimeType: "image/png",
    format: "png",
    sizeBytes: encoded.byteLength,
    width: 2,
    height: 1,
    base64: encoded.toString("base64"),
    order: 0
  };
}
