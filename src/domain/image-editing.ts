import type { ImageFormat, OutputFormat } from "./common";
import type { GenerationError } from "./error";
import type {
  EndpointOverride,
  GenerationParams,
  GenerationReferenceInput,
  ModelRequestOverride,
  UsageInfo
} from "./generation";

export const IMAGE_EDIT_LIMITS = {
  minCandidates: 1,
  maxCandidates: 4,
  defaultCandidates: 2,
  maxRegions: 8,
  maxBranches: 100,
  maxSessionsPerPage: 100,
  maxVersionTags: 12,
  maxComments: 500,
  maxTemplates: 100,
  maxWorkspaceMembers: 100,
  maxShareLinks: 50
} as const;

export type EditSessionStatus = "active" | "archived" | "degraded";
export type EditMode = "whole" | "local" | "merge";
export type EditTurnStatus =
  | "analyzing"
  | "awaiting_clarification"
  | "queued"
  | "running"
  | "persisting"
  | "partial_success"
  | "succeeded"
  | "failed"
  | "canceled"
  | "interrupted";
export type EditJobStatus =
  | "queued"
  | "running"
  | "persisting"
  | "succeeded"
  | "failed"
  | "canceled"
  | "interrupted";
export type EditMessageRole = "user" | "assistant" | "system";
export type EditMessageKind =
  | "instruction"
  | "clarification"
  | "clarification_answer"
  | "progress"
  | "result"
  | "error";
export type EditAssetKind = "source" | "mask" | "annotation" | "result";
export type EditAssetSourceType = "asset" | "url";
export type EditPolishAction = "execute" | "clarify";
export type EditContinuationStrategy =
  | "openai-response"
  | "gemini-context"
  | "reference"
  | "annotated-reference";
export type EditSelectionMethod =
  | "brush"
  | "rectangle"
  | "lasso"
  | "magic"
  | "semantic";
export type EditMaskCombination = "add" | "subtract" | "intersect";
export type EditMaskSemantics = "selection-alpha" | "native-transparent";
export type EditProtectedPreset =
  | "identity"
  | "text"
  | "logo"
  | "composition"
  | "product"
  | "color";
export type EditVersionReviewState =
  | "draft"
  | "in_review"
  | "approved"
  | "changes_requested"
  | "published";
export type EditWorkspaceRole = "owner" | "admin" | "editor" | "reviewer" | "viewer";
export type EditSharePermission = "view" | "comment" | "edit";
export type EditWorkflowState =
  | "draft"
  | "in_review"
  | "changes_requested"
  | "approved"
  | "published";
export type EditAuditAction =
  | "session.created"
  | "session.updated"
  | "session.deleted"
  | "turn.created"
  | "version.updated"
  | "version.quality_evaluated"
  | "version.deleted"
  | "version.merged"
  | "comment.created"
  | "comment.resolved"
  | "review.requested"
  | "review.decided"
  | "share.created"
  | "share.revoked"
  | "workflow.updated";

export type EditImageInput = GenerationReferenceInput;

export type EditAsset = {
  id: string;
  sessionId: string;
  kind: EditAssetKind;
  sourceType: EditAssetSourceType;
  url: string;
  name: string;
  mimeType: string;
  format: ImageFormat | OutputFormat;
  sizeBytes?: number;
  width?: number;
  height?: number;
  createdAt: string;
};

