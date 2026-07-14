import { getModelById } from "../../src/config/models";
import type {
  AnswerEditClarificationRequest,
  CheckoutEditVersionRequest,
  BatchCleanupEditVersionsRequest,
  CreateEditApprovalRequest,
  CreateEditBranchRequest,
  CreateEditBrandAssetRequest,
  CreateEditCommentRequest,
  CreateEditInstructionTemplateRequest,
  CreateEditShareLinkRequest,
  CreateEditSessionRequest,
  CreateEditTurnRequest,
  EditAuditAction,
  EditBranch,
  EditBrandAsset,
  EditInstructionAnalysis,
  EditJob,
  EditJobStatus,
  EditMessage,
  EditPlatformMetrics,
  EditPlatformSnapshot,
  EditQualityAssessment,
  EditSession,
  EditSessionEvent,
  EditSessionEventType,
  EditTurn,
  EditWorkspace,
  EndpointOverride,
  GenerationError,
  GenerationParams,
  MergeEditVersionRegionRequest,
  ModelConfig,
  ModelRequestOverride,
  RetryEditJobRequest,
  UpdateEditCommentRequest,
  UpdateEditBranchRequest,
  UpdateEditInstructionTemplateRequest,
  UpdateEditSessionRequest,
  UpdateEditShareLinkRequest,
  UpdateEditVersionRequest,
  UpdateEditWorkflowRequest,
  UpdateEditWorkspaceRequest,
  UpsertEditWorkspaceMemberRequest,
  UsageInfo
} from "../../src/domain";
import { IMAGE_EDIT_LIMITS } from "../../src/domain/image-editing";
import { createGenerationError } from "../../src/services/error-service";
import { estimateGenerationCost } from "../../src/services/generation-form-service";
import { applyModelRequestOverride } from "../../src/services/model-settings-service";
import { GenerationSuiteScheduler } from "../suite/suite-scheduler";
import { resolveEditInstructionAnalysis } from "./edit-analyzer";
import { EditAssetStore } from "./edit-assets";
import {
  buildContinuationCompatibilityKey,
  EditExecutor,
  type EditExecutionResult
} from "./edit-executor";
import {
  DEFAULT_WORKSPACE_ID,
  EditSessionStore,
  LEGACY_EDIT_OWNER_ID
} from "./edit-store";
import type { EditVisitor } from "./edit-visitor";

type RuntimeEditConfig = {
  endpointOverride?: EndpointOverride;
  modelOverride?: ModelRequestOverride;
};

const BLOCKING_TURN_STATUSES = new Set<EditTurn["status"]>([
  "analyzing",
  "awaiting_clarification",
  "running",
  "persisting"
]);

const RETRYABLE_JOB_STATUSES = new Set<EditJobStatus>([
  "failed",
  "interrupted",
  "canceled"
]);

