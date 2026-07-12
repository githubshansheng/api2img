import { getModelById } from "../../src/config/models";
import type {
  CreateGenerationSuiteRequest,
  EndpointOverride,
  GenerationError,
  GenerationReferenceInput,
  GenerationSet,
  GenerationSlot,
  GenerationSuiteEvent,
  GenerationSuiteEventType,
  ModelConfig,
  ModelRequestOverride,
  RetryGenerationSuiteSlotRequest,
  SelectSuiteAnchorRequest,
  StartGenerationSuiteRequest,
  SuiteImage,
  SuiteReference,
  UpdateGenerationSuiteRequest
} from "../../src/domain";
import {
  isGenerationSlotKind,
  isSuiteReferenceRole,
  SUITE_GENERATION_LIMITS
} from "../../src/domain/suite-generation";
import { createGenerationError } from "../../src/services/error-service";
import { validateGenerationForm } from "../../src/services/generation-form-service";
import { applyModelRequestOverride } from "../../src/services/model-settings-service";
import {
  calculateGenerationSuiteProgress,
  compileSuiteNegativePrompt,
  compileSuiteSlotPrompt,
  GENERATION_SUITE_TEMPLATES,
  getGenerationSuiteTemplate,
  mergeSharedVisualSpec,
  validateGenerationSuite
} from "../../src/services/suite-generation-service";
import {
  executeGenerationRequest,
  type GenerationExecutionResult
} from "../generation-executor";
import {
  GenerationSuiteAssetError,
  GenerationSuiteAssetStore
} from "./suite-assets";
import { GenerationSuiteScheduler } from "./suite-scheduler";
import { GenerationSuiteStore } from "./suite-store";

type RuntimeGenerationConfig = {
  endpointOverride?: EndpointOverride;
  modelOverride?: ModelRequestOverride;
};

type AttemptTaskGroup = {
  suiteId: string;
  slotId: string;
  attemptId: string;
  remaining: number;
  totalDurationMs: number;
  firstError?: GenerationError;
};

type QueueTaskDescriptor = {
  taskIndex: number;
  requestId: string;
  candidateCount: number;
  candidateOffset: number;
};

type GenerationExecutor = (
  input: Parameters<typeof executeGenerationRequest>[0],
  signal?: AbortSignal
) => Promise<GenerationExecutionResult>;

