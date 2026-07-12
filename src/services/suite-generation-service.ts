import type {
  GenerationSet,
  GenerationSlot,
  GenerationSuiteProgress,
  GenerationSuiteTemplate,
  GenerationSuiteTemplateId,
  GenerationSuiteValidation,
  SharedVisualSpec,
  SuiteReference,
  SuiteReferenceRole
} from "../domain";
import {
  isGenerationSlotKind,
  isSuiteReferenceRole,
  SUITE_GENERATION_LIMITS
} from "../domain/suite-generation";

export const GENERATION_SUITE_TEMPLATES: readonly GenerationSuiteTemplate[] = [
  {
    id: "consistent-subject-4",
    name: "通用同主体 4 张",
    description: "以一张主视觉锁定主体，再扩展细节、使用场景和传播画面。",
    recommendedFor: "人物、角色、产品、IP 和品牌视觉",
    defaultSpec: {
      subject: "",
      style: "精致商业摄影，真实材质，现代视觉语言",
      palette: "统一的主色与辅助色，避免每张图发生明显色偏",
      lighting: "柔和主光配合克制轮廓光，光向在整套图片中保持一致",
      camera: "自然透视，中等景深，镜头语言统一",
      composition: "主体清晰、留白克制、视觉重心稳定",
      continuityRules: [
        "主体身份、五官、发型、服饰或产品结构保持一致",
        "材质、品牌标识、主色、配件数量和位置不得随场景变化",
        "除场景要求外，不新增文字、水印、边框或无关道具"
      ],
      negativePrompt: "主体变形，身份变化，多余肢体，产品结构改变，错误文字，水印，低清晰度"
    },
    slots: [
      {
        key: "anchor",
        kind: "anchor",
        title: "主视觉锚点",
        description: "确定主体、材质、色彩与镜头基准。",
        scenePrompt: "生成可作为整套图片视觉基准的主视觉。主体完整、识别特征清楚，背景克制，细节可信。",
        defaultCandidateCount: 2
      },
      {
        key: "detail",
        kind: "scene",
        title: "细节特写",
        description: "放大主体最有辨识度的结构或材质。",
        scenePrompt: "在不改变主体身份与结构的前提下，表现关键细节和材质，使用近景或特写构图。",
        defaultCandidateCount: 1
      },
      {
        key: "usage",
        kind: "scene",
        title: "真实场景",
        description: "将同一主体放入合理的真实使用环境。",
        scenePrompt: "将同一主体置于自然、可信的使用场景，环境服务于主体，不喧宾夺主。",
        defaultCandidateCount: 1
      },
      {
        key: "campaign",
        kind: "scene",
        title: "传播画面",
        description: "形成适合宣传物料的宽松构图。",
        scenePrompt: "生成具有品牌传播感的画面，保持同一主体和视觉体系，并预留适量文案区域但不生成文字。",
        defaultCandidateCount: 1
      }
    ]
  },
  {
    id: "ecommerce-product-5",
    name: "电商产品 5 张",
    description: "覆盖商品主图、角度图、卖点细节、使用场景和功能传播图。",
    recommendedFor: "电商 SKU、消费电子、美妆、家居和包装产品",
    defaultSpec: {
      subject: "",
      style: "高端电商产品摄影，真实材质，干净利落",
      palette: "品牌主色保持准确，背景色与产品形成清晰层级",
      lighting: "大型柔光箱主光，干净高光与自然接触阴影",
      camera: "标准产品摄影透视，焦段和畸变控制一致",
      composition: "商品为唯一视觉中心，边缘完整，适合电商裁切",
      continuityRules: [
        "SKU 型号、包装、Logo、按钮、接口、纹理和配件必须一致",
        "产品比例、颜色与材质不得因场景变化而改变",
        "不生成价格、促销标签、乱码、额外 Logo 或水印"
      ],
      negativePrompt: "产品变形，型号变化，错误 Logo，乱码，多余配件，材质塑料感，过曝，脏污，水印"
    },
    slots: [
      {
        key: "anchor",
        kind: "anchor",
        title: "商品主图",
        description: "锁定 SKU 外观、颜色、比例和材质。",
        scenePrompt: "生成干净的商品主图，完整展示产品，三分之二正面视角，背景简洁，接触阴影自然。",
        defaultCandidateCount: 2
      },
      {
        key: "angle",
        kind: "scene",
        title: "补充角度",
        description: "展示主图未覆盖的侧面与结构。",
        scenePrompt: "保持同一 SKU，切换到能够补充结构信息的合理角度，产品比例和材质完全一致。",
        defaultCandidateCount: 1
      },
      {
        key: "detail",
        kind: "scene",
        title: "卖点细节",
        description: "突出核心工艺、接口或材料。",
        scenePrompt: "聚焦一个最重要的产品卖点，以近景展示工艺和材质，不改变任何结构或标识。",
        defaultCandidateCount: 1
      },
      {
        key: "lifestyle",
        kind: "scene",
        title: "使用场景",
        description: "表现用户真实使用产品的情境。",
        scenePrompt: "将同一产品放入符合目标用户的真实使用场景，尺寸关系准确，环境自然且不遮挡主体。",
        defaultCandidateCount: 1
      },
      {
        key: "feature",
        kind: "scene",
        title: "功能传播",
        description: "形成适合详情页功能说明的留白画面。",
        scenePrompt: "保持产品完全一致，围绕核心功能组织画面，预留文案区域但不要生成任何文字或图标。",
        defaultCandidateCount: 1
      }
    ]
  }
] as const;

