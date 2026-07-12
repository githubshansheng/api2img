import cors from "cors";
import express from "express";
import type { Response as ExpressResponse } from "express";
import path from "node:path";
import { DEFAULT_MODEL_ID, getEnabledModels, getModelById } from "../src/config/models";
import type {
  AdapterHttpRequest,
  AdapterHttpResponse,
  BootstrapConfig,
  GenerationRequestPayload
} from "../src/domain";
import { createGenerationError, normalizeGenerationError } from "../src/services/error-service";
import { findInvalidHeaderValueCharacter } from "../src/services/http-header-service";
import { applyModelRequestOverride } from "../src/services/model-settings-service";
import {
  buildReasoningHttpRequest,
  buildRecognitionChatCompletionsBody,
  buildRecognitionHttpRequest,
  extractResponsesErrorCode,
  extractResponsesErrorMessage,
  parseUtilityTextResult,
  summarizeUtilityRequest,
  type ReasoningRequestPayload,
  type RecognitionRequestPayload
} from "../src/services/responses-api-service";
import { executeGenerationRequest } from "./generation-executor";
import { GenerationSuiteAssetStore } from "./suite/suite-assets";
import { createGenerationSuiteRouter } from "./suite/suite-router";
import { GenerationSuiteService } from "./suite/suite-service";
import { GenerationSuiteStore } from "./suite/suite-store";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const suiteDataDirectory = path.resolve(
  process.env.API2IMG_DATA_DIR ?? path.join(process.cwd(), ".data", "suites")
);
const remoteImageHostAllowlist = (process.env.API2IMG_REMOTE_IMAGE_HOSTS ?? "")
  .split(",")
  .map((hostname) => hostname.trim())
  .filter(Boolean);
const generationSuiteService = new GenerationSuiteService({
  store: new GenerationSuiteStore(path.join(suiteDataDirectory, "generation-suites.sqlite")),
  assets: new GenerationSuiteAssetStore(
    path.join(suiteDataDirectory, "assets"),
    "/api/generation-suites/assets",
    {
      archiveRemoteImages: process.env.API2IMG_ARCHIVE_REMOTE_IMAGES !== "false",
      remoteHostAllowlist: remoteImageHostAllowlist
    }
  )
});

app.use(cors());
app.use(express.json({ limit: "100mb" }));

const now = new Date().toISOString();

const bootstrap = {
  appVersion: "0.1.0",
  lang: "zh-CN",
  serverTime: now,
  generatedAt: now,
  promptTemplateVersion: "local-dev",
  models: getEnabledModels(),
  defaultModelId: DEFAULT_MODEL_ID,
  featureFlags: {
    enableBatch: true,
    enableCompare: true,
    enableHistory: true,
    enableAssetTemplates: true,
    enableRecognition: true,
    enableReasoning: true,
    enableLocalArchive: true,
    enableCustomStorage: true,
    enablePromptOptimize: false,
    enableRealKeyInCurl: true
  },
  navItems: [
    { key: "studio", label: "GPT Studio", enabled: true },
    { key: "generation", label: "生成图片", enabled: true },
    { key: "compare", label: "模型对比", enabled: true },
    { key: "history", label: "历史记录", enabled: true },
    { key: "assets", label: "素材模板", enabled: true },
    { key: "recognition", label: "识别图片", enabled: true },
    { key: "reasoning", label: "推理测试", enabled: true },
    { key: "settings", label: "设置", enabled: true }
  ],
  notices: [
    {
      id: "p0-start",
      level: "info",
      title: "里程碑功能已启用",
      content: "生成、批量、历史、模板、对比、识图、推理和高级设置均可使用。",
      priority: 1,
      enabled: true
    }
  ]
} satisfies BootstrapConfig;

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    data: {
      status: "ok",
      service: "api2image-bff",
      checkedAt: new Date().toISOString()
    },
    requestId: crypto.randomUUID(),
    serverTime: new Date().toISOString()
  });
});

