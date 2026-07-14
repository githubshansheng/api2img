import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import type {
  AnswerEditClarificationRequest,
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
  EditSharePermission,
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
} from "../../src/domain";
import { createGenerationError } from "../../src/services/error-service";
import {
  EditSessionService,
  EditSessionServiceError
} from "./edit-service";
import {
  createEditVisitorMiddleware,
  requireEditVisitor
} from "./edit-visitor";

type AsyncRoute = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void>;

export function createEditSessionRouter(service: EditSessionService) {
  const router = express.Router();

  router.use(createEditVisitorMiddleware());

  router.get("/assets/:filename", (req, res, next) => {
    const filename = routeParam(req, "filename");

    if (!isSafeAssetFilename(filename)) {
      next(new EditSessionServiceError(404, "EDIT_ASSET_NOT_FOUND", "Asset unavailable."));
      return;
    }

    try {
      service.authorizeAsset(
        requireEditVisitor(req).ownerId,
        filename,
        readShareToken(req)
      );
      res.setHeader("Cache-Control", "private, no-store");
      res.sendFile(filename, {
        root: path.resolve(service.assets.rootDirectory),
        dotfiles: "deny",
        index: false
      }, next);
    } catch (error) {
      next(error);
    }
  });

  router.use((req, _res, next) => {
    const shareToken = readShareToken(req);

    if (!shareToken || (req.method === "GET" && req.path.startsWith("/shared/"))) {
      next();
      return;
    }

    try {
      assertSharedRequestAllowed(req, service.getShareAccess(shareToken));
      next();
    } catch (error) {
      next(error);
    }
  });

  router.get("/", (req, res) => {
    const requestedLimit = Number(req.query.limit ?? 50);
    sendSuccess(
      res,
      service.list(
        Number.isFinite(requestedLimit) ? requestedLimit : 50,
        requireEditVisitor(req).ownerId
      )
    );
  });

  router.post(
    "/",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        await service.create(
          req.body as CreateEditSessionRequest,
          requireEditVisitor(req)
        ),
        201
      );
    })
  );

  router.get("/platform", (req, res) => {
    sendSuccess(
      res,
      service.getPlatformSnapshot(requireEditVisitor(req).workspaceId)
    );
  });

  router.patch(
    "/platform/workspace",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        service.updateWorkspace(
          req.body as UpdateEditWorkspaceRequest,
          requireEditVisitor(req).workspaceId
        )
      );
    })
  );

  router.put(
    "/platform/workspace/members",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        service.upsertWorkspaceMember(
          req.body as UpsertEditWorkspaceMemberRequest,
          requireEditVisitor(req).workspaceId
        )
      );
    })
  );

  router.delete(
    "/platform/workspace/members/:memberId",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        service.removeWorkspaceMember(
          routeParam(req, "memberId"),
          requireEditVisitor(req).workspaceId
        )
      );
    })
  );

  router.post(
    "/platform/templates",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        service.createInstructionTemplate(
          req.body as CreateEditInstructionTemplateRequest,
          requireEditVisitor(req).workspaceId
        ),
        201
      );
    })
  );

  router.patch(
    "/platform/templates/:templateId",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        service.updateInstructionTemplate(
          routeParam(req, "templateId"),
          req.body as UpdateEditInstructionTemplateRequest,
          requireEditVisitor(req).workspaceId
        )
      );
    })
  );

  router.delete(
    "/platform/templates/:templateId",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        service.deleteInstructionTemplate(
          routeParam(req, "templateId"),
          requireEditVisitor(req).workspaceId
        )
      );
    })
  );

  router.post(
    "/platform/brand-assets",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        service.createBrandAsset(
          req.body as CreateEditBrandAssetRequest,
          requireEditVisitor(req).ownerId,
          requireEditVisitor(req).workspaceId
        ),
        201
      );
    })
  );

  router.delete(
    "/platform/brand-assets/:assetId",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        service.deleteBrandAsset(
          routeParam(req, "assetId"),
          requireEditVisitor(req).workspaceId
        )
      );
    })
  );

  router.post(
    "/platform/cost-preview",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        service.previewTurnCost(
          req.body as {
            modelId: string;
            params: GenerationParams;
            candidateCount: number;
            modelOverride?: ModelRequestOverride;
          }
        )
      );
    })
  );

  router.post(
    "/platform/lifecycle/cleanup",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        await service.runLifecycleCleanup(requireEditVisitor(req).workspaceId)
      );
    })
  );

  router.get("/shared/:token", (req, res) => {
    sendSuccess(res, service.getSharedSession(routeParam(req, "token")));
  });

  router.use("/:id", (req, _res, next) => {
    if (readShareToken(req)) {
      next();
      return;
    }

    try {
      service.get(routeParam(req, "id"), requireEditVisitor(req).ownerId);
      next();
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id/events", (req, res, next) => {
    try {
      const shareToken = readShareToken(req);
      const session = shareToken
        ? service.getSharedSession(shareToken).session
        : service.get(routeParam(req, "id"), requireEditVisitor(req).ownerId);
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      writeEvent(res, {
        id: crypto.randomUUID(),
        sessionId: session.id,
        type: "edit.snapshot",
        occurredAt: new Date().toISOString(),
        session
      });

      const unsubscribe = service.subscribe(session.id, (event) => {
        if (shareToken && event.session) {
          try {
            writeEvent(res, {
              ...event,
              session: service.getSharedSession(shareToken).session
            });
          } catch {
            res.end();
            return;
          }
        } else {
          writeEvent(res, event);
        }

        if (event.type === "session.deleted") {
          res.end();
        }
      });
      const heartbeat = setInterval(() => {
        writeEvent(res, {
          id: crypto.randomUUID(),
          sessionId: session.id,
          type: "heartbeat",
          occurredAt: new Date().toISOString()
        });
      }, 15_000);
      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      req.once("close", cleanup);
      res.once("close", cleanup);
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", (req, res) => {
    const shareToken = readShareToken(req);
    sendSuccess(
      res,
      shareToken
        ? service.getSharedSession(shareToken).session
        : service.get(routeParam(req, "id"), requireEditVisitor(req).ownerId)
    );
  });

  router.patch(
    "/:id",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        await service.update(
          routeParam(req, "id"),
          req.body as UpdateEditSessionRequest
        )
      );
    })
  );

  router.post(
    "/:id/turns",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        await service.createTurn(
          routeParam(req, "id"),
          req.body as CreateEditTurnRequest
        ),
        202
      );
    })
  );

  router.post(
    "/:id/turns/:turnId/clarification",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        await service.answerClarification(
          routeParam(req, "id"),
          routeParam(req, "turnId"),
          req.body as AnswerEditClarificationRequest
        ),
        202
      );
    })
  );

  router.post(
    "/:id/turns/:turnId/cancel",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        await service.cancelTurn(
          routeParam(req, "id"),
          routeParam(req, "turnId")
        )
      );
    })
  );

  router.post(
    "/:id/jobs/:jobId/retry",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        await service.retryJob(
          routeParam(req, "id"),
          routeParam(req, "jobId"),
          (req.body ?? {}) as RetryEditJobRequest
        ),
        202
      );
    })
  );

  router.post(
    "/:id/versions/:versionId/checkout",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        await service.checkoutVersion(
          routeParam(req, "id"),
          routeParam(req, "versionId"),
          (req.body ?? {}) as CheckoutEditVersionRequest
        )
      );
    })
  );

  router.patch(
    "/:id/versions/:versionId",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        await service.updateVersion(
          routeParam(req, "id"),
          routeParam(req, "versionId"),
          req.body as UpdateEditVersionRequest
        )
      );
    })
  );

  router.post(
    "/:id/versions/cleanup",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        await service.batchCleanupVersions(
          routeParam(req, "id"),
          req.body as BatchCleanupEditVersionsRequest
        )
      );
    })
  );

  router.post(
    "/:id/versions/merge-region",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        await service.mergeVersionRegion(
          routeParam(req, "id"),
          req.body as MergeEditVersionRegionRequest
        ),
        201
      );
    })
  );

  router.get("/:id/export", (req, res) => {
    sendSuccess(res, service.exportManifest(routeParam(req, "id")));
  });

  router.post(
    "/:id/comments",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        await service.createComment(
          routeParam(req, "id"),
          req.body as CreateEditCommentRequest
        ),
        201
      );
    })
  );

  router.patch(
    "/:id/comments/:commentId",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        await service.updateComment(
          routeParam(req, "id"),
          routeParam(req, "commentId"),
          req.body as UpdateEditCommentRequest
        )
      );
    })
  );

  router.post(
    "/:id/approvals",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        await service.createApproval(
          routeParam(req, "id"),
          req.body as CreateEditApprovalRequest
        ),
        201
      );
    })
  );

  router.post(
    "/:id/share-links",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        await service.createShareLink(
          routeParam(req, "id"),
          req.body as CreateEditShareLinkRequest
        ),
        201
      );
    })
  );

  router.patch(
    "/:id/share-links/:shareId",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        await service.updateShareLink(
          routeParam(req, "id"),
          routeParam(req, "shareId"),
          req.body as UpdateEditShareLinkRequest
        )
      );
    })
  );

  router.post(
    "/:id/workflow",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        await service.updateWorkflow(
          routeParam(req, "id"),
          req.body as UpdateEditWorkflowRequest
        )
      );
    })
  );

  router.post(
    "/:id/branches",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        await service.createBranch(
          routeParam(req, "id"),
          req.body as CreateEditBranchRequest
        ),
        201
      );
    })
  );

  router.patch(
    "/:id/branches/:branchId",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        await service.updateBranch(
          routeParam(req, "id"),
          routeParam(req, "branchId"),
          req.body as UpdateEditBranchRequest
        )
      );
    })
  );

  router.delete(
    "/:id",
    asyncRoute(async (req, res) => {
      const id = routeParam(req, "id");
      await service.delete(id, requireEditVisitor(req).ownerId);
      sendSuccess(res, { id, deleted: true });
    })
  );

  router.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (res.headersSent) {
        res.end();
        return;
      }

      const normalized = normalizeEditRouterError(error);
      res.status(normalized.statusCode).json({
        success: false,
        error: normalized.error,
        requestId: crypto.randomUUID(),
        serverTime: new Date().toISOString()
      });
    }
  );

  return router;
}

