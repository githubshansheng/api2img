import { describe, expect, it } from "vitest";
import type { ReferenceImage } from "../../domain";
import { createRecognitionDraft } from "../../services/recognition-service";

const images: ReferenceImage[] = [
  {
    id: "ref-1",
    source: "local-file",
    name: "product.png",
    mimeType: "image/png",
    format: "png",
    sizeBytes: 2048,
    width: 800,
    height: 600,
    previewURL: "data:image/png;base64,aW1hZ2U=",
    base64: "aW1hZ2U=",
    order: 0,
    uploadStatus: "ready",
    createdAt: 1783411200000
  }
];

describe("recognition service", () => {
  it("creates a structured recognition draft from uploaded image facts", () => {
    const draft = createRecognitionDraft({
      role: "attributes",
      question: "请提取商品材质和颜色",
      images,
      model: {
        id: "vision-model",
        apiModelName: "vision-model-real",
        displayName: "Vision Model"
      } as never
    });

    expect(draft.title).toBe("属性分析请求预览");
    expect(draft.summary).toContain("已整理 1 张图片的真实识图请求预览");
    expect(draft.imageFacts[0]).toContain("product.png");
    expect(draft.requestPreview).toMatchObject({
      role: "attributes",
      roleLabel: "属性分析",
      model: "vision-model-real",
      question: "请提取商品材质和颜色",
      imageCount: 1
    });
  });

  it("uses an empty-state draft when no image is uploaded", () => {
    const draft = createRecognitionDraft({
      role: "object",
      question: "   ",
      images: []
    });

    expect(draft.summary).toBe("请先上传图片，系统会整理真实识图请求预览。");
    expect(draft.requestPreview).toMatchObject({
      question: expect.stringContaining("请详细分析这些图片的内容"),
      imageCount: 0
    });
  });
});
