import type {
  CreateGenerationSuiteRequest,
  GenerationRequestPayload,
  GenerationSet,
  GenerationSlot,
  SuiteImage,
  SuiteReference
} from "../../domain";
import type { GenerationExecutionResult } from "../../../server/generation-executor";
import { calculateGenerationSuiteProgress } from "../../services/suite-generation-service";

export const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n0sAAAAASUVORK5CYII=";

export function createSuiteReference(
  index: number,
  role: SuiteReference["role"] = "style"
): SuiteReference {
  return {
    id: `reference-${index}`,
    role,
    name: `reference-${index}.png`,
    mimeType: "image/png",
    format: "png",
    order: index,
    remoteURL: `https://assets.example/reference-${index}.png`,
    createdAt: "2026-07-12T00:00:00.000Z"
  };
}

export function createSuiteImage(
  slotId: string,
  overrides: Partial<SuiteImage> = {}
): SuiteImage {
  return {
    id: overrides.id ?? `${slotId}-image-0`,
    slotId,
    attemptId: overrides.attemptId ?? `${slotId}-attempt-0`,
    candidateIndex: overrides.candidateIndex ?? 0,
    sourceType: overrides.sourceType ?? "url",
    url: overrides.url ?? `https://assets.example/${slotId}.png`,
    mimeType: overrides.mimeType ?? "image/png",
    format: overrides.format ?? "png",
    width: overrides.width ?? 1024,
    height: overrides.height ?? 1024,
    selected: overrides.selected ?? false,
    createdAt: overrides.createdAt ?? "2026-07-12T00:00:00.000Z"
  };
}

export function createSuiteSlot(
  kind: GenerationSlot["kind"],
  overrides: Partial<GenerationSlot> = {}
): GenerationSlot {
  const id = overrides.id ?? (kind === "anchor" ? "anchor-slot" : "scene-slot");

  return {
    id,
    kind,
    title: overrides.title ?? (kind === "anchor" ? "主视觉锚点" : "使用场景"),
    description: overrides.description ?? "测试场景",
    scenePrompt: overrides.scenePrompt ?? "保持同一主体，生成新的场景画面。",
    negativePrompt: overrides.negativePrompt,
    candidateCount: overrides.candidateCount ?? (kind === "anchor" ? 2 : 1),
    order: overrides.order ?? (kind === "anchor" ? 0 : 1),
    status: overrides.status ?? "pending",
    selectedImageId: overrides.selectedImageId,
    images: overrides.images ?? [],
    attempts: overrides.attempts ?? []
  };
}

export function createGenerationSet(
  overrides: Partial<GenerationSet> = {}
): GenerationSet {
  const anchorSlot = createSuiteSlot("anchor");
  const sceneSlot = createSuiteSlot("scene");
  const slots = overrides.slots ?? [anchorSlot, sceneSlot];
  const anchorSlotId =
    overrides.anchorSlotId ?? slots.find((slot) => slot.kind === "anchor")?.id ?? anchorSlot.id;
  const suite: GenerationSet = {
    schemaVersion: 1,
    id: "suite-test",
    name: "一致性套图测试",
    templateId: "consistent-subject-4",
    status: "draft",
    modelId: "gpt-image-2",
    modelDisplayName: "GPT Image 2",
    params: {
      ratio: "1:1",
      resolution: "1K",
      quality: "high",
      count: 1,
      outputFormat: "png",
      responseFormat: "b64_json"
    },
    sharedSpec: {
      subject: "银色桌面音箱",
      style: "现代商业产品摄影",
      palette: "银灰、黑色与青色点缀",
      lighting: "左前方柔光",
      camera: "50mm 标准镜头",
      composition: "主体居中并保留呼吸空间",
      continuityRules: [
        "产品结构、材质和接口位置保持一致",
        "所有画面沿用相同的主色和光线方向"
      ],
      negativePrompt: "变形，错误文字，水印"
    },
    references: [],
    slots,
    anchorSlotId,
    options: {
      requireAnchorConfirmation: true,
      autoSelectFirstAnchor: false,
      perSuiteConcurrency: 2
    },
    progress: calculateGenerationSuiteProgress(slots),
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z"
  };

  return {
    ...suite,
    ...overrides,
    sharedSpec: overrides.sharedSpec ?? suite.sharedSpec,
    references: overrides.references ?? suite.references,
    slots,
    anchorSlotId,
    options: overrides.options ?? suite.options,
    progress: overrides.progress ?? calculateGenerationSuiteProgress(slots)
  };
}

export function createGenerationSuiteRequest(
  overrides: Partial<CreateGenerationSuiteRequest> = {}
): CreateGenerationSuiteRequest {
  return {
    name: "一致性套图测试",
    templateId: "consistent-subject-4",
    modelId: "gpt-image-2",
    modelDisplayName: "GPT Image 2",
    endpointOverride: {
      baseURL: "https://proxy.example/v1/images/generations",
      apiKey: "test-secret-key",
      headers: {
        Authorization: "Bearer test-secret-key",
        "X-Suite-Test": "enabled"
      }
    },
    params: {
      ratio: "1:1",
      resolution: "1K",
      quality: "high",
      count: 1,
      outputFormat: "png",
      responseFormat: "b64_json"
    },
    sharedSpec: {
      subject: "银色桌面音箱",
      style: "现代商业产品摄影",
      palette: "银灰、黑色与青色点缀",
      lighting: "左前方柔光",
      camera: "50mm 标准镜头",
      composition: "主体居中并保留呼吸空间",
      continuityRules: [
        "产品结构、材质和接口位置保持一致",
        "所有画面沿用相同的主色和光线方向"
      ],
      negativePrompt: "变形，错误文字，水印"
    },
    referenceImages: [],
    options: {
      requireAnchorConfirmation: false,
      autoSelectFirstAnchor: true,
      perSuiteConcurrency: 2
    },
    slots: [
      {
        kind: "anchor",
        title: "主视觉锚点",
        description: "锁定主体外观",
        scenePrompt: "生成干净完整的产品主视觉。",
        candidateCount: 2
      },
      {
        kind: "scene",
        title: "桌面场景",
        description: "展示产品使用状态",
        scenePrompt: "将同一产品放在现代办公桌面中。",
        candidateCount: 1
      }
    ],
    ...overrides
  };
}

export function createSuccessfulGenerationExecution(
  input: Partial<GenerationRequestPayload>
): GenerationExecutionResult {
  const requestId = input.requestId ?? crypto.randomUUID();
  const count = Math.max(1, input.params?.count ?? 1);

  return {
    success: true,
    statusCode: 202,
    requestId,
    data: {
      requestId,
      status: "success",
      acceptedAt: new Date().toISOString(),
      modelId: input.modelId ?? "gpt-image-2",
      result: {
        requestId,
        status: "success",
        images: Array.from({ length: count }, (_, index) => ({
          id: `${requestId}-image-${index}`,
          sourceType: "base64" as const,
          base64: TINY_PNG_BASE64,
          mimeType: "image/png",
          width: 1,
          height: 1,
          format: "png" as const,
          index,
          temporary: false,
          saved: false
        })),
        durationMs: 8
      }
    }
  };
}