export class EditSessionServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "EditSessionServiceError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class EditSessionService {
  readonly store: EditSessionStore;
  readonly assets: EditAssetStore;
  readonly scheduler: GenerationSuiteScheduler;

  private readonly executor: EditExecutor;
  private readonly runtimeConfigs = new Map<string, RuntimeEditConfig>();
  private readonly listeners = new Map<string, Set<(event: EditSessionEvent) => void>>();
  private readonly lockTails = new Map<string, Promise<void>>();
  private readonly deletingSessions = new Set<string>();

  constructor(input: {
    store: EditSessionStore;
    assets: EditAssetStore;
    scheduler?: GenerationSuiteScheduler;
    executor?: EditExecutor;
  }) {
    this.store = input.store;
    this.assets = input.assets;
    this.scheduler = input.scheduler ?? new GenerationSuiteScheduler(4);
    this.executor = input.executor ?? new EditExecutor({ assets: input.assets });
    this.store.markInFlightInterrupted();
  }

  list(limit = 50, ownerId = LEGACY_EDIT_OWNER_ID) {
    return this.store.list(limit, ownerId);
  }

  get(id: string, ownerId = LEGACY_EDIT_OWNER_ID) {
    return this.requireSession(id, ownerId);
  }

  async create(
    input: CreateEditSessionRequest,
    visitor: EditVisitor = legacyEditVisitor()
  ) {
    validateCreateSessionRequest(input);
    const model = requireImageEditModel(input.modelId);
    const sessionId = crypto.randomUUID();
    let sourceAsset;

    try {
      sourceAsset = await this.assets.persistInput({
        sessionId,
        kind: "source",
        image: input.source
      });
    } catch (error) {
      await this.assets.deleteSessionAssets(sessionId);
      throw new EditSessionServiceError(
        400,
        "EDIT_SOURCE_PERSIST_FAILED",
        error instanceof Error ? error.message : "源图片保存失败"
      );
    }

    const now = new Date().toISOString();
    const rootVersionId = crypto.randomUUID();
    const mainBranchId = crypto.randomUUID();
    const session: EditSession = {
      schemaVersion: 2,
      id: sessionId,
      workspaceId: visitor.workspaceId,
      title: input.title?.trim() || stripExtension(sourceAsset.name) || `修图会话 ${now.slice(0, 10)}`,
      status: "active",
      defaultModelId: model.id,
      currentVersionId: rootVersionId,
      currentBranchId: mainBranchId,
      branches: [
        {
          id: mainBranchId,
          sessionId,
          name: "主分支",
          headVersionId: rootVersionId,
          baseVersionId: rootVersionId,
          createdAt: now,
          updatedAt: now
        }
      ],
      turns: [],
      messages: [
        {
          id: crypto.randomUUID(),
          sessionId,
          role: "system",
          kind: "progress",
          text: "源图片已保存。可以进行整图、局部或双版本合并编辑。",
          createdAt: now
        }
      ],
      versions: [
        {
          id: rootVersionId,
          sessionId,
          assetId: sourceAsset.id,
          parentVersionIds: [],
          candidateIndex: 0,
          label: "原始图片",
          modelId: model.id,
          tags: [],
          favorite: false,
          reviewState: "draft",
          width: sourceAsset.width,
          height: sourceAsset.height,
          createdAt: now
        }
      ],
      jobs: [],
      assets: [sourceAsset],
      continuations: [],
      protectedPresets: [],
      comments: [],
      approvals: [],
      shareLinks: [],
      auditLog: [],
      workflow: {
        state: "draft"
      },
      createdAt: now,
      updatedAt: now
    };
    appendAudit(session, "session.created", "创建修图会话", {
      actorId: visitor.ownerId
    });

    this.store.save(session, visitor.ownerId);
    this.emit("session.updated", session);
    return session;
  }

  async update(id: string, input: UpdateEditSessionRequest) {
    return this.withSessionLock(id, () => {
      const session = this.requireSession(id);
      const changes: string[] = [];

      if (input.title !== undefined) {
        const title = input.title.trim();

        if (!title) {
          throw new EditSessionServiceError(400, "EDIT_TITLE_REQUIRED", "会话名称不能为空");
        }

        session.title = title;
        changes.push("title");
      }

      if (input.defaultModelId !== undefined) {
        session.defaultModelId = requireImageEditModel(input.defaultModelId).id;
        changes.push("defaultModelId");
      }

      if (input.archived !== undefined) {
        session.status = input.archived ? "archived" : "active";
        session.archivedAt = input.archived ? new Date().toISOString() : undefined;
        changes.push(input.archived ? "archived" : "restored");
      }

      if (changes.length > 0) {
        appendAudit(
          session,
          "session.updated",
          input.archived === true
            ? "归档修图会话"
            : input.archived === false
              ? "恢复修图会话"
              : "更新修图会话",
          {
            actorId: "local-owner",
            targetId: session.id,
            metadata: { changes }
          }
        );
      }

      session.updatedAt = new Date().toISOString();
      this.store.save(session);
      this.emit("session.updated", session);
      return session;
    });
  }

  async createTurn(id: string, input: CreateEditTurnRequest) {
    validateCreateTurnRequest(input);
    const session = this.requireSession(id);
    const existing = session.turns.find((turn) => turn.clientTurnId === input.clientTurnId);

    if (existing) {
      return session;
    }

    const model = requireImageEditModel(input.modelId, input.modelOverride);
    validateTurnModelCapabilities(input, model);
    const candidateCount = clampCandidateCount(
      input.candidateCount,
      model.editCapabilities.maxCandidates
    );
    ensureWorkspaceQuota(
      this.store,
      candidateCount,
      session.workspaceId ?? DEFAULT_WORKSPACE_ID
    );
    const analysis = resolveEditInstructionAnalysis({
      instruction: input.originalInstruction,
      mode: input.mode,
      regions: input.regions,
      supplied: input.analysis
    });

    if (analysis.action === "execute") {
      ensureRuntimeCredentials({
        endpointOverride: input.endpointOverride,
        modelOverride: input.modelOverride
      });
    }

    const persistedRegions: Array<{
      region: EditTurn["regions"][number];
      maskAsset: EditSession["assets"][number];
    }> = [];

    try {
      for (const region of input.regions ?? []) {
        const maskAsset = await this.assets.persistInput({
          sessionId: id,
          kind: "mask",
          image: region.mask
        });

        persistedRegions.push({
          region: {
            id: region.id || crypto.randomUUID(),
            label: region.label.trim() || "未命名区域",
            color: region.color || "#22d3ee",
            instruction: region.instruction.trim(),
            maskAssetId: maskAsset.id,
            selectionMethod: region.selectionMethod ?? "brush",
            combinationMode: region.combinationMode ?? "add",
            maskSemantics: region.maskSemantics,
            priority: clampInteger(region.priority, 0, IMAGE_EDIT_LIMITS.maxRegions - 1, persistedRegions.length),
            featherRadius: clampInteger(region.featherRadius, 0, 256, 0),
            expansionPixels: clampInteger(region.expansionPixels, -256, 256, 0),
            inverted: Boolean(region.inverted),
            semanticTarget: region.semanticTarget?.trim() || undefined,
            bounds: region.bounds
          },
          maskAsset
        });
      }
    } catch (error) {
      await rollbackAssets(this.assets, id, persistedRegions.map((item) => item.maskAsset));
      throw new EditSessionServiceError(
        400,
        "EDIT_MASK_PERSIST_FAILED",
        error instanceof Error ? error.message : "局部蒙版保存失败"
      );
    }

    let created: { session: EditSession; turnId?: string };

    try {
      created = await this.withSessionLock(id, () => {
        const current = this.requireSession(id);

        if (current.status !== "active") {
          throw new EditSessionServiceError(409, "EDIT_SESSION_NOT_ACTIVE", "请先恢复已归档的修图会话");
        }

        if (current.turns.some((turn) => turn.clientTurnId === input.clientTurnId)) {
          return { session: current, turnId: undefined };
        }

        const branch = current.branches.find(
          (item) => item.id === input.branchId && !item.archivedAt
        );

        if (!branch) {
          throw new EditSessionServiceError(404, "EDIT_BRANCH_NOT_FOUND", "编辑分支不存在或已归档");
        }

        validateSourceVersions(current, input.sourceVersionIds, input.mode);

        const now = new Date().toISOString();
        const turnId = crypto.randomUUID();
        const turn: EditTurn = {
          id: turnId,
          clientTurnId: input.clientTurnId,
          sessionId: id,
          branchId: branch.id,
          sourceVersionIds: [...input.sourceVersionIds],
          mode: input.mode,
          status: analysis.action === "clarify" ? "awaiting_clarification" : "queued",
          modelId: model.id,
          modelDisplayName: input.modelDisplayName?.trim() || model.displayName,
          modelOverride: input.modelOverride,
          endpointOverride: sanitizeEndpointOverride(input.endpointOverride),
          params: {
            ...input.params,
            count: 1
          },
          candidateCount,
          originalInstruction: input.originalInstruction.trim(),
          polishedInstruction: analysis.polishedInstruction,
          analysis,
          regions: persistedRegions.map((item) => item.region),
          jobIds: [],
          continuationStrategy: model.editCapabilities.continuationMode,
          continuationCompatibilityKey: buildContinuationCompatibilityKey(
            model,
            input.endpointOverride
          ),
          costEstimate: buildEditCostEstimate(model, input.params, candidateCount),
          createdAt: now,
          updatedAt: now
        };

        current.assets.push(...persistedRegions.map((item) => item.maskAsset));
        current.protectedPresets = uniqueStrings([
          ...(current.protectedPresets ?? []),
          ...(input.protectedPresets ?? [])
        ]) as EditSession["protectedPresets"];
        current.turns.push(turn);
        appendAudit(current, "turn.created", `创建第 ${current.turns.length} 轮修图`, {
          actorId: "local-owner",
          targetId: turnId,
          metadata: {
            mode: turn.mode,
            candidateCount: turn.candidateCount
          }
        });
        current.messages.push(
          createMessage({
            sessionId: id,
            turnId,
            role: "user",
            kind: "instruction",
            text: turn.originalInstruction,
            originalText: turn.originalInstruction,
            polishedText: turn.polishedInstruction
          })
        );

        if (analysis.action === "clarify") {
          current.messages.push(
            createMessage({
              sessionId: id,
              turnId,
              role: "assistant",
              kind: "clarification",
              text:
                analysis.clarificationQuestion ??
                "请补充修改对象、目标效果和必须保持不变的内容。"
            })
          );
        } else {
          createCandidateJobs(current, turn);
          current.messages.push(
            createMessage({
              sessionId: id,
              turnId,
              role: "assistant",
              kind: "progress",
              text: `指令已润色，${turn.candidateCount} 个候选任务已进入队列。`,
              originalText: turn.originalInstruction,
              polishedText: turn.polishedInstruction
            })
          );
        }

        current.updatedAt = now;
        this.store.save(current);
        this.emit("turn.updated", current, { turnId });
        return { session: current, turnId };
      });
    } catch (error) {
      await rollbackAssets(this.assets, id, persistedRegions.map((item) => item.maskAsset));
      throw error;
    }

    if (!created.turnId && persistedRegions.length > 0) {
      await rollbackAssets(this.assets, id, persistedRegions.map((item) => item.maskAsset));
    }

    if (created.turnId && analysis.action === "execute") {
      this.runtimeConfigs.set(created.turnId, {
        endpointOverride: input.endpointOverride,
        modelOverride: input.modelOverride
      });
      await this.startNextTurn(id);
    }

    return this.requireSession(id);
  }

  async answerClarification(
    id: string,
    turnId: string,
    input: AnswerEditClarificationRequest
  ) {
    if (!input.answer?.trim()) {
      throw new EditSessionServiceError(400, "EDIT_CLARIFICATION_ANSWER_REQUIRED", "请填写补充说明");
    }

    const prepared = await this.withSessionLock(id, () => {
      const session = this.requireSession(id);
      const turn = requireTurn(session, turnId);

      if (turn.status !== "awaiting_clarification") {
        throw new EditSessionServiceError(
          409,
          "EDIT_TURN_NOT_AWAITING_CLARIFICATION",
          "当前编辑轮次不需要补充说明"
        );
      }

      const combinedInstruction = `${turn.originalInstruction}\n补充说明：${input.answer.trim()}`;
      const analysis = resolveEditInstructionAnalysis({
        instruction: combinedInstruction,
        mode: turn.mode,
        regions: turn.regions,
        supplied: input.analysis
      });
      const now = new Date().toISOString();

      session.messages.push(
        createMessage({
          sessionId: id,
          turnId,
          role: "user",
          kind: "clarification_answer",
          text: input.answer.trim()
        })
      );
      turn.analysis = analysis;
      turn.polishedInstruction = analysis.polishedInstruction;
      turn.updatedAt = now;

      if (analysis.action === "clarify") {
        session.messages.push(
          createMessage({
            sessionId: id,
            turnId,
            role: "assistant",
            kind: "clarification",
            text:
              analysis.clarificationQuestion ??
              "信息仍不够明确，请继续补充具体位置、目标效果和保留约束。"
          })
        );
      } else {
        const runtimeConfig = resolveRuntimeConfig(
          this.runtimeConfigs.get(turnId),
          input
        );
        ensureRuntimeCredentials(runtimeConfig);
        this.runtimeConfigs.set(turnId, runtimeConfig);
        turn.status = "queued";
        createCandidateJobs(session, turn);
        session.messages.push(
          createMessage({
            sessionId: id,
            turnId,
            role: "assistant",
            kind: "progress",
            text: `补充说明已合并，${turn.candidateCount} 个候选任务已进入队列。`,
            originalText: turn.originalInstruction,
            polishedText: turn.polishedInstruction
          })
        );
      }

      session.updatedAt = now;
      this.store.save(session);
      this.emit("turn.updated", session, { turnId });
      return { analysis };
    });

    if (prepared.analysis.action === "execute") {
      await this.startNextTurn(id);
    }

    return this.requireSession(id);
  }

  async retryJob(id: string, jobId: string, input: RetryEditJobRequest = {}) {
    const turnId = await this.withSessionLock(id, () => {
      const session = this.requireSession(id);
      const job = requireJob(session, jobId);
      const turn = requireTurn(session, job.turnId);

      if (!RETRYABLE_JOB_STATUSES.has(job.status)) {
        throw new EditSessionServiceError(
          409,
          "EDIT_JOB_NOT_RETRYABLE",
          "只有失败、中断或取消的候选任务可以重试"
        );
      }

      const runtimeConfig = resolveRuntimeConfig(
        this.runtimeConfigs.get(turn.id),
        input
      );
      ensureRuntimeCredentials(runtimeConfig);
      this.runtimeConfigs.set(turn.id, runtimeConfig);

      const now = new Date().toISOString();
      job.status = "queued";
      job.error = undefined;
      job.updatedAt = now;
      turn.status = "queued";
      turn.error = undefined;
      turn.completedAt = undefined;
      turn.canceledAt = undefined;
      turn.updatedAt = now;
      session.updatedAt = now;
      session.messages.push(
        createMessage({
          sessionId: id,
          turnId: turn.id,
          role: "assistant",
          kind: "progress",
          text: `候选 ${job.candidateIndex + 1} 已重新加入队列。`
        })
      );
      this.store.save(session);
      this.emit("job.updated", session, { turnId: turn.id, jobId });
      return turn.id;
    });

    await this.startNextTurn(id);
    return this.requireSession(id);
  }

  async cancelTurn(id: string, turnId: string) {
    await this.withSessionLock(id, () => {
      const current = this.requireSession(id);
      const turn = requireTurn(current, turnId);

      if (!["queued", "running", "persisting", "awaiting_clarification"].includes(turn.status)) {
        throw new EditSessionServiceError(
          409,
          "EDIT_TURN_NOT_CANCELLABLE",
          "当前编辑轮次没有可取消的任务"
        );
      }

      const now = new Date().toISOString();
      turn.status = "canceled";
      turn.canceledAt = now;
      turn.completedAt = now;
      turn.updatedAt = now;
      current.jobs
        .filter((job) => job.turnId === turn.id)
        .forEach((job) => {
          if (["queued", "running", "persisting"].includes(job.status)) {
            job.status = "canceled";
            job.updatedAt = now;
          }
          job.attempts.forEach((attempt) => {
            if (["queued", "running", "persisting"].includes(attempt.status)) {
              attempt.status = "canceled";
              attempt.completedAt = now;
            }
          });
        });
      current.messages.push(
        createMessage({
          sessionId: id,
          turnId,
          role: "assistant",
          kind: "progress",
          text: "当前编辑轮次已取消。"
        })
      );
      current.updatedAt = now;
      this.store.save(current);
      this.emit("turn.updated", current, { turnId });
      return current;
    });

    this.scheduler.cancelSuite(id);
    await this.scheduler.waitForSuiteIdle(id);
    this.runtimeConfigs.delete(turnId);
    await this.startNextTurn(id);
    return this.requireSession(id);
  }

  async checkoutVersion(
    id: string,
    versionId: string,
    input: CheckoutEditVersionRequest = {}
  ) {
    return this.withSessionLock(id, () => {
      const session = this.requireSession(id);
      const version = requireVersion(session, versionId);
      const now = new Date().toISOString();
      let branch: EditBranch;

      if (input.createBranch) {
        branch = createBranchRecord(session, {
          fromVersionId: version.id,
          name: input.branchName
        });
        session.branches.push(branch);
      } else {
        branch =
          session.branches.find(
            (item) => item.id === (input.branchId ?? session.currentBranchId) && !item.archivedAt
          ) ??
          (() => {
            throw new EditSessionServiceError(
              404,
              "EDIT_BRANCH_NOT_FOUND",
              "目标分支不存在或已归档"
            );
          })();
        branch.headVersionId = version.id;
        branch.updatedAt = now;
      }

      session.currentBranchId = branch.id;
      session.currentVersionId = version.id;
      const turn = version.turnId
        ? session.turns.find((item) => item.id === version.turnId)
        : undefined;

      if (turn) {
        turn.selectedVersionId = version.id;
        turn.updatedAt = now;
      }

      session.updatedAt = now;
      this.store.save(session);
      this.emit("session.updated", session, { versionId: version.id });
      return session;
    });
  }

  async createBranch(id: string, input: CreateEditBranchRequest) {
    return this.withSessionLock(id, () => {
      const session = this.requireSession(id);
      requireVersion(session, input.fromVersionId);

      if (session.branches.length >= IMAGE_EDIT_LIMITS.maxBranches) {
        throw new EditSessionServiceError(
          409,
          "EDIT_BRANCH_LIMIT_EXCEEDED",
          `每个会话最多保留 ${IMAGE_EDIT_LIMITS.maxBranches} 个分支`
        );
      }

      const branch = createBranchRecord(session, input);
      session.branches.push(branch);
      session.currentBranchId = branch.id;
      session.currentVersionId = branch.headVersionId;
      session.updatedAt = branch.updatedAt;
      this.store.save(session);
      this.emit("session.updated", session);
      return session;
    });
  }

  async updateBranch(id: string, branchId: string, input: UpdateEditBranchRequest) {
    return this.withSessionLock(id, () => {
      const session = this.requireSession(id);
      const branch = session.branches.find((item) => item.id === branchId);

      if (!branch) {
        throw new EditSessionServiceError(404, "EDIT_BRANCH_NOT_FOUND", "分支不存在");
      }

      if (input.name !== undefined) {
        const name = input.name.trim();

        if (!name) {
          throw new EditSessionServiceError(400, "EDIT_BRANCH_NAME_REQUIRED", "分支名称不能为空");
        }

        ensureUniqueBranchName(session, name, branch.id);
        branch.name = name;
      }

      if (input.archived !== undefined) {
        if (input.archived && branch.id === session.currentBranchId) {
          throw new EditSessionServiceError(
            409,
            "EDIT_CURRENT_BRANCH_ARCHIVE_FORBIDDEN",
            "当前分支不能直接归档，请先切换到其它分支"
          );
        }

        branch.archivedAt = input.archived ? new Date().toISOString() : undefined;
      }

      branch.updatedAt = new Date().toISOString();
      session.updatedAt = branch.updatedAt;
      this.store.save(session);
      this.emit("session.updated", session);
      return session;
    });
  }

  getPlatformSnapshot(workspaceId = DEFAULT_WORKSPACE_ID): EditPlatformSnapshot {
    const workspace = this.store.getWorkspace(workspaceId);

    return {
      workspace,
      metrics: this.buildPlatformMetrics(workspace)
    };
  }

  updateWorkspace(
    input: UpdateEditWorkspaceRequest,
    workspaceId = DEFAULT_WORKSPACE_ID
  ) {
    const workspace = this.store.getWorkspace(workspaceId);
    const now = new Date().toISOString();

    if (input.name !== undefined) {
      const name = input.name.trim();

      if (!name) {
        throw new EditSessionServiceError(400, "EDIT_WORKSPACE_NAME_REQUIRED", "团队空间名称不能为空");
      }

      workspace.name = name;
    }

    workspace.quota = {
      ...workspace.quota,
      ...sanitizeQuotaPatch(input.quota)
    };
    workspace.lifecycle = {
      ...workspace.lifecycle,
      ...sanitizeLifecyclePatch(input.lifecycle)
    };
    workspace.updatedAt = now;
    return this.store.saveWorkspace(workspace);
  }

  upsertWorkspaceMember(
    input: UpsertEditWorkspaceMemberRequest,
    workspaceId = DEFAULT_WORKSPACE_ID
  ) {
    const workspace = this.store.getWorkspace(workspaceId);
    const name = input.name?.trim();

    if (!name) {
      throw new EditSessionServiceError(400, "EDIT_MEMBER_NAME_REQUIRED", "成员名称不能为空");
    }

    const existing = input.id
      ? workspace.members.find((member) => member.id === input.id)
      : undefined;

    if (!existing && workspace.members.length >= IMAGE_EDIT_LIMITS.maxWorkspaceMembers) {
      throw new EditSessionServiceError(409, "EDIT_MEMBER_LIMIT_EXCEEDED", "团队空间成员数量已达上限");
    }

    if (existing) {
      existing.name = name;
      existing.role = input.role;
    } else {
      workspace.members.push({
        id: input.id?.trim() || crypto.randomUUID(),
        name,
        role: input.role,
        createdAt: new Date().toISOString()
      });
    }

    workspace.updatedAt = new Date().toISOString();
    return this.store.saveWorkspace(workspace);
  }

  removeWorkspaceMember(memberId: string, workspaceId = DEFAULT_WORKSPACE_ID) {
    const workspace = this.store.getWorkspace(workspaceId);
    const member = workspace.members.find((item) => item.id === memberId);

    if (!member) {
      throw new EditSessionServiceError(404, "EDIT_MEMBER_NOT_FOUND", "团队成员不存在");
    }

    if (member.role === "owner") {
      throw new EditSessionServiceError(409, "EDIT_OWNER_REMOVE_FORBIDDEN", "空间所有者不能被移除");
    }

    workspace.members = workspace.members.filter((item) => item.id !== memberId);
    workspace.updatedAt = new Date().toISOString();
    return this.store.saveWorkspace(workspace);
  }

  createInstructionTemplate(
    input: CreateEditInstructionTemplateRequest,
    workspaceId = DEFAULT_WORKSPACE_ID
  ) {
    const workspace = this.store.getWorkspace(workspaceId);

    if (workspace.templates.length >= IMAGE_EDIT_LIMITS.maxTemplates) {
      throw new EditSessionServiceError(409, "EDIT_TEMPLATE_LIMIT_EXCEEDED", "常用指令模板数量已达上限");
    }

    const name = input.name?.trim();
    const instruction = input.instruction?.trim();

    if (!name || !instruction) {
      throw new EditSessionServiceError(400, "EDIT_TEMPLATE_FIELDS_REQUIRED", "模板名称和修图指令不能为空");
    }

    const now = new Date().toISOString();
    workspace.templates.push({
      id: crypto.randomUUID(),
      workspaceId: workspace.id,
      name,
      instruction,
      mode: input.mode,
      protectedPresets: uniqueStrings(input.protectedPresets ?? []) as NonNullable<
        EditSession["protectedPresets"]
      >,
      protectedElements: uniqueStrings(input.protectedElements ?? []),
      createdBy: input.createdBy?.trim() || "local-owner",
      createdAt: now,
      updatedAt: now
    });
    workspace.updatedAt = now;
    return this.store.saveWorkspace(workspace);
  }

  updateInstructionTemplate(
    templateId: string,
    input: UpdateEditInstructionTemplateRequest,
    workspaceId = DEFAULT_WORKSPACE_ID
  ) {
    const workspace = this.store.getWorkspace(workspaceId);
    const template = workspace.templates.find((item) => item.id === templateId);

    if (!template) {
      throw new EditSessionServiceError(404, "EDIT_TEMPLATE_NOT_FOUND", "修图模板不存在");
    }

    if (input.name !== undefined) {
      template.name = input.name.trim();
    }
    if (input.instruction !== undefined) {
      template.instruction = input.instruction.trim();
    }
    if (!template.name || !template.instruction) {
      throw new EditSessionServiceError(400, "EDIT_TEMPLATE_FIELDS_REQUIRED", "模板名称和修图指令不能为空");
    }
    if (input.mode !== undefined) {
      template.mode = input.mode;
    }
    if (input.protectedPresets !== undefined) {
      template.protectedPresets = uniqueStrings(input.protectedPresets) as NonNullable<
        EditSession["protectedPresets"]
      >;
    }
    if (input.protectedElements !== undefined) {
      template.protectedElements = uniqueStrings(input.protectedElements);
    }
    template.updatedAt = new Date().toISOString();
    workspace.updatedAt = template.updatedAt;
    return this.store.saveWorkspace(workspace);
  }

  deleteInstructionTemplate(
    templateId: string,
    workspaceId = DEFAULT_WORKSPACE_ID
  ) {
    const workspace = this.store.getWorkspace(workspaceId);
    const before = workspace.templates.length;
    workspace.templates = workspace.templates.filter((item) => item.id !== templateId);

    if (workspace.templates.length === before) {
      throw new EditSessionServiceError(404, "EDIT_TEMPLATE_NOT_FOUND", "修图模板不存在");
    }

    workspace.updatedAt = new Date().toISOString();
    return this.store.saveWorkspace(workspace);
  }

  createBrandAsset(
    input: CreateEditBrandAssetRequest,
    ownerId = LEGACY_EDIT_OWNER_ID,
    workspaceId = DEFAULT_WORKSPACE_ID
  ) {
    const workspace = this.store.getWorkspace(workspaceId);
    const name = input.name?.trim();
    const assetURL = input.assetURL?.trim();

    if (!name || !assetURL) {
      throw new EditSessionServiceError(400, "EDIT_BRAND_ASSET_FIELDS_REQUIRED", "素材名称和地址不能为空");
    }

    if (input.sessionId && input.versionId) {
      const session = this.requireSession(input.sessionId, ownerId);
      requireVersion(session, input.versionId);
    }

    const asset: EditBrandAsset = {
      id: crypto.randomUUID(),
      workspaceId: workspace.id,
      name,
      kind: input.kind,
      sessionId: input.sessionId,
      versionId: input.versionId,
      assetURL,
      notes: input.notes?.trim() || undefined,
      createdAt: new Date().toISOString()
    };
    workspace.brandAssets.push(asset);
    workspace.updatedAt = asset.createdAt;
    this.store.saveWorkspace(workspace);
    return workspace;
  }

  deleteBrandAsset(assetId: string, workspaceId = DEFAULT_WORKSPACE_ID) {
    const workspace = this.store.getWorkspace(workspaceId);
    const before = workspace.brandAssets.length;
    workspace.brandAssets = workspace.brandAssets.filter((item) => item.id !== assetId);

    if (workspace.brandAssets.length === before) {
      throw new EditSessionServiceError(404, "EDIT_BRAND_ASSET_NOT_FOUND", "品牌素材不存在");
    }

    workspace.updatedAt = new Date().toISOString();
    return this.store.saveWorkspace(workspace);
  }

  previewTurnCost(input: {
    modelId: string;
    params: GenerationParams;
    candidateCount: number;
    modelOverride?: ModelRequestOverride;
  }) {
    const model = requireImageEditModel(input.modelId, input.modelOverride);
    const candidateCount = clampCandidateCount(
      input.candidateCount,
      model.editCapabilities.maxCandidates
    );
    return buildEditCostEstimate(model, input.params, candidateCount);
  }

  async updateVersion(
    id: string,
    versionId: string,
    input: UpdateEditVersionRequest
  ) {
    return this.withSessionLock(id, () => {
      const session = this.requireSession(id);
      const version = requireVersion(session, versionId);

      if (input.label !== undefined) {
        const label = input.label.trim();

        if (!label) {
          throw new EditSessionServiceError(400, "EDIT_VERSION_LABEL_REQUIRED", "版本名称不能为空");
        }

        version.label = label;
      }
      if (input.tags !== undefined) {
        version.tags = uniqueStrings(input.tags)
          .slice(0, IMAGE_EDIT_LIMITS.maxVersionTags);
      }
      if (input.favorite !== undefined) {
        version.favorite = input.favorite;
      }
      if (input.note !== undefined) {
        version.note = input.note.trim() || undefined;
      }
      if (input.reviewState !== undefined) {
        version.reviewState = input.reviewState;
      }
      if (input.qualityAssessment !== undefined) {
        version.qualityAssessment = normalizeQualityAssessment(
          session,
          version,
          input.qualityAssessment
        );
      }

      session.updatedAt = new Date().toISOString();
      appendAudit(session, "version.updated", `更新版本「${version.label}」`, {
        actorId: input.actorId,
        targetId: version.id
      });
      if (version.qualityAssessment && input.qualityAssessment !== undefined) {
        appendAudit(session, "version.quality_evaluated", `完成版本「${version.label}」技术质量检查`, {
          actorId: input.actorId,
          targetId: version.id,
          metadata: {
            evaluator: version.qualityAssessment.evaluator,
            sourceVersionId: version.qualityAssessment.sourceVersionId,
            technicalScore: version.qualityAssessment.technicalScore,
            changedPixelRatio: version.qualityAssessment.changedPixelRatio,
            warningCount: version.qualityAssessment.warnings.length
          }
        });
      }
      this.store.save(session);
      this.emit("session.updated", session, { versionId });
      return session;
    });
  }

  async batchCleanupVersions(
    id: string,
    input: BatchCleanupEditVersionsRequest
  ) {
    const deletedAssets: EditSession["assets"] = [];
    const result = await this.withSessionLock(id, () => {
      const session = this.requireSession(id);
      const requested = new Set(uniqueStrings(input.versionIds));
      const protectedIds = collectProtectedVersionIds(session, requested);
      const deletable = session.versions.filter(
        (version) => requested.has(version.id) && !protectedIds.has(version.id)
      );

      if (deletable.length === 0) {
        throw new EditSessionServiceError(
          409,
          "EDIT_NO_DELETABLE_VERSIONS",
          "所选版本包含当前版本、分支头、根版本或仍被后续版本引用，无法清理"
        );
      }

      const deleteIds = new Set(deletable.map((version) => version.id));
      const deleteAssetIds = new Set(deletable.map((version) => version.assetId));
      deletedAssets.push(
        ...session.assets.filter((asset) => deleteAssetIds.has(asset.id))
      );
      session.versions = session.versions.filter((version) => !deleteIds.has(version.id));
      session.assets = session.assets.filter((asset) => !deleteAssetIds.has(asset.id));
      session.continuations = session.continuations.filter(
        (continuation) => !deleteIds.has(continuation.versionId)
      );
      session.jobs = session.jobs.filter((job) => !job.resultVersionId || !deleteIds.has(job.resultVersionId));
      const keptJobIds = new Set(session.jobs.map((job) => job.id));
      session.turns.forEach((turn) => {
        turn.jobIds = turn.jobIds.filter((jobId) => keptJobIds.has(jobId));
      });
      session.updatedAt = new Date().toISOString();
      appendAudit(session, "version.deleted", `批量清理 ${deletable.length} 个版本`, {
        actorId: input.actorId,
        metadata: {
          versionIds: [...deleteIds]
        }
      });
      this.store.save(session);
      this.emit("session.updated", session);
      return session;
    });

    await rollbackAssets(this.assets, id, deletedAssets);
    return result;
  }

  async mergeVersionRegion(
    id: string,
    input: MergeEditVersionRegionRequest
  ) {
    if (
      !Array.isArray(input.sourceVersionIds) ||
      input.sourceVersionIds.length !== 2 ||
      new Set(input.sourceVersionIds).size !== 2
    ) {
      throw new EditSessionServiceError(400, "EDIT_LOCAL_MERGE_SOURCES_INVALID", "局部合并需要两个不同源版本");
    }

    const session = this.requireSession(id);
    input.sourceVersionIds.forEach((versionId) => requireVersion(session, versionId));
    const asset = await this.assets.persistInput({
      sessionId: id,
      kind: "result",
      image: input.result
    });

    try {
      return await this.withSessionLock(id, () => {
        const current = this.requireSession(id);
        input.sourceVersionIds.forEach((versionId) => requireVersion(current, versionId));
        const now = new Date().toISOString();
        const versionId = crypto.randomUUID();
        current.assets.push(asset);
        current.versions.push({
          id: versionId,
          sessionId: id,
          assetId: asset.id,
          parentVersionIds: [...input.sourceVersionIds],
          candidateIndex: 0,
          label: input.label?.trim() || "局部合并版本",
          tags: ["局部合并"],
          favorite: false,
          note: input.note?.trim() || undefined,
          reviewState: "draft",
          width: asset.width,
          height: asset.height,
          createdAt: now
        });
        current.currentVersionId = versionId;
        const branch = current.branches.find((item) => item.id === current.currentBranchId);

        if (branch) {
          branch.headVersionId = versionId;
          branch.updatedAt = now;
        }
        current.updatedAt = now;
        appendAudit(current, "version.merged", "创建局部区域合并版本", {
          actorId: input.actorId,
          targetId: versionId,
          metadata: {
            sourceVersionIds: input.sourceVersionIds
          }
        });
        this.store.save(current);
        this.emit("version.created", current, { versionId });
        return current;
      });
    } catch (error) {
      await rollbackAssets(this.assets, id, [asset]);
      throw error;
    }
  }

  exportManifest(id: string) {
    const session = this.requireSession(id);

    return {
      exportedAt: new Date().toISOString(),
      schemaVersion: 2,
      session: {
        ...session,
        shareLinks: (session.shareLinks ?? []).map(({ token: _token, ...link }) => link)
      },
      versionGraph: session.versions.map((version) => ({
        id: version.id,
        parentVersionIds: version.parentVersionIds,
        label: version.label,
        tags: version.tags ?? [],
        favorite: version.favorite ?? false,
        note: version.note,
        reviewState: version.reviewState ?? "draft"
      })),
      instructions: session.turns.map((turn) => ({
        turnId: turn.id,
        originalInstruction: turn.originalInstruction,
        polishedInstruction: turn.polishedInstruction,
        protectedElements: turn.analysis?.protectedElements ?? [],
        sourceVersionIds: turn.sourceVersionIds,
        candidateVersionIds: session.versions
          .filter((version) => version.turnId === turn.id)
          .map((version) => version.id)
      }))
    };
  }

  async createComment(id: string, input: CreateEditCommentRequest) {
    return this.withSessionLock(id, () => {
      const session = this.requireSession(id);
      const body = input.body?.trim();

      if (!body) {
        throw new EditSessionServiceError(400, "EDIT_COMMENT_REQUIRED", "评论内容不能为空");
      }
      if ((session.comments?.length ?? 0) >= IMAGE_EDIT_LIMITS.maxComments) {
        throw new EditSessionServiceError(409, "EDIT_COMMENT_LIMIT_EXCEEDED", "当前会话评论数量已达上限");
      }
      if (input.versionId) {
        requireVersion(session, input.versionId);
      }
      if (input.turnId) {
        requireTurn(session, input.turnId);
      }

      const now = new Date().toISOString();
      const comment = {
        id: crypto.randomUUID(),
        sessionId: id,
        versionId: input.versionId,
        turnId: input.turnId,
        authorId: input.authorId?.trim() || "local-owner",
        authorName: input.authorName?.trim() || "本地用户",
        body,
        createdAt: now,
        updatedAt: now
      };
      session.comments = [...(session.comments ?? []), comment];
      session.updatedAt = now;
      appendAudit(session, "comment.created", "添加协作评论", {
        actorId: comment.authorId,
        targetId: comment.id
      });
      this.store.save(session);
      this.emit("session.updated", session);
      return session;
    });
  }

  async updateComment(
    id: string,
    commentId: string,
    input: UpdateEditCommentRequest
  ) {
    return this.withSessionLock(id, () => {
      const session = this.requireSession(id);
      const comment = session.comments?.find((item) => item.id === commentId);

      if (!comment) {
        throw new EditSessionServiceError(404, "EDIT_COMMENT_NOT_FOUND", "评论不存在");
      }
      if (input.body !== undefined) {
        const body = input.body.trim();

        if (!body) {
          throw new EditSessionServiceError(400, "EDIT_COMMENT_REQUIRED", "评论内容不能为空");
        }

        comment.body = body;
      }
      if (input.resolved !== undefined) {
        comment.resolvedAt = input.resolved ? new Date().toISOString() : undefined;
      }
      comment.updatedAt = new Date().toISOString();
      session.updatedAt = comment.updatedAt;
      appendAudit(session, "comment.resolved", input.resolved ? "解决协作评论" : "重新打开协作评论", {
        actorId: input.actorId,
        targetId: comment.id
      });
      this.store.save(session);
      this.emit("session.updated", session);
      return session;
    });
  }

  async createApproval(id: string, input: CreateEditApprovalRequest) {
    return this.withSessionLock(id, () => {
      const session = this.requireSession(id);
      const version = requireVersion(session, input.versionId);
      const now = new Date().toISOString();
      const approval = {
        id: crypto.randomUUID(),
        sessionId: id,
        versionId: version.id,
        reviewerId: input.reviewerId?.trim() || "local-owner",
        reviewerName: input.reviewerName?.trim() || "本地审核人",
        decision: input.decision,
        note: input.note?.trim() || undefined,
        createdAt: now
      };
      session.approvals = [...(session.approvals ?? []), approval];
      version.reviewState =
        input.decision === "approved" ? "approved" : "changes_requested";
      session.workflow = {
        ...(session.workflow ?? { state: "draft" }),
        state: input.decision === "approved" ? "approved" : "changes_requested",
        reviewVersionId: version.id,
        decidedBy: approval.reviewerId,
        decidedAt: now
      };
      session.updatedAt = now;
      appendAudit(session, "review.decided", input.decision === "approved" ? "版本审核通过" : "版本退回修改", {
        actorId: approval.reviewerId,
        targetId: version.id
      });
      this.store.save(session);
      this.emit("session.updated", session, { versionId: version.id });
      return session;
    });
  }

  async createShareLink(id: string, input: CreateEditShareLinkRequest) {
    return this.withSessionLock(id, () => {
      const session = this.requireSession(id);

      if ((session.shareLinks?.filter((link) => !link.revokedAt).length ?? 0) >= IMAGE_EDIT_LIMITS.maxShareLinks) {
        throw new EditSessionServiceError(409, "EDIT_SHARE_LIMIT_EXCEEDED", "有效分享链接数量已达上限");
      }

      const now = new Date().toISOString();
      const link = {
        id: crypto.randomUUID(),
        sessionId: id,
        token: createShareToken(),
        permission: input.permission,
        createdBy: input.createdBy?.trim() || "local-owner",
        expiresAt: normalizeFutureDate(input.expiresAt),
        createdAt: now
      };
      session.shareLinks = [...(session.shareLinks ?? []), link];
      session.updatedAt = now;
      appendAudit(session, "share.created", `创建${sharePermissionLabel(link.permission)}分享链接`, {
        actorId: link.createdBy,
        targetId: link.id
      });
      this.store.save(session);
      this.emit("session.updated", session);
      return {
        session,
        link
      };
    });
  }

  getSharedSession(token: string) {
    const access = this.getShareAccess(token);
    const session = this.requireSessionAny(access.sessionId);

    return {
      permission: access.permission,
      session: {
        ...session,
        shareLinks: [],
        auditLog: []
      }
    };
  }

  getShareAccess(token: string) {
    const normalizedToken = token.trim();
    const now = Date.now();

    for (const session of this.store.getAllAny()) {
      const link = session.shareLinks?.find(
        (item) =>
          item.token === normalizedToken &&
          !item.revokedAt &&
          (!item.expiresAt || new Date(item.expiresAt).getTime() > now)
      );

      if (link) {
        return {
          permission: link.permission,
          sessionId: session.id
        };
      }
    }

    throw new EditSessionServiceError(
      404,
      "EDIT_SHARE_NOT_FOUND",
      "分享链接不存在、已撤销或已过期"
    );
  }

  async updateShareLink(
    id: string,
    shareId: string,
    input: UpdateEditShareLinkRequest
  ) {
    return this.withSessionLock(id, () => {
      const session = this.requireSession(id);
      const link = session.shareLinks?.find((item) => item.id === shareId);

      if (!link) {
        throw new EditSessionServiceError(404, "EDIT_SHARE_NOT_FOUND", "分享链接不存在");
      }

      if (input.revoked) {
        link.revokedAt = new Date().toISOString();
        appendAudit(session, "share.revoked", "撤销分享链接", {
          actorId: input.actorId,
          targetId: link.id
        });
      } else {
        link.revokedAt = undefined;
      }
      session.updatedAt = new Date().toISOString();
      this.store.save(session);
      this.emit("session.updated", session);
      return session;
    });
  }

  async updateWorkflow(id: string, input: UpdateEditWorkflowRequest) {
    return this.withSessionLock(id, () => {
      const session = this.requireSession(id);
      const now = new Date().toISOString();
      const actorId = input.actorId?.trim() || "local-owner";
      const workflow = session.workflow ?? { state: "draft" as const };
      const version = input.versionId
        ? requireVersion(session, input.versionId)
        : requireVersion(session, session.currentVersionId);

      if (input.action === "request_review") {
        workflow.state = "in_review";
        workflow.reviewVersionId = version.id;
        workflow.requestedBy = actorId;
        workflow.requestedAt = now;
        version.reviewState = "in_review";
        appendAudit(session, "review.requested", "提交版本审核", {
          actorId,
          targetId: version.id
        });
      } else if (input.action === "return_changes") {
        workflow.state = "changes_requested";
        workflow.decidedBy = actorId;
        workflow.decidedAt = now;
        version.reviewState = "changes_requested";
        appendAudit(session, "review.decided", "退回版本修改", {
          actorId,
          targetId: version.id
        });
      } else if (input.action === "approve") {
        workflow.state = "approved";
        workflow.decidedBy = actorId;
        workflow.decidedAt = now;
        version.reviewState = "approved";
        appendAudit(session, "review.decided", "审核通过版本", {
          actorId,
          targetId: version.id
        });
      } else if (input.action === "publish") {
        if (!["approved", "published"].includes(workflow.state)) {
          throw new EditSessionServiceError(409, "EDIT_WORKFLOW_APPROVAL_REQUIRED", "版本审核通过后才能发布");
        }
        workflow.state = "published";
        workflow.publishedVersionId = version.id;
        workflow.publishedAt = now;
        version.reviewState = "published";
        version.publishedAt = now;
        appendAudit(session, "workflow.updated", "发布审核版本", {
          actorId,
          targetId: version.id
        });
      } else {
        workflow.state = "draft";
        version.reviewState = "draft";
        workflow.reviewVersionId = undefined;
        appendAudit(session, "workflow.updated", "重新打开发布流程", {
          actorId,
          targetId: version.id
        });
      }

      session.workflow = workflow;
      session.updatedAt = now;
      this.store.save(session);
      this.emit("session.updated", session, { versionId: version.id });
      return session;
    });
  }

  async runLifecycleCleanup(workspaceId = DEFAULT_WORKSPACE_ID) {
    const workspace = this.store.getWorkspace(workspaceId);
    const cutoff = Date.now() - workspace.lifecycle.detachedVersionRetentionDays * 86_400_000;
    let removedVersions = 0;

    for (const session of this.store.getAllByWorkspace(workspaceId)) {
      const candidateIds = session.versions
        .filter(
          (version) =>
            version.parentVersionIds.length > 0 &&
            !version.favorite &&
            (version.tags?.length ?? 0) === 0 &&
            new Date(version.createdAt).getTime() < cutoff
        )
        .map((version) => version.id);

      if (candidateIds.length === 0) {
        continue;
      }

      try {
        const before = session.versions.length;
        const cleaned = await this.batchCleanupVersions(session.id, {
          versionIds: candidateIds,
          actorId: "lifecycle-policy"
        });
        removedVersions += before - cleaned.versions.length;
      } catch (error) {
        if (!(error instanceof EditSessionServiceError) || error.code !== "EDIT_NO_DELETABLE_VERSIONS") {
          throw error;
        }
      }
    }

    return {
      removedVersions,
      completedAt: new Date().toISOString()
    };
  }

  private buildPlatformMetrics(workspace: EditWorkspace): EditPlatformMetrics {
    const sessions = this.store.getAllByWorkspace(workspace.id);
    const turns = sessions.flatMap((session) => session.turns);
    const jobs = sessions.flatMap((session) => session.jobs);
    const attempts = jobs.flatMap((job) => job.attempts);
    const succeeded = jobs.filter((job) => job.status === "succeeded").length;
    const selectedVersionIds = new Set(
      turns.flatMap((turn) => turn.selectedVersionId ? [turn.selectedVersionId] : [])
    );
    const estimatedValues = turns.flatMap((turn) =>
      turn.costEstimate?.estimatedCostValue !== undefined
        ? [turn.costEstimate.estimatedCostValue]
        : []
    );
    const estimatedTotal = estimatedValues.reduce((sum, value) => sum + value, 0);
    const today = new Date().toISOString().slice(0, 10);
    const dailyCandidatesUsed = turns
      .filter((turn) => turn.createdAt.startsWith(today))
      .reduce((sum, turn) => sum + turn.candidateCount, 0);
    const storageBytes = sessions
      .flatMap((session) => session.assets)
      .reduce((sum, asset) => sum + (asset.sizeBytes ?? 0), 0);
    const averageDurationMs =
      attempts.length > 0
        ? Math.round(
            attempts.reduce((sum, attempt) => sum + (attempt.durationMs ?? 0), 0) /
              attempts.length
          )
        : 0;

    return {
      generatedAt: new Date().toISOString(),
      sessionCount: sessions.length,
      turnCount: turns.length,
      candidateCount: jobs.length,
      successRate: jobs.length > 0 ? succeeded / jobs.length : 0,
      retryRate:
        jobs.length > 0
          ? jobs.filter((job) => job.attempts.length > 1).length / jobs.length
          : 0,
      checkoutRate: jobs.length > 0 ? selectedVersionIds.size / jobs.length : 0,
      averageDurationMs,
      estimatedEffectiveEditCostText:
        selectedVersionIds.size > 0 && estimatedValues.length > 0
          ? `¥${(estimatedTotal / selectedVersionIds.size).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`
          : "以上游实际账单为准",
      storageBytes,
      dailyCandidatesUsed,
      quota: workspace.quota,
      providerHealth: this.executor.providerHealth()
    };
  }

  subscribe(id: string, listener: (event: EditSessionEvent) => void) {
    this.requireSession(id);
    const listeners = this.listeners.get(id) ?? new Set();
    listeners.add(listener);
    this.listeners.set(id, listeners);

    return () => {
      listeners.delete(listener);

      if (listeners.size === 0) {
        this.listeners.delete(id);
      }
    };
  }

  async delete(id: string, ownerId = LEGACY_EDIT_OWNER_ID) {
    const session = this.requireSession(id, ownerId);
    const turnIds = session.turns.map((turn) => turn.id);

    if (this.deletingSessions.has(id)) {
      throw new EditSessionServiceError(409, "EDIT_SESSION_DELETE_IN_PROGRESS", "会话正在删除");
    }

    this.deletingSessions.add(id);
    this.scheduler.cancelSuite(id);

    try {
      await this.scheduler.waitForSuiteIdle(id);
      await this.assets.deleteSessionAssets(id);
      this.store.delete(id, ownerId);
      turnIds.forEach((turnId) => this.runtimeConfigs.delete(turnId));
      this.emitDeleted(id);
      this.listeners.delete(id);
    } finally {
      this.deletingSessions.delete(id);
    }
  }

  private async startNextTurn(sessionId: string) {
    const launch = await this.withSessionLock(sessionId, () => {
      const session = this.requireSession(sessionId);

      if (
        session.turns.some((turn) => BLOCKING_TURN_STATUSES.has(turn.status)) ||
        this.deletingSessions.has(sessionId)
      ) {
        return undefined;
      }

      const turn = session.turns.find((item) => item.status === "queued");

      if (!turn) {
        return undefined;
      }

      const runtimeConfig = this.runtimeConfigs.get(turn.id);

      if (!runtimeConfig) {
        turn.status = "interrupted";
        turn.error = interruptedRuntimeError();
        turn.updatedAt = new Date().toISOString();
        session.updatedAt = turn.updatedAt;
        this.store.save(session);
        this.emit("turn.updated", session, { turnId: turn.id });
        return undefined;
      }

      turn.status = "running";
      turn.updatedAt = new Date().toISOString();
      session.updatedAt = turn.updatedAt;
      this.store.save(session);
      this.emit("turn.updated", session, { turnId: turn.id });

      return {
        turnId: turn.id,
        jobIds: turn.jobIds.filter((jobId) => {
          const job = session.jobs.find((item) => item.id === jobId);
          return job?.status === "queued";
        })
      };
    });

    if (!launch) {
      return;
    }

    launch.jobIds.forEach((jobId) => {
      this.scheduler.enqueue({
        id: `${launch.turnId}:${jobId}:${crypto.randomUUID()}`,
        suiteId: sessionId,
        perSuiteConcurrency: IMAGE_EDIT_LIMITS.maxCandidates,
        run: (signal) => this.runJob(sessionId, launch.turnId, jobId, signal)
      });
    });
  }

  private async runJob(
    sessionId: string,
    turnId: string,
    jobId: string,
    signal: AbortSignal
  ) {
    const prepared = await this.withSessionLock(sessionId, () => {
      const session = this.requireSession(sessionId);
      const turn = requireTurn(session, turnId);
      const job = requireJob(session, jobId);

      if (turn.status === "canceled" || job.status !== "queued") {
        return undefined;
      }

      const now = new Date().toISOString();
      const attempt = {
        id: crypto.randomUUID(),
        attemptNumber: job.attempts.length + 1,
        status: "running" as const,
        requestId: crypto.randomUUID(),
        startedAt: now
      };
      job.attempts.push(attempt);
      job.status = "running";
      job.updatedAt = now;
      turn.status = "running";
      turn.updatedAt = now;
      session.updatedAt = now;
      this.store.save(session);
      this.emit("job.updated", session, { turnId, jobId });

      return {
        session,
        turn,
        job,
        requestId: attempt.requestId,
        runtimeConfig: this.runtimeConfigs.get(turnId)
      };
    });

    if (!prepared) {
      return;
    }

    try {
      const result = await this.executor.execute({
        session: prepared.session,
        turn: prepared.turn,
        requestId: prepared.requestId,
        endpointOverride: prepared.runtimeConfig?.endpointOverride,
        modelOverride: prepared.runtimeConfig?.modelOverride,
        signal
      });

      const shouldPersist = await this.withSessionLock(sessionId, () => {
        const session = this.requireSession(sessionId);
        const turn = requireTurn(session, turnId);
        const job = requireJob(session, jobId);

        if (turn.status === "canceled" || job.status === "canceled") {
          return false;
        }

        job.status = "persisting";
        job.updatedAt = new Date().toISOString();
        turn.status = "persisting";
        turn.updatedAt = job.updatedAt;
        session.updatedAt = job.updatedAt;
        this.store.save(session);
        this.emit("job.updated", session, { turnId, jobId });
        return true;
      });

      if (!shouldPersist) {
        return;
      }

      const asset = await this.assets.persistGenerated({
        sessionId,
        turnId,
        jobId,
        candidateIndex: prepared.job.candidateIndex,
        image: result.image,
        signal
      });

      try {
        const recorded = await this.recordJobSuccess(
          sessionId,
          turnId,
          jobId,
          asset,
          result
        );

        if (!recorded) {
          await rollbackAssets(this.assets, sessionId, [asset]);
        }
      } catch (error) {
        await rollbackAssets(this.assets, sessionId, [asset]);
        throw error;
      }
    } catch (error) {
      await this.recordJobFailure(sessionId, turnId, jobId, error);
    } finally {
      const finalized = await this.finalizeTurnIfResolved(sessionId, turnId);

      if (finalized) {
        this.runtimeConfigs.delete(turnId);
        await this.startNextTurn(sessionId);
      }
    }
  }

  private async recordJobSuccess(
    sessionId: string,
    turnId: string,
    jobId: string,
    asset: EditSession["assets"][number],
    result: EditExecutionResult
  ) {
    return this.withSessionLock(sessionId, () => {
      const session = this.requireSession(sessionId);
      const turn = requireTurn(session, turnId);
      const job = requireJob(session, jobId);

      if (turn.status === "canceled" || job.status === "canceled") {
        return false;
      }

      const attempt = job.attempts.at(-1);
      const now = new Date().toISOString();
      const versionId = crypto.randomUUID();

      session.assets.push(asset);
      session.versions.push({
        id: versionId,
        sessionId,
        turnId,
        assetId: asset.id,
        parentVersionIds: [...turn.sourceVersionIds],
        candidateIndex: job.candidateIndex,
        label: `候选 ${job.candidateIndex + 1}`,
        modelId: turn.modelId,
        width: asset.width,
        height: asset.height,
        createdAt: now
      });
      session.continuations.push({
        id: crypto.randomUUID(),
        sessionId,
        versionId,
        provider: result.continuation.provider,
        modelId: result.continuation.modelId,
        compatibilityKey: result.continuation.compatibilityKey,
        strategy: result.continuation.strategy ?? "reference",
        responseId: result.continuation.responseId,
        imageGenerationCallId: result.continuation.imageGenerationCallId,
        interactionId: result.continuation.interactionId,
        opaqueMetadata: result.continuation.opaqueMetadata,
        expiresAt: result.continuation.expiresAt,
        createdAt: now
      });
      job.status = "succeeded";
      job.resultVersionId = versionId;
      job.error = undefined;
      job.updatedAt = now;

      if (attempt) {
        attempt.status = "succeeded";
        attempt.completedAt = now;
        attempt.durationMs = result.durationMs;
        attempt.error = undefined;
      }

      turn.usage = mergeUsage(turn.usage, result.usage);
      turn.continuationStrategy = result.continuation.strategy ?? "reference";
      turn.updatedAt = now;
      session.updatedAt = now;
      this.store.save(session);
      this.emit("version.created", session, { turnId, jobId, versionId });
      return true;
    });
  }

  private async recordJobFailure(
    sessionId: string,
    turnId: string,
    jobId: string,
    error: unknown
  ) {
    await this.withSessionLock(sessionId, () => {
      const session = this.requireSession(sessionId);
      const turn = requireTurn(session, turnId);
      const job = requireJob(session, jobId);

      if (turn.status === "canceled" || job.status === "canceled") {
        return;
      }

      const normalized = toGenerationError(error);
      const attempt = job.attempts.at(-1);
      const now = new Date().toISOString();
      job.status = "failed";
      job.error = normalized;
      job.updatedAt = now;

      if (attempt) {
        attempt.status = "failed";
        attempt.completedAt = now;
        attempt.error = normalized;
        attempt.durationMs = attempt.startedAt
          ? Math.max(0, Date.now() - new Date(attempt.startedAt).getTime())
          : undefined;
      }

      turn.error ??= normalized;
      turn.updatedAt = now;
      session.updatedAt = now;
      this.store.save(session);
      this.emit("job.updated", session, { turnId, jobId });
    });
  }

  private async finalizeTurnIfResolved(sessionId: string, turnId: string) {
    return this.withSessionLock(sessionId, () => {
      const session = this.requireSession(sessionId);
      const turn = requireTurn(session, turnId);
      const jobs = turn.jobIds.map((jobId) => requireJob(session, jobId));
      const unresolved = jobs.some((job) =>
        ["queued", "running", "persisting"].includes(job.status)
      );

      if (unresolved || turn.status === "canceled") {
        return turn.status === "canceled";
      }

      const succeeded = jobs.filter((job) => job.status === "succeeded");
      const failed = jobs.filter((job) => job.status === "failed");
      const interrupted = jobs.filter((job) => job.status === "interrupted");
      const now = new Date().toISOString();

      if (succeeded.length === jobs.length) {
        turn.status = "succeeded";
      } else if (succeeded.length > 0) {
        turn.status = "partial_success";
      } else if (interrupted.length > 0) {
        turn.status = "interrupted";
      } else {
        turn.status = failed.length > 0 ? "failed" : "canceled";
      }

      turn.completedAt = now;
      turn.updatedAt = now;
      session.updatedAt = now;
      session.messages = session.messages.filter(
        (message) =>
          message.turnId !== turnId ||
          (message.kind !== "result" && message.kind !== "error")
      );

      if (succeeded.length > 0) {
        session.messages.push(
          createMessage({
            sessionId,
            turnId,
            role: "assistant",
            kind: "result",
            text:
              succeeded.length === jobs.length
                ? `已生成 ${succeeded.length} 个候选版本。选择一个候选检出后，才会推进当前分支。`
                : `已生成 ${succeeded.length} 个可用候选，另有 ${jobs.length - succeeded.length} 个任务未成功。`
          })
        );
      } else {
        session.messages.push(
          createMessage({
            sessionId,
            turnId,
            role: "assistant",
            kind: "error",
            text: turn.error?.message ?? "本轮编辑没有生成可用候选，可检查设置后重试。"
          })
        );
      }

      this.store.save(session);
      this.emit("turn.updated", session, { turnId });
      return true;
    });
  }

  authorizeAsset(
    ownerId: string,
    filename: string,
    shareToken?: string
  ) {
    const asset = this.store.findAssetSession(
      `${this.assets.publicBaseURL}/${encodeURIComponent(filename)}`
    );

    if (!asset) {
      throw unavailableAssetError();
    }

    if (asset.owner_id === ownerId) {
      return;
    }

    if (shareToken) {
      try {
        const access = this.getShareAccess(shareToken);

        if (access.sessionId === asset.session_id) {
          return;
        }
      } catch {
        // Return the same response for missing and inaccessible assets.
      }
    }

    throw unavailableAssetError();
  }

  private requireSession(id: string, ownerId?: string) {
    const session = ownerId
      ? this.store.get(id, ownerId)
      : this.store.getAny(id);

    if (!session) {
      throw new EditSessionServiceError(404, "EDIT_SESSION_NOT_FOUND", "修图会话不存在");
    }

    return session;
  }

  private requireSessionAny(id: string) {
    const session = this.store.getAny(id);

    if (!session) {
      throw new EditSessionServiceError(
        404,
        "EDIT_SESSION_NOT_FOUND",
        "Edit session not found."
      );
    }

    return session;
  }

  private emit(
    type: EditSessionEventType,
    session: EditSession,
    context: {
      turnId?: string;
      jobId?: string;
      versionId?: string;
    } = {}
  ) {
    const listeners = this.listeners.get(session.id);

    if (!listeners?.size) {
      return;
    }

    const event: EditSessionEvent = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      type,
      occurredAt: new Date().toISOString(),
      ...context,
      session: structuredClone(session)
    };
    listeners.forEach((listener) => {
      try {
        listener(event);
      } catch {
        listeners.delete(listener);
      }
    });
  }

  private emitDeleted(sessionId: string) {
    const listeners = this.listeners.get(sessionId);

    if (!listeners?.size) {
      return;
    }

    const event: EditSessionEvent = {
      id: crypto.randomUUID(),
      sessionId,
      type: "session.deleted",
      occurredAt: new Date().toISOString()
    };
    listeners.forEach((listener) => listener(event));
  }

  private async withSessionLock<T>(
    sessionId: string,
    work: () => Promise<T> | T
  ): Promise<T> {
    const previous = this.lockTails.get(sessionId) ?? Promise.resolve();
    const run = previous.then(work, work);
    const tail = run.then(
      () => undefined,
      () => undefined
    );
    this.lockTails.set(sessionId, tail);

    try {
      return await run;
    } finally {
      if (this.lockTails.get(sessionId) === tail) {
        this.lockTails.delete(sessionId);
      }
    }
  }
}