app.get("/api/config/bootstrap", (_req, res) => {
  res.json({
    success: true,
    data: bootstrap,
    requestId: crypto.randomUUID(),
    serverTime: new Date().toISOString()
  });
});

app.post("/api/recognition/analyze", async (req, res) => {
  const input = req.body as Partial<RecognitionRequestPayload>;
  const requestId = input.requestId ?? crypto.randomUUID();
  const model = input.modelId ? getModelById(input.modelId) : undefined;

  if (!model || !model.enabled) {
    sendApiFailure(res, 400, requestId, "MODEL_NOT_FOUND", "模型不可用", "请选择可用模型后再开始识图。");
    return;
  }

  const runtimeModel = applyModelRequestOverride(model, input.modelOverride);
  const images = Array.isArray(input.images) ? input.images : [];

  if (images.length === 0) {
    sendApiFailure(res, 400, requestId, "IMAGE_REQUIRED", "缺少识别图片", "请先上传至少一张图片。");
    return;
  }

  if (!input.endpointOverride?.apiKey?.trim()) {
    sendApiFailure(res, 400, requestId, "API_KEY_REQUIRED", "缺少 API Key", "请先在设置中保存主 Key 或模型 Key。");
    return;
  }

  try {
    const body = buildRecognitionChatCompletionsBody({
      modelName: runtimeModel.apiModelName,
      role: input.role ?? "universal",
      question: input.question ?? "",
      images
    });
    const adapterRequest = buildRecognitionHttpRequest({
      model: runtimeModel,
      body,
      endpointOverride: input.endpointOverride
    });

    await executeResponsesRequest({
      res,
      requestId,
      runtimeModel,
      adapterRequest,
      requestPreview: {
        endpointStyle: "chat-completions",
        ...body
      }
    });
  } catch (error) {
    sendApiFailure(
      res,
      400,
      requestId,
      "RECOGNITION_REQUEST_INVALID",
      "识图请求参数错误",
      getErrorMessage(error)
    );
  }
});

app.post("/api/reasoning/test", async (req, res) => {
  const input = req.body as Partial<ReasoningRequestPayload>;
  const requestId = input.requestId ?? crypto.randomUUID();
  const model = input.modelId ? getModelById(input.modelId) : undefined;

  if (!model || !model.enabled) {
    sendApiFailure(res, 400, requestId, "MODEL_NOT_FOUND", "模型不可用", "请选择可用模型后再开始推理测试。");
    return;
  }

  const requestedModelName = input.modelName?.trim();
  const runtimeModel = applyModelRequestOverride(model, {
    ...input.modelOverride,
    apiModelName: requestedModelName || input.modelOverride?.apiModelName
  });

  if (!input.endpointOverride?.apiKey?.trim()) {
    sendApiFailure(res, 400, requestId, "API_KEY_REQUIRED", "缺少 API Key", "请先在设置中保存主 Key 或模型 Key。");
    return;
  }

  try {
    const adapterRequest = buildReasoningHttpRequest({
      model: runtimeModel,
      platform: input.platform ?? "openai",
      modelName: runtimeModel.apiModelName,
      effort: input.effort ?? "medium",
      maxTokens: input.maxTokens ?? 1024,
      prompt: input.prompt ?? "",
      referenceImages: Array.isArray(input.referenceImages) ? input.referenceImages : [],
      apiStyle: input.apiStyle,
      wantSummary: input.wantSummary,
      endpointOverride: input.endpointOverride
    });

    await executeResponsesRequest({
      res,
      requestId,
      runtimeModel,
      adapterRequest,
      requestPreview: {
        platform: input.platform ?? "openai",
        apiStyle: input.apiStyle,
        wantSummary: input.wantSummary,
        ...(adapterRequest.body && typeof adapterRequest.body === "object" ? (adapterRequest.body as Record<string, unknown>) : {})
      }
    });
  } catch (error) {
    sendApiFailure(
      res,
      400,
      requestId,
      "REASONING_REQUEST_INVALID",
      "推理请求参数错误",
      getErrorMessage(error)
    );
  }
});

