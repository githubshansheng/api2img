import {
  DEFAULT_REASONING_MAX_TOKENS,
  MAX_REASONING_OUTPUT_TOKENS,
  REASONING_EFFORT_LABELS,
  getReasoningPlatform,
  type ReasoningApiStyle,
  type ReasoningEffortLevel,
  type ReasoningPlatformId
} from "../config/reasoning";

export type ReasoningEffort = ReasoningEffortLevel;

export type ReasoningDraftInput = {
  platform: ReasoningPlatformId | string;
  modelName: string;
  effort: ReasoningEffort;
  maxTokens: number;
  prompt: string;
  hasReferenceImage: boolean;
  apiStyle?: ReasoningApiStyle;
  wantSummary?: boolean;
};

export type ReasoningDraft = {
  title: string;
  summary: string;
  requestPreview: Record<string, unknown>;
  checklist: string[];
  createdAt: string;
};

export function createReasoningDraft(input: ReasoningDraftInput): ReasoningDraft {
  const prompt = input.prompt.trim() || "请分析当前图片生成方案的可行性、风险和改进方向。";
  const maxTokens = clampReasoningMaxTokens(input.maxTokens || DEFAULT_REASONING_MAX_TOKENS);
  const platform =
    input.platform === "anthropic" || input.platform === "openai" || input.platform === "gemini"
      ? getReasoningPlatform(input.platform)
      : undefined;
  const platformLabel = platform?.label ?? (input.platform || "推理平台");
  const effortLabel = REASONING_EFFORT_LABELS[input.effort] ?? input.effort;

  return {
    title: `${platformLabel} · ${input.modelName || "未指定模型"}`,
    summary: `${effortLabel}推理配置已整理，最大输出 ${maxTokens} tokens${
      input.hasReferenceImage ? "，包含参考图输入" : ""
    }。`,
    requestPreview: {
      platform: input.platform,
      platformLabel,
      apiStyle: input.apiStyle,
      model: input.modelName,
      reasoning: {
        effort: input.effort,
        summary: input.wantSummary ? "auto" : undefined
      },
      max_output_tokens: maxTokens,
      input: prompt,
      hasReferenceImage: input.hasReferenceImage
    },
    checklist: [
      "确认模型是否支持当前推理强度",
      "确认参考图会经过脱敏和大小校验",
      "确认输出摘要不会记录完整 API Key",
      "确认失败时返回结构化错误"
    ],
    createdAt: new Date().toISOString()
  };
}

export function clampReasoningMaxTokens(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_REASONING_MAX_TOKENS;
  }

  return Math.max(256, Math.min(MAX_REASONING_OUTPUT_TOKENS, Math.floor(value)));
}
