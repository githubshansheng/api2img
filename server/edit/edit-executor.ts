import { getModelById } from "../../src/config/models";
import type {
  EditAsset,
  EditSession,
  EditTurn,
  EndpointOverride,
  GeneratedImage,
  GenerationReferenceInput,
  ModelConfig,
  ModelRequestOverride,
  ProviderContinuationInput,
  UsageInfo
} from "../../src/domain";
import { createGenerationError } from "../../src/services/error-service";
import { applyModelRequestOverride } from "../../src/services/model-settings-service";
import {
  executeGenerationRequest,
  type GenerationExecutionResult
} from "../generation-executor";
import { EditAssetStore } from "./edit-assets";
import { composeNativeMaskLayers } from "./edit-mask-compositor";
import { EditProviderCircuitBreaker } from "./provider-circuit-breaker";

export type EditExecutionResult = {
  image: GeneratedImage;
  usage?: UsageInfo;
  durationMs: number;
  continuation: {
    provider: string;
    modelId: string;
    compatibilityKey: string;
    strategy: EditTurn["continuationStrategy"];
    responseId?: string;
    imageGenerationCallId?: string;
    interactionId?: string;
    opaqueMetadata?: Record<string, unknown>;
    expiresAt?: string;
  };
};

type GenerationExecutor = (
  input: Parameters<typeof executeGenerationRequest>[0],
  signal?: AbortSignal
) => Promise<GenerationExecutionResult>;

export class EditExecutor {
  private readonly assets: EditAssetStore;
  private readonly executeGeneration: GenerationExecutor;
  readonly circuitBreaker: EditProviderCircuitBreaker;

  constructor(input: {
    assets: EditAssetStore;
    executeGeneration?: GenerationExecutor;
    circuitBreaker?: EditProviderCircuitBreaker;
  }) {
    this.assets = input.assets;
    this.executeGeneration = input.executeGeneration ?? executeGenerationRequest;
    this.circuitBreaker = input.circuitBreaker ?? new EditProviderCircuitBreaker();
  }

  async execute(input: {
    session: EditSession;
    turn: EditTurn;
    requestId: string;
    endpointOverride?: EndpointOverride;
    modelOverride?: ModelRequestOverride;
    signal?: AbortSignal;
  }): Promise<EditExecutionResult> {
    const model = requireEditModel(input.turn.modelId, input.modelOverride);
    const materialized = await materializeTurnReferences(
      this.assets,
      input.session,
      input.turn,
      model
    );
    const compatibilityKey = buildContinuationCompatibilityKey(
      model,
      input.endpointOverride ?? input.turn.endpointOverride
    );
    const continuation = resolveCompatibleContinuation(
      input.session,
      input.turn,
      compatibilityKey,
      model
    );
    this.circuitBreaker.assertAvailable(model.provider);

    try {
      const execution = await this.executeGeneration(
        {
        requestId: input.requestId,
        modelId: model.id,
        modelOverride: input.modelOverride ?? input.turn.modelOverride,
        endpointOverride: input.endpointOverride,
        prompt: compileEditPrompt(input.turn, model, materialized.references.length),
        referenceImages: materialized.references,
        nativeMask: materialized.nativeMask,
        continuation,
        params: {
          ...input.turn.params,
          count: 1
        },
        options: {
          saveToHistory: false,
          storeResultToCloud: false,
          returnRawSummary: false,
          useCustomEndpoint: Boolean(
            input.endpointOverride?.baseURL || input.endpointOverride?.editURL
          )
        },
        clientContext: {
          page: "editing",
          lang: "zh-CN",
          timezone: "Asia/Shanghai",
          source: "image-editing-workbench"
        }
        },
        input.signal
      );

      if (!execution.success) {
        throw execution.error;
      }

      const result = execution.data.result;
      const image = result?.images.find((item) => !item.error);

      if (!image) {
        throw (
          result?.error ??
          createGenerationError({
            type: "upstream",
            code: "EDIT_NO_IMAGE",
            title: "上游未返回修图结果",
            message: "请求已完成，但响应中没有可保存的图片。",
            suggestion: "调整指令或切换支持以图修图的模型后重试。",
            retryable: true,
            mayHaveCharged: true
          })
        );
      }

      this.circuitBreaker.recordSuccess(model.provider);
      const strategy = resolveResultContinuationStrategy(
        model,
        input.turn,
        result?.continuation,
        input.endpointOverride
      );

      return {
        image,
        usage: result?.usage,
        durationMs: result?.durationMs ?? 0,
        continuation: {
          provider: model.provider,
          modelId: model.id,
          compatibilityKey,
          strategy,
          responseId: result?.continuation?.responseId,
          imageGenerationCallId: result?.continuation?.imageGenerationCallId,
          interactionId: result?.continuation?.interactionId,
          opaqueMetadata: result?.continuation?.opaqueMetadata,
          expiresAt:
            strategy === "reference" || strategy === "annotated-reference"
              ? undefined
              : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        }
      };
    } catch (error) {
      this.circuitBreaker.recordFailure(model.provider);
      throw error;
    }
  }

