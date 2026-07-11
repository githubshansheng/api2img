import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { GeneratedImage } from "../../domain";
import { buildImageResultZip, type ZipDownloadItem } from "../../services/download-service";

function createImage(id: string, base64?: string): GeneratedImage {
  return {
    id,
    sourceType: "base64",
    base64: base64 ?? "aW1hZ2UtYnl0ZXM=",
    format: "png",
    mimeType: "image/png",
    index: 0,
    temporary: false,
    saved: false,
    width: 1024,
    height: 1024
  };
}

function createItem(image: GeneratedImage): ZipDownloadItem {
  return {
    requestId: "req-20260707",
    modelDisplayName: "GPT Image 2",
    prompt: "小金毛在海边晒太阳",
    image,
    createdAt: "2026-07-07T08:00:00.000Z",
    resolutionText: "1:1 / 1K"
  };
}

describe("download service", () => {
  it("builds a zip with images and a manifest", async () => {
    const progress: number[] = [];
    const result = await buildImageResultZip([createItem(createImage("img-1"))], (value) => progress.push(value));
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const filenames = Object.keys(zip.files);
    const manifest = JSON.parse((await zip.file("manifest.json")?.async("string")) ?? "[]") as Array<{
      imageId: string;
      prompt: string;
      resolutionText: string;
    }>;

    expect(result.fileCount).toBe(1);
    expect(result.filename).toMatch(/^api2image-results-\d{8}-\d{6}\.zip$/);
    expect(filenames.some((filename) => filename.endsWith("GPT-Image-2.png"))).toBe(true);
    expect(manifest[0]).toMatchObject({
      imageId: "img-1",
      prompt: "小金毛在海边晒太阳",
      resolutionText: "1:1 / 1K"
    });
    expect(progress.at(0)).toBe(5);
    expect(progress.at(-1)).toBe(100);
  });

  it("parses base64 data URLs", async () => {
    const dataUrlImage = createImage("img-data-url");
    dataUrlImage.base64 = undefined;
    dataUrlImage.sourceType = "url";
    dataUrlImage.url = "data:image/png;base64,aW1hZ2UtZnJvbS11cmw=";

    const result = await buildImageResultZip([createItem(dataUrlImage)]);
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const imageFile = Object.values(zip.files).find((file) => file.name.endsWith(".png") && file.name !== "manifest.json");

    expect(await imageFile?.async("string")).toBe("image-from-url");
  });
});