function asyncRoute(route: AsyncRoute) {
  return (req: Request, res: Response, next: NextFunction) => {
    void route(req, res, next).catch(next);
  };
}

function sendSuccess<T>(res: Response, data: T, statusCode = 200) {
  res.status(statusCode).json({
    success: true,
    data,
    requestId: crypto.randomUUID(),
    serverTime: new Date().toISOString()
  });
}

function routeParam(req: Request, name: string) {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function isSafeAssetFilename(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) &&
    value === path.basename(value);
}

function readShareToken(req: Request) {
  const headerValue = req.get("X-Edit-Share-Token")?.trim();
  const queryValue =
    typeof req.query.shareToken === "string"
      ? req.query.shareToken.trim()
      : "";
  return headerValue || queryValue || undefined;
}

function assertSharedRequestAllowed(
  req: Request,
  access: {
    permission: EditSharePermission;
    sessionId: string;
  }
) {
  const segments = req.path
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  const targetSessionId = segments[0];

  if (!targetSessionId || targetSessionId !== access.sessionId) {
    throw new EditSessionServiceError(
      403,
      "EDIT_SHARE_SESSION_FORBIDDEN",
      "分享链接不能访问其他修图会话"
    );
  }

  const resource = segments[1];

  if (req.method === "GET" || req.method === "HEAD") {
    if (resource === "export") {
      throw new EditSessionServiceError(
        403,
        "EDIT_SHARE_EXPORT_FORBIDDEN",
        "分享访问不能导出完整会话清单"
      );
    }

    return;
  }

  if (
    access.permission === "comment" &&
    req.method === "POST" &&
    resource === "comments" &&
    segments.length === 2
  ) {
    return;
  }

  if (access.permission === "edit") {
    const editableResources = new Set([
      "turns",
      "jobs",
      "versions",
      "branches",
      "comments"
    ]);

    if (resource && editableResources.has(resource)) {
      return;
    }
  }

  throw new EditSessionServiceError(
    403,
    "EDIT_SHARE_PERMISSION_DENIED",
    access.permission === "view"
      ? "当前分享链接仅允许查看"
      : access.permission === "comment"
        ? "当前分享链接仅允许查看和评论"
        : "当前分享链接不允许执行会话管理、审核或发布操作"
  );
}