export class GenerationSuiteServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "GenerationSuiteServiceError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class GenerationSuiteService {
  readonly store: GenerationSuiteStore;
  readonly assets: GenerationSuiteAssetStore;
  readonly scheduler: GenerationSuiteScheduler;

  private readonly executeGeneration: GenerationExecutor;
  private readonly runtimeConfigs = new Map<string, RuntimeGenerationConfig>();
  private readonly taskGroups = new Map<string, AttemptTaskGroup>();
  private readonly listeners = new Map<string, Set<(event: GenerationSuiteEvent) => void>>();
  private readonly lockTails = new Map<string, Promise<void>>();
  private readonly deletingSuites = new Set<string>();

  constructor(input: {
    store: GenerationSuiteStore;
    assets: GenerationSuiteAssetStore;
    scheduler?: GenerationSuiteScheduler;
    executeGeneration?: GenerationExecutor;
  }) {
    this.store = input.store;
    this.assets = input.assets;
    this.scheduler = input.scheduler ?? new GenerationSuiteScheduler(4);
    this.executeGeneration = input.executeGeneration ?? executeGenerationRequest;
    this.store.markRunningSuitesInterrupted();
  }

  list(limit = 50) {
    return this.store.list(limit);
  }

  get(id: string) {
    return this.requireSuite(id);
  }

  getTemplates() {
    return GENERATION_SUITE_TEMPLATES;
  }

  async create(input: CreateGenerationSuiteRequest) {
    validateCreateRequestShape(input);
    const template = getGenerationSuiteTemplate(input.templateId);

    if (!template) {
      throw new GenerationSuiteServiceError(400, "SUITE_TEMPLATE_NOT_FOUND", "套图模板不存在");
    }

    if (!input.params) {
      throw new GenerationSuiteServiceError(400, "SUITE_PARAMS_REQUIRED", "缺少生成参数");
    }

    const baseModel = getModelById(input.modelId);

    if (!baseModel || !baseModel.enabled) {
      throw new GenerationSuiteServiceError(400, "MODEL_NOT_FOUND", "请选择可用的图片模型");
    }

    const runtimeModel = applyModelRequestOverride(baseModel, input.modelOverride);

    if (
      !runtimeModel.capabilities.supportsImageToImage ||
      runtimeModel.capabilities.maxReferenceImages < 1
    ) {
      throw new GenerationSuiteServiceError(
        400,
        "SUITE_MODEL_REFERENCE_REQUIRED",
        "一致性套图需要选择支持参考图的模型"
      );
    }

    const referenceInputs = Array.isArray(input.referenceImages) ? input.referenceImages : [];
    const generationValidation = validateGenerationForm({
      model: runtimeModel,
      prompt: input.sharedSpec?.subject ?? "",
      referenceImages: referenceInputs,
      params: {
        ...input.params,
        count: 1
      },
      requireApiKey: false
    });

    if (!generationValidation.isValid) {
      throw new GenerationSuiteServiceError(
        400,
        "SUITE_GENERATION_PARAMS_INVALID",
        generationValidation.errors[0]?.message ?? "套图生成参数校验失败",
        generationValidation
      );
    }

    const suiteId = crypto.randomUUID();
    const now = new Date().toISOString();
    const referenceResults = await Promise.allSettled(
      referenceInputs.map((reference, index) =>
        this.assets.persistReference(suiteId, {
          ...reference,
          id: reference.id || crypto.randomUUID(),
          order: index
        })
      )
    );
    const failedReference = referenceResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );

    if (failedReference) {
      await this.assets.deleteSuiteAssets(suiteId);
      const reason = failedReference.reason;
      throw new GenerationSuiteServiceError(
        400,
        "SUITE_REFERENCE_PERSIST_FAILED",
        reason instanceof GenerationSuiteAssetError
          ? reason.message
          : reason instanceof Error &&
              reason.message === "SUITE_ASSET_SIZE_INVALID"
          ? "参考图超过允许的大小"
          : "参考图保存失败"
      );
    }
    const references = referenceResults.map(
      (result) => (result as PromiseFulfilledResult<SuiteReference>).value
    );
    const requestedSlots: NonNullable<CreateGenerationSuiteRequest["slots"]> =
      input.slots && input.slots.length > 0
        ? input.slots
        : template.slots.map((definition) => ({
            kind: definition.kind,
            title: definition.title,
            description: definition.description,
            scenePrompt: definition.scenePrompt,
            candidateCount: definition.defaultCandidateCount
          }));
    const slots = requestedSlots.map((override, index): GenerationSlot => {
      const definition = template.slots[index];
      const kind = index === 0 ? "anchor" : override.kind ?? definition?.kind ?? "scene";

      return {
        id: crypto.randomUUID(),
        kind,
        title:
          override.title?.trim() ||
          definition?.title ||
          (kind === "anchor" ? "主视觉锚点" : `场景 ${index}`),
        description: override.description?.trim() || definition?.description || "",
        scenePrompt:
          override.scenePrompt?.trim() ||
          definition?.scenePrompt ||
          "保持主体、风格与主视觉锚点一致，生成一个新的使用场景。",
        negativePrompt: override.negativePrompt?.trim() || undefined,
        candidateCount: clampCandidateCount(
          override.candidateCount ??
            definition?.defaultCandidateCount ??
            SUITE_GENERATION_LIMITS.minCandidatesPerSlot
        ),
        order: index,
        status: "pending",
        images: [],
        attempts: []
      };
    });
    const anchorSlot = slots.find((slot) => slot.kind === "anchor");

    if (!anchorSlot) {
      throw new GenerationSuiteServiceError(500, "SUITE_TEMPLATE_ANCHOR_MISSING", "套图模板缺少锚点槽位");
    }

    const suite: GenerationSet = {
      schemaVersion: 1,
      id: suiteId,
      name: input.name?.trim() || `${template.name} ${now.slice(0, 10)}`,
      templateId: template.id,
      status: "draft",
      modelId: runtimeModel.id,
      modelDisplayName: input.modelDisplayName?.trim() || runtimeModel.displayName,
      modelOverride: input.modelOverride,
      endpointOverride: sanitizeEndpointOverride(input.endpointOverride),
      params: {
        ...input.params,
        count: 1
      },
      sharedSpec: mergeSharedVisualSpec(template.defaultSpec, input.sharedSpec ?? {}),
      references,
      slots,
      anchorSlotId: anchorSlot.id,
      options: {
        requireAnchorConfirmation: input.options?.requireAnchorConfirmation ?? false,
        autoSelectFirstAnchor: input.options?.autoSelectFirstAnchor ?? true,
        perSuiteConcurrency: clampPerSuiteConcurrency(
          input.options?.perSuiteConcurrency ?? SUITE_GENERATION_LIMITS.defaultPerSuiteConcurrency
        )
      },
      progress: calculateGenerationSuiteProgress(slots),
      createdAt: now,
      updatedAt: now
    };
    const validation = validateGenerationSuite(suite, runtimeModel.capabilities.maxReferenceImages);

    if (!validation.isValid) {
      await this.assets.deleteSuiteAssets(suiteId);
      throw new GenerationSuiteServiceError(
        400,
        "SUITE_VALIDATION_FAILED",
        validation.errors[0]?.message ?? "套图参数校验失败",
        validation
      );
    }

    if (input.endpointOverride || input.modelOverride) {
      this.runtimeConfigs.set(suiteId, {
        endpointOverride: input.endpointOverride,
        modelOverride: input.modelOverride
      });
    }

    this.store.save(suite);
    this.emit("suite.updated", suite, undefined, "套图草稿已创建");
    return suite;
  }

  async update(id: string, input: UpdateGenerationSuiteRequest) {
    return this.withSuiteLock(id, async () => {
      const suite = this.requireSuite(id);

      if (!["draft", "interrupted", "failed", "partial_success"].includes(suite.status)) {
        throw new GenerationSuiteServiceError(409, "SUITE_NOT_EDITABLE", "当前状态下不能修改套图配置");
      }

      if (input.name !== undefined) {
        suite.name = input.name.trim();
      }

      if (input.sharedSpec) {
        suite.sharedSpec = mergeSharedVisualSpec(suite.sharedSpec, {
          ...input.sharedSpec,
          continuityRules:
            input.sharedSpec.continuityRules === undefined
              ? suite.sharedSpec.continuityRules
              : input.sharedSpec.continuityRules
        });
      }

      if (input.options) {
        suite.options = {
          ...suite.options,
          ...input.options,
          perSuiteConcurrency: clampPerSuiteConcurrency(
            input.options.perSuiteConcurrency ?? suite.options.perSuiteConcurrency
          )
        };
      }

      input.slots?.forEach((slotPatch) => {
        const slot = suite.slots.find((item) => item.id === slotPatch.id);

        if (!slot) {
          throw new GenerationSuiteServiceError(404, "SUITE_SLOT_NOT_FOUND", "场景槽位不存在");
        }

        slot.title = slotPatch.title?.trim() || slot.title;
        slot.description = slotPatch.description?.trim() || slot.description;
        slot.scenePrompt = slotPatch.scenePrompt?.trim() || slot.scenePrompt;
        slot.negativePrompt =
          slotPatch.negativePrompt === undefined ? slot.negativePrompt : slotPatch.negativePrompt.trim() || undefined;
        slot.candidateCount =
          slotPatch.candidateCount === undefined
            ? slot.candidateCount
            : clampCandidateCount(slotPatch.candidateCount);
      });

      const model = this.requireRuntimeModel(suite);
      const validation = validateGenerationSuite(suite, model.capabilities.maxReferenceImages);

      if (!validation.isValid) {
        throw new GenerationSuiteServiceError(
          400,
          "SUITE_VALIDATION_FAILED",
          validation.errors[0]?.message ?? "套图参数校验失败",
          validation
        );
      }

      suite.updatedAt = new Date().toISOString();
      suite.progress = calculateGenerationSuiteProgress(suite.slots);
      this.store.save(suite);
      this.emit("suite.updated", suite, undefined, "套图配置已更新");
      return suite;
    });
  }

  async start(id: string, input: StartGenerationSuiteRequest = {}) {
    const suite = this.requireSuite(id);
    const runtimeConfig = this.resolveRuntimeConfig(suite, input);

    ensureRuntimeCredentials(runtimeConfig);
    this.runtimeConfigs.set(id, runtimeConfig);

    const target = await this.withSuiteLock(id, async () => {
      const current = this.requireSuite(id);

      if (current.status === "completed") {
        throw new GenerationSuiteServiceError(409, "SUITE_ALREADY_COMPLETED", "套图已经全部完成");
      }

      if (current.status === "awaiting_anchor") {
        return { suite: current, slotIds: [] as string[] };
      }

      current.lastError = undefined;
      current.startedAt ??= new Date().toISOString();
      current.completedAt = undefined;
      current.cancelledAt = undefined;

      const hasSelectedAnchor = Boolean(
        current.selectedAnchorImageId &&
          current.slots
            .find((slot) => slot.id === current.anchorSlotId)
            ?.images.some((image) => image.id === current.selectedAnchorImageId)
      );
      const eligibleStatuses = new Set(["pending", "failed", "interrupted", "cancelled"]);
      const slotIds = hasSelectedAnchor
        ? current.slots
            .filter((slot) => slot.kind === "scene" && eligibleStatuses.has(slot.status))
            .map((slot) => slot.id)
        : current.slots
            .filter((slot) => slot.id === current.anchorSlotId && eligibleStatuses.has(slot.status))
            .map((slot) => slot.id);

      if (slotIds.length === 0) {
        return { suite: current, slotIds };
      }

      current.status = "queued";
      current.updatedAt = new Date().toISOString();
      this.store.save(current);
      this.emit("suite.started", current, undefined, "套图任务已进入队列");
      return { suite: current, slotIds };
    });

    for (const slotId of target.slotIds) {
      await this.enqueueSlot(id, slotId);
    }

    return this.requireSuite(id);
  }

  async selectAnchor(id: string, input: SelectSuiteAnchorRequest) {
    const suite = this.requireSuite(id);
    const runtimeConfig = this.resolveRuntimeConfig(suite, input);

    ensureRuntimeCredentials(runtimeConfig);
    this.runtimeConfigs.set(id, runtimeConfig);

    const sceneSlotIds = await this.withSuiteLock(id, async () => {
      const current = this.requireSuite(id);
      const anchorSlot = current.slots.find((slot) => slot.id === current.anchorSlotId);

      if (
        current.status !== "awaiting_anchor" ||
        anchorSlot?.status !== "awaiting_selection"
      ) {
        throw new GenerationSuiteServiceError(
          409,
          "SUITE_ANCHOR_NOT_READY",
          "主视觉候选图尚未进入可选择状态"
        );
      }

      const selectedImage = anchorSlot.images.find((image) => image.id === input.imageId);

      if (!selectedImage) {
        throw new GenerationSuiteServiceError(404, "SUITE_ANCHOR_IMAGE_NOT_FOUND", "主视觉候选图不存在");
      }

      anchorSlot.images.forEach((image) => {
        image.selected = image.id === selectedImage.id;
      });
      anchorSlot.selectedImageId = selectedImage.id;
      anchorSlot.status = "completed";
      current.selectedAnchorImageId = selectedImage.id;
      current.status = "generating_scenes";
      current.updatedAt = new Date().toISOString();
      current.progress = calculateGenerationSuiteProgress(current.slots);
      this.store.save(current);
      this.emit("anchor.selected", current, anchorSlot.id, "主视觉锚点已确认");

      return current.slots
        .filter(
          (slot) =>
            slot.kind === "scene" &&
            ["pending", "failed", "interrupted", "cancelled"].includes(slot.status)
        )
        .map((slot) => slot.id);
    });

    for (const slotId of sceneSlotIds) {
      await this.enqueueSlot(id, slotId);
    }

    return this.requireSuite(id);
  }

  async retrySlot(id: string, slotId: string, input: RetryGenerationSuiteSlotRequest = {}) {
    const suite = this.requireSuite(id);
    const slot = suite.slots.find((item) => item.id === slotId);

    if (!slot) {
      throw new GenerationSuiteServiceError(404, "SUITE_SLOT_NOT_FOUND", "场景槽位不存在");
    }

    if (!["failed", "interrupted"].includes(slot.status)) {
      throw new GenerationSuiteServiceError(409, "SUITE_SLOT_NOT_RETRYABLE", "只有失败或中断的场景可以重试");
    }

    if (slot.kind === "scene" && !suite.selectedAnchorImageId) {
      throw new GenerationSuiteServiceError(409, "SUITE_ANCHOR_REQUIRED", "请先确认主视觉锚点");
    }

    const runtimeConfig = this.resolveRuntimeConfig(suite, input);

    ensureRuntimeCredentials(runtimeConfig);
    this.runtimeConfigs.set(id, runtimeConfig);
    await this.enqueueSlot(id, slotId);
    return this.requireSuite(id);
  }

  async cancel(id: string) {
    const suite = await this.withSuiteLock(id, async () => {
      const current = this.requireSuite(id);

      if (current.status === "cancelled") {
        return current;
      }

      if (
        !["queued", "generating_anchor", "awaiting_anchor", "generating_scenes"].includes(
          current.status
        )
      ) {
        throw new GenerationSuiteServiceError(
          409,
          "SUITE_NOT_CANCELLABLE",
          "当前套图任务没有正在运行的生成流程"
        );
      }

      const now = new Date().toISOString();

      current.status = "cancelled";
      current.cancelledAt = now;
      current.updatedAt = now;
      current.slots.forEach((slot) => {
        if (
          ["pending", "queued", "running", "awaiting_selection", "interrupted"].includes(
            slot.status
          )
        ) {
          slot.status = "cancelled";
        }
        slot.attempts.forEach((attempt) => {
          if (attempt.status === "queued" || attempt.status === "running") {
            attempt.status = "cancelled";
            attempt.completedAt = now;
          }
        });
      });
      current.progress = calculateGenerationSuiteProgress(current.slots);
      this.store.save(current);
      this.emit("suite.cancelled", current, undefined, "套图任务已取消");
      return current;
    });

    this.scheduler.cancelSuite(id);
    this.runtimeConfigs.delete(id);
    this.clearTaskGroupsForSuite(id);

    return suite;
  }

  async delete(id: string) {
    this.requireSuite(id);

    if (this.deletingSuites.has(id)) {
      throw new GenerationSuiteServiceError(409, "SUITE_DELETE_IN_PROGRESS", "套图正在删除");
    }

    this.deletingSuites.add(id);
    this.scheduler.cancelSuite(id);
    this.runtimeConfigs.delete(id);

    try {
      await this.scheduler.waitForSuiteIdle(id);
      this.clearTaskGroupsForSuite(id);
      await this.assets.deleteSuiteAssets(id);

      await this.withSuiteLock(id, async () => {
        const suite = this.requireSuite(id);
        const deleted = this.store.delete(id);

        if (!deleted) {
          throw new GenerationSuiteServiceError(404, "SUITE_NOT_FOUND", "套图记录不存在");
        }

        this.emit("suite.deleted", suite, undefined, "套图记录已删除");
      });
    } finally {
      this.clearTaskGroupsForSuite(id);
      this.listeners.delete(id);
      this.deletingSuites.delete(id);
    }
  }

  subscribe(id: string, listener: (event: GenerationSuiteEvent) => void) {
    this.requireSuite(id);
    const listeners = this.listeners.get(id) ?? new Set();
    listeners.add(listener);
    this.listeners.set(id, listeners);

    return () => {
      const current = this.listeners.get(id);
      current?.delete(listener);

      if (current?.size === 0) {
        this.listeners.delete(id);
      }
    };
  }

  private async enqueueSlot(suiteId: string, slotId: string) {
    if (this.deletingSuites.has(suiteId)) {
      return;
    }

    const queued = await this.withSuiteLock(suiteId, async () => {
      if (this.deletingSuites.has(suiteId)) {
        return undefined;
      }

      const suite = this.requireSuite(suiteId);
      const slot = suite.slots.find((item) => item.id === slotId);

      if (!slot) {
        throw new GenerationSuiteServiceError(404, "SUITE_SLOT_NOT_FOUND", "场景槽位不存在");
      }

      if (slot.status === "queued" || slot.status === "running") {
        return undefined;
      }

      const missingCandidateCount = Math.max(0, slot.candidateCount - slot.images.length);

      if (missingCandidateCount === 0) {
        const now = new Date().toISOString();
        const enqueueScenes = resolveSlotFromExistingImages(suite, slot, now);

        suite.updatedAt = now;
        suite.progress = calculateGenerationSuiteProgress(suite.slots);
        this.store.save(suite);

        if (slot.kind === "anchor" && suite.status === "awaiting_anchor") {
          this.emit(
            "anchor.awaiting_selection",
            suite,
            slot.id,
            "已有主视觉候选图，请选择一张作为整套锚点"
          );
        } else {
          this.emit("slot.completed", suite, slot.id, `${slot.title} 已恢复完成状态`);
        }

        if (suite.status === "completed" || suite.status === "partial_success") {
          this.emit("suite.completed", suite, undefined, "套图任务已完成");
        }

        return {
          kind: "resolved" as const,
          enqueueScenes
        };
      }

      const runtimeModel = this.requireRuntimeModel(suite);
      const runtimeConfig = this.requireRuntimeConfig(suite);
      const useResponses =
        runtimeConfig.endpointOverride?.endpointVariant === "responses" ||
        runtimeModel.endpointType === "responses";
      const canBatchCandidates =
        !useResponses && runtimeModel.capabilities.maxOutputs >= missingCandidateCount;
      const taskCount = canBatchCandidates ? 1 : missingCandidateCount;
      const attemptId = crypto.randomUUID();
      const now = new Date().toISOString();
      const nextCandidateIndex =
        slot.images.reduce((max, image) => Math.max(max, image.candidateIndex), -1) + 1;
      const descriptors: QueueTaskDescriptor[] = Array.from({ length: taskCount }, (_, taskIndex) => ({
        taskIndex,
        requestId: crypto.randomUUID(),
        candidateCount: canBatchCandidates ? missingCandidateCount : 1,
        candidateOffset: canBatchCandidates ? nextCandidateIndex : nextCandidateIndex + taskIndex
      }));
      const attempt = {
        id: attemptId,
        attemptNumber: slot.attempts.length + 1,
        status: "queued" as const,
        prompt: compileSuiteSlotPrompt(suite, slot),
        referenceIds: this.collectReferenceIds(suite, slot, runtimeModel.capabilities.maxReferenceImages),
        requestedCandidateCount: missingCandidateCount,
        requestIds: descriptors.map((descriptor) => descriptor.requestId),
        imageIds: [],
        queuedAt: now
      };

      slot.status = "queued";
      slot.attempts.push(attempt);
      suite.status = slot.kind === "anchor" ? "generating_anchor" : "generating_scenes";
      suite.updatedAt = now;
      suite.progress = calculateGenerationSuiteProgress(suite.slots);
      this.store.save(suite);
      this.taskGroups.set(attemptId, {
        suiteId,
        slotId,
        attemptId,
        remaining: taskCount,
        totalDurationMs: 0
      });
      this.emit("slot.queued", suite, slotId, `${slot.title} 已进入生成队列`);

      return {
        kind: "queued" as const,
        perSuiteConcurrency: suite.options.perSuiteConcurrency,
        descriptors,
        attemptId
      };
    });

    if (!queued) {
      return;
    }

    if (queued.kind === "resolved") {
      if (queued.enqueueScenes) {
        await this.enqueuePendingSceneSlots(suiteId);
      }

      return;
    }

    queued.descriptors.forEach((descriptor) => {
      this.scheduler.enqueue({
        id: `${queued.attemptId}:${descriptor.taskIndex}`,
        suiteId,
        perSuiteConcurrency: queued.perSuiteConcurrency,
        run: async (signal) => {
          try {
            await this.runSlotTask(suiteId, slotId, queued.attemptId, descriptor, signal);
          } catch (error) {
            if (!signal.aborted) {
              await this.recordTaskFailure(
                suiteId,
                slotId,
                queued.attemptId,
                toGenerationError(error)
              );
            }
          }
        }
      });
    });
  }

  private async runSlotTask(
    suiteId: string,
    slotId: string,
    attemptId: string,
    descriptor: QueueTaskDescriptor,
    signal: AbortSignal
  ) {
    const snapshot = await this.withSuiteLock(suiteId, async () => {
      if (this.deletingSuites.has(suiteId)) {
        return undefined;
      }

      const suite = this.requireSuite(suiteId);

      if (suite.status === "cancelled") {
        return undefined;
      }

      const slot = suite.slots.find((item) => item.id === slotId);
      const attempt = slot?.attempts.find((item) => item.id === attemptId);

      if (!slot || !attempt) {
        throw new GenerationSuiteServiceError(404, "SUITE_ATTEMPT_NOT_FOUND", "生成尝试记录不存在");
      }

      const now = new Date().toISOString();
      slot.status = "running";
      attempt.status = "running";
      attempt.startedAt ??= now;
      suite.status = slot.kind === "anchor" ? "generating_anchor" : "generating_scenes";
      suite.updatedAt = now;
      suite.progress = calculateGenerationSuiteProgress(suite.slots);
      this.store.save(suite);
      this.emit("slot.started", suite, slotId, `${slot.title} 正在生成`);
      return structuredClone(suite);
    });

    if (!snapshot || signal.aborted) {
      return;
    }

    const slot = snapshot.slots.find((item) => item.id === slotId);

    if (!slot) {
      throw new GenerationSuiteServiceError(404, "SUITE_SLOT_NOT_FOUND", "场景槽位不存在");
    }

    const runtimeConfig = this.requireRuntimeConfig(snapshot);
    const references = await this.materializeReferences(
      snapshot,
      slot,
      this.requireRuntimeModel(snapshot).capabilities.maxReferenceImages
    );
    const execution = await this.executeGeneration(
      {
        requestId: descriptor.requestId,
        modelId: snapshot.modelId,
        modelOverride: runtimeConfig.modelOverride ?? snapshot.modelOverride,
        endpointOverride: runtimeConfig.endpointOverride,
        prompt: compileSuiteSlotPrompt(snapshot, slot),
        negativePrompt: compileSuiteNegativePrompt(snapshot, slot),
        referenceImages: references,
        params: {
          ...snapshot.params,
          count: descriptor.candidateCount
        },
        options: {
          saveToHistory: false,
          storeResultToCloud: false,
          returnRawSummary: false,
          useCustomEndpoint: Boolean(runtimeConfig.endpointOverride?.baseURL)
        },
        clientContext: {
          page: "generation",
          lang: "zh-CN",
          timezone: "Asia/Shanghai",
          source: "consistent-image-suite"
        }
      },
      signal
    );

    if (signal.aborted) {
      return;
    }

    if (!execution.success) {
      throw execution.error;
    }

    const adapterResult = execution.data.result;
    const generatedImages = (adapterResult?.images ?? []).slice(0, descriptor.candidateCount);

    if (generatedImages.length === 0) {
      throw (
        adapterResult?.error ??
        createGenerationError({
          type: "upstream",
          code: "NO_IMAGE",
          title: "未返回图片",
          message: "上游响应中没有可用于套图的图片。",
          retryable: true,
          mayHaveCharged: true
        })
      );
    }

    const partialResultError =
      generatedImages.length < descriptor.candidateCount
        ? createGenerationError({
            type: "upstream",
            code: "PARTIAL_IMAGE_RESULT",
            title: "候选图返回不完整",
            message: `请求 ${descriptor.candidateCount} 张候选图，上游仅返回 ${generatedImages.length} 张。`,
            retryable: true,
            mayHaveCharged: true
          })
        : undefined;
    const persistenceResults = await Promise.allSettled(
      generatedImages.map((image, imageIndex) =>
        this.assets.persistGeneratedImage({
          suiteId,
          slotId,
          attemptId,
          candidateIndex: descriptor.candidateOffset + imageIndex,
          image,
          signal
        })
      )
    );
    const persistedImages = persistenceResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );
    const persistenceFailure = persistenceResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );

    if (persistenceFailure) {
      await this.assets.deleteGeneratedImages(suiteId, persistedImages);
      throw persistenceFailure.reason;
    }

    if (signal.aborted || this.deletingSuites.has(suiteId)) {
      await this.assets.deleteGeneratedImages(suiteId, persistedImages);
      return;
    }

    const recorded = await this.recordTaskSuccess(
      suiteId,
      slotId,
      attemptId,
      persistedImages,
      adapterResult?.durationMs ?? 0,
      partialResultError
    );

    if (!recorded) {
      await this.assets.deleteGeneratedImages(suiteId, persistedImages);
    }
  }

  private async recordTaskSuccess(
    suiteId: string,
    slotId: string,
    attemptId: string,
    images: SuiteImage[],
    durationMs: number,
    partialResultError?: GenerationError
  ): Promise<boolean> {
    const group = this.taskGroups.get(attemptId);

    if (!group) {
      return false;
    }

    group.remaining -= 1;
    group.totalDurationMs += durationMs;
    group.firstError ??= partialResultError;
    const isFinalTask = group.remaining <= 0;
    const outcome = await this.withSuiteLock(suiteId, async () => {
      const suite = this.requireSuite(suiteId);

      if (suite.status === "cancelled") {
        return { suite, enqueueScenes: false, completed: false, recorded: false };
      }

      const slot = suite.slots.find((item) => item.id === slotId);
      const attempt = slot?.attempts.find((item) => item.id === attemptId);

      if (!slot || !attempt) {
        return { suite, enqueueScenes: false, completed: false, recorded: false };
      }

      slot.images.push(...images);
      attempt.imageIds.push(...images.map((image) => image.id));

      if (!isFinalTask) {
        suite.updatedAt = new Date().toISOString();
        suite.progress = calculateGenerationSuiteProgress(suite.slots);
        this.store.save(suite);
        this.emit("suite.updated", suite, slotId, `${slot.title} 已返回部分候选图`);
        return { suite, enqueueScenes: false, completed: false, recorded: true };
      }

      const now = new Date().toISOString();
      const isIncomplete =
        slot.images.length < slot.candidateCount && Boolean(group.firstError);
      attempt.status = isIncomplete ? "failed" : "completed";
      attempt.completedAt = now;
      attempt.durationMs = group.totalDurationMs;
      attempt.error ??= group.firstError;
      let enqueueScenes = false;

      if (slot.kind === "anchor") {
        if (shouldAwaitAnchorSelection(suite)) {
          slot.status = "awaiting_selection";
          suite.status = "awaiting_anchor";
        } else {
          const selected = slot.images.find((image) => image.id === suite.selectedAnchorImageId) ?? slot.images[0];

          if (selected) {
            slot.images.forEach((image) => {
              image.selected = image.id === selected.id;
            });
            slot.selectedImageId = selected.id;
            suite.selectedAnchorImageId = selected.id;
            slot.status = "completed";
            suite.status = "generating_scenes";
            enqueueScenes = true;
          }
        }
      } else if (isIncomplete) {
        slot.status = "failed";
        suite.lastError = group.firstError;
        finalizeSuiteIfResolved(suite, now);
      } else {
        slot.status = "completed";
        const selected = slot.images.find((image) => image.selected) ?? slot.images[0];

        if (selected) {
          selected.selected = true;
          slot.selectedImageId = selected.id;
        }
        finalizeSuiteIfResolved(suite, now);
      }

      suite.updatedAt = now;
      suite.progress = calculateGenerationSuiteProgress(suite.slots);
      this.store.save(suite);

      if (slot.kind === "anchor" && suite.status === "awaiting_anchor") {
        this.emit("anchor.awaiting_selection", suite, slot.id, "请选择一张主视觉作为整套锚点");
      } else if (slot.status === "failed") {
        this.emit("slot.failed", suite, slot.id, `${slot.title} 仅返回部分候选图，可重试补齐`);
      } else {
        this.emit("slot.completed", suite, slot.id, `${slot.title} 生成完成`);
      }

      if (suite.status === "completed" || suite.status === "partial_success") {
        this.emit("suite.completed", suite, undefined, "套图任务已完成");
      }

      return { suite, enqueueScenes, completed: true, recorded: true };
    });

    if (isFinalTask) {
      this.taskGroups.delete(attemptId);
    }

    if (outcome.enqueueScenes) {
      await this.enqueuePendingSceneSlots(suiteId);
    }

    return outcome.recorded;
  }

  private async recordTaskFailure(
    suiteId: string,
    slotId: string,
    attemptId: string,
    error: GenerationError
  ) {
    const group = this.taskGroups.get(attemptId);

    if (!group) {
      return;
    }

    group.remaining -= 1;
    group.firstError ??= error;
    const isFinalTask = group.remaining <= 0;

    await this.withSuiteLock(suiteId, async () => {
      const suite = this.requireSuite(suiteId);

      if (suite.status === "cancelled") {
        return;
      }

      const slot = suite.slots.find((item) => item.id === slotId);
      const attempt = slot?.attempts.find((item) => item.id === attemptId);

      if (!slot || !attempt) {
        return;
      }

      attempt.error ??= error;

      if (!isFinalTask) {
        suite.updatedAt = new Date().toISOString();
        this.store.save(suite);
        return;
      }

      const now = new Date().toISOString();
      attempt.status = "failed";
      attempt.completedAt = now;
      attempt.durationMs = group.totalDurationMs;

      if (slot.images.length > 0) {
        if (slot.kind === "anchor") {
          if (shouldAwaitAnchorSelection(suite)) {
            slot.status = "awaiting_selection";
            suite.status = "awaiting_anchor";
          } else {
            const selected = slot.images[0];

            if (selected) {
              selected.selected = true;
              slot.selectedImageId = selected.id;
              suite.selectedAnchorImageId = selected.id;
              slot.status = "completed";
              suite.status = "generating_scenes";
            }
          }
        } else {
          slot.status = "failed";
          suite.lastError = group.firstError ?? error;
          finalizeSuiteIfResolved(suite, now);
        }
      } else {
        slot.status = "failed";
        suite.lastError = group.firstError ?? error;

        if (slot.kind === "anchor") {
          suite.status = "failed";
        } else {
          finalizeSuiteIfResolved(suite, now);
        }
      }

      suite.updatedAt = now;
      suite.progress = calculateGenerationSuiteProgress(suite.slots);
      this.store.save(suite);

      if (slot.kind === "anchor" && suite.status === "awaiting_anchor") {
        this.emit("anchor.awaiting_selection", suite, slot.id, "部分候选生成成功，请选择一张主视觉作为整套锚点");
      } else if (slot.status === "completed") {
        this.emit("slot.completed", suite, slot.id, `${slot.title} 已返回可用候选图`);
      } else {
        this.emit("slot.failed", suite, slot.id, `${slot.title} 生成失败`);
      }
    });

    if (isFinalTask) {
      const suite = this.requireSuite(suiteId);
      const slot = suite.slots.find((item) => item.id === slotId);
      this.taskGroups.delete(attemptId);

      if (slot?.kind === "anchor" && slot.status === "completed" && suite.selectedAnchorImageId) {
        await this.enqueuePendingSceneSlots(suiteId);
      }
    }
  }

  private async enqueuePendingSceneSlots(suiteId: string) {
    const suite = this.requireSuite(suiteId);
    const slotIds = suite.slots
      .filter(
        (slot) =>
          slot.kind === "scene" &&
          ["pending", "failed", "interrupted", "cancelled"].includes(slot.status)
      )
      .map((slot) => slot.id);

    for (const slotId of slotIds) {
      await this.enqueueSlot(suiteId, slotId);
    }
  }

  private clearTaskGroupsForSuite(suiteId: string) {
    for (const [attemptId, group] of this.taskGroups) {
      if (group.suiteId === suiteId) {
        this.taskGroups.delete(attemptId);
      }
    }
  }

  private collectReferenceIds(suite: GenerationSet, slot: GenerationSlot, maxReferences: number) {
    return selectReferencesForSlot(suite, slot, maxReferences).map((item) => item.id);
  }

  private async materializeReferences(
    suite: GenerationSet,
    slot: GenerationSlot,
    maxReferences: number
  ): Promise<GenerationReferenceInput[]> {
    const selected = selectReferencesForSlot(suite, slot, maxReferences);
    const materialized = await Promise.all(
      selected.map((item, index) =>
        item.type === "anchor"
          ? this.assets.materializeSuiteImage(item.image, index)
          : this.assets.materializeReference(item.reference)
      )
    );

    return materialized.map((reference, index) => ({
      ...reference,
      order: index
    }));
  }

  private requireRuntimeModel(suite: GenerationSet): ModelConfig {
    const model = getModelById(suite.modelId);

    if (!model || !model.enabled) {
      throw new GenerationSuiteServiceError(400, "MODEL_NOT_FOUND", "套图所用模型已不可用");
    }

    const runtimeConfig = this.runtimeConfigs.get(suite.id);
    return applyModelRequestOverride(model, runtimeConfig?.modelOverride ?? suite.modelOverride);
  }

  private requireRuntimeConfig(suite: GenerationSet) {
    const config = this.runtimeConfigs.get(suite.id);

    if (!config) {
      throw new GenerationSuiteServiceError(
        409,
        "SUITE_RUNTIME_CONFIG_REQUIRED",
        "服务重启后需要重新提交 API 运行配置"
      );
    }

    return config;
  }

  private resolveRuntimeConfig(
    suite: GenerationSet,
    input: StartGenerationSuiteRequest | SelectSuiteAnchorRequest | RetryGenerationSuiteSlotRequest
  ): RuntimeGenerationConfig {
    const previous = this.runtimeConfigs.get(suite.id);

    return {
      endpointOverride: {
        ...suite.endpointOverride,
        ...previous?.endpointOverride,
        ...input.endpointOverride,
        headers: {
          ...previous?.endpointOverride?.headers,
          ...input.endpointOverride?.headers
        }
      },
      modelOverride: input.modelOverride ?? previous?.modelOverride ?? suite.modelOverride
    };
  }

  private requireSuite(id: string) {
    const suite = this.store.get(id);

    if (!suite) {
      throw new GenerationSuiteServiceError(404, "SUITE_NOT_FOUND", "套图记录不存在");
    }

    return suite;
  }

  private emit(
    type: GenerationSuiteEventType,
    suite: GenerationSet,
    slotId?: string,
    message?: string
  ) {
    const listeners = this.listeners.get(suite.id);

    if (!listeners?.size) {
      return;
    }

    const event: GenerationSuiteEvent = {
      id: crypto.randomUUID(),
      suiteId: suite.id,
      type,
      occurredAt: new Date().toISOString(),
      slotId,
      suite: structuredClone(suite),
      message
    };
    listeners.forEach((listener) => {
      try {
        listener(event);
      } catch {
        listeners.delete(listener);
      }
    });
  }

  private async withSuiteLock<T>(suiteId: string, work: () => Promise<T> | T): Promise<T> {
    const previous = this.lockTails.get(suiteId) ?? Promise.resolve();
    const run = previous.then(work, work);
    const tail = run.then(
      () => undefined,
      () => undefined
    );

    this.lockTails.set(suiteId, tail);

    try {
      return await run;
    } finally {
      if (this.lockTails.get(suiteId) === tail) {
        this.lockTails.delete(suiteId);
      }
    }
  }
}

