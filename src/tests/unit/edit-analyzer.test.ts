import { describe, expect, it } from "vitest";
import {
  analyzeEditInstruction,
  resolveEditInstructionAnalysis
} from "../../../server/edit/edit-analyzer";

describe("edit instruction analyzer", () => {
  it("detects conflicting edit requirements before execution", () => {
    const analysis = analyzeEditInstruction({
      instruction: "把背景改成黑白，同时保留鲜艳彩色效果。",
      mode: "whole"
    });

    expect(analysis.action).toBe("clarify");
    expect(analysis.conflicts).toContain("画面同时要求黑白与彩色");
    expect(analysis.clarificationQuestion).toContain("存在冲突");
  });

  it("normalizes a supplied AI analysis and downgrades low confidence", () => {
    const analysis = resolveEditInstructionAnalysis({
      instruction: "移除桌面杂物，保留产品和包装文字。",
      mode: "whole",
      supplied: {
        action: "execute",
        confidence: 0.4,
        originalInstruction: "移除桌面杂物，保留产品和包装文字。",
        polishedInstruction: "移除桌面杂物，保持产品结构和包装文字不变。",
        editTargets: ["桌面", "桌面"],
        protectedElements: ["产品", "产品"],
        conflicts: [],
        warnings: [],
        analyzedBy: "ai"
      }
    });

    expect(analysis.action).toBe("clarify");
    expect(analysis.clarificationQuestion).toBeTruthy();
  });
});
