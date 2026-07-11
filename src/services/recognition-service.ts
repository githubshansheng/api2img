import type { ModelConfig, ReferenceImage } from "../domain";
import {
  DEFAULT_VISION_RECOGNITION_ROLE,
  VISION_RECOGNITION_DEFAULT_PROMPT,
  VISION_RECOGNITION_ROLES,
  type VisionRecognitionRoleId
} from "../config/vision-recognition";
import { formatFileSize } from "./upload-service";

export type LegacyRecognitionRole = "object" | "bullet-points" | "attributes" | "ocr";
export type RecognitionRole = VisionRecognitionRoleId | LegacyRecognitionRole;

export type RecognitionDraftInput = {
  role: RecognitionRole;
  question: string;
  model?: ModelConfig;
  images: ReferenceImage[];
};

export type RecognitionDraft = {
  title: string;
  summary: string;
  requestPreview: Record<string, unknown>;
  imageFacts: string[];
  createdAt: string;
};

const legacyRoleMap: Record<LegacyRecognitionRole, VisionRecognitionRoleId> = {
  object: "universal",
  "bullet-points": "amazon-bullets",
  attributes: "product-analysis",
  ocr: "ocr-extract"
};

export function normalizeRecognitionRole(role?: RecognitionRole): VisionRecognitionRoleId {
  if (!role) {
    return DEFAULT_VISION_RECOGNITION_ROLE;
  }

  if (role in legacyRoleMap) {
    return legacyRoleMap[role as LegacyRecognitionRole];
  }

  return VISION_RECOGNITION_ROLES.some((item) => item.id === role)
    ? (role as VisionRecognitionRoleId)
    : DEFAULT_VISION_RECOGNITION_ROLE;
}

export function getRecognitionRoleConfig(role?: RecognitionRole) {
  const normalizedRole = normalizeRecognitionRole(role);

  return (
    VISION_RECOGNITION_ROLES.find((item) => item.id === normalizedRole) ??
    VISION_RECOGNITION_ROLES.find((item) => item.id === DEFAULT_VISION_RECOGNITION_ROLE) ??
    VISION_RECOGNITION_ROLES[0]
  );
}

export function getRecognitionRolePrompt(role?: RecognitionRole) {
  return getRecognitionRoleConfig(role).prompt || VISION_RECOGNITION_DEFAULT_PROMPT;
}

export function createRecognitionDraft(input: RecognitionDraftInput): RecognitionDraft {
  const imageFacts = input.images.map((image, index) => {
    const size = image.sizeBytes ? formatFileSize(image.sizeBytes) : "大小未知";
    const dimensions = image.width && image.height ? `${image.width}x${image.height}` : "尺寸待读取";

    return `${index + 1}. ${image.name}，${image.mimeType}，${size}，${dimensions}`;
  });
  const roleConfig = getRecognitionRoleConfig(input.role);
  const question = input.question.trim() || VISION_RECOGNITION_DEFAULT_PROMPT;

  return {
    title: `${roleConfig.shortName}请求预览`,
    summary:
      imageFacts.length > 0
        ? `已整理 ${imageFacts.length} 张图片的真实识图请求预览，开始识别后将通过后端调用视觉模型。`
        : "请先上传图片，系统会整理真实识图请求预览。",
    requestPreview: {
      role: input.role,
      normalizedRole: roleConfig.id,
      roleLabel: roleConfig.shortName,
      model: input.model?.apiModelName ?? input.model?.id,
      question,
      systemPrompt: roleConfig.prompt,
      imageCount: input.images.length,
      images: input.images.map((image) => ({
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        width: image.width,
        height: image.height
      }))
    },
    imageFacts,
    createdAt: new Date().toISOString()
  };
}
