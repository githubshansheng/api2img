import type {
  GenerateVector3DViewRequest,
  GenerateVector3DViewResult,
  Vector3DGenerationStage,
  Vector3DRepairAnalysis,
  Vector3DStreamEvent
} from "../domain";
import { readApiResponse } from "./api-response-service";

export class Vector3DViewpointApiError extends Error {
  code?: string;
  requestId?: string;
  retryable: boolean;

  constructor(
    message: string,
    options: { code?: string; requestId?: string; retryable?: boolean } = {}
  ) {
    super(message);
    this.name = "Vector3DViewpointApiError";
    this.code = options.code;
    this.requestId = options.requestId;
    this.retryable = options.retryable ?? false;
  }
}

export async function generateVector3DView(
  payload: GenerateVector3DViewRequest,
  handlers: {
    onStage?: (
      stage: Vector3DGenerationStage,
      message: string,
      analysis?: Vector3DRepairAnalysis
    ) => void;
  } = {},
  signal?: AbortSignal
) {
  const response = await fetch("/api/generate-3d-view?stream=1", {
    method: "POST",
    headers: {
      Accept: "application/x-ndjson, application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal
  });
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/x-ndjson") || !response.body) {
    const body = await readApiResponse<GenerateVector3DViewResult>(response, {
      requestLabel: "3D 视角重塑"
    });

    if (!response.ok || !body.success || !body.data) {
      throw new Vector3DViewpointApiError(body.error?.message ?? "3D 视角重塑失败", {
        code: body.error?.code,
        requestId: body.requestId,
        retryable: body.error?.retryable
      });
    }

    return body.data;
  }

  return readVector3DStream(response.body, handlers);
}

async function readVector3DStream(
  stream: ReadableStream<Uint8Array>,
  handlers: {
    onStage?: (
      stage: Vector3DGenerationStage,
      message: string,
      analysis?: Vector3DRepairAnalysis
    ) => void;
  }
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: GenerateVector3DViewResult | undefined;

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const event = parseStreamEvent(line);

      if (!event) {
        continue;
      }

      if (event.type === "stage") {
        handlers.onStage?.(event.stage, event.message, event.analysis);
      } else if (event.type === "result") {
        result = event.data;
      } else {
        throw new Vector3DViewpointApiError(event.error.message, {
          code: event.error.code,
          requestId: event.error.requestId,
          retryable: event.error.retryable
        });
      }
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    const event = parseStreamEvent(buffer);

    if (event?.type === "result") {
      result = event.data;
    } else if (event?.type === "error") {
      throw new Vector3DViewpointApiError(event.error.message, {
        code: event.error.code,
        requestId: event.error.requestId,
        retryable: event.error.retryable
      });
    }
  }

  if (!result) {
    throw new Vector3DViewpointApiError("服务端流已结束，但没有返回重塑图像。", {
      code: "VECTOR3D_STREAM_INCOMPLETE",
      retryable: true
    });
  }

  return result;
}

function parseStreamEvent(line: string): Vector3DStreamEvent | undefined {
  const value = line.trim();

  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as Vector3DStreamEvent;
  } catch {
    throw new Vector3DViewpointApiError("服务端返回了无法解析的进度事件。", {
      code: "VECTOR3D_STREAM_INVALID",
      retryable: true
    });
  }
}