export type EditRegion = {
  id: string;
  label: string;
  color: string;
  instruction: string;
  maskAssetId: string;
  selectionMethod?: EditSelectionMethod;
  combinationMode?: EditMaskCombination;
  maskSemantics?: EditMaskSemantics;
  priority?: number;
  featherRadius?: number;
  expansionPixels?: number;
  inverted?: boolean;
  semanticTarget?: string;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type EditInstructionAnalysis = {
  action: EditPolishAction;
  confidence: number;
  originalInstruction: string;
  polishedInstruction: string;
  clarificationQuestion?: string;
  editTargets: string[];
  protectedElements: string[];
  conflicts: string[];
  warnings: string[];
  analyzedBy: "ai" | "heuristic" | "user";
};

export type EditQualityAssessment = {
  schemaVersion: 1;
  evaluator: "pixel-diff-v1";
  evaluatedAt: string;
  sourceVersionId: string;
  technicalScore?: number;
  changedPixelRatio: number;
  selectionCoverage?: number;
  outsideDriftRate?: number;
  protectedConsistencyScore?: number;
  edgeBlendScore?: number;
  resampled: boolean;
  warnings: string[];
};

export type ImageVersion = {
  id: string;
  sessionId: string;
  turnId?: string;
  assetId: string;
  parentVersionIds: string[];
  candidateIndex: number;
  label: string;
  modelId?: string;
  tags?: string[];
  favorite?: boolean;
  note?: string;
  reviewState?: EditVersionReviewState;
  qualityAssessment?: EditQualityAssessment;
  publishedAt?: string;
  width?: number;
  height?: number;
  createdAt: string;
};

export type EditBranch = {
  id: string;
  sessionId: string;
  name: string;
  headVersionId: string;
  baseVersionId: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type EditMessage = {
  id: string;
  sessionId: string;
  turnId?: string;
  role: EditMessageRole;
  kind: EditMessageKind;
  text: string;
  originalText?: string;
  polishedText?: string;
  createdAt: string;
};

export type EditJobAttempt = {
  id: string;
  attemptNumber: number;
  status: EditJobStatus;
  requestId: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: GenerationError;
};

export type EditJob = {
  id: string;
  sessionId: string;
  turnId: string;
  candidateIndex: number;
  status: EditJobStatus;
  attempts: EditJobAttempt[];
  resultVersionId?: string;
  error?: GenerationError;
  createdAt: string;
  updatedAt: string;
};

export type ProviderContinuation = {
  id: string;
  sessionId: string;
  versionId: string;
  provider: string;
  modelId: string;
  compatibilityKey: string;
  strategy: EditContinuationStrategy;
  responseId?: string;
  imageGenerationCallId?: string;
  interactionId?: string;
  opaqueMetadata?: Record<string, unknown>;
  expiresAt?: string;
  createdAt: string;
};

export type EditCostEstimate = {
  unitPriceText: string;
  estimatedCostText: string;
  worstCaseCostText: string;
  canCalculate: boolean;
  estimatedCostValue?: number;
  worstCaseCostValue?: number;
  currency?: string;
  candidateCount: number;
  riskText?: string;
};

export type EditTurn = {
  id: string;
  clientTurnId: string;
  sessionId: string;
  branchId: string;
  sourceVersionIds: string[];
  mode: EditMode;
  status: EditTurnStatus;
  modelId: string;
  modelDisplayName: string;
  modelOverride?: ModelRequestOverride;
  endpointOverride?: Pick<EndpointOverride, "baseURL" | "editURL" | "endpointVariant">;
  params: GenerationParams;
  candidateCount: number;
  originalInstruction: string;
  polishedInstruction?: string;
  analysis?: EditInstructionAnalysis;
  regions: EditRegion[];
  jobIds: string[];
  selectedVersionId?: string;
  continuationStrategy?: EditContinuationStrategy;
  continuationCompatibilityKey?: string;
  costEstimate?: EditCostEstimate;
  usage?: UsageInfo;
  error?: GenerationError;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  canceledAt?: string;
};

export type EditComment = {
  id: string;
  sessionId: string;
  versionId?: string;
  turnId?: string;
  authorId: string;
  authorName: string;
  body: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type EditApproval = {
  id: string;
  sessionId: string;
  versionId: string;
  reviewerId: string;
  reviewerName: string;
  decision: "approved" | "changes_requested";
  note?: string;
  createdAt: string;
};

export type EditShareLink = {
  id: string;
  sessionId: string;
  token: string;
  permission: EditSharePermission;
  createdBy: string;
  expiresAt?: string;
  revokedAt?: string;
  createdAt: string;
};

export type EditAuditEvent = {
  id: string;
  sessionId: string;
  actorId: string;
  action: EditAuditAction;
  targetId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type EditPublishWorkflow = {
  state: EditWorkflowState;
  reviewVersionId?: string;
  requestedBy?: string;
  requestedAt?: string;
  decidedBy?: string;
  decidedAt?: string;
  publishedVersionId?: string;
  publishedAt?: string;
};

export type EditSession = {
  schemaVersion: 1 | 2;
  id: string;
  workspaceId?: string;
  title: string;
  status: EditSessionStatus;
  defaultModelId: string;
  currentVersionId: string;
  currentBranchId: string;
  branches: EditBranch[];
  turns: EditTurn[];
  messages: EditMessage[];
  versions: ImageVersion[];
  jobs: EditJob[];
  assets: EditAsset[];
  continuations: ProviderContinuation[];
  protectedPresets?: EditProtectedPreset[];
  comments?: EditComment[];
  approvals?: EditApproval[];
  shareLinks?: EditShareLink[];
  auditLog?: EditAuditEvent[];
  workflow?: EditPublishWorkflow;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};

export type EditSessionSummary = Pick<
  EditSession,
  | "id"
  | "title"
  | "status"
  | "defaultModelId"
  | "currentVersionId"
  | "currentBranchId"
  | "createdAt"
  | "updatedAt"
  | "archivedAt"
> & {
  thumbnailURL?: string;
  versionCount: number;
  turnCount: number;
};

export type CreateEditSessionRequest = {
  title?: string;
  modelId: string;
  source: EditImageInput;
};

export type UpdateEditSessionRequest = {
  title?: string;
  archived?: boolean;
  defaultModelId?: string;
};

export type CreateEditTurnRequest = {
  clientTurnId: string;
  branchId: string;
  sourceVersionIds: string[];
  mode: EditMode;
  modelId: string;
  modelDisplayName?: string;
  modelOverride?: ModelRequestOverride;
  endpointOverride?: EndpointOverride;
  params: GenerationParams;
  candidateCount: number;
  originalInstruction: string;
  protectedPresets?: EditProtectedPreset[];
  analysis?: EditInstructionAnalysis;
  regions?: Array<{
    id: string;
    label: string;
    color: string;
    instruction: string;
    mask: EditImageInput;
    selectionMethod?: EditSelectionMethod;
    combinationMode?: EditMaskCombination;
    maskSemantics?: EditMaskSemantics;
    priority?: number;
    featherRadius?: number;
    expansionPixels?: number;
    inverted?: boolean;
    semanticTarget?: string;
    bounds?: EditRegion["bounds"];
  }>;
};

export type UpdateEditVersionRequest = {
  label?: string;
  tags?: string[];
  favorite?: boolean;
  note?: string;
  reviewState?: EditVersionReviewState;
  qualityAssessment?: EditQualityAssessment;
  actorId?: string;
};

export type BatchCleanupEditVersionsRequest = {
  versionIds: string[];
  actorId?: string;
};

export type MergeEditVersionRegionRequest = {
  sourceVersionIds: [string, string];
  result: EditImageInput;
  label?: string;
  note?: string;
  actorId?: string;
};

export type CreateEditCommentRequest = {
  versionId?: string;
  turnId?: string;
  authorId?: string;
  authorName?: string;
  body: string;
};

export type UpdateEditCommentRequest = {
  body?: string;
  resolved?: boolean;
  actorId?: string;
};

export type CreateEditApprovalRequest = {
  versionId: string;
  reviewerId?: string;
  reviewerName?: string;
  decision: "approved" | "changes_requested";
  note?: string;
};

export type CreateEditShareLinkRequest = {
  permission: EditSharePermission;
  createdBy?: string;
  expiresAt?: string;
};

export type UpdateEditShareLinkRequest = {
  revoked?: boolean;
  actorId?: string;
};

export type UpdateEditWorkflowRequest = {
  action: "request_review" | "return_changes" | "approve" | "publish" | "reopen";
  versionId?: string;
  actorId?: string;
  actorName?: string;
  note?: string;
};

export type EditInstructionTemplate = {
  id: string;
  workspaceId: string;
  name: string;
  instruction: string;
  mode?: EditMode;
  protectedPresets: EditProtectedPreset[];
  protectedElements: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type EditBrandAsset = {
  id: string;
  workspaceId: string;
  name: string;
  kind: "logo" | "product" | "reference";
  sessionId?: string;
  versionId?: string;
  assetURL: string;
  notes?: string;
  createdAt: string;
};

export type EditWorkspaceMember = {
  id: string;
  name: string;
  role: EditWorkspaceRole;
  createdAt: string;
};

export type EditQuotaPolicy = {
  maxConcurrentJobs: number;
  maxSessionConcurrentTurns: number;
  dailyCandidateLimit: number;
  storageLimitBytes: number;
};

export type EditLifecyclePolicy = {
  detachedVersionRetentionDays: number;
  failedAssetRetentionDays: number;
  autoCleanupEnabled: boolean;
};

export type EditWorkspace = {
  id: string;
  name: string;
  members: EditWorkspaceMember[];
  templates: EditInstructionTemplate[];
  brandAssets: EditBrandAsset[];
  quota: EditQuotaPolicy;
  lifecycle: EditLifecyclePolicy;
  createdAt: string;
  updatedAt: string;
};

export type UpdateEditWorkspaceRequest = {
  name?: string;
  quota?: Partial<EditQuotaPolicy>;
  lifecycle?: Partial<EditLifecyclePolicy>;
};

export type UpsertEditWorkspaceMemberRequest = {
  id?: string;
  name: string;
  role: EditWorkspaceRole;
};

export type CreateEditInstructionTemplateRequest = {
  name: string;
  instruction: string;
  mode?: EditMode;
  protectedPresets?: EditProtectedPreset[];
  protectedElements?: string[];
  createdBy?: string;
};

export type UpdateEditInstructionTemplateRequest =
  Partial<CreateEditInstructionTemplateRequest>;

export type CreateEditBrandAssetRequest = {
  name: string;
  kind: EditBrandAsset["kind"];
  sessionId?: string;
  versionId?: string;
  assetURL: string;
  notes?: string;
};

export type EditProviderHealth = {
  provider: string;
  state: "closed" | "open" | "half_open";
  failures: number;
  successes: number;
  openedAt?: string;
  retryAt?: string;
  lastFailureAt?: string;
  lastSuccessAt?: string;
};

export type EditPlatformMetrics = {
  generatedAt: string;
  sessionCount: number;
  turnCount: number;
  candidateCount: number;
  successRate: number;
  retryRate: number;
  checkoutRate: number;
  averageDurationMs: number;
  estimatedEffectiveEditCostText: string;
  storageBytes: number;
  dailyCandidatesUsed: number;
  quota: EditQuotaPolicy;
  providerHealth: EditProviderHealth[];
};

export type EditPlatformSnapshot = {
  workspace: EditWorkspace;
  metrics: EditPlatformMetrics;
};

export type AnswerEditClarificationRequest = {
  answer: string;
  analysis: EditInstructionAnalysis;
  endpointOverride?: EndpointOverride;
  modelOverride?: ModelRequestOverride;
};

export type RetryEditJobRequest = {
  endpointOverride?: EndpointOverride;
  modelOverride?: ModelRequestOverride;
};

export type CheckoutEditVersionRequest = {
  branchId?: string;
  createBranch?: boolean;
  branchName?: string;
};

export type CreateEditBranchRequest = {
  fromVersionId: string;
  name?: string;
};

export type UpdateEditBranchRequest = {
  name?: string;
  archived?: boolean;
};

export type EditSessionEventType =
  | "edit.snapshot"
  | "session.updated"
  | "session.deleted"
  | "turn.updated"
  | "job.updated"
  | "version.created"
  | "heartbeat";

export type EditSessionEvent = {
  id: string;
  sessionId: string;
  type: EditSessionEventType;
  occurredAt: string;
  turnId?: string;
  jobId?: string;
  versionId?: string;
  session?: EditSession;
};