function sanitizeQuotaPatch(
  input: UpdateEditWorkspaceRequest["quota"]
): Partial<EditWorkspace["quota"]> {
  if (!input) {
    return {};
  }

  return {
    ...(input.maxConcurrentJobs === undefined
      ? {}
      : {
          maxConcurrentJobs: clampInteger(
            input.maxConcurrentJobs,
            1,
            64,
            8
          )
        }),
    ...(input.maxSessionConcurrentTurns === undefined
      ? {}
      : {
          maxSessionConcurrentTurns: clampInteger(
            input.maxSessionConcurrentTurns,
            1,
            8,
            1
          )
        }),
    ...(input.dailyCandidateLimit === undefined
      ? {}
      : {
          dailyCandidateLimit: clampInteger(
            input.dailyCandidateLimit,
            1,
            100_000,
            500
          )
        }),
    ...(input.storageLimitBytes === undefined
      ? {}
      : {
          storageLimitBytes: clampInteger(
            input.storageLimitBytes,
            100 * 1024 * 1024,
            1024 * 1024 * 1024 * 1024,
            20 * 1024 * 1024 * 1024
          )
        })
  };
}

function sanitizeLifecyclePatch(
  input: UpdateEditWorkspaceRequest["lifecycle"]
): Partial<EditWorkspace["lifecycle"]> {
  if (!input) {
    return {};
  }

  return {
    ...(input.detachedVersionRetentionDays === undefined
      ? {}
      : {
          detachedVersionRetentionDays: clampInteger(
            input.detachedVersionRetentionDays,
            1,
            3650,
            30
          )
        }),
    ...(input.failedAssetRetentionDays === undefined
      ? {}
      : {
          failedAssetRetentionDays: clampInteger(
            input.failedAssetRetentionDays,
            1,
            3650,
            7
          )
        }),
    ...(input.autoCleanupEnabled === undefined
      ? {}
      : { autoCleanupEnabled: Boolean(input.autoCleanupEnabled) })
  };
}

