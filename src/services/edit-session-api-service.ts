import type {
  AnswerEditClarificationRequest,
  ApiError,
  BatchCleanupEditVersionsRequest,
  CheckoutEditVersionRequest,
  CreateEditApprovalRequest,
  CreateEditBranchRequest,
  CreateEditBrandAssetRequest,
  CreateEditCommentRequest,
  CreateEditInstructionTemplateRequest,
  CreateEditShareLinkRequest,
  CreateEditSessionRequest,
  CreateEditTurnRequest,
  EditCostEstimate,
  EditPlatformSnapshot,
  EditSession,
  EditSessionEvent,
  EditSessionSummary,
  EditSharePermission,
  EditWorkspace,
  GenerationError,
  GenerationParams,
  MergeEditVersionRegionRequest,
  ModelRequestOverride,
  RetryEditJobRequest,
  UpdateEditBranchRequest,
  UpdateEditCommentRequest,
  UpdateEditInstructionTemplateRequest,
  UpdateEditSessionRequest,
  UpdateEditShareLinkRequest,
  UpdateEditVersionRequest,
  UpdateEditWorkflowRequest,
  UpdateEditWorkspaceRequest,
  UpsertEditWorkspaceMemberRequest
} from "../domain";
import { readApiResponse } from "./api-response-service";

const EDIT_API_BASE = "/api/edit-sessions";

export class EditSessionApiError extends Error {
  readonly apiError?: ApiError | GenerationError;

  constructor(message: string, apiError?: ApiError | GenerationError) {
    super(message);
    this.name = "EditSessionApiError";
    this.apiError = apiError;
  }
}

export function listEditSessions(limit = 50) {
  return requestEditApi<EditSessionSummary[]>(
    `${EDIT_API_BASE}?limit=${encodeURIComponent(limit)}`,
    { requestLabel: "获取修图会话" }
  );
}

export function getEditSession(id: string) {
  return requestEditApi<EditSession>(`${EDIT_API_BASE}/${encodeURIComponent(id)}`, {
    requestLabel: "获取修图会话详情"
  });
}

export function createEditSession(payload: CreateEditSessionRequest) {
  return requestEditApi<EditSession>(EDIT_API_BASE, {
    method: "POST",
    body: payload,
    requestLabel: "创建修图会话"
  });
}

export function updateEditSession(id: string, payload: UpdateEditSessionRequest) {
  return requestEditApi<EditSession>(`${EDIT_API_BASE}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: payload,
    requestLabel: "更新修图会话"
  });
}

export function deleteEditSession(id: string) {
  return requestEditApi<{ id: string; deleted: boolean }>(
    `${EDIT_API_BASE}/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      requestLabel: "删除修图会话"
    }
  );
}

export function createEditTurn(id: string, payload: CreateEditTurnRequest) {
  return requestEditApi<EditSession>(
    `${EDIT_API_BASE}/${encodeURIComponent(id)}/turns`,
    {
      method: "POST",
      body: payload,
      requestLabel: "提交修图指令"
    }
  );
}

export function answerEditClarification(
  id: string,
  turnId: string,
  payload: AnswerEditClarificationRequest
) {
  return requestEditApi<EditSession>(
    `${EDIT_API_BASE}/${encodeURIComponent(id)}/turns/${encodeURIComponent(turnId)}/clarification`,
    {
      method: "POST",
      body: payload,
      requestLabel: "补充修图说明"
    }
  );
}

export function cancelEditTurn(id: string, turnId: string) {
  return requestEditApi<EditSession>(
    `${EDIT_API_BASE}/${encodeURIComponent(id)}/turns/${encodeURIComponent(turnId)}/cancel`,
    {
      method: "POST",
      body: {},
      requestLabel: "取消修图任务"
    }
  );
}

export function retryEditJob(
  id: string,
  jobId: string,
  payload: RetryEditJobRequest = {}
) {
  return requestEditApi<EditSession>(
    `${EDIT_API_BASE}/${encodeURIComponent(id)}/jobs/${encodeURIComponent(jobId)}/retry`,
    {
      method: "POST",
      body: payload,
      requestLabel: "重试修图候选"
    }
  );
}

export function checkoutEditVersion(
  id: string,
  versionId: string,
  payload: CheckoutEditVersionRequest = {}
) {
  return requestEditApi<EditSession>(
    `${EDIT_API_BASE}/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/checkout`,
    {
      method: "POST",
      body: payload,
      requestLabel: "检出修图版本"
    }
  );
}

