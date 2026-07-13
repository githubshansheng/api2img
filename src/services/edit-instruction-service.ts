import type {
  EditInstructionAnalysis,
  EditMode,
  EndpointOverride,
  ModelRequestOverride
} from "../domain";
import { runReasoningRequest } from "./generation-api-service";
import { inferPromptPolishPlatform } from "./prompt-polish-service";

export type EditInstructionRegionInput = {
  label: string;
  instruction: string;
};

export type AnalyzeEditInstructionInput = {
  instruction: string;
  mode: EditMode;
  regions: EditInstructionRegionInput[];
};

export type EditInstructionRuntime = {
  modelId: string;
  modelName: string;
  endpointOverride?: EndpointOverride;
  modelOverride?: ModelRequestOverride;
};

export async function analyzeEditInstructionWithAI(
  input: AnalyzeEditInstructionInput,
  runtime: EditInstructionRuntime
): Promise<EditInstructionAnalysis> {
  const result = await runReasoningRequest({
    requestId: crypto.randomUUID(),
    modelId: runtime.modelId,
    platform: inferPromptPolishPlatform(runtime.modelName),
    modelName: runtime.modelName,
    effort: "low",
    maxTokens: 2200,
    prompt: buildEditInstructionAnalysisPrompt(input),
    apiStyle: "responses",
    wantSummary: false,
    endpointOverride: runtime.endpointOverride,
    modelOverride: {
      ...runtime.modelOverride,
      apiModelName: runtime.modelName
    }
  });

  return parseEditInstructionAnalysis(result.outputText, input);
}

export function buildEditInstructionAnalysisPrompt(
  input: AnalyzeEditInstructionInput
) {
  const modeLabel: Record<EditMode, string> = {
    whole: "整图编辑",
    local: "局部蒙版编辑",
    merge: "双版本合并编辑"
  };
  const regionText =
    input.regions.length > 0
      ? input.regions
          .map(
            (region, index) =>
              `${index + 1}. ${region.label || `区域 ${index + 1}`}：${
                region.instruction || "沿用主指令"
              }`
          )
          .join("\n")
      : "无";

  return [
    "你是专业图像编辑指令分析器。判断用户需求是否足够明确，并在不改变意图的前提下润色为可执行的中文修图指令。",
    "明确需求直接执行；存在对象不清、目标效果不清、互相冲突或局部编辑位置不清时，必须要求澄清。",
    "润色时补充保真约束：未提及区域、人物身份、产品结构、Logo、文字内容、数量、透视和构图关系保持不变。",
    "只返回一个 JSON 对象，不要 Markdown、解释或额外文本。",
    'JSON 结构：{"action":"execute|clarify","confidence":0到1,"originalInstruction":"原文","polishedInstruction":"润色指令","clarificationQuestion":"需要澄清时的问题","editTargets":["修改对象"],"protectedElements":["保持不变的内容"],"conflicts":["冲突"],"warnings":["风险提示"],"analyzedBy":"ai"}',
    `编辑模式：${modeLabel[input.mode]}`,
    `用户原始指令：${input.instruction.trim()}`,
    `局部区域：\n${regionText}`
  ].join("\n");
}

export function parseEditInstructionAnalysis(
  outputText: string,
  input: AnalyzeEditInstructionInput
): EditInstructionAnalysis {
  const parsed = parseJsonObject(outputText);
  const action = parsed.action === "clarify" ? "clarify" : "execute";
  const polishedInstruction = readString(parsed.polishedInstruction);

  if (!polishedInstruction) {
    throw new Error("AI 未返回可用的润色指令");
  }

  return {
    action,
    confidence: clampConfidence(parsed.confidence),
    originalInstruction: input.instruction.trim(),
    polishedInstruction,
    clarificationQuestion:
      action === "clarify"
        ? readString(parsed.clarificationQuestion) ||
          "请补充要修改的对象、目标效果和必须保持不变的内容。"
        : undefined,
    editTargets: readStringArray(parsed.editTargets),
    protectedElements: readStringArray(parsed.protectedElements),
    conflicts: readStringArray(parsed.conflicts),
    warnings: readStringArray(parsed.warnings),
    analyzedBy: "ai"
  };
}

export function createLocalEditInstructionAnalysis(
  input: AnalyzeEditInstructionInput
): EditInstructionAnalysis {
  const instruction = input.instruction.trim();
  const vague =
    instruction.length < 6 ||
    /^(修一下|优化一下|润色一下|调整一下|更好看|随便处理|你决定)[。！!？?]*$/.test(
      instruction
    );
  const localWithoutRegion = input.mode === "local" && input.regions.length === 0;
  const action = vague || localWithoutRegion ? "clarify" : "execute";
  const prefix =
    input.mode === "whole"
      ? "在保持原图主体身份、结构和构图关系的前提下，"
      : input.mode === "local"
        ? "仅修改蒙版标记区域，保持区域外内容、主体身份和整体构图不变，"
        : "以第一张图为主版本，仅融合第二张图中指令明确要求的元素，";

  return {
    action,
    confidence: action === "execute" ? 0.76 : 0.68,
    originalInstruction: instruction,
    polishedInstruction: `${prefix}${instruction.replace(/[。；;]+$/, "")}。`,
    clarificationQuestion:
      action === "clarify"
        ? localWithoutRegion
          ? "请先绘制要修改的区域，并说明目标效果和区域外需要保持不变的内容。"
          : "请具体说明要修改什么、希望变成什么效果，以及哪些内容必须保持不变。"
        : undefined,
    editTargets: input.regions.map((region) => region.label).filter(Boolean),
    protectedElements: ["未提及区域", "主体身份", "文字与 Logo", "整体构图"],
    conflicts: [],
    warnings: ["AI 润色暂不可用，已使用本地规则整理指令。"],
    analyzedBy: "heuristic"
  };
}

function parseJsonObject(value: string) {
  const normalized = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");

  if (start < 0 || end <= start) {
    throw new Error("AI 润色结果不是有效 JSON");
  }

  const parsed = JSON.parse(normalized.slice(start, end + 1)) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI 润色结果格式不正确");
  }

  return parsed as Record<string, unknown>;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
        )
      )
    : [];
}

function clampConfidence(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.8;
}
