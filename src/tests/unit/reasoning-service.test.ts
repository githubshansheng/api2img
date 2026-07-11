import { describe, expect, it } from "vitest";
import { createReasoningDraft } from "../../services/reasoning-service";

describe("reasoning service", () => {
  it("creates a reasoning request preview and clamps token limits", () => {
    const draft = createReasoningDraft({
      platform: "openai",
      modelName: "o3",
      effort: "high",
      maxTokens: 99999,
      prompt: "请评估图片生成方案",
      hasReferenceImage: true
    });

    expect(draft.title).toBe("OpenAI · GPT · o3");
    expect(draft.summary).toContain("深度推理配置已整理");
    expect(draft.summary).toContain("32000 tokens");
    expect(draft.requestPreview).toMatchObject({
      platform: "openai",
      model: "o3",
      max_output_tokens: 32000,
      input: "请评估图片生成方案",
      hasReferenceImage: true
    });
    expect(draft.checklist).toContain("确认失败时返回结构化错误");
  });

  it("fills defaults for empty prompts and low token limits", () => {
    const draft = createReasoningDraft({
      platform: "",
      modelName: "",
      effort: "medium",
      maxTokens: 32,
      prompt: "   ",
      hasReferenceImage: false
    });

    expect(draft.title).toBe("推理平台 · 未指定模型");
    expect(draft.requestPreview).toMatchObject({
      max_output_tokens: 256,
      input: "请分析当前图片生成方案的可行性、风险和改进方向。",
      hasReferenceImage: false
    });
  });
});