const REFERENCE_ROLE_PRIORITY: Record<SuiteReferenceRole | "anchor", number> = {
  subject: 0,
  anchor: 1,
  style: 2,
  logo: 3,
  composition: 4,
  background: 5
};

export function getGenerationSuiteTemplate(templateId: GenerationSuiteTemplateId) {
  return GENERATION_SUITE_TEMPLATES.find((template) => template.id === templateId);
}

export function mergeSharedVisualSpec(
  templateSpec: SharedVisualSpec,
  input: Partial<SharedVisualSpec>
): SharedVisualSpec {
  return {
    subject: input.subject?.trim() ?? templateSpec.subject,
    style: input.style?.trim() || templateSpec.style,
    palette: input.palette?.trim() || templateSpec.palette,
    lighting: input.lighting?.trim() || templateSpec.lighting,
    camera: input.camera?.trim() || templateSpec.camera,
    composition: input.composition?.trim() || templateSpec.composition,
    continuityRules:
      input.continuityRules?.map((rule) => rule.trim()).filter(Boolean) ?? [...templateSpec.continuityRules],
    negativePrompt: input.negativePrompt?.trim() || templateSpec.negativePrompt
  };
}

export function compileSuiteSlotPrompt(suite: Pick<GenerationSet, "sharedSpec" | "references">, slot: GenerationSlot) {
  const spec = suite.sharedSpec;
  const referenceInstructions = buildReferenceInstructions(suite.references, slot.kind === "scene");
  const lines = [
    "请生成同一套视觉资产中的一张图片。",
    `【主体】${spec.subject.trim() || "严格复刻主体参考图中的同一主体"}`,
    `【本张任务】${slot.scenePrompt.trim()}`,
    `【统一风格】${spec.style.trim()}`,
    `【统一配色】${spec.palette.trim()}`,
    `【统一光线】${spec.lighting.trim()}`,
    `【统一镜头】${spec.camera.trim()}`,
    `【统一构图原则】${spec.composition.trim()}`,
    "【跨图一致性规则】",
    ...spec.continuityRules.map((rule, index) => `${index + 1}. ${rule}`),
    ...referenceInstructions,
    slot.kind === "scene"
      ? "必须以已选择的主视觉锚点为身份与风格基准，只改变本张任务明确要求的场景、景别或构图。"
      : "这张图将作为后续图片的主视觉锚点，请优先保证主体身份、结构、材质和色彩可稳定复用。",
    "只输出最终图片，不要在画面中解释规则。"
  ];

  return lines.filter(Boolean).join("\n");
}

export function compileSuiteNegativePrompt(suite: Pick<GenerationSet, "sharedSpec">, slot: GenerationSlot) {
  return [suite.sharedSpec.negativePrompt, slot.negativePrompt].filter((value) => value?.trim()).join("，") || undefined;
}