  providerHealth() {
    return this.circuitBreaker.snapshot();
  }
}

export function compileEditPrompt(
  turn: EditTurn,
  model: ModelConfig,
  referenceCount: number
) {
  const lines = [
    "你正在执行专业、非破坏性的图像编辑任务。",
    turn.mode === "merge"
      ? "参考图 1 是主版本；参考图 2 是合并来源。只融合指令明确要求的元素。"
      : "参考图 1 是当前编辑底图。",
    "严格保持未提及区域、主体身份、产品结构、Logo、文字内容、数量和构图关系不变。",
    `编辑指令：${turn.polishedInstruction ?? turn.originalInstruction}`
  ];

  if (turn.analysis?.protectedElements.length) {
    lines.push(`锁定不变：${turn.analysis.protectedElements.join("；")}`);
  }

  if (turn.mode === "local") {
    lines.push(
      model.editCapabilities.localMode === "native-mask"
        ? "最终有效选区已通过原生透明蒙版单独传入；只允许修改透明选区，蒙版外必须保持不变。"
        : "后续参考图为区域标注/蒙版参考，请根据区域标签执行修改，区域外不得变化。"
    );
  }

  turn.regions.forEach((region, index) => {
    const location =
      model.editCapabilities.localMode === "native-mask"
        ? `优先级 ${region.priority ?? index}`
        : `参考图 ${Math.min(
            referenceCount,
            turn.sourceVersionIds.length + index + 1
          )}，标记色 ${region.color}`;
    lines.push(
      `区域「${region.label}」（${location}）：${region.instruction || turn.polishedInstruction || turn.originalInstruction}`
    );
  });

  lines.push(
    "输出要求：只返回编辑后的完整图片；保持原图可识别性、透视、光照逻辑和边缘融合自然。"
  );

  return lines.join("\n");
}

async function materializeTurnReferences(
  assets: EditAssetStore,
  session: EditSession,
  turn: EditTurn,
  model: ModelConfig
) {
  const sourceAssets = turn.sourceVersionIds.map((versionId) => {
    const version = session.versions.find((item) => item.id === versionId);
    const asset = session.assets.find((item) => item.id === version?.assetId);

    if (!version || !asset) {
      throw createGenerationError({
        type: "storage",
        code: "EDIT_SOURCE_VERSION_MISSING",
        title: "源版本不可用",
        message: "修图任务引用的源版本或图片资产不存在。",
        retryable: false
      });
    }

    return asset;
  });
  const maskLayers = turn.regions
    .slice()
    .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0))
    .map((region) => {
      const asset = session.assets.find(
        (item) => item.id === region.maskAssetId
      );

      if (!asset) {
        throw createGenerationError({
          type: "storage",
          code: "EDIT_MASK_ASSET_MISSING",
          title: "局部蒙版不可用",
          message: `区域「${region.label}」引用的蒙版资产不存在。`,
          retryable: false
        });
      }

      return { asset, region };
    });
  const maskAssets = maskLayers.map((layer) => layer.asset);
  const useNativeMask =
    turn.mode === "local" &&
    model.editCapabilities.localMode === "native-mask" &&
    maskAssets.length > 0;
  const selectedAssets = selectReferenceAssets(
    sourceAssets,
    useNativeMask ? [] : maskAssets,
    model.capabilities.maxReferenceImages
  );
  const references = await Promise.all(
    selectedAssets.map((asset, index) => assets.materialize(asset, index))
  );

  const normalizedReferences = references.map((reference, index): GenerationReferenceInput => ({
    ...reference,
    order: index
  }));
  let nativeMaskImage: GenerationReferenceInput | undefined;
  let nativeMaskIsCanonical = false;

  if (useNativeMask) {
    const materializedMasks = await Promise.all(
      maskLayers.map(({ asset }, index) => assets.materialize(asset, index))
    );
    nativeMaskIsCanonical = maskLayers.every(
      ({ region }) => region.maskSemantics === "selection-alpha"
    );

    if (nativeMaskIsCanonical) {
      try {
        nativeMaskImage = composeNativeMaskLayers(
          materializedMasks.map((image, index) => ({
            image,
            mode: maskLayers[index]?.region.combinationMode
          })),
          {
            width: sourceAssets[0]?.width,
            height: sourceAssets[0]?.height
          }
        );
      } catch (error) {
        throw createGenerationError({
          type: "storage",
          code: "EDIT_NATIVE_MASK_COMPOSE_FAILED",
          title: "局部蒙版合成失败",
          message:
            error instanceof Error
              ? error.message
              : "无法生成供上游编辑接口使用的有效蒙版。",
          retryable: false
        });
      }
    } else {
      nativeMaskImage = materializedMasks[0];
    }
  }

  return {
    references: normalizedReferences,
    nativeMask: nativeMaskImage
      ? {
          image: {
            ...nativeMaskImage,
            order: 0
          },
          sourceImageIndex: 0,
          inverted: nativeMaskIsCanonical
            ? false
            : turn.regions[0]?.inverted
        }
      : undefined
  };
}

