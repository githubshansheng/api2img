import { describe, expect, it } from "vitest";
import { getModelById } from "../../config/models";
import { createReferenceImageWithBase64, validateReferenceImageFiles } from "../../services/upload-service";

const model = getModelById("flux-2-pro")!;

describe("upload service", () => {
  it("accepts JPG and PNG files within size limits", () => {
    const result = validateReferenceImageFiles(
      [
        { name: "a.jpg", type: "image/jpeg", size: 1024 },
        { name: "b.png", type: "image/png", size: 2048 }
      ],
      model.capabilities
    );

    expect(result.acceptedFiles).toHaveLength(2);
    expect(result.issues).toHaveLength(0);
  });

  it("rejects unsupported file formats", () => {
    const result = validateReferenceImageFiles([{ name: "doc.pdf", type: "application/pdf", size: 1024 }], model.capabilities);

    expect(result.acceptedFiles).toHaveLength(0);
    expect(result.issues[0]?.code).toBe("REFERENCE_IMAGE_FORMAT_UNSUPPORTED");
  });

  it("rejects files over model size limit", () => {
    const result = validateReferenceImageFiles(
      [{ name: "huge.png", type: "image/png", size: 21 * 1024 * 1024 }],
      model.capabilities
    );

    expect(result.acceptedFiles).toHaveLength(0);
    expect(result.issues[0]?.code).toBe("REFERENCE_IMAGE_TOO_LARGE");
  });

  it("enforces model reference image count", () => {
    const files = Array.from({ length: 5 }, (_, index) => ({
      name: `${index}.png`,
      type: "image/png",
      size: 1024
    }));
    const result = validateReferenceImageFiles(files, model.capabilities);

    expect(model.capabilities.maxReferenceImages).toBe(4);
    expect(result.acceptedFiles).toHaveLength(4);
    expect(result.issues[0]?.code).toBe("REFERENCE_IMAGE_COUNT_EXCEEDED");
  });

  it("reads uploaded files into image data URLs for transport", async () => {
    const image = await createReferenceImageWithBase64(
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "sample.png", { type: "" }),
      0
    );

    expect(image.mimeType).toBe("image/png");
    expect(image.base64).toMatch(/^data:image\/png;base64,/);
    expect(image.base64?.endsWith(",")).toBe(false);
  });
});