export function createEditBranch(id: string, payload: CreateEditBranchRequest) {
  return requestEditApi<EditSession>(
    `${EDIT_API_BASE}/${encodeURIComponent(id)}/branches`,
    {
      method: "POST",
      body: payload,
      requestLabel: "创建修图分支"
    }
  );
}

export function updateEditBranch(
  id: string,
  branchId: string,
  payload: UpdateEditBranchRequest
) {
  return requestEditApi<EditSession>(
    `${EDIT_API_BASE}/${encodeURIComponent(id)}/branches/${encodeURIComponent(branchId)}`,
    {
      method: "PATCH",
      body: payload,
      requestLabel: "更新修图分支"
    }
  );
}

export function getEditPlatformSnapshot() {
  return requestEditApi<EditPlatformSnapshot>(`${EDIT_API_BASE}/platform`, {
    requestLabel: "获取修图平台信息"
  });
}

export function updateEditWorkspace(payload: UpdateEditWorkspaceRequest) {
  return requestEditApi<EditWorkspace>(`${EDIT_API_BASE}/platform/workspace`, {
    method: "PATCH",
    body: payload,
    requestLabel: "更新修图工作区"
  });
}

export function upsertEditWorkspaceMember(
  payload: UpsertEditWorkspaceMemberRequest
) {
  return requestEditApi<EditWorkspace>(
    `${EDIT_API_BASE}/platform/workspace/members`,
    {
      method: "PUT",
      body: payload,
      requestLabel: "更新工作区成员"
    }
  );
}

export function removeEditWorkspaceMember(memberId: string) {
  return requestEditApi<EditWorkspace>(
    `${EDIT_API_BASE}/platform/workspace/members/${encodeURIComponent(memberId)}`,
    {
      method: "DELETE",
      requestLabel: "移除工作区成员"
    }
  );
}

export function createEditInstructionTemplate(
  payload: CreateEditInstructionTemplateRequest
) {
  return requestEditApi<EditWorkspace>(`${EDIT_API_BASE}/platform/templates`, {
    method: "POST",
    body: payload,
    requestLabel: "创建常用修图模板"
  });
}

export function updateEditInstructionTemplate(
  templateId: string,
  payload: UpdateEditInstructionTemplateRequest
) {
  return requestEditApi<EditWorkspace>(
    `${EDIT_API_BASE}/platform/templates/${encodeURIComponent(templateId)}`,
    {
      method: "PATCH",
      body: payload,
      requestLabel: "更新常用修图模板"
    }
  );
}

export function deleteEditInstructionTemplate(templateId: string) {
  return requestEditApi<EditWorkspace>(
    `${EDIT_API_BASE}/platform/templates/${encodeURIComponent(templateId)}`,
    {
      method: "DELETE",
      requestLabel: "删除常用修图模板"
    }
  );
}

export function createEditBrandAsset(payload: CreateEditBrandAssetRequest) {
  return requestEditApi<EditWorkspace>(
    `${EDIT_API_BASE}/platform/brand-assets`,
    {
      method: "POST",
      body: payload,
      requestLabel: "创建品牌素材"
    }
  );
}

export function deleteEditBrandAsset(assetId: string) {
  return requestEditApi<EditWorkspace>(
    `${EDIT_API_BASE}/platform/brand-assets/${encodeURIComponent(assetId)}`,
    {
      method: "DELETE",
      requestLabel: "删除品牌素材"
    }
  );
}

export function previewEditTurnCost(payload: {
  modelId: string;
  params: GenerationParams;
  candidateCount: number;
  modelOverride?: ModelRequestOverride;
}) {
  return requestEditApi<EditCostEstimate>(
    `${EDIT_API_BASE}/platform/cost-preview`,
    {
      method: "POST",
      body: payload,
      requestLabel: "预估修图费用"
    }
  );
}

export function runEditLifecycleCleanup() {
  return requestEditApi<{ removedVersions: number; completedAt: string }>(
    `${EDIT_API_BASE}/platform/lifecycle/cleanup`,
    {
      method: "POST",
      body: {},
      requestLabel: "执行修图生命周期清理"
    }
  );
}

export function getSharedEditSession(token: string) {
  return requestEditApi<{
    permission: EditSharePermission;
    session: EditSession;
  }>(`${EDIT_API_BASE}/shared/${encodeURIComponent(token)}`, {
    requestLabel: "打开修图分享"
  });
}

export function updateEditVersion(
  id: string,
  versionId: string,
  payload: UpdateEditVersionRequest
) {
  return requestEditApi<EditSession>(
    `${EDIT_API_BASE}/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`,
    {
      method: "PATCH",
      body: payload,
      requestLabel: "更新修图版本"
    }
  );
}