type OrderedSuiteReference =
  | { id: string; type: "reference"; role: SuiteReference["role"]; reference: SuiteReference }
  | { id: string; type: "anchor"; role: "anchor"; image: SuiteImage };

export function selectReferencesForSlot(
  suite: GenerationSet,
  slot: GenerationSlot,
  maxReferences: number
): OrderedSuiteReference[] {
  const priorities: Record<SuiteReference["role"], number> = {
    subject: 0,
    style: 1,
    logo: 2,
    composition: 3,
    background: 4
  };
  const references: OrderedSuiteReference[] = suite.references.map((reference) => ({
    id: reference.id,
    type: "reference",
    role: reference.role,
    reference
  }));
  references.sort((left, right) => {
    if (left.type !== "reference" || right.type !== "reference") {
      return 0;
    }

    return priorities[left.role] - priorities[right.role] || left.reference.order - right.reference.order;
  });

  const limit = Math.max(
    0,
    Math.min(Math.floor(maxReferences), SUITE_GENERATION_LIMITS.maxReferences)
  );

  if (limit === 0 || slot.kind !== "scene" || !suite.selectedAnchorImageId) {
    return references.slice(0, limit);
  }

  const anchorSlot = suite.slots.find((item) => item.id === suite.anchorSlotId);
  const anchorImage = anchorSlot?.images.find((image) => image.id === suite.selectedAnchorImageId);

  if (!anchorImage) {
    return references.slice(0, limit);
  }

  return [
    {
      id: anchorImage.id,
      type: "anchor",
      role: "anchor",
      image: anchorImage
    },
    ...references.slice(0, Math.max(0, limit - 1))
  ];
}