export function sortSuiteReferences<T extends Pick<SuiteReference, "role" | "order">>(
  references: T[],
  anchor?: T
) {
  const sortedReferences = references
    .map((reference) => ({
      reference,
      priority: REFERENCE_ROLE_PRIORITY[reference.role]
    }))
    .sort((left, right) => left.priority - right.priority || left.reference.order - right.reference.order)
    .map((item) => item.reference);

  return (anchor ? [anchor, ...sortedReferences] : sortedReferences).slice(
    0,
    SUITE_GENERATION_LIMITS.maxReferences
  );
}

export function calculateGenerationSuiteProgress(slots: GenerationSlot[]): GenerationSuiteProgress {
  const totalCandidates = slots.reduce((sum, slot) => sum + slot.candidateCount, 0);
  const completedCandidates = slots.reduce(
    (sum, slot) => sum + Math.min(slot.images.length, slot.candidateCount),
    0
  );
  const completedSlots = slots.filter((slot) => slot.status === "completed").length;
  const failedSlots = slots.filter((slot) => slot.status === "failed").length;
  const runningSlots = slots.filter((slot) => slot.status === "running").length;
  const queuedSlots = slots.filter((slot) => slot.status === "queued").length;
  const resolvedSlots = completedSlots + failedSlots;

  return {
    totalSlots: slots.length,
    completedSlots,
    failedSlots,
    runningSlots,
    queuedSlots,
    totalCandidates,
    completedCandidates,
    percent: slots.length === 0 ? 0 : Math.round((resolvedSlots / slots.length) * 100)
  };
}

