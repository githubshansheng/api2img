import { describe, expect, it } from "vitest";
import {
  createLocalEditInstructionAnalysis,
  parseEditInstructionAnalysis
} from "../../services/edit-instruction-service";

describe("edit instruction service", () => {
  it("parses fenced AI JSON, clamps confidence, and deduplicates arrays", () => {
    const analysis = parseEditInstructionAnalysis(
      [
        "```json",
        JSON.stringify({
          action: "execute",
          confidence: 1.7,
          polishedInstruction: "仅替换背景，保持人物身份和服装不变。",
          editTargets: ["背景", " 背景 "],
          protectedElements: ["人物", "人物", ""],
          conflicts: [],
          warnings: ["注意文字", "注意文字"]
        }),
        "```"
      ].join("\n"),
      {
        instruction: "换个背景，人物不要动",
        mode: "whole",
        regions: []
      }
    );

    expect(analysis).toMatchObject({
      action: "execute",
      confidence: 1,
      originalInstruction: "换个背景，人物不要动",
      editTargets: ["背景"],
      protectedElements: ["人物"],
      warnings: ["注意文字"],
      analyzedBy: "ai"
    });
  });

  it("asks for clarification when local fallback has no selected region", () => {
    const analysis = createLocalEditInstructionAnalysis({
      instruction: "把外套改成深绿色羊毛材质",
      mode: "local",
      regions: []
    });

    expect(analysis.action).toBe("clarify");
    expect(analysis.clarificationQuestion).toContain("绘制");
    expect(analysis.polishedInstruction).toContain("保持区域外内容");
  });
});