function buildEditCostEstimate(
  model: ModelConfig,
  params: GenerationParams,
  candidateCount: number
): NonNullable<EditTurn["costEstimate"]> {
  const count = Math.max(1, Math.floor(candidateCount));
  const preview = estimateGenerationCost(model, {
    ...params,
    count
  });
  const quality = model.capabilities.qualities.find(
    (option) => option.key === params.quality
  );
  const qualityMultiplier =
    model.price.qualityMultiplier?.[params.quality] ??
    quality?.priceMultiplier ??
    1;
  const resolutionMultiplier =
    model.price.resolutionMultiplier?.[params.resolution] ?? 1;
  const multiplier = qualityMultiplier * resolutionMultiplier;
  const rangeMaximum =
    model.price.mode === "range" && model.price.maxPriceValue !== undefined
      ? model.price.maxPriceValue * count * multiplier
      : undefined;
  const estimatedValue = preview.estimatedCostValue;
  const maximumValue = rangeMaximum ?? estimatedValue;
  const worstCaseMultiplier = model.price.chargeOnFailureRisk ? 2 : 1;
  const worstCaseValue =
    maximumValue === undefined ? undefined : maximumValue * worstCaseMultiplier;
  const formatValue = (value: number) => {
    const symbol =
      preview.currency === "USD"
        ? "$"
        : preview.currency === "CNY"
          ? "¥"
          : preview.currency === "POINT"
            ? ""
            : "";
    const suffix =
      preview.currency === "POINT"
        ? " points"
        : preview.currency === "TOKEN"
          ? " tokens"
          : "";
    return `${symbol}${value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}${suffix}`;
  };

  return {
    unitPriceText: preview.unitPriceText,
    estimatedCostText: preview.estimatedCostText,
    worstCaseCostText:
      worstCaseValue === undefined
        ? preview.riskText
          ? `${preview.estimatedCostText} (failed requests may still be charged)`
          : preview.estimatedCostText
        : formatValue(worstCaseValue),
    canCalculate: preview.canCalculate,
    estimatedCostValue: estimatedValue,
    worstCaseCostValue: worstCaseValue,
    currency: preview.currency,
    candidateCount: count,
    riskText: preview.riskText
  };
}