export function cleanupEditVersions(
  id: string,
  payload: BatchCleanupEditVersionsRequest
) {
  return requestEditApi<EditSession>(
    `${EDIT_API_BASE}/${encodeURIComponent(id)}/versions/cleanup`,
    {
      method: "POST",
      body: payload,
      requestLabel: "清理修图版本"
    }
  );
}

export function mergeEditVersionRegion(
  id: string,
  payload: MergeEditVersionRegionRequest
) {
  return requestEditApi<EditSession>(
    `${EDIT_API_BASE}/${encodeURIComponent(id)}/versions/merge-region`,
    {
      method: "POST",
      body: payload,
      requestLabel: "合并局部区域"
    }
  );
}

export function exportEditSessionManifest(id: string) {
  return requestEditApi<Record<string, unknown>>(
    `${EDIT_API_BASE}/${encodeURIComponent(id)}/export`,
    {
      requestLabel: "导出修图清单"
    }
  );
}

export function createEditComment(
  id: string,
  payload: CreateEditCommentRequest
) {
  return requestEditApi<EditSession>(
    `${EDIT_API_BASE}/${encodeURIComponent(id)}/comments`,
    {
      method: "POST",
      body: payload,
      requestLabel: "添加修图评论"
    }
  );
}

export function updateEditComment(
  id: string,
  commentId: string,
  payload: UpdateEditCommentRequest
) {
  return requestEditApi<EditSession>(
    `${EDIT_API_BASE}/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`,
    {
      method: "PATCH",
      body: payload,
      requestLabel: "更新修图评论"
    }
  );
}

export function createEditApproval(
  id: string,
  payload: CreateEditApprovalRequest
) {
  return requestEditApi<EditSession>(
    `${EDIT_API_BASE}/${encodeURIComponent(id)}/approvals`,
    {
      method: "POST",
      body: payload,
      requestLabel: "提交修图审核结果"
    }
  );
}

export function createEditShareLink(
  id: string,
  payload: CreateEditShareLinkRequest
) {
  return requestEditApi<{
    session: EditSession;
    link: NonNullable<EditSession["shareLinks"]>[number];
  }>(`${EDIT_API_BASE}/${encodeURIComponent(id)}/share-links`, {
    method: "POST",
    body: payload,
    requestLabel: "创建修图分享链接"
  });
}

export function updateEditShareLink(
  id: string,
  shareId: string,
  payload: UpdateEditShareLinkRequest
) {
  return requestEditApi<EditSession>(
    `${EDIT_API_BASE}/${encodeURIComponent(id)}/share-links/${encodeURIComponent(shareId)}`,
    {
      method: "PATCH",
      body: payload,
      requestLabel: "更新修图分享链接"
    }
  );
}

export function updateEditWorkflow(
  id: string,
  payload: UpdateEditWorkflowRequest
) {
  return requestEditApi<EditSession>(
    `${EDIT_API_BASE}/${encodeURIComponent(id)}/workflow`,
    {
      method: "POST",
      body: payload,
      requestLabel: "更新修图发布流程"
    }
  );
}

export function subscribeEditSessionEvents(
  id: string,
  handlers: {
    onEvent: (event: EditSessionEvent) => void;
    onOpen?: () => void;
    onError?: () => void;
  }
) {
  const shareToken = resolveActiveShareToken();
  const search = shareToken
    ? `?shareToken=${encodeURIComponent(shareToken)}`
    : "";
  const source = new EventSource(
    `${EDIT_API_BASE}/${encodeURIComponent(id)}/events${search}`
  );

  source.onopen = () => handlers.onOpen?.();
  source.onmessage = (message) => {
    try {
      handlers.onEvent(JSON.parse(message.data) as EditSessionEvent);
    } catch {
      handlers.onError?.();
    }
  };
  source.onerror = () => handlers.onError?.();

  return () => source.close();
}

async function requestEditApi<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    requestLabel: string;
  }
) {
  const shareToken = resolveActiveShareToken();
  const headers: Record<string, string> = {};

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (shareToken) {
    headers["X-Edit-Share-Token"] = shareToken;
  }

  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const body = await readApiResponse<T>(response, {
    requestLabel: options.requestLabel
  });

  if (!response.ok || !body.success || body.data === undefined) {
    throw new EditSessionApiError(
      body.error?.message ?? `${options.requestLabel}失败`,
      body.error
    );
  }

  return body.data;
}

function resolveActiveShareToken() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (
    new URLSearchParams(window.location.search).get("share")?.trim() ||
    undefined
  );
}