function selectReferenceAssets(
  sources: EditAsset[],
  masks: EditAsset[],
  maxReferences: number
) {
  const limit = Math.max(1, Math.floor(maxReferences));
  const requiredSources = sources.slice(0, Math.min(sources.length, limit));
  return [...requiredSources, ...masks.slice(0, Math.max(0, limit - requiredSources.length))];
}

function requireEditModel(modelId: string, override?: ModelRequestOverride) {
  const model = getModelById(modelId);

  if (!model || !model.enabled) {
    throw createGenerationError({
      type: "validation",
      code: "EDIT_MODEL_NOT_FOUND",
      title: "修图模型不可用",
      message: "请选择一个已启用的图片模型。",
      retryable: false
    });
  }

  const runtimeModel = applyModelRequestOverride(model, override);

  if (
    !runtimeModel.editCapabilities.supportsWholeImageEdit ||
    !runtimeModel.capabilities.supportsImageToImage ||
    runtimeModel.capabilities.maxReferenceImages < 1
  ) {
    throw createGenerationError({
      type: "validation",
      code: "EDIT_MODEL_REFERENCE_REQUIRED",
      title: "模型不支持以图修图",
      message: "当前模型不能接收参考图，请切换到支持图片输入的模型。",
      retryable: false
    });
  }

  return runtimeModel;
}

function resolveContinuationStrategy(model: ModelConfig, turn: EditTurn) {
  if (turn.mode === "local" && model.editCapabilities.localMode === "annotated-reference") {
    return "annotated-reference" as const;
  }

  return model.editCapabilities.continuationMode;
}

export function buildContinuationCompatibilityKey(
  model: ModelConfig,
  endpointOverride?: EndpointOverride
) {
  const endpoint = (
    endpointOverride?.editURL ??
    endpointOverride?.baseURL ??
    model.editURL ??
    model.baseURL
  )
    .trim()
    .replace(/\/+$/, "");
  const variant = endpointOverride?.endpointVariant ?? model.endpointType;

  return [
    model.provider,
    model.id,
    model.apiModelName,
    endpoint,
    variant,
    "edit-params-v2"
  ].join("|");
}

function resolveCompatibleContinuation(
  session: EditSession,
  turn: EditTurn,
  compatibilityKey: string,
  model: ModelConfig
): ProviderContinuationInput | undefined {
  const sourceVersionId = turn.sourceVersionIds[0];
  const continuation = session.continuations
    .filter((item) => item.versionId === sourceVersionId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

  if (
    !continuation ||
    continuation.compatibilityKey !== compatibilityKey ||
    continuation.provider !== model.provider ||
    continuation.modelId !== model.id ||
    (continuation.expiresAt && new Date(continuation.expiresAt).getTime() <= Date.now()) ||
    !["openai-response", "gemini-context"].includes(continuation.strategy)
  ) {
    return undefined;
  }

  return {
    provider: continuation.provider,
    modelId: continuation.modelId,
    compatibilityKey: continuation.compatibilityKey,
    strategy: continuation.strategy as "openai-response" | "gemini-context",
    responseId: continuation.responseId,
    imageGenerationCallId: continuation.imageGenerationCallId,
    interactionId: continuation.interactionId,
    opaqueMetadata: continuation.opaqueMetadata,
    expiresAt: continuation.expiresAt
  };
}

function resolveResultContinuationStrategy(
  model: ModelConfig,
  turn: EditTurn,
  continuation: {
    responseId?: string;
    interactionId?: string;
    opaqueMetadata?: Record<string, unknown>;
  } | undefined,
  endpointOverride?: EndpointOverride
) {
  if (
    continuation?.responseId &&
    (endpointOverride?.endpointVariant ?? model.endpointType) === "responses"
  ) {
    return "openai-response" as const;
  }

  if (
    model.provider === "google" &&
    (continuation?.interactionId || continuation?.opaqueMetadata)
  ) {
    return "gemini-context" as const;
  }

  return resolveContinuationStrategy(model, turn);
}
