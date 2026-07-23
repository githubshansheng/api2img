import express, {
  type NextFunction,
  type Request,
  type Response
} from "express";
import type {
  SingleImageViewpointRequest,
  SingleImageViewpointStreamEvent
} from "../../src/domain";
import { createGenerationError } from "../../src/services/error-service";
import {
  generateSingleImageViewpoint,
  SingleImageViewpointServiceError
} from "./single-image-viewpoint-service";

export function createSingleImageViewpointRouter() {
  const router = express.Router();

  router.post(
    "/",
    asyncRoute(async (req, res) => {
      const rawInput = req.body as Partial<SingleImageViewpointRequest>;
      const requestId = rawInput.requestId?.trim() || crypto.randomUUID();
      const input = {
        ...rawInput,
        requestId
      };
      const stream = req.query.stream === "1";
      const controller = new AbortController();
      let completed = false;
      res.locals.singleImageViewpointRequestId = requestId;

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
          const data = await generateSingleImageViewpoint(
            input,
            undefined,
            controller.signal
          );

          if (!controller.signal.aborted && !res.destroyed) {
            sendSuccess(res, data, requestId);
          }
          return;
        }

        res.status(200);
        res.setHeader(
          "Content-Type",
          "application/x-ndjson; charset=utf-8"
        );
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        const data = await generateSingleImageViewpoint(
          input,
          (stage) => {
            writeStreamEvent(res, {
              type: "stage",
              ...stage
            });
          },
          controller.signal
        );
        writeStreamEvent(res, {
          type: "result",
          data
        });
      } catch (error) {
        if (!stream) {
          throw error;
        }

        const normalized = normalizeSingleImageViewpointError(error);
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
    })
  );

  router.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (res.destroyed || res.writableEnded) {
        return;
      }

      const normalized = normalizeSingleImageViewpointError(error);
      const requestId =
        typeof res.locals.singleImageViewpointRequestId === "string"
          ? res.locals.singleImageViewpointRequestId
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
        title: "单图 AI 新视角生成失败",
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
    }
  );

  return router;
}

function asyncRoute(
  route: (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    void route(req, res, next).catch(next);
  };
}

function writeStreamEvent(
  res: Response,
  event: SingleImageViewpointStreamEvent
) {
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

function normalizeSingleImageViewpointError(error: unknown) {
  if (error instanceof SingleImageViewpointServiceError) {
    return error;
  }

  return new SingleImageViewpointServiceError(
    500,
    "SINGLE_VIEW_GENERATION_FAILED",
    error instanceof Error
      ? error.message
      : "单图 AI 新视角生成执行失败。",
    { retryable: true }
  );
}
