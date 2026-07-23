import type {
  SingleImageCameraPrompt,
  SingleImagePromptLanguage,
  SingleImageViewpointAnalysis,
  SingleImageViewpointRequest,
  SingleImageViewpointResult,
  SingleImageViewpointStage,
  SingleImageViewpointStreamEvent
} from "../domain";
import {
  findSingleImagePromptConflict,
  SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER,
  SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER_EN
} from "../domain";
import { readApiResponse } from "./api-response-service";
import {
  appendDebugLog,
  describeDebugError
} from "./debug-log-service";

export class SingleImageViewpointApiError extends Error {
  code?: string;
  retryable: boolean;

  constructor(
    message: string,
    options: { code?: string; retryable?: boolean } = {}
  ) {
    super(message);
    this.name = "SingleImageViewpointApiError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
  }
}

export type SingleImageCameraProtocolIssue =
  | "missing-camera-prompt"
  | "camera-marker-mismatch"
  | "render-marker-missing"
  | "render-camera-block-mismatch"
  | "legacy-camera-conflict";

export function inspectSingleImageCameraProtocol(input: {
  cameraPrompt?: Pick<
    SingleImageCameraPrompt,
    "deterministicPromptZh" | "deterministicPromptEn"
  >;
  renderPrompt?: string;
  promptLanguage?: SingleImagePromptLanguage;
}): SingleImageCameraProtocolIssue | undefined {
  const promptLanguage = input.promptLanguage ?? "zh";
  const cameraProtocol =
    promptLanguage === "en"
      ? input.cameraPrompt?.deterministicPromptEn
      : input.cameraPrompt?.deterministicPromptZh;
  const protocolMarker =
    promptLanguage === "en"
      ? SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER_EN
      : SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER;
  const renderProtocol = input.renderPrompt;

  if (!cameraProtocol) {
    return "missing-camera-prompt";
  }

  if (!cameraProtocol.includes(protocolMarker)) {
    return "camera-marker-mismatch";
  }

  if (renderProtocol && !renderProtocol.includes(protocolMarker)) {
    return "render-marker-missing";
  }

  if (renderProtocol && !renderProtocol.includes(cameraProtocol)) {
    return "render-camera-block-mismatch";
  }

  if (
    [cameraProtocol, renderProtocol].some(
      (prompt) => Boolean(prompt && findSingleImagePromptConflict(prompt))
    )
  ) {
    return "legacy-camera-conflict";
  }

  return undefined;
}

export function isCurrentSingleImageCameraProtocol(input: {
  cameraPrompt?: Pick<
    SingleImageCameraPrompt,
    "deterministicPromptZh" | "deterministicPromptEn"
  >;
  renderPrompt?: string;
  promptLanguage?: SingleImagePromptLanguage;
}) {
  return inspectSingleImageCameraProtocol(input) === undefined;
}

export function assertCurrentSingleImageCameraProtocol(input: {
  cameraPrompt?: Pick<
    SingleImageCameraPrompt,
    "deterministicPromptZh" | "deterministicPromptEn"
  >;
  renderPrompt?: string;
  promptLanguage?: SingleImagePromptLanguage;
}) {
  const issue = inspectSingleImageCameraProtocol(input);

  if (issue) {
    throw new SingleImageViewpointApiError(
      formatCameraProtocolIssueMessage(issue),
      {
        code: "SINGLE_VIEW_CAMERA_PROTOCOL_MISMATCH",
        retryable: true
      }
    );
  }
}