function appendAudit(
  session: EditSession,
  action: EditAuditAction,
  summary: string,
  input: {
    actorId?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  } = {}
) {
  const event: NonNullable<EditSession["auditLog"]>[number] = {
    id: crypto.randomUUID(),
    sessionId: session.id,
    actorId: input.actorId?.trim() || "local-owner",
    action,
    targetId: input.targetId,
    summary,
    metadata: input.metadata,
    createdAt: new Date().toISOString()
  };
  session.auditLog = [...(session.auditLog ?? []), event].slice(-2000);
}

function uniqueStrings<T extends string>(values: readonly T[]) {
  const seen = new Set<string>();

  return values.flatMap((value) => {
    const trimmed = value.trim();
    const key = trimmed.toLocaleLowerCase();

    if (!trimmed || seen.has(key)) {
      return [];
    }

    seen.add(key);
    return [trimmed as T];
  });
}

function clampInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number
) {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function ensureWorkspaceQuota(
  store: EditSessionStore,
  candidateCount: number,
  workspaceId: string
) {
  const workspace = store.getWorkspace(workspaceId);
  const sessions = store.getAllByWorkspace(workspaceId);
  const activeJobs = sessions
    .flatMap((session) => session.jobs)
    .filter((job) => ["queued", "running", "persisting"].includes(job.status))
    .length;
  const today = new Date().toISOString().slice(0, 10);
  const dailyCandidates = sessions
    .flatMap((session) => session.turns)
    .filter((turn) => turn.createdAt.startsWith(today))
    .reduce((sum, turn) => sum + turn.candidateCount, 0);
  const storageBytes = sessions
    .flatMap((session) => session.assets)
    .reduce((sum, asset) => sum + (asset.sizeBytes ?? 0), 0);

  if (activeJobs + candidateCount > workspace.quota.maxConcurrentJobs) {
    throw new EditSessionServiceError(
      429,
      "EDIT_CONCURRENT_JOB_QUOTA_EXCEEDED",
      "Concurrent image-editing job quota exceeded.",
      {
        activeJobs,
        requestedCandidates: candidateCount,
        limit: workspace.quota.maxConcurrentJobs
      }
    );
  }

  if (dailyCandidates + candidateCount > workspace.quota.dailyCandidateLimit) {
    throw new EditSessionServiceError(
      429,
      "EDIT_DAILY_CANDIDATE_QUOTA_EXCEEDED",
      "Daily image-editing candidate quota exceeded.",
      {
        dailyCandidates,
        requestedCandidates: candidateCount,
        limit: workspace.quota.dailyCandidateLimit
      }
    );
  }

  if (storageBytes >= workspace.quota.storageLimitBytes) {
    throw new EditSessionServiceError(
      409,
      "EDIT_STORAGE_QUOTA_EXCEEDED",
      "Image-editing workspace storage quota exceeded.",
      {
        storageBytes,
        limit: workspace.quota.storageLimitBytes
      }
    );
  }
}

function collectProtectedVersionIds(
  session: EditSession,
  requested: ReadonlySet<string>
) {
  const protectedIds = new Set<string>();
  const protect = (value?: string) => {
    if (value && requested.has(value)) {
      protectedIds.add(value);
    }
  };

  protect(session.currentVersionId);
  session.versions.forEach((version) => {
    if (
      version.parentVersionIds.length === 0 ||
      version.favorite ||
      ["approved", "published"].includes(version.reviewState ?? "draft")
    ) {
      protect(version.id);
    }
  });
  session.branches.forEach((branch) => {
    protect(branch.headVersionId);
    protect(branch.baseVersionId);
  });
  session.turns.forEach((turn) => {
    turn.sourceVersionIds.forEach(protect);
    protect(turn.selectedVersionId);
  });
  session.comments?.forEach((comment) => protect(comment.versionId));
  session.approvals?.forEach((approval) => protect(approval.versionId));
  protect(session.workflow?.reviewVersionId);
  protect(session.workflow?.publishedVersionId);

  let changed = true;

  while (changed) {
    changed = false;

    session.versions.forEach((version) => {
      const childWillRemain =
        !requested.has(version.id) || protectedIds.has(version.id);

      if (!childWillRemain) {
        return;
      }

      version.parentVersionIds.forEach((parentId) => {
        if (requested.has(parentId) && !protectedIds.has(parentId)) {
          protectedIds.add(parentId);
          changed = true;
        }
      });
    });
  }

  return protectedIds;
}

function createShareToken() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString(
    "base64url"
  );
}