export function validateGenerationSuite(suite: GenerationSet, maxReferenceImages = 12): GenerationSuiteValidation {
  const errors: GenerationSuiteValidation["errors"] = [];
  const warnings: GenerationSuiteValidation["warnings"] = [];
  const slotCount = suite.slots.length;
  const anchorSlots = suite.slots.filter((slot) => slot.kind === "anchor");
  const totalCandidates = suite.slots.reduce((sum, slot) => sum + slot.candidateCount, 0);

  if (!suite.name.trim()) {
    errors.push(issue("name", "SUITE_NAME_REQUIRED", "请输入套图名称"));
  }

  if (!suite.sharedSpec.subject.trim() && !suite.references.some((reference) => reference.role === "subject")) {
    errors.push(issue("sharedSpec.subject", "SUITE_SUBJECT_REQUIRED", "请描述主体或上传至少一张主体参考图"));
  }

  suite.references.forEach((reference, index) => {
    if (!isSuiteReferenceRole(reference.role)) {
      errors.push(
        issue(
          `references[${index}].role`,
          "SUITE_REFERENCE_ROLE_INVALID",
          `第 ${index + 1} 张参考图的角色无效`
        )
      );
    }
  });

  if (slotCount < SUITE_GENERATION_LIMITS.minSlots || slotCount > SUITE_GENERATION_LIMITS.maxSlots) {
    errors.push(
      issue(
        "slots",
        "SUITE_SLOT_COUNT_INVALID",
        `场景槽位需在 ${SUITE_GENERATION_LIMITS.minSlots} 到 ${SUITE_GENERATION_LIMITS.maxSlots} 个之间`
      )
    );
  }

  if (anchorSlots.length !== 1 || anchorSlots[0]?.id !== suite.anchorSlotId) {
    errors.push(issue("anchorSlotId", "SUITE_ANCHOR_INVALID", "每套图片必须且只能有一个有效的主视觉锚点槽位"));
  }

  suite.slots.forEach((slot, index) => {
    if (!isGenerationSlotKind(slot.kind)) {
      errors.push(
        issue(
          `slots[${index}].kind`,
          "SUITE_SLOT_KIND_INVALID",
          `第 ${index + 1} 个场景的类型无效`
        )
      );
    }

    if (!slot.title.trim()) {
      errors.push(issue(`slots[${index}].title`, "SUITE_SLOT_TITLE_REQUIRED", `第 ${index + 1} 个场景缺少标题`));
    }

    if (!slot.scenePrompt.trim()) {
      errors.push(
        issue(`slots[${index}].scenePrompt`, "SUITE_SLOT_PROMPT_REQUIRED", `${slot.title || `第 ${index + 1} 个场景`}缺少任务描述`)
      );
    }

    if (
      !Number.isInteger(slot.candidateCount) ||
      slot.candidateCount < SUITE_GENERATION_LIMITS.minCandidatesPerSlot ||
      slot.candidateCount > SUITE_GENERATION_LIMITS.maxCandidatesPerSlot
    ) {
      errors.push(
        issue(
          `slots[${index}].candidateCount`,
          "SUITE_CANDIDATE_COUNT_INVALID",
          `每个场景候选数需在 ${SUITE_GENERATION_LIMITS.minCandidatesPerSlot} 到 ${SUITE_GENERATION_LIMITS.maxCandidatesPerSlot} 之间`
        )
      );
    }
  });

  if (totalCandidates > SUITE_GENERATION_LIMITS.maxTotalCandidates) {
    errors.push(
      issue(
        "slots.candidateCount",
        "SUITE_TOTAL_CANDIDATES_EXCEEDED",
        `整套候选图总数不能超过 ${SUITE_GENERATION_LIMITS.maxTotalCandidates} 张`
      )
    );
  }

  const effectiveReferenceLimit = Math.min(maxReferenceImages, SUITE_GENERATION_LIMITS.maxReferences);

  if (suite.references.length > effectiveReferenceLimit) {
    errors.push(
      issue("references", "SUITE_REFERENCE_LIMIT_EXCEEDED", `当前模型最多支持 ${effectiveReferenceLimit} 张参考图`)
    );
  }

  if (
    suite.slots.some((slot) => slot.kind === "scene") &&
    effectiveReferenceLimit > 0 &&
    suite.references.length >= effectiveReferenceLimit
  ) {
    warnings.push(
      warning(
        "references",
        "SUITE_ANCHOR_REFERENCE_RESERVED",
        "场景生成会为主视觉锚点预留 1 个参考图名额，最低优先级的用户参考图可能不参与场景生成"
      )
    );
  }

  if (
    !Number.isInteger(suite.options.perSuiteConcurrency) ||
    suite.options.perSuiteConcurrency < 1 ||
    suite.options.perSuiteConcurrency > SUITE_GENERATION_LIMITS.maxPerSuiteConcurrency
  ) {
    errors.push(
      issue(
        "options.perSuiteConcurrency",
        "SUITE_CONCURRENCY_INVALID",
        `单套并发需在 1 到 ${SUITE_GENERATION_LIMITS.maxPerSuiteConcurrency} 之间`
      )
    );
  }

  if (!suite.sharedSpec.style.trim()) {
    warnings.push(warning("sharedSpec.style", "SUITE_STYLE_EMPTY", "未填写风格规范，跨场景一致性可能下降"));
  }

  if (suite.sharedSpec.continuityRules.length === 0) {
    warnings.push(
      warning("sharedSpec.continuityRules", "SUITE_CONTINUITY_RULES_EMPTY", "建议至少填写一条跨图一致性规则")
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

function buildReferenceInstructions(references: SuiteReference[], includeAnchor: boolean) {
  if (references.length === 0 && !includeAnchor) {
    return [];
  }

  const roleCounts = references.reduce<Record<string, number>>((counts, reference) => {
    counts[reference.role] = (counts[reference.role] ?? 0) + 1;
    return counts;
  }, {});
  const labels: Record<SuiteReferenceRole, string> = {
    subject: "主体",
    style: "风格",
    logo: "Logo",
    composition: "构图",
    background: "背景"
  };
  const summary = (Object.entries(roleCounts) as Array<[SuiteReferenceRole, number]>)
    .map(([role, count]) => `${labels[role]}参考 ${count} 张`)
    .join("、");

  return [
    `【参考图使用】${summary || "无用户参考图"}${includeAnchor ? "，并以主视觉锚点为最高身份基准" : ""}。`,
    "主体参考用于身份和结构，风格参考只用于视觉语言，Logo 参考只用于标识准确性，构图和背景参考不得覆盖主体特征。"
  ];
}

function issue(field: string, code: string, message: string) {
  return {
    field,
    code,
    message,
    blocking: true
  };
}

function warning(field: string, code: string, message: string) {
  return {
    field,
    code,
    message,
    blocking: false
  };
}