function shouldAwaitAnchorSelection(suite: GenerationSet) {
  return suite.options.requireAnchorConfirmation || !suite.options.autoSelectFirstAnchor;
}

function resolveSlotFromExistingImages(
  suite: GenerationSet,
  slot: GenerationSlot,
  now: string
) {
  if (slot.kind === "anchor") {
    if (shouldAwaitAnchorSelection(suite)) {
      slot.status = "awaiting_selection";
      suite.status = "awaiting_anchor";
      return false;
    }

    const selected =
      slot.images.find((image) => image.id === suite.selectedAnchorImageId) ??
      slot.images.find((image) => image.selected) ??
      slot.images[0];

    if (selected) {
      slot.images.forEach((image) => {
        image.selected = image.id === selected.id;
      });
      slot.selectedImageId = selected.id;
      suite.selectedAnchorImageId = selected.id;
    }

    slot.status = "completed";
    suite.status = "generating_scenes";
    return true;
  }

  const selected =
    slot.images.find((image) => image.id === slot.selectedImageId) ??
    slot.images.find((image) => image.selected) ??
    slot.images[0];

  if (selected) {
    slot.images.forEach((image) => {
      image.selected = image.id === selected.id;
    });
    slot.selectedImageId = selected.id;
  }

  slot.status = "completed";
  finalizeSuiteIfResolved(suite, now);
  return false;
}