app.post("/api/generations", async (req, res) => {
  const execution = await executeGenerationRequest(req.body as Partial<GenerationRequestPayload>);

  res.status(execution.statusCode).json({
    success: execution.success,
    data: execution.success ? execution.data : undefined,
    error: execution.success ? undefined : execution.error,
    requestId: execution.requestId,
    serverTime: new Date().toISOString()
  });
});

app.use("/api/generation-suites", createGenerationSuiteRouter(generationSuiteService));

async function executeResponsesRequest(input: {
  res: ExpressResponse;
  requestId: string;
  runtimeModel: ReturnType<typeof applyModelRequestOverride>;
  adapterRequest: AdapterHttpRequest;
  requestPreview: Record<string, unknown>;
}) {
  const upstreamResponse = await sendAdapterHttpRequest(input.adapterRequest);

  if (upstreamResponse.statusCode >= 400) {
    const upstreamCode = extractResponsesErrorCode(upstreamResponse.body) ?? String(upstreamResponse.statusCode);
    const upstreamMessage = extractResponsesErrorMessage(upstreamResponse.body);
    const signal =
      upstreamCode === "UPSTREAM_TIMEOUT"
        ? ("timeout" as const)
        : upstreamCode === "UPSTREAM_REQUEST_FAILED"
          ? ("network" as const)
          : undefined;
    const error = normalizeGenerationError({
      statusCode: upstreamResponse.statusCode,
      upstreamCode,
      upstreamMessage,
      model: input.runtimeModel,
      rawBody: upstreamResponse.body,
      signal
    });

    input.res.status(upstreamResponse.statusCode).json({
      success: false,
      error,
      requestId: input.requestId,
      serverTime: new Date().toISOString()
    });
    return;
  }

  const parsed = parseUtilityTextResult(upstreamResponse.body, input.adapterRequest);

  if (!parsed.outputText) {
    const error = createGenerationError({
      type: "upstream",
      code: "NO_TEXT_OUTPUT",
      title: "上游未返回文本结果",
      message: "真实接口已返回响应，但没有解析到可展示的文本输出。",
      suggestion: "请检查当前平台、模型名和 API 端点是否匹配，或切换可用模型后重试。",
      retryable: true,
      mayHaveCharged: true,
      statusCode: 502,
      upstreamStatus: upstreamResponse.statusCode,
      safeDetails: `status=${upstreamResponse.statusCode}; model=${input.runtimeModel.apiModelName}`
    });

    input.res.status(502).json({
      success: false,
      error,
      requestId: input.requestId,
      serverTime: new Date().toISOString()
    });
    return;
  }

  input.res.json({
    success: true,
    data: {
      requestId: input.requestId,
      status: "success",
      modelId: input.runtimeModel.id,
      modelName: input.runtimeModel.apiModelName,
      endpoint: input.adapterRequest.url,
      outputText: parsed.outputText,
      thinkingText: parsed.thinkingText,
      usage: parsed.usage,
      durationMs: upstreamResponse.durationMs,
      requestPreview: input.requestPreview,
      rawResponseSummary: parsed.rawResponseSummary,
      adapterRequest: summarizeUtilityRequest(input.adapterRequest)
    },
    requestId: input.requestId,
    serverTime: new Date().toISOString()
  });
}

function sendApiFailure(
  res: ExpressResponse,
  statusCode: number,
  requestId: string,
  code: string,
  title: string,
  message: string
) {
  const error = createGenerationError({
    type: statusCode === 401 ? "auth" : "validation",
    code,
    title,
    message,
    retryable: false,
    statusCode
  });

  res.status(statusCode).json({
    success: false,
    error,
    requestId,
    serverTime: new Date().toISOString()
  });
}

