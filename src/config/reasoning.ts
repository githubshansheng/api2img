export type ReasoningPlatformId = "anthropic" | "openai" | "gemini";
export type ReasoningApiStyle = "responses" | "chat-completions";
export type ReasoningEffortLevel = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type ReasoningModelOption = {
  id: string;
  levels: ReasoningEffortLevel[];
  default: ReasoningEffortLevel;
};

export type ReasoningPlatformConfig = {
  id: ReasoningPlatformId;
  label: string;
  hint: string;
  defaultApiStyle?: ReasoningApiStyle;
  models: ReasoningModelOption[];
};

export type ReasoningPromptPreset = {
  id: string;
  name: string;
  shortName: string;
  description: string;
  prompt: string;
};

export const REASONING_DEFAULT_BASE_URL = "https://api.apiyi.com";
export const DEFAULT_REASONING_PLATFORM: ReasoningPlatformId = "anthropic";
export const DEFAULT_REASONING_MAX_TOKENS = 4096;
export const MAX_REASONING_OUTPUT_TOKENS = 32000;

export const REASONING_EFFORT_LABELS: Record<ReasoningEffortLevel, string> = {
  none: "关闭",
  minimal: "极简",
  low: "快速",
  medium: "均衡",
  high: "深度",
  xhigh: "超深度",
  max: "最大"
};

export const REASONING_PLATFORMS: ReasoningPlatformConfig[] = [
  {
    id: "anthropic",
    label: "Anthropic · Claude",
    hint: "Messages 端点，适合观察 Claude 推理强度与摘要输出。",
    models: [
      { id: "claude-opus-4-8", levels: ["low", "medium", "high", "xhigh", "max"], default: "high" },
      { id: "claude-opus-4-7", levels: ["low", "medium", "high", "xhigh", "max"], default: "high" },
      { id: "claude-sonnet-4-6", levels: ["low", "medium", "high"], default: "high" }
    ]
  },
  {
    id: "openai",
    label: "OpenAI · GPT",
    hint: "可在 Responses 与 Chat Completions 间切换，便于定位端点兼容性。",
    defaultApiStyle: "responses",
    models: [
      { id: "gpt-5.5", levels: ["none", "low", "medium", "high", "xhigh"], default: "medium" },
      { id: "gpt-5.4", levels: ["none", "low", "medium", "high", "xhigh"], default: "none" }
    ]
  },
  {
    id: "gemini",
    label: "Google · Gemini",
    hint: "Gemini generateContent 端点，使用 thinkingConfig 表达推理强度。",
    models: [
      { id: "gemini-3.1-pro-preview", levels: ["low", "medium", "high"], default: "high" },
      { id: "gemini-3.5-flash", levels: ["minimal", "low", "medium", "high"], default: "medium" }
    ]
  }
];

export const REASONING_PROMPT_PRESETS: ReasoningPromptPreset[] = [
  {
    id: "liar-puzzle",
    name: "诚实者与说谎者",
    shortName: "真话假话",
    description: "经典骑士与无赖逻辑谜题",
    prompt:
      "一个岛上住着两类人:诚实者永远说真话,说谎者永远说假话。你遇到三个人 A、B、C。\n\nA 说:「B 和 C 是同一类人。」\n\n这时有人问 C:「A 和 B 是同一类人吗?」\n\n请推理出 C 会怎么回答。要求:分情况枚举所有可能的组合,逐步说明推理过程,最后给出结论并解释为什么答案是唯一的。"
  },
  {
    id: "weighing",
    name: "称球找次品",
    shortName: "称球问题",
    description: "12 球 3 次称量经典谜题",
    prompt:
      "有 12 个外观完全相同的小球,其中 11 个重量相同,1 个是次品,但不知道次品偏轻还是偏重。现在只有一架没有砝码的天平,最多允许称 3 次。\n\n请给出能**保证**找出次品、并同时判断它偏轻还是偏重的完整方案。要求:写清每次称量的分组方式,以及每种称量结果(左重/右重/平衡)分别如何处理,直到覆盖所有分支。"
  },
  {
    id: "monty-hall",
    name: "三门问题及变体",
    shortName: "三门问题",
    description: "概率直觉与条件概率的经典对决",
    prompt:
      "经典三门问题:三扇门后分别是一辆汽车和两只山羊。你选了 1 号门,主持人(他知道每扇门后是什么)打开了 3 号门,门后是山羊,然后问你要不要换成 2 号门。\n\n1) 换门会提高中奖概率吗?为什么?请给出严格的概率分析。\n\n2) 变体:如果主持人**并不知道**门后是什么,只是随手打开了 3 号门、碰巧是山羊,这时换门的中奖概率还是一样的吗?请分别计算两种情形的概率,并解释差异的本质原因。"
  },
  {
    id: "trap-questions",
    name: "直觉陷阱三连",
    shortName: "直觉陷阱",
    description: "考察能否避开系统一的快思考陷阱",
    prompt:
      "请回答以下三道容易答错的题。要求:每题先写出大多数人的「直觉答案」,再给出仔细推理后的正确答案和计算过程。\n\n1) 球拍和球一共 1.10 元,球拍比球贵 1 元,球多少钱?\n\n2) 5 台机器 5 分钟生产 5 个零件,那么 100 台机器生产 100 个零件需要多少分钟?\n\n3) 湖面上的睡莲每天面积翻一倍,48 天能长满整个湖面,那么长满半个湖面需要多少天?"
  },
  {
    id: "detective",
    name: "侦探推理",
    shortName: "侦探推理",
    description: "供词枚举与唯一解验证",
    prompt:
      "保险柜被盗,甲、乙、丙三名嫌疑人中**恰有一人**作案。审讯记录如下:\n\n甲:「不是我偷的。」\n乙:「不是我偷的。」\n丙:「是甲偷的。」\n\n已知三人中**只有一人说了真话**。\n\n请推理出谁是小偷、谁说了真话。要求:对「甲偷 / 乙偷 / 丙偷」三种假设逐一枚举验证,说明每种假设下三句话的真假情况,排除矛盾情形,证明答案唯一。"
  },
  {
    id: "sequence",
    name: "数列找规律",
    shortName: "数列规律",
    description: "三条风格迥异的找规律题",
    prompt:
      "请找出下列三个数列的规律,给出下一项,并详细说明推理过程:\n\n1) 1, 11, 21, 1211, 111221, ?\n\n2) 2, 3, 5, 9, 17, 33, ?\n\n3) 8, 5, 4, 9, 1, 7, 6, ?(提示:规律与数字本身的大小无关)"
  }
];

export function getReasoningPlatform(platformId: ReasoningPlatformId) {
  return REASONING_PLATFORMS.find((platform) => platform.id === platformId) ?? REASONING_PLATFORMS[0];
}

export function getDefaultReasoningModel(platformId: ReasoningPlatformId) {
  return getReasoningPlatform(platformId).models[0];
}