function normalizeFutureDate(value?: string) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  const timestamp = Date.parse(trimmed);

  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
    throw new EditSessionServiceError(
      400,
      "EDIT_SHARE_EXPIRY_INVALID",
      "分享链接有效期必须是未来的有效时间"
    );
  }

  return new Date(timestamp).toISOString();
}

function sharePermissionLabel(
  permission: NonNullable<EditSession["shareLinks"]>[number]["permission"]
) {
  return {
    view: "仅查看",
    comment: "可评论",
    edit: "可编辑"
  }[permission];
}

function normalizeQualityAssessment(
  session: EditSession,
  version: EditSession["versions"][number],
  input: EditQualityAssessment
): EditQualityAssessment {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new EditSessionServiceError(
      400,
      "EDIT_QUALITY_ASSESSMENT_INVALID",
      "质量检查结果必须是 JSON 对象"
    );
  }

  if (input.schemaVersion !== 1 || input.evaluator !== "pixel-diff-v1") {
    throw new EditSessionServiceError(
      400,
      "EDIT_QUALITY_EVALUATOR_UNSUPPORTED",
      "质量检查结果的版本或评估器不受支持"
    );
  }

  const sourceVersionId =
    typeof input.sourceVersionId === "string"
      ? input.sourceVersionId.trim()
      : "";

  if (
    !sourceVersionId ||
    !version.parentVersionIds.includes(sourceVersionId) ||
    !session.versions.some((item) => item.id === sourceVersionId)
  ) {
    throw new EditSessionServiceError(
      400,
      "EDIT_QUALITY_SOURCE_INVALID",
      "质量检查必须使用当前版本的直接父版本作为对比基线"
    );
  }

  const evaluatedAt = Date.parse(input.evaluatedAt);

  if (!Number.isFinite(evaluatedAt)) {
    throw new EditSessionServiceError(
      400,
      "EDIT_QUALITY_TIME_INVALID",
      "质量检查时间无效"
    );
  }

  if (typeof input.resampled !== "boolean") {
    throw new EditSessionServiceError(
      400,
      "EDIT_QUALITY_RESAMPLED_INVALID",
      "质量检查尺寸对齐标记无效"
    );
  }

  return {
    schemaVersion: 1,
    evaluator: "pixel-diff-v1",
    evaluatedAt: new Date(evaluatedAt).toISOString(),
    sourceVersionId,
    technicalScore: normalizeQualityScore(
      input.technicalScore,
      "technicalScore"
    ),
    changedPixelRatio: normalizeQualityRatio(
      input.changedPixelRatio,
      "changedPixelRatio",
      true
    )!,
    selectionCoverage: normalizeQualityRatio(
      input.selectionCoverage,
      "selectionCoverage"
    ),
    outsideDriftRate: normalizeQualityRatio(
      input.outsideDriftRate,
      "outsideDriftRate"
    ),
    protectedConsistencyScore: normalizeQualityRatio(
      input.protectedConsistencyScore,
      "protectedConsistencyScore"
    ),
    edgeBlendScore: normalizeQualityRatio(
      input.edgeBlendScore,
      "edgeBlendScore"
    ),
    resampled: input.resampled,
    warnings: uniqueStrings(
      Array.isArray(input.warnings)
        ? input.warnings
            .filter((warning): warning is string => typeof warning === "string")
            .map((warning) => warning.slice(0, 240))
        : []
    ).slice(0, 12)
  };
}

