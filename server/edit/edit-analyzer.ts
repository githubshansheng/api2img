import type { EditInstructionAnalysis, EditMode, EditRegion } from "../../src/domain";

const VAGUE_ONLY_PATTERNS = [
  /^(?:帮我|请|麻烦)?(?:修|改|优化|润色|调整|处理)(?:一下|下)?[。！!？?]?$/,
  /^(?:更|再)?(?:好看|高级|自然|漂亮|精致|清晰)(?:一点|一些)?[。！!？?]?$/,
  /^(?:随便|看着办|你决定)[。！!？?]?$/
];

const CONFLICT_PAIRS: Array<[RegExp, RegExp, string]> = [
  [/黑白|单色/, /彩色|鲜艳/, "画面同时要求黑白与彩色"],
  [/白天|日间|阳光/, /夜晚|夜景|月光/, "时间环境同时要求白天与夜晚"],
  [/删除|去掉|移除/, /保留|不要改|维持/, "同一轮同时包含删除与保留要求"],
  [/透明背景/, /不透明背景|实色背景/, "背景同时要求透明与不透明"]
];

const TARGET_PATTERNS: Array<[RegExp, string]> = [
  [/背景|天空|环境/, "背景"],
  [/人物|人脸|面部|皮肤|发型|服装/, "人物"],
  [/产品|商品|包装|瓶身|结构/, "产品"],
  [/文字|文案|字体|logo|标志/i, "文字与品牌"],
  [/颜色|色调|调色|光影|曝光|对比度/, "色彩与光影"],
  [/构图|裁切|视角|镜头|比例/, "构图"],
  [/清晰|锐化|分辨率|噪点/, "画质"]
];

export function analyzeEditInstruction(input: {
  instruction: string;
  mode: EditMode;
  regions?: Pick<EditRegion, "label" | "instruction">[];
}): EditInstructionAnalysis {
  const originalInstruction = input.instruction.trim();
  const regionInstructions = (input.regions ?? [])
    .map((region) => region.instruction.trim())
    .filter(Boolean);
  const combined = [originalInstruction, ...regionInstructions].filter(Boolean).join("；");
  const conflicts = detectConflicts(combined);
  const vague = !originalInstruction || VAGUE_ONLY_PATTERNS.some((pattern) => pattern.test(originalInstruction));
  const localWithoutRegion =
    input.mode === "local" &&
    (input.regions?.length ?? 0) === 0 &&
    !/(左|右|上|下|中间|中央|背景|人物|脸|衣服|产品|文字|logo|区域)/i.test(originalInstruction);
  const action = vague || conflicts.length > 0 || localWithoutRegion ? "clarify" : "execute";
  const editTargets = collectMatches(combined, TARGET_PATTERNS);
  const protectedElements = extractProtectedElements(combined);
  const warnings: string[] = [];

  if (input.mode === "local" && (input.regions?.length ?? 0) === 0) {
    warnings.push("未提供蒙版，将依赖文字位置描述执行局部修改");
  }

  if (input.mode === "merge") {
    warnings.push("合并编辑会同时参考两个父版本，请明确主图与借用元素");
  }

  return {
    action,
    confidence: action === "execute" ? 0.82 : conflicts.length > 0 ? 0.96 : 0.72,
    originalInstruction,
    polishedInstruction:
      action === "execute"
        ? polishHeuristically(originalInstruction, input.mode, regionInstructions)
        : originalInstruction,
    clarificationQuestion: action === "clarify"
      ? buildClarificationQuestion({ vague, conflicts, localWithoutRegion })
      : undefined,
    editTargets,
    protectedElements,
    conflicts,
    warnings,
    analyzedBy: "heuristic"
  };
}

export function resolveEditInstructionAnalysis(input: {
  instruction: string;
  mode: EditMode;
  regions?: Pick<EditRegion, "label" | "instruction">[];
  supplied?: EditInstructionAnalysis;
}) {
  const fallback = analyzeEditInstruction(input);
  const supplied = input.supplied;

  if (!supplied) {
    return fallback;
  }

  const polishedInstruction = supplied.polishedInstruction?.trim();
  const suppliedIsUsable =
    supplied.originalInstruction?.trim() === input.instruction.trim() &&
    Boolean(polishedInstruction) &&
    Number.isFinite(supplied.confidence);

  if (!suppliedIsUsable) {
    return fallback;
  }

  if (fallback.action === "clarify" && fallback.conflicts.length > 0) {
    return {
      ...fallback,
      warnings: Array.from(new Set([...fallback.warnings, ...(supplied.warnings ?? [])]))
    };
  }

  if (supplied.action === "execute" && supplied.confidence < 0.75) {
    return {
      ...supplied,
      action: "clarify" as const,
      clarificationQuestion:
        supplied.clarificationQuestion?.trim() ||
        "我还不能确定要改动的对象和期望结果。请补充修改位置、目标效果，以及必须保持不变的内容。"
    };
  }

  return {
    ...supplied,
    originalInstruction: input.instruction.trim(),
    polishedInstruction,
    editTargets: uniqueStrings(supplied.editTargets),
    protectedElements: uniqueStrings(supplied.protectedElements),
    conflicts: uniqueStrings(supplied.conflicts),
    warnings: uniqueStrings(supplied.warnings)
  };
}

function detectConflicts(value: string) {
  return CONFLICT_PAIRS.flatMap(([left, right, message]) =>
    left.test(value) && right.test(value) ? [message] : []
  );
}

function collectMatches(value: string, patterns: Array<[RegExp, string]>) {
  return patterns.flatMap(([pattern, label]) => pattern.test(value) ? [label] : []);
}

function extractProtectedElements(value: string) {
  const protectedElements: string[] = [];
  const clauses = value.split(/[，。；;,\n]/).map((clause) => clause.trim()).filter(Boolean);

  clauses.forEach((clause) => {
    if (/(保留|保持|不要改|不改变|维持|锁定)/.test(clause)) {
      protectedElements.push(clause.replace(/^(请|并且|同时)/, ""));
    }
  });

  return uniqueStrings(protectedElements);
}

function polishHeuristically(instruction: string, mode: EditMode, regions: string[]) {
  const prefix =
    mode === "whole"
      ? "在保持原图主体身份、结构和构图关系的前提下，"
      : mode === "local"
        ? "仅修改指定区域，保持蒙版外内容、主体身份和整体构图不变，"
        : "以第一张图为主版本，按指令融合第二张图中的指定元素，保持未提及内容不变，";
  const regionText = regions.length > 0
    ? ` 分区要求：${regions.map((value, index) => `区域${index + 1}：${value}`).join("；")}。`
    : "";
  const normalized = instruction.replace(/\s+/g, " ").replace(/[。；;]+$/, "");

  return `${prefix}${normalized}。${regionText}`.trim();
}

function buildClarificationQuestion(input: {
  vague: boolean;
  conflicts: string[];
  localWithoutRegion: boolean;
}) {
  if (input.conflicts.length > 0) {
    return `当前要求存在冲突：${input.conflicts.join("；")}。请说明最终以哪一项为准，并补充必须保持不变的内容。`;
  }

  if (input.localWithoutRegion) {
    return "请指出要修改的具体位置或绘制蒙版，并说明目标效果以及蒙版外需要保持不变的内容。";
  }

  if (input.vague) {
    return "请具体说明要修改什么、希望变成什么效果，以及哪些人物、产品、文字、颜色或构图必须保持不变。";
  }

  return "请补充更明确的修改目标和保留约束。";
}

function uniqueStrings(values: string[] | undefined) {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));
}
