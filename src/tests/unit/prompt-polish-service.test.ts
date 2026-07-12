import { describe, expect, it } from "vitest";
import {
  buildPromptPolishInstruction,
  extractPolishedPrompt,
  inferPromptPolishPlatform
} from "../../services/prompt-polish-service";

describe("prompt polish service", () => {
  it("builds a constrained image prompt polishing instruction", () => {
    const instruction = buildPromptPolishInstruction({
      fieldLabel: "主体",
      templateName: "电商产品",
      value: "白色保温杯，正面 logo"
    });

    expect(instruction).toContain("「电商产品」一致性套图");
    expect(instruction).toContain("字段「主体」");
    expect(instruction).toContain("必须保留主体身份");
    expect(instruction).toContain("<source_prompt>\n白色保温杯，正面 logo\n</source_prompt>");
  });

  it("adds line-list formatting requirements for continuity rules", () => {
    const instruction = buildPromptPolishInstruction({
      fieldLabel: "一致性规则",
      templateName: "通用主体",
      value: "人物发型一致\n服装颜色一致",
      format: "line-list"
    });

    expect(instruction).toContain("保持每行一条独立规则");
  });

  it("adds comma-list formatting requirements for negative prompts", () => {
    const instruction = buildPromptPolishInstruction({
      fieldLabel: "排除内容",
      templateName: "电商产品",
      value: "变形, 错误文字",
      format: "comma-list"
    });

    expect(instruction).toContain("逗号分隔的排除项");
  });

  it("extracts tagged, fenced, and plain model output", () => {
    expect(
      extractPolishedPrompt("<polished_prompt>\n电影级柔光，主体细节清晰\n</polished_prompt>")
    ).toBe("电影级柔光，主体细节清晰");
    expect(extractPolishedPrompt("```text\n高质感产品摄影\n```")).toBe("高质感产品摄影");
    expect(extractPolishedPrompt("保持角色五官与服装一致")).toBe("保持角色五官与服装一致");
  });

  it("rejects empty source and empty model output", () => {
    expect(() =>
      buildPromptPolishInstruction({
        fieldLabel: "主体",
        templateName: "通用主体",
        value: "  "
      })
    ).toThrow("请先输入");
    expect(() => extractPolishedPrompt("  ")).toThrow("AI 未返回");
  });

  it("infers the compatible reasoning platform from the model name", () => {
    expect(inferPromptPolishPlatform("gpt-5.6-sol")).toBe("openai");
    expect(inferPromptPolishPlatform("claude-sonnet-4-6")).toBe("anthropic");
    expect(inferPromptPolishPlatform("gemini-3.1-pro-preview")).toBe("gemini");
  });
});