async function sendAdapterHttpRequest(request: AdapterHttpRequest): Promise<AdapterHttpResponse> {
  const startedAt = Date.now();
  const invalidHeader = findInvalidAdapterHeader(request);

  if (invalidHeader) {
    return {
      statusCode: 400,
      headers: {},
      body: {
        error: {
          code: "INVALID_HTTP_HEADER_VALUE",
          message:
            invalidHeader.name.toLowerCase() === "authorization"
              ? "API Key 包含中文、换行或其它非法请求头字符，请重新粘贴真实 Key。"
              : `请求头 ${invalidHeader.name} 包含非法字符，请检查模型配置。`
        }
      },
      durationMs: Date.now() - startedAt
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: serializeAdapterRequestBody(request),
      signal: controller.signal
    });

    return {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await parseUpstreamBody(response),
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    const timeoutReached = getErrorName(error) === "AbortError";
    const details = buildUpstreamFailureDetails(error, request);

    return {
      statusCode: timeoutReached ? 504 : 502,
      headers: {},
      body: {
        error: {
          code: timeoutReached ? "UPSTREAM_TIMEOUT" : "UPSTREAM_REQUEST_FAILED",
          message: timeoutReached ? "上游生成请求超时。" : getErrorMessage(error),
          details
        }
      },
      durationMs: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timeout);
  }
}

function findInvalidAdapterHeader(request: AdapterHttpRequest) {
  for (const [name, value] of Object.entries(request.headers)) {
    const invalid = findInvalidHeaderValueCharacter(value);

    if (invalid) {
      return {
        name,
        value,
        invalid
      };
    }
  }

  return undefined;
}

function serializeAdapterRequestBody(request: AdapterHttpRequest) {
  if (typeof request.body === "string") {
    return request.body;
  }

  if (request.body instanceof FormData) {
    return request.body;
  }

  return JSON.stringify(request.body);
}

async function parseUpstreamBody(response: Response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return { rawText: text };
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { rawText: text };
  }
}

function getErrorName(error: unknown) {
  if (typeof error === "object" && error !== null && "name" in error) {
    return String((error as { name?: unknown }).name);
  }

  return "";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "无法连接上游图片生成服务。";
}

function buildUpstreamFailureDetails(error: unknown, request: AdapterHttpRequest) {
  return [
    "source=bff",
    `target=${describeRequestTarget(request.url)}`,
    `method=${request.method}`,
    `timeoutMs=${request.timeoutMs}`,
    getErrorName(error) ? `error.name=${truncateDiagnosticValue(getErrorName(error), 80)}` : undefined,
    getErrorCauseCode(error) ? `cause.code=${truncateDiagnosticValue(getErrorCauseCode(error) ?? "", 80)}` : undefined,
    getErrorCauseMessage(error)
      ? `cause.message=${truncateDiagnosticValue(getErrorCauseMessage(error) ?? "", 160)}`
      : undefined
  ]
    .filter(Boolean)
    .join("; ");
}

function describeRequestTarget(url: string) {
  try {
    const parsed = new URL(url);

    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return truncateDiagnosticValue(url.split("?")[0] ?? url, 160);
  }
}

function getErrorCauseCode(error: unknown) {
  const cause = error instanceof Error ? error.cause : undefined;

  if (typeof cause === "object" && cause !== null && "code" in cause) {
    return String((cause as { code?: unknown }).code);
  }

  return undefined;
}

function getErrorCauseMessage(error: unknown) {
  const cause = error instanceof Error ? error.cause : undefined;

  if (cause instanceof Error && cause.message) {
    return cause.message;
  }

  if (typeof cause === "object" && cause !== null && "message" in cause) {
    return String((cause as { message?: unknown }).message);
  }

  return undefined;
}

function truncateDiagnosticValue(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      id: crypto.randomUUID(),
      type: "validation",
      code: "NOT_FOUND",
      title: "接口不存在",
      message: `Route ${req.method} ${req.path} does not exist`,
      retryable: false
    },
    requestId: crypto.randomUUID(),
    serverTime: new Date().toISOString()
  });
});

app.listen(port, () => {
  console.log(`[api2image-bff] listening on http://localhost:${port}`);
});