export async function generateSingleImageViewpoint(
  payload: SingleImageViewpointRequest,
  handlers: {
    onStage?: (
      stage: SingleImageViewpointStage,
      message: string,
      analysis?: SingleImageViewpointAnalysis,
      cameraPrompt?: SingleImageCameraPrompt,
      renderPrompt?: string,
      promptLanguage?: SingleImagePromptLanguage
    ) => void;
  } = {},
  signal?: AbortSignal
) {
  const startedAt = Date.now();
  appendDebugLog({
    level: "info",
    category: "single-view",
    message: `提交${payload.prompt_language === "zh" ? "中文" : "英文"}单图新视角请求`,
    requestId: payload.requestId,
    details: {
      endpoint: "/api/single-image-viewpoint?stream=1",
      promptLanguage: payload.prompt_language ?? "zh",
      reasoningModel: payload.reasoning_model,
      imageModel: payload.image_model,
      rotationDegrees: payload.rotation_degrees,
      cameraDistance: payload.camera_distance,
      outputSize: payload.output_size,
      sourceSize: {
        width: payload.source_width,
        height: payload.source_height
      },
      inputImages: {
        sourceImageProvided: Boolean(payload.source_image),
        sourceImageCharacters: payload.source_image.length,
        poseGuideImageProvided: Boolean(payload.pose_guide_image),
        poseGuideImageCharacters: payload.pose_guide_image.length,
        fullCameraPoseImageProvided: Boolean(payload.camera_pose_image),
        fullCameraPoseImageCharacters: payload.camera_pose_image.length
      },
      endpointOverride: {
        baseURL: payload.endpoint_override?.baseURL,
        editURL: payload.endpoint_override?.editURL,
        headerNames: Object.keys(payload.endpoint_override?.headers ?? {})
      }
    }
  });

  try {
    const response = await fetch("/api/single-image-viewpoint?stream=1", {
      method: "POST",
      headers: {
        Accept: "application/x-ndjson, application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal
    });
    const contentType = response.headers.get("content-type") ?? "";

    appendDebugLog({
      level: response.ok ? "info" : "warn",
      category: "single-view",
      message: "单图新视角后端连接已建立",
      requestId: payload.requestId,
      durationMs: Date.now() - startedAt,
      details: {
        status: response.status,
        statusText: response.statusText,
        contentType,
        streamAvailable: Boolean(response.body)
      }
    });

    if (!contentType.includes("application/x-ndjson") || !response.body) {
      const body = await readApiResponse<SingleImageViewpointResult>(
        response,
        {
          requestLabel: "单图 AI 新视角"
        }
      );

      if (!response.ok || !body.success || !body.data) {
        throw new SingleImageViewpointApiError(
          body.error?.message ?? "单图 AI 新视角生成失败",
          {
            code: body.error?.code,
            retryable: body.error?.retryable
          }
        );
      }

      assertCurrentSingleImageCameraProtocol(body.data);
      logSingleImageResult(body.data, startedAt);
      return body.data;
    }

    return await readSingleImageViewpointStream(
      response.body,
      handlers,
      {
        requestId: payload.requestId,
        promptLanguage: payload.prompt_language ?? "zh",
        startedAt
      }
    );
  } catch (error) {
    appendDebugLog({
      level:
        error instanceof Error && error.name === "AbortError"
          ? "warn"
          : "error",
      category: "single-view",
      message:
        error instanceof Error && error.name === "AbortError"
          ? "单图新视角请求已取消"
          : "单图新视角请求失败",
      requestId: payload.requestId,
      durationMs: Date.now() - startedAt,
      details: {
        promptLanguage: payload.prompt_language ?? "zh",
        error: describeDebugError(error)
      }
    });
    throw error;
  }
}

async function readSingleImageViewpointStream(
  stream: ReadableStream<Uint8Array>,
  handlers: {
    onStage?: (
      stage: SingleImageViewpointStage,
      message: string,
      analysis?: SingleImageViewpointAnalysis,
      cameraPrompt?: SingleImageCameraPrompt,
      renderPrompt?: string,
      promptLanguage?: SingleImagePromptLanguage
    ) => void;
  },
  context: {
    requestId: string;
    promptLanguage: SingleImagePromptLanguage;
    startedAt: number;
  }
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: SingleImageViewpointResult | undefined;

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
        logProtocolInspection(event, context);
        assertCurrentSingleImageCameraProtocol(event);
        appendDebugLog({
          level: "info",
          category: "single-view",
          message: `收到单图新视角阶段：${event.stage}`,
          requestId: context.requestId,
          durationMs: Date.now() - context.startedAt,
          details: {
            stage: event.stage,
            promptLanguage:
              event.promptLanguage ?? context.promptLanguage,
            message: event.message,
            analysisAvailable: Boolean(event.analysis),
            cameraPromptAvailable: Boolean(event.cameraPrompt),
            renderPromptCharacters: event.renderPrompt?.length ?? 0
          }
        });
        handlers.onStage?.(
          event.stage,
          event.message,
          event.analysis,
          event.cameraPrompt,
          event.renderPrompt,
          event.promptLanguage
        );
      } else if (event.type === "result") {
        logProtocolInspection(event.data, context);
        assertCurrentSingleImageCameraProtocol(event.data);
        result = event.data;
        logSingleImageResult(event.data, context.startedAt);
      } else {
        appendDebugLog({
          level: "error",
          category: "single-view",
          message: "单图新视角流返回错误事件",
          requestId: event.error.requestId ?? context.requestId,
          durationMs: Date.now() - context.startedAt,
          details: {
            code: event.error.code,
            message: event.error.message,
            retryable: event.error.retryable,
            promptLanguage: context.promptLanguage
          }
        });
        throw new SingleImageViewpointApiError(event.error.message, {
          code: event.error.code,
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
      logProtocolInspection(event.data, context);
      assertCurrentSingleImageCameraProtocol(event.data);
      result = event.data;
      logSingleImageResult(event.data, context.startedAt);
    } else if (event?.type === "error") {
      appendDebugLog({
        level: "error",
        category: "single-view",
        message: "单图新视角流结束时返回错误事件",
        requestId: event.error.requestId ?? context.requestId,
        durationMs: Date.now() - context.startedAt,
        details: {
          code: event.error.code,
          message: event.error.message,
          retryable: event.error.retryable,
          promptLanguage: context.promptLanguage
        }
      });
      throw new SingleImageViewpointApiError(event.error.message, {
        code: event.error.code,
        retryable: event.error.retryable
      });
    }
  }

  if (!result) {
    throw new SingleImageViewpointApiError(
      "服务端进度流已结束，但没有返回新视角图像。",
      {
        code: "SINGLE_VIEW_STREAM_INCOMPLETE",
        retryable: true
      }
    );
  }

  return result;
}

function logProtocolInspection(
  input: {
    cameraPrompt?: SingleImageCameraPrompt;
    renderPrompt?: string;
    promptLanguage?: SingleImagePromptLanguage;
  },
  context: {
    requestId: string;
    promptLanguage: SingleImagePromptLanguage;
    startedAt: number;
  }
) {
  const promptLanguage =
    input.promptLanguage ?? context.promptLanguage;
  const cameraProtocol =
    promptLanguage === "en"
      ? input.cameraPrompt?.deterministicPromptEn
      : input.cameraPrompt?.deterministicPromptZh;
  const marker =
    promptLanguage === "en"
      ? SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER_EN
      : SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER;
  const issue = inspectSingleImageCameraProtocol({
    ...input,
    promptLanguage
  });

  appendDebugLog({
    level: issue ? "error" : "debug",
    category: "single-view",
    message: issue
      ? `相机协议校验失败：${issue}`
      : "相机协议校验通过",
    requestId: context.requestId,
    durationMs: Date.now() - context.startedAt,
    details: {
      promptLanguage,
      issue,
      expectedMarker: marker,
      cameraPromptAvailable: Boolean(cameraProtocol),
      cameraPromptCharacters: cameraProtocol?.length ?? 0,
      cameraContainsMarker: cameraProtocol?.includes(marker) ?? false,
      renderPromptAvailable: Boolean(input.renderPrompt),
      renderPromptCharacters: input.renderPrompt?.length ?? 0,
      renderContainsMarker:
        input.renderPrompt?.includes(marker) ?? false,
      renderContainsExactCameraBlock:
        Boolean(
          cameraProtocol &&
            input.renderPrompt?.includes(cameraProtocol)
        ),
      legacyConflict:
        findSingleImagePromptConflict(
          input.renderPrompt ?? cameraProtocol ?? ""
        ) ?? null
    }
  });
}

function formatCameraProtocolIssueMessage(
  issue: SingleImageCameraProtocolIssue
) {
  switch (issue) {
    case "missing-camera-prompt":
      return "后端进度事件缺少确定性相机提示词，已拒绝显示本次结果。";
    case "camera-marker-mismatch":
      return "后端返回的相机提示词不是当前 10.6 协议，已拒绝显示本次结果。";
    case "render-marker-missing":
      return "后端最终提示词缺少 10.6 相机协议标记，已拒绝提交或显示本次结果。";
    case "render-camera-block-mismatch":
      return "后端最终提示词未包含完整的 10.6 锁定相机块，已拒绝提交或显示本次结果。";
    case "legacy-camera-conflict":
      return "后端最终提示词包含会覆盖目标机位的旧式冲突约束，已拒绝提交或显示本次结果。";
  }
}

function logSingleImageResult(
  result: SingleImageViewpointResult,
  startedAt: number
) {
  appendDebugLog({
    level: "info",
    category: "single-view",
    message: "单图新视角生成完成",
    requestId: result.requestId,
    durationMs: Date.now() - startedAt,
    details: {
      promptLanguage: result.promptLanguage,
      subjectCategory: result.subjectCategory,
      outputSize: result.outputSize,
      reasoningModel: result.reasoningModel,
      imageModel: result.imageModel,
      reasoningDurationMs: result.reasoningDurationMs,
      renderingDurationMs: result.renderingDurationMs,
      totalDurationMs: result.totalDurationMs,
      imageMimeType: result.imageMimeType,
      renderPromptCharacters: result.renderPrompt.length,
      cameraProtocolCharacters:
        result.cameraPrompt.deterministicPromptZh.length
    }
  });
}

function parseStreamEvent(
  line: string
): SingleImageViewpointStreamEvent | undefined {
  const value = line.trim();

  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as SingleImageViewpointStreamEvent;
  } catch {
    throw new SingleImageViewpointApiError(
      "服务端返回了无法解析的进度事件。",
      {
        code: "SINGLE_VIEW_STREAM_INVALID",
        retryable: true
      }
    );
  }
}