function finalizeSuiteIfResolved(suite: GenerationSet, now: string) {
  const sceneSlots = suite.slots.filter((slot) => slot.kind === "scene");
  const unresolved = sceneSlots.some((slot) =>
    ["pending", "queued", "running", "interrupted"].includes(slot.status)
  );

  if (unresolved) {
    suite.status = "generating_scenes";
    return;
  }

  const completedCount = sceneSlots.filter((slot) => slot.status === "completed").length;
  const failedCount = sceneSlots.filter((slot) => slot.status === "failed").length;

  if (failedCount === 0 && completedCount === sceneSlots.length) {
    suite.status = "completed";
  } else if (completedCount > 0) {
    suite.status = "partial_success";
  } else {
    suite.status = "failed";
  }

  suite.completedAt = now;
}

function sanitizeEndpointOverride(input?: EndpointOverride): GenerationSet["endpointOverride"] {
  if (!input) {
    return undefined;
  }

  const sanitized: NonNullable<GenerationSet["endpointOverride"]> = {
    baseURL: sanitizeEndpointURL(input.baseURL),
    editURL: sanitizeEndpointURL(input.editURL),
    endpointVariant: input.endpointVariant
  };

  return sanitized.baseURL || sanitized.editURL || sanitized.endpointVariant
    ? sanitized
    : undefined;
}

