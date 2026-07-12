import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import type {
  CreateGenerationSuiteRequest,
  RetryGenerationSuiteSlotRequest,
  SelectSuiteAnchorRequest,
  StartGenerationSuiteRequest,
  UpdateGenerationSuiteRequest
} from "../../src/domain";
import { createGenerationError } from "../../src/services/error-service";
import {
  GenerationSuiteService,
  GenerationSuiteServiceError
} from "./suite-service";

type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export function createGenerationSuiteRouter(service: GenerationSuiteService) {
  const router = express.Router();

  router.get("/templates", (_req, res) => {
    sendSuccess(res, service.getTemplates());
  });

  router.use(
    "/assets",
    express.static(path.resolve(service.assets.rootDirectory), {
      fallthrough: false,
      immutable: false,
      index: false,
      maxAge: "1h",
      redirect: false
    })
  );

  router.get("/", (req, res) => {
    const requestedLimit = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(requestedLimit) ? requestedLimit : 50;
    sendSuccess(res, service.list(limit));
  });

  router.post(
    "/",
    asyncRoute(async (req, res) => {
      const suite = await service.create(req.body as CreateGenerationSuiteRequest);
      sendSuccess(res, suite, 201);
    })
  );

  router.get("/:id/events", (req, res, next) => {
    try {
      const suite = service.get(routeParam(req, "id"));

      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      writeEvent(res, {
        id: crypto.randomUUID(),
        suiteId: suite.id,
        type: "suite.snapshot",
        occurredAt: new Date().toISOString(),
        suite
      });

      const unsubscribe = service.subscribe(suite.id, (event) => {
        writeEvent(res, event);

        if (event.type === "suite.deleted") {
          res.end();
        }
      });
      const heartbeat = setInterval(() => {
        writeEvent(res, {
          id: crypto.randomUUID(),
          suiteId: suite.id,
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
    sendSuccess(res, service.get(routeParam(req, "id")));
  });

  router.patch(
    "/:id",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        await service.update(routeParam(req, "id"), req.body as UpdateGenerationSuiteRequest)
      );
    })
  );

  router.post(
    "/:id/start",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        await service.start(routeParam(req, "id"), (req.body ?? {}) as StartGenerationSuiteRequest),
        202
      );
    })
  );

  router.post(
    "/:id/anchor",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        await service.selectAnchor(routeParam(req, "id"), req.body as SelectSuiteAnchorRequest),
        202
      );
    })
  );

  router.post(
    "/:id/slots/:slotId/retry",
    asyncRoute(async (req, res) => {
      sendSuccess(
        res,
        await service.retrySlot(
          routeParam(req, "id"),
          routeParam(req, "slotId"),
          (req.body ?? {}) as RetryGenerationSuiteSlotRequest
        ),
        202
      );
    })
  );

  router.post(
    "/:id/cancel",
    asyncRoute(async (req, res) => {
      sendSuccess(res, await service.cancel(routeParam(req, "id")));
    })
  );

  router.delete(
    "/:id",
    asyncRoute(async (req, res) => {
      const id = routeParam(req, "id");
      await service.delete(id);
      sendSuccess(res, { id, deleted: true });
    })
  );

  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) {
      res.end();
      return;
    }

    const normalized = normalizeSuiteRouterError(error);
    res.status(normalized.statusCode).json({
      success: false,
      error: normalized.error,
      requestId: crypto.randomUUID(),
      serverTime: new Date().toISOString()
    });
  });

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

function writeEvent(res: Response, event: {
  id: string;
  suiteId: string;
  type: string;
  occurredAt: string;
  suite?: unknown;
}) {
  if (res.writableEnded || res.destroyed) {
    return;
  }

  res.write(`id: ${event.id}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function normalizeSuiteRouterError(error: unknown) {
  if (error instanceof GenerationSuiteServiceError) {
    return {
      statusCode: error.statusCode,
      error: createGenerationError({
        type: error.statusCode >= 500 ? "unknown" : "validation",
        code: error.code,
        title: "套图请求失败",
        message: error.message,
        retryable: error.statusCode >= 500 || error.statusCode === 409,
        statusCode: error.statusCode,
        safeDetails: error.details ? JSON.stringify(error.details) : undefined
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
      code: statusCode === 404 ? "SUITE_ASSET_NOT_FOUND" : "SUITE_API_FAILED",
      title: statusCode === 404 ? "素材不存在" : "套图接口执行失败",
      message: error instanceof Error ? error.message : "套图接口执行失败",
      retryable: statusCode >= 500,
      statusCode
    })
  };
}
