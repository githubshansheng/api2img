import express, { type NextFunction, type Request, type Response } from "express";
import type { GenerateVector3DViewRequest, Vector3DStreamEvent } from "../../src/domain";
import { createGenerationError } from "../../src/services/error-service";
import {
  generateVector3DView,
  Vector3DServiceError
} from "./vector3d-service";

export function createVector3DViewpointRouter() {
  const router = express.Router();

  router.post("/", asyncRoute(async (req, res) => {
    const rawInput = req.body as Partial<GenerateVector3DViewRequest>;
    const requestId = rawInput.requestId?.trim() || crypto.randomUUID();
    const input = {
      ...rawInput,
      requestId
    };
    const stream = req.query.stream === "1";
    const controller = new AbortController();
    let completed = false;
    res.locals.vector3dRequestId = requestId;

    const handleRequestAborted = () => {
      if (!completed) {
        controller.abort();
      }
    };
    const handleResponseClosed = () => {
      if (!completed && !res.writableEnded) {
        controller.abort();
      }
    };

    req.once("aborted", handleRequestAborted);
    res.once("close", handleResponseClosed);

    try {
      if (!stream) {
        const data = await generateVector3DView(input, undefined, controller.signal);

        if (!controller.signal.aborted && !res.destroyed) {
          sendSuccess(res, data, requestId);
        }
        return;
      }

      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const data = await generateVector3DView(input, (stage) => {
        writeStreamEvent(res, {
          type: "stage",
          ...stage
        });
      }, controller.signal);
      writeStreamEvent(res, {
        type: "result",
        data
      });
    } catch (error) {
      if (!stream) {
        throw error;
      }

      const normalized = normalizeVector3DError(error);
      writeStreamEvent(res, {
        type: "error",
        error: {
          code: normalized.code,
          message: normalized.message,
          requestId,
          retryable: normalized.retryable
        }
      });
    } finally {
      completed = true;
      req.off("aborted", handleRequestAborted);
      res.off("close", handleResponseClosed);

      if (stream && !res.writableEnded && !res.destroyed) {
        res.end();
      }
    }
  }));

  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.destroyed || res.writableEnded) {
      return;
    }

    const normalized = normalizeVector3DError(error);
    const requestId =
      typeof res.locals.vector3dRequestId === "string"
        ? res.locals.vector3dRequestId
        : crypto.randomUUID();
    const apiError = createGenerationError({
      type:
        normalized.statusCode === 401 || normalized.statusCode === 403
          ? "auth"
          : normalized.statusCode === 429
            ? "rate_limit"
            : normalized.statusCode >= 500
              ? "upstream"
              : "validation",
      code: normalized.code,
      title: "3D 视角重塑失败",
      message: normalized.message,
      retryable: normalized.retryable,
      statusCode: normalized.statusCode
    });

    res.status(normalized.statusCode).json({
      success: false,
      error: apiError,
      requestId,
      serverTime: new Date().toISOString()
    });
  });

  return router;
}

function asyncRoute(route: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void route(req, res, next).catch(next);
  };
}

function writeStreamEvent(res: Response, event: Vector3DStreamEvent) {
  if (!res.writableEnded && !res.destroyed) {
    res.write(`${JSON.stringify(event)}\n`);
  }
}

function sendSuccess<T>(res: Response, data: T, requestId: string) {
  res.json({
    success: true,
    data,
    requestId,
    serverTime: new Date().toISOString()
  });
}

function normalizeVector3DError(error: unknown) {
  if (error instanceof Vector3DServiceError) {
    return error;
  }

  return new Vector3DServiceError(
    500,
    "VECTOR3D_GENERATION_FAILED",
    error instanceof Error ? error.message : "3D 视角重塑执行失败。",
    { retryable: true }
  );
}