function isSensitiveHeader(name: string) {
  const normalized = name.trim().toLowerCase().replaceAll("_", "-");

  if (
    [
      "authorization",
      "proxy-authorization",
      "cookie",
      "set-cookie",
      "api-key",
      "apikey",
      "token",
      "secret",
      "password"
    ].includes(normalized)
  ) {
    return true;
  }

  if (
    normalized.endsWith("-authorization") ||
    normalized.endsWith("-token") ||
    normalized.endsWith("-secret") ||
    normalized.endsWith("-password")
  ) {
    return true;
  }

  return [
    "api-key",
    "apikey",
    "auth-token",
    "access-token",
    "client-secret",
    "credential",
    "private-key",
    "subscription-key"
  ].some((marker) => normalized.includes(marker));
}

function sanitizeEndpointURL(value?: string) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = new URL(trimmed);
    parsed.username = "";
    parsed.password = "";

    for (const name of [...parsed.searchParams.keys()]) {
      if (isSensitiveURLParameter(name)) {
        parsed.searchParams.delete(name);
      }
    }

    return parsed.toString();
  } catch {
    return trimmed.replace(/([?&](?:api[_-]?key|token|secret|password|signature|sig|code)=)[^&#]*/gi, "$1[redacted]");
  }
}

function isSensitiveURLParameter(name: string) {
  const normalized = name.trim().toLowerCase().replaceAll("_", "-");

  return (
    ["key", "token", "secret", "password", "signature", "sig", "code"].includes(normalized) ||
    isSensitiveHeader(normalized)
  );
}

function ensureRuntimeCredentials(config: RuntimeGenerationConfig) {
  const hasApiKey = Boolean(config.endpointOverride?.apiKey?.trim());
  const hasCredentialHeader = Object.values(config.endpointOverride?.headers ?? {}).some(
    (value) => Boolean(value.trim())
  );

  if (!hasApiKey && !hasCredentialHeader) {
    throw new GenerationSuiteServiceError(400, "API_KEY_REQUIRED", "请先在设置中配置 API Key");
  }
}

function validateCreateRequestShape(input: CreateGenerationSuiteRequest) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new GenerationSuiteServiceError(
      400,
      "SUITE_REQUEST_INVALID",
      "套图创建请求必须是 JSON 对象"
    );
  }

  if (input.referenceImages !== undefined && !Array.isArray(input.referenceImages)) {
    throw new GenerationSuiteServiceError(
      400,
      "SUITE_REFERENCE_IMAGES_INVALID",
      "referenceImages 必须是数组"
    );
  }

  input.referenceImages?.forEach((reference, index) => {
    if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
      throw new GenerationSuiteServiceError(
        400,
        "SUITE_REFERENCE_INVALID",
        `第 ${index + 1} 张参考图配置无效`,
        { field: `referenceImages[${index}]` }
      );
    }

    if (!isSuiteReferenceRole(reference.role)) {
      throw new GenerationSuiteServiceError(
        400,
        "SUITE_REFERENCE_ROLE_INVALID",
        `第 ${index + 1} 张参考图的角色无效`,
        { field: `referenceImages[${index}].role` }
      );
    }
  });

  if (input.slots !== undefined && !Array.isArray(input.slots)) {
    throw new GenerationSuiteServiceError(
      400,
      "SUITE_SLOTS_INVALID",
      "slots 必须是数组"
    );
  }

  input.slots?.forEach((slot, index) => {
    if (!slot || typeof slot !== "object" || Array.isArray(slot)) {
      throw new GenerationSuiteServiceError(
        400,
        "SUITE_SLOT_INVALID",
        `第 ${index + 1} 个场景配置无效`,
        { field: `slots[${index}]` }
      );
    }

    if (slot.kind !== undefined && !isGenerationSlotKind(slot.kind)) {
      throw new GenerationSuiteServiceError(
        400,
        "SUITE_SLOT_KIND_INVALID",
        `第 ${index + 1} 个场景的类型无效`,
        { field: `slots[${index}].kind` }
      );
    }
  });
}