function normalizeQualityRatio(
  value: unknown,
  field: string,
  required = false
) {
  if (value === undefined && !required) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new EditSessionServiceError(
      400,
      "EDIT_QUALITY_METRIC_INVALID",
      `质量检查指标 ${field} 必须是 0 到 1 之间的数字`
    );
  }

  return Math.round(value * 10_000) / 10_000;
}

function normalizeQualityScore(value: unknown, field: string) {
  if (value === undefined) {
    return undefined;
  }

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  ) {
    throw new EditSessionServiceError(
      400,
      "EDIT_QUALITY_METRIC_INVALID",
      `质量检查指标 ${field} 必须是 0 到 100 之间的数字`
    );
  }

  return Math.round(value);
}

function validateCreateSessionRequest(input: CreateEditSessionRequest) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new EditSessionServiceError(
      400,
      "EDIT_SESSION_REQUEST_INVALID",
      "创建修图会话的请求必须是 JSON 对象"
    );
  }

  if (!input.source || typeof input.source !== "object" || Array.isArray(input.source)) {
    throw new EditSessionServiceError(400, "EDIT_SOURCE_REQUIRED", "请上传一张源图片");
  }
}

function validateCreateTurnRequest(input: CreateEditTurnRequest) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new EditSessionServiceError(
      400,
      "EDIT_TURN_REQUEST_INVALID",
      "修图请求必须是 JSON 对象"
    );
  }

  if (!input.clientTurnId?.trim()) {
    throw new EditSessionServiceError(400, "EDIT_CLIENT_TURN_ID_REQUIRED", "缺少客户端轮次标识");
  }

  if (!input.originalInstruction?.trim()) {
    throw new EditSessionServiceError(400, "EDIT_INSTRUCTION_REQUIRED", "请输入修图指令");
  }

  if (!["whole", "local", "merge"].includes(input.mode)) {
    throw new EditSessionServiceError(400, "EDIT_MODE_INVALID", "修图模式无效");
  }

  if (!Array.isArray(input.sourceVersionIds)) {
    throw new EditSessionServiceError(400, "EDIT_SOURCE_VERSIONS_INVALID", "源版本必须是数组");
  }

  if (!input.params || typeof input.params !== "object") {
    throw new EditSessionServiceError(400, "EDIT_PARAMS_REQUIRED", "缺少图片生成参数");
  }

  if ((input.regions?.length ?? 0) > IMAGE_EDIT_LIMITS.maxRegions) {
    throw new EditSessionServiceError(
      400,
      "EDIT_REGION_LIMIT_EXCEEDED",
      `每轮最多创建 ${IMAGE_EDIT_LIMITS.maxRegions} 个蒙版区域`
    );
  }
}