function writeEvent(
  res: Response,
  event: {
    id: string;
    sessionId: string;
    type: string;
    occurredAt: string;
    session?: unknown;
  }
) {
  if (res.writableEnded || res.destroyed) {
    return;
  }

  res.write(`id: ${event.id}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function normalizeEditRouterError(error: unknown) {
  if (error instanceof EditSessionServiceError) {
    return {
      statusCode: error.statusCode,
      error: createGenerationError({
        type: error.statusCode >= 500 ? "unknown" : "validation",
        code: error.code,
        title: "修图请求失败",
        message: error.message,
        retryable: error.statusCode >= 500 || error.statusCode === 409,
        statusCode: error.statusCode,
        safeDetails: error.details
          ? JSON.stringify(error.details)
          : undefined
      })
    };
  }

  const statusCode =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    Number.isFinite(Number((error as { status?: unknown }).status))
      ? Number((error as { status?: unknown }).status)
      : 500;

  return {
    statusCode,
    error: createGenerationError({
      type: statusCode >= 500 ? "unknown" : "validation",
      code:
        statusCode === 404
          ? "EDIT_ASSET_NOT_FOUND"
          : "EDIT_API_FAILED",
      title: statusCode === 404 ? "修图资产不存在" : "修图接口执行失败",
      message:
        error instanceof Error ? error.message : "修图接口执行失败",
      retryable: statusCode >= 500,
      statusCode
    })
  };
}