function clampCandidateCount(value: number) {
  const parsed = Number.isFinite(value) ? Math.floor(value) : SUITE_GENERATION_LIMITS.minCandidatesPerSlot;
  return Math.min(
    Math.max(parsed, SUITE_GENERATION_LIMITS.minCandidatesPerSlot),
    SUITE_GENERATION_LIMITS.maxCandidatesPerSlot
  );
}

function clampPerSuiteConcurrency(value: number) {
  const parsed = Number.isFinite(value) ? Math.floor(value) : SUITE_GENERATION_LIMITS.defaultPerSuiteConcurrency;
  return Math.min(Math.max(parsed, 1), SUITE_GENERATION_LIMITS.maxPerSuiteConcurrency);
}

function toGenerationError(error: unknown): GenerationError {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "title" in error &&
    "message" in error
  ) {
    return error as GenerationError;
  }

  if (error instanceof GenerationSuiteServiceError) {
    return createGenerationError({
      type: "validation",
      code: error.code,
      title: "套图任务执行失败",
      message: error.message,
      retryable: error.statusCode >= 500 || error.statusCode === 409,
      statusCode: error.statusCode
    });
  }

  if (error instanceof GenerationSuiteAssetError) {
    return createGenerationError({
      type: "storage",
      code: error.code,
      title: "套图素材保存失败",
      message: error.message,
      suggestion: "请检查远程图片域名与归档配置，或改用本地上传的图片后重试。",
      retryable: true
    });
  }

  return createGenerationError({
    type: "unknown",
    code: "SUITE_TASK_FAILED",
    title: "套图任务执行失败",
    message: error instanceof Error ? error.message : "套图任务执行失败",
    retryable: true
  });
}