function requireImageEditModel(modelId: string, override?: ModelRequestOverride) {
  const model = getModelById(modelId);

  if (!model || !model.enabled) {
    throw new EditSessionServiceError(400, "EDIT_MODEL_NOT_FOUND", "请选择可用的图片模型");
  }

  const runtimeModel = applyModelRequestOverride(model, override);

  if (
    !runtimeModel.capabilities.supportsImageToImage ||
    !runtimeModel.editCapabilities.supportsWholeImageEdit ||
    runtimeModel.capabilities.maxReferenceImages < 1
  ) {
    throw new EditSessionServiceError(
      400,
      "EDIT_MODEL_IMAGE_INPUT_REQUIRED",
      "当前模型不支持以图修图"
    );
  }

  return runtimeModel;
}

function validateTurnModelCapabilities(
  input: CreateEditTurnRequest,
  model: ModelConfig
) {
  const regions = input.regions ?? [];
  const maxReferences = Math.max(
    0,
    Math.floor(model.capabilities.maxReferenceImages)
  );

  if (input.mode !== "local" && regions.length > 0) {
    throw new EditSessionServiceError(
      400,
      "EDIT_REGIONS_REQUIRE_LOCAL_MODE",
      "蒙版区域只能用于局部编辑"
    );
  }

  if (input.mode === "local") {
    if (model.editCapabilities.localMode === "none") {
      throw new EditSessionServiceError(
        400,
        "EDIT_MODEL_LOCAL_MODE_UNSUPPORTED",
        "当前模型不支持局部编辑"
      );
    }

    if (regions.length === 0) {
      throw new EditSessionServiceError(
        400,
        "EDIT_LOCAL_REGION_REQUIRED",
        "局部编辑至少需要一个蒙版区域"
      );
    }
  }

  if (
    input.mode === "merge" &&
    (!model.editCapabilities.supportsBranchMerge || maxReferences < 2)
  ) {
    throw new EditSessionServiceError(
      400,
      "EDIT_MODEL_MERGE_UNSUPPORTED",
      "当前模型不能同时接收两个版本，无法执行合并编辑"
    );
  }

  if (input.sourceVersionIds.length > maxReferences) {
    throw new EditSessionServiceError(
      400,
      "EDIT_MODEL_REFERENCE_LIMIT_EXCEEDED",
      `当前模型最多接收 ${maxReferences} 张参考图`
    );
  }

  const maxRegions =
    model.editCapabilities.localMode === "native-mask" && input.mode === "local"
      ? IMAGE_EDIT_LIMITS.maxRegions
      : Math.max(0, maxReferences - input.sourceVersionIds.length);

  if (regions.length > maxRegions) {
    throw new EditSessionServiceError(
      400,
      "EDIT_MODEL_REGION_LIMIT_EXCEEDED",
      maxRegions > 0
        ? `当前模型本轮最多支持 ${maxRegions} 个蒙版区域`
        : "当前模型没有可用于蒙版区域的参考图额度",
      {
        maxReferences,
        sourceCount: input.sourceVersionIds.length,
        maxRegions
      }
    );
  }
}

function validateSourceVersions(
  session: EditSession,
  sourceVersionIds: string[],
  mode: EditTurn["mode"]
) {
  const expectedCount = mode === "merge" ? 2 : 1;

  if (sourceVersionIds.length !== expectedCount) {
    throw new EditSessionServiceError(
      400,
      "EDIT_SOURCE_VERSION_COUNT_INVALID",
      mode === "merge" ? "合并编辑必须选择两个源版本" : "整图或局部编辑必须选择一个源版本"
    );
  }

  sourceVersionIds.forEach((versionId) => requireVersion(session, versionId));

  if (new Set(sourceVersionIds).size !== sourceVersionIds.length) {
    throw new EditSessionServiceError(
      400,
      "EDIT_SOURCE_VERSION_DUPLICATED",
      "合并编辑不能重复选择同一个版本"
    );
  }
}

function requireTurn(session: EditSession, turnId: string) {
  const turn = session.turns.find((item) => item.id === turnId);

  if (!turn) {
    throw new EditSessionServiceError(404, "EDIT_TURN_NOT_FOUND", "编辑轮次不存在");
  }

  return turn;
}

function requireJob(session: EditSession, jobId: string) {
  const job = session.jobs.find((item) => item.id === jobId);

  if (!job) {
    throw new EditSessionServiceError(404, "EDIT_JOB_NOT_FOUND", "候选任务不存在");
  }

  return job;
}

function requireVersion(session: EditSession, versionId: string) {
  const version = session.versions.find((item) => item.id === versionId);

  if (!version) {
    throw new EditSessionServiceError(404, "EDIT_VERSION_NOT_FOUND", "图片版本不存在");
  }

  return version;
}

function createCandidateJobs(session: EditSession, turn: EditTurn) {
  if (turn.jobIds.length > 0) {
    return;
  }

  const now = new Date().toISOString();

  for (let index = 0; index < turn.candidateCount; index += 1) {
    const job: EditJob = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      turnId: turn.id,
      candidateIndex: index,
      status: "queued",
      attempts: [],
      createdAt: now,
      updatedAt: now
    };
    session.jobs.push(job);
    turn.jobIds.push(job.id);
  }
}

function createMessage(input: Omit<EditMessage, "id" | "createdAt">): EditMessage {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...input
  };
}

function createBranchRecord(
  session: EditSession,
  input: CreateEditBranchRequest
): EditBranch {
  const now = new Date().toISOString();
  const name = input.name?.trim() || nextBranchName(session);
  ensureUniqueBranchName(session, name);

  return {
    id: crypto.randomUUID(),
    sessionId: session.id,
    name,
    headVersionId: input.fromVersionId,
    baseVersionId: input.fromVersionId,
    createdAt: now,
    updatedAt: now
  };
}

function nextBranchName(session: EditSession) {
  let index = 1;
  const names = new Set(session.branches.map((branch) => branch.name));

  while (names.has(`分支 ${index}`)) {
    index += 1;
  }

  return `分支 ${index}`;
}

function ensureUniqueBranchName(session: EditSession, name: string, exceptId?: string) {
  if (
    session.branches.some(
      (branch) =>
        branch.id !== exceptId &&
        !branch.archivedAt &&
        branch.name.trim().toLowerCase() === name.trim().toLowerCase()
    )
  ) {
    throw new EditSessionServiceError(409, "EDIT_BRANCH_NAME_EXISTS", "分支名称已存在");
  }
}

function clampCandidateCount(value: number, modelLimit: number) {
  const parsed = Number.isFinite(value)
    ? Math.floor(value)
    : IMAGE_EDIT_LIMITS.defaultCandidates;
  const upperLimit = Math.max(
    IMAGE_EDIT_LIMITS.minCandidates,
    Math.min(
      IMAGE_EDIT_LIMITS.maxCandidates,
      Number.isFinite(modelLimit)
        ? Math.floor(modelLimit)
        : IMAGE_EDIT_LIMITS.maxCandidates
    )
  );

  return Math.min(
    upperLimit,
    Math.max(IMAGE_EDIT_LIMITS.minCandidates, parsed)
  );
}

function legacyEditVisitor(): EditVisitor {
  return {
    ownerId: LEGACY_EDIT_OWNER_ID,
    workspaceId: DEFAULT_WORKSPACE_ID
  };
}

function unavailableAssetError() {
  return new EditSessionServiceError(
    404,
    "EDIT_ASSET_NOT_FOUND",
    "Requested edit asset is unavailable."
  );
}

async function rollbackAssets(
  assets: EditAssetStore,
  sessionId: string,
  values: EditSession["assets"]
) {
  if (values.length === 0) {
    return;
  }

  try {
    await assets.deleteAssets(sessionId, values);
  } catch {
    // Rollback is best-effort; preserve the original request or persistence error.
  }
}

function stripExtension(value: string) {
  return value.replace(/\.[^.]+$/, "").trim();
}

function resolveRuntimeConfig(
  previous: RuntimeEditConfig | undefined,
  input: {
    endpointOverride?: EndpointOverride;
    modelOverride?: ModelRequestOverride;
  }
): RuntimeEditConfig {
  return {
    endpointOverride: {
      ...previous?.endpointOverride,
      ...input.endpointOverride,
      headers: {
        ...previous?.endpointOverride?.headers,
        ...input.endpointOverride?.headers
      }
    },
    modelOverride: input.modelOverride ?? previous?.modelOverride
  };
}

function ensureRuntimeCredentials(config: RuntimeEditConfig) {
  const hasApiKey = Boolean(config.endpointOverride?.apiKey?.trim());
  const hasCredentialHeader = Object.values(config.endpointOverride?.headers ?? {}).some(
    (value) => Boolean(value.trim())
  );

  if (!hasApiKey && !hasCredentialHeader) {
    throw new EditSessionServiceError(
      400,
      "API_KEY_REQUIRED",
      "请先在设置中配置主 API Key 或当前模型 API Key"
    );
  }
}

function sanitizeEndpointOverride(
  input?: EndpointOverride
): EditTurn["endpointOverride"] {
  if (!input) {
    return undefined;
  }

  const sanitized: NonNullable<EditTurn["endpointOverride"]> = {
    baseURL: sanitizeEndpointURL(input.baseURL),
    editURL: sanitizeEndpointURL(input.editURL),
    endpointVariant: input.endpointVariant
  };

  return sanitized.baseURL || sanitized.editURL || sanitized.endpointVariant
    ? sanitized
    : undefined;
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
      if (isSensitiveName(name)) {
        parsed.searchParams.delete(name);
      }
    }

    return parsed.toString();
  } catch {
    return trimmed.replace(
      /([?&](?:api[_-]?key|token|secret|password|signature|sig|code)=)[^&#]*/gi,
      "$1[redacted]"
    );
  }
}

function isSensitiveName(name: string) {
  const normalized = name.trim().toLowerCase().replaceAll("_", "-");
  return [
    "key",
    "token",
    "secret",
    "password",
    "signature",
    "sig",
    "code",
    "authorization",
    "api-key",
    "apikey",
    "credential"
  ].some((marker) => normalized === marker || normalized.includes(marker));
}

function mergeUsage(current: UsageInfo | undefined, next: UsageInfo | undefined) {
  if (!current && !next) {
    return undefined;
  }

  return {
    promptTokens: sumOptional(current?.promptTokens, next?.promptTokens),
    completionTokens: sumOptional(
      current?.completionTokens,
      next?.completionTokens
    ),
    totalTokens: sumOptional(current?.totalTokens, next?.totalTokens),
    imageCount: (current?.imageCount ?? 0) + (next?.imageCount ?? 1),
    chargedAmountText: next?.chargedAmountText ?? current?.chargedAmountText,
    estimatedCostText: next?.estimatedCostText ?? current?.estimatedCostText
  } satisfies UsageInfo;
}

function sumOptional(left?: number, right?: number) {
  return left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
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

  return createGenerationError({
    type: "unknown",
    code: "EDIT_JOB_FAILED",
    title: "候选修图失败",
    message: error instanceof Error ? error.message : "候选修图失败",
    retryable: true,
    mayHaveCharged: true
  });
}

function interruptedRuntimeError() {
  return createGenerationError({
    type: "validation",
    code: "EDIT_RUNTIME_CONFIG_REQUIRED",
    title: "需要重新提交运行配置",
    message: "服务重启后不会自动重放可能产生费用的修图任务。",
    suggestion: "确认上游账单后手动重试，并重新提交 API 配置。",
    retryable: true,
    mayHaveCharged: true
  });
}
