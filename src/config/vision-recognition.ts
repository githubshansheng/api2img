export type VisionRecognitionRoleId =
  | "universal"
  | "product-title"
  | "amazon-bullets"
  | "product-analysis"
  | "ocr-extract";

export type VisionRecognitionRoleConfig = {
  id: VisionRecognitionRoleId;
  name: string;
  shortName: string;
  description: string;
  prompt: string;
  defaultModel: string;
  isDefault?: boolean;
};

export type VisionRecognitionModelConfig = {
  id: string;
  displayName: string;
  shortName: string;
  description: string;
  features: string[];
  price: string;
  recommended: boolean;
};

export const VISION_RECOGNITION_DEFAULT_PROMPT =
  "请详细分析这些图片的内容，包括场景、物体、人物、氛围等。";

export const VISION_RECOGNITION_MODELS: VisionRecognitionModelConfig[] = [
  {
    id: "gpt-5.6-terra",
    displayName: "GPT-5.6 Terra",
    shortName: "GPT-5.6 Terra",
    description: "默认视觉理解模型，适合图片识别与结构化分析",
    features: ["视觉理解", "多图分析", "结构化输出"],
    price: "按服务端实际计费",
    recommended: true
  },
  {
    id: "gpt-5.2",
    displayName: "GPT-5.2",
    shortName: "GPT-5.2",
    description: "最新旗舰模型，卓越理解与推理能力",
    features: ["顶级理解", "深度推理", "多模态分析"],
    price: "$1.75/$14 per 1M tokens",
    recommended: false
  },
  {
    id: "gemini-3-pro-preview",
    displayName: "Gemini 3 Pro Preview",
    shortName: "Gemini 3 Pro",
    description: "Google 最新旗舰预览版，强大的多模态能力",
    features: ["旗舰性能", "多图理解", "深度分析"],
    price: "$2/$12 per 1M tokens",
    recommended: true
  },
  {
    id: "gemini-2.5-flash-preview-09-2025",
    displayName: "Gemini 2.5 Flash",
    shortName: "Gemini 2.5",
    description: "快速响应版本，性价比极高",
    features: ["极速响应", "性价比高", "推理模式"],
    price: "$0.3/$2.4 per 1M tokens",
    recommended: true
  },
  {
    id: "gpt-5-mini",
    displayName: "GPT-5-mini",
    shortName: "GPT-5-mini",
    description: "轻量高效版本，适合日常使用",
    features: ["高性价比", "快速响应", "准确理解"],
    price: "$0.25/$2 per 1M tokens",
    recommended: false
  },
  {
    id: "claude-haiku-4-5-20251001",
    displayName: "Claude Haiku 4.5",
    shortName: "Haiku 4.5",
    description: "Anthropic 轻量模型，快速且精准",
    features: ["速度快", "成本优", "细节描述"],
    price: "$1/$5 per 1M tokens",
    recommended: false
  },
  {
    id: "qwen-vl-ocr-latest",
    displayName: "Qwen OCR Latest",
    shortName: "Qwen OCR",
    description: "阿里云千问专业 OCR 识别，极速提取文字",
    features: ["OCR 专用", "极速响应", "超高准确率"],
    price: "$0.044/$0.073 per 1M tokens",
    recommended: false
  }
];

export const VISION_RECOGNITION_ROLES: VisionRecognitionRoleConfig[] = [
  {
    id: "universal",
    name: "万物识别+百科",
    shortName: "万物识别",
    description: "通用图像识别和百科知识分析",
    defaultModel: "gpt-5.6-terra",
    isDefault: true,
    prompt:
      "请详细识别并分析图片中的所有物品、场景和元素。对于识别到的主要物体，请提供以下信息：\n\n1. 物品名称和类别\n2. 主要特征和细节描述\n3. 相关的百科知识（历史、用途、特点等）\n4. 场景背景和环境分析\n\n请用清晰的结构化方式呈现分析结果。"
  },
  {
    id: "product-title",
    name: "商品取标题",
    shortName: "商品标题",
    description: "为商品图片生成吸引人的电商标题",
    defaultModel: "gpt-5.6-terra",
    prompt:
      "请作为专业的电商文案，分析这张商品图片并生成3-5个优质的商品标题。要求：\n\n1. 标题长度控制在20-30字\n2. 突出商品的核心卖点和特征\n3. 包含适当的修饰词（如：新款、高品质、爆款等）\n4. 符合电商平台的标题规范\n5. 吸引点击，提升转化\n\n请直接输出标题列表，每个标题单独一行。"
  },
  {
    id: "amazon-bullets",
    name: "亚马逊五点描述",
    shortName: "五点描述",
    description: "生成亚马逊商品详情页的五点描述",
    defaultModel: "gpt-5.6-terra",
    prompt:
      '请作为亚马逊资深运营，根据这张商品图片生成专业的五点描述（Bullet Points）。要求：\n\n1. 每条控制在150-200个字符\n2. 第一点：核心功能或主要用途\n3. 第二点：材质、规格或技术参数\n4. 第三点：独特卖点或竞争优势\n5. 第四点：使用场景或适用人群\n6. 第五点：售后保障或品质承诺\n\n格式要求：\n- 每点用 "✓" 或 "【】" 开头\n- 语言精炼，突出重点\n- 符合亚马逊平台规范'
  },
  {
    id: "product-analysis",
    name: "商品属性分析器",
    shortName: "属性分析",
    description: "深度分析商品属性，提取结构化信息",
    defaultModel: "gpt-5.6-terra",
    prompt:
      "请作为商品数据分析师，对图片中的商品进行详细的属性分析。请按以下维度输出结构化信息：\n\n【基础属性】\n- 商品品类：\n- 颜色：\n- 尺寸/规格：\n- 材质：\n- 品牌（如可识别）：\n\n【视觉特征】\n- 设计风格：\n- 主要元素：\n- 色调分析：\n\n【目标市场】\n- 适用人群：\n- 价格档位预估：\n- 销售场景：\n\n【优化建议】\n- 产品优势：\n- 改进空间：\n- 营销建议："
  },
  {
    id: "ocr-extract",
    name: "OCR 提取",
    shortName: "OCR 提取",
    description: "快速提取图片中的所有文字内容",
    defaultModel: "qwen-vl-ocr-latest",
    prompt:
      "请提取图片中的所有文字内容，包括：\n\n1. 主标题和副标题\n2. 正文内容\n3. 标签、按钮、菜单等UI文字\n4. 水印、版权信息\n5. 其他任何可见文字\n\n请按照图片中文字出现的位置顺序，逐行列出所有文字。如果有多列内容，请按从左到右、从上到下的顺序提取。"
  }
];

export const DEFAULT_VISION_RECOGNITION_MODEL =
  VISION_RECOGNITION_MODELS.find((model) => model.id === "gpt-5.6-terra")?.id ??
  VISION_RECOGNITION_MODELS[0].id;

export const DEFAULT_VISION_RECOGNITION_ROLE =
  VISION_RECOGNITION_ROLES.find((role) => role.isDefault)?.id ?? VISION_RECOGNITION_ROLES[0].id;
