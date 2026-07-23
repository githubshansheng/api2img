import { createHash } from "node:crypto";
import sharp from "sharp";
import type {
  SingleImageCameraPrompt,
  SingleImageCameraPose,
  SingleImageFrameSpec,
  SingleImagePromptLanguage,
  SingleImageSubjectCategory,
  SingleImageViewpointAnalysis,
  SingleImageViewpointRequest,
  SingleImageViewpointResult,
  XYZRotation
} from "../../src/domain";
import {
  buildSingleImageCameraPrompt,
  buildSingleImageCameraPose,
  calculateSingleImageOutputSize,
  DEFAULT_SINGLE_IMAGE_IMAGE_MODEL,
  DEFAULT_SINGLE_IMAGE_PROMPT_LANGUAGE,
  DEFAULT_SINGLE_IMAGE_REASONING_MODEL,
  DEFAULT_SINGLE_IMAGE_USER_PROMPT_EN,
  DEFAULT_SINGLE_IMAGE_USER_PROMPT_ZH,
  findSingleImagePromptConflict,
  SINGLE_IMAGE_CAMERA_DISTANCE_DEFAULT,
  SINGLE_IMAGE_CAMERA_DISTANCE_MAX,
  SINGLE_IMAGE_CAMERA_DISTANCE_MIN,
  SINGLE_IMAGE_VIEWPOINT_LIMITS,
} from "../../src/domain";
import { findInvalidHeaderValueCharacter } from "../../src/services/http-header-service";
import { stripKnownEndpointSuffix } from "../../src/services/model-endpoint-service";

const DEFAULT_OPENAI_ROOT = "https://api.openai.com";
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp"
]);
const REASONING_TIMEOUT_MS = 10 * 60 * 1000;
const REASONING_CACHE_TTL_MS = 5 * 60 * 1000;
const REASONING_CACHE_MAX_ENTRIES = 16;
const IMAGE_EDIT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_OUTPUT_EDGE = 3840;
const MIN_OUTPUT_PIXELS = 655_360;
const MAX_OUTPUT_PIXELS = 8_294_400;
const MAX_OUTPUT_ASPECT_RATIO = 3;

type ParsedDataURL = {
  mimeType: string;
  bytes: Uint8Array<ArrayBuffer>;
};

type NormalizedRequest = SingleImageViewpointRequest & {
  api_key: string;
  camera_distance: number;
  prompt_language: SingleImagePromptLanguage;
  cameraPrompt: SingleImageCameraPrompt;
  pose: SingleImageCameraPose;
  sourceDimensions?: {
    width: number;
    height: number;
  };
  endpoint_override: NonNullable<
    SingleImageViewpointRequest["endpoint_override"]
  >;
};

type SingleImageLocalizedReasoningPlan = {
  optimizedPrompt: string;
  sourceViewDescription: string;
  visibilityConstraints: string[];
  occlusionConstraints: string[];
  identityConstraints: string[];
  hiddenSurfacePlan: string[];
  scenePlan: string[];
  uncertaintyNotes: string[];
};

type SingleImageBilingualReasoningAnalysis = {
  subjectCategory: SingleImageSubjectCategory;
  zh: SingleImageLocalizedReasoningPlan;
  en: SingleImageLocalizedReasoningPlan;
};

type SingleImageReasoningCacheEntry = {
  expiresAt: number;
  promise: Promise<SingleImageBilingualReasoningAnalysis>;
};

const singleImageReasoningCache = new Map<
  string,
  SingleImageReasoningCacheEntry
>();

export class SingleImageViewpointServiceError extends Error {
  statusCode: number;
  code: string;
  retryable: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { retryable?: boolean } = {}
  ) {
    super(message);
    this.name = "SingleImageViewpointServiceError";
    this.statusCode = statusCode;
    this.code = code;
    this.retryable =
      options.retryable ?? (statusCode >= 500 || statusCode === 429);
  }
}

export async function generateSingleImageViewpoint(
  input: Partial<SingleImageViewpointRequest>,
  onStage?: (input: {
    stage: "reasoning" | "rendering";
    message: string;
    analysis?: SingleImageViewpointAnalysis;
    cameraPrompt?: SingleImageCameraPrompt;
    renderPrompt?: string;
    promptLanguage?: SingleImagePromptLanguage;
  }) => void,
  signal?: AbortSignal
): Promise<SingleImageViewpointResult> {
  const startedAt = Date.now();
  const request = validateSingleImageViewpointRequest(input);
  const sourceImage = parseImageDataURL(request.source_image, "source_image");
  const poseGuideImage = parseImageDataURL(
    request.pose_guide_image,
    "pose_guide_image"
  );
  const cameraPoseImage = parseImageDataURL(
    request.camera_pose_image,
    "camera_pose_image"
  );
  const endpoints = resolveSingleImageViewpointEndpoints(
    request.endpoint_override
  );
  const requestHeaders = buildRequestHeaders(
    request.api_key,
    request.endpoint_override.headers
  );

  onStage?.({
    stage: "reasoning",
    message: `${request.reasoning_model} 正在分析原图、目标投影与完整 XYZ 机位图`,
    cameraPrompt: request.cameraPrompt,
    promptLanguage: request.prompt_language
  });

  const reasoningStartedAt = Date.now();
  const bilingualAnalysis = await getSharedSingleImageReasoningAnalysis(
    request,
    endpoints.responses,
    requestHeaders,
    signal
  );
  const reasoningDurationMs = Date.now() - reasoningStartedAt;
  const analysis = selectSingleImageReasoningAnalysis(
    bilingualAnalysis,
    request.cameraPrompt,
    request.prompt_language
  );
  const renderPrompt = buildSingleImageAnalyzedRenderPrompt(
    analysis,
    request.pose,
    request.user_prompt,
    request.camera_distance,
    request.prompt_language,
    buildFrameSpec(request)
  );

  onStage?.({
    stage: "rendering",
    message: `${request.image_model} 正在使用${request.prompt_language === "en" ? "英文" : "中文"}提示词从目标新机位重新拍摄整个场景`,
    analysis,
    cameraPrompt: request.cameraPrompt,
    renderPrompt,
    promptLanguage: request.prompt_language
  });

  const renderingStartedAt = Date.now();
  const imageResponse = await requestJSON(
    endpoints.imageEdits,
    {
      method: "POST",
      headers: buildRequestHeaders(
        request.api_key,
        request.endpoint_override.headers,
        true
      ),
      body: buildSingleImageEditForm({
        request,
        renderPrompt,
        sourceImage,
        poseGuideImage,
        cameraPoseImage
      }),
      timeoutMs: IMAGE_EDIT_TIMEOUT_MS,
      label: "新视角图像生成"
    },
    signal
  );
  const parsedRenderedImage = parseSingleImageEditResponse(imageResponse);
  const renderedImage = request.sourceDimensions
    ? await normalizeSingleImageRenderedImage(
        parsedRenderedImage,
        request.output_size,
        signal
      )
    : parsedRenderedImage;
  const renderingDurationMs = Date.now() - renderingStartedAt;

  return {
    requestId: request.requestId,
    image: renderedImage.image,
    imageMimeType: renderedImage.mimeType,
    pose: request.pose,
    cameraPrompt: request.cameraPrompt,
    renderPrompt,
    promptLanguage: request.prompt_language,
    outputSize: request.output_size,
    subjectCategory: analysis.subjectCategory,
    optimizedPrompt: analysis.optimizedPrompt,
    viewDescription: analysis.viewDescription,
    sourceViewDescription: analysis.sourceViewDescription,
    targetViewDescription: analysis.targetViewDescription,
    relativeCameraMotion: analysis.relativeCameraMotion,
    visibilityConstraints: analysis.visibilityConstraints,
    occlusionConstraints: analysis.occlusionConstraints,
    identityConstraints: analysis.identityConstraints,
    hiddenSurfacePlan: analysis.hiddenSurfacePlan,
    scenePlan: analysis.scenePlan,
    uncertaintyNotes: analysis.uncertaintyNotes,
    reasoningModel: request.reasoning_model,
    imageModel: request.image_model,
    reasoningDurationMs,
    renderingDurationMs,
    totalDurationMs: Date.now() - startedAt
  };
}

export function validateSingleImageViewpointRequest(
  input: Partial<SingleImageViewpointRequest>
): NormalizedRequest {
  const requestId = input.requestId?.trim() || crypto.randomUUID();
  const sourceImage = requireString(input.source_image, "source_image");
  const poseGuideImage = requireString(
    input.pose_guide_image,
    "pose_guide_image"
  );
  const cameraPoseImage = requireString(
    input.camera_pose_image,
    "camera_pose_image"
  );
  const source = parseImageDataURL(sourceImage, "source_image");
  const guide = parseImageDataURL(poseGuideImage, "pose_guide_image");
  const cameraPose = parseImageDataURL(
    cameraPoseImage,
    "camera_pose_image"
  );

  if (
    source.bytes.byteLength >
    SINGLE_IMAGE_VIEWPOINT_LIMITS.sourceImageBytes
  ) {
    throw new SingleImageViewpointServiceError(
      413,
      "SINGLE_VIEW_SOURCE_TOO_LARGE",
      "原始参考图不能超过 20 MB。"
    );
  }

  if (
    guide.bytes.byteLength >
    SINGLE_IMAGE_VIEWPOINT_LIMITS.guideImageBytes
  ) {
    throw new SingleImageViewpointServiceError(
      413,
      "SINGLE_VIEW_GUIDE_TOO_LARGE",
      "姿态引导图不能超过 20 MB。"
    );
  }

  if (
    cameraPose.bytes.byteLength >
    SINGLE_IMAGE_VIEWPOINT_LIMITS.cameraPoseImageBytes
  ) {
    throw new SingleImageViewpointServiceError(
      413,
      "SINGLE_VIEW_CAMERA_POSE_TOO_LARGE",
      "完整机位图不能超过 20 MB。"
    );
  }

  if (
    source.bytes.byteLength +
      guide.bytes.byteLength +
      cameraPose.bytes.byteLength >
    SINGLE_IMAGE_VIEWPOINT_LIMITS.combinedImageBytes
  ) {
    throw new SingleImageViewpointServiceError(
      413,
      "SINGLE_VIEW_IMAGES_TOO_LARGE",
      "三张输入图片合计不能超过 48 MB。"
    );
  }

  const apiKey = input.api_key?.trim();

  if (!apiKey) {
    throw new SingleImageViewpointServiceError(
      400,
      "API_KEY_REQUIRED",
      "请先在设置中配置 API Key。"
    );
  }

  if (input.background_mode !== "preserve_scene") {
    throw new SingleImageViewpointServiceError(
      400,
      "SINGLE_VIEW_BACKGROUND_MODE_INVALID",
      "当前仅支持保持原场景的背景模式。"
    );
  }

  const rotation = validateXYZRotation(input.rotation_degrees);
  const cameraDistance = validateCameraDistance(input.camera_distance);
  const promptLanguage = validatePromptLanguage(input.prompt_language);
  const sourceDimensions = validateSourceDimensions(
    input.source_width,
    input.source_height
  );
  const pose = buildSingleImageCameraPose(rotation);
  const requestedOutputSize = validateOutputSize(input.output_size);
  const outputSize = sourceDimensions
    ? lockOutputSizeToSourceAspect(requestedOutputSize, sourceDimensions)
    : requestedOutputSize;
  const cameraPrompt = buildSingleImageCameraPrompt(
    rotation,
    cameraDistance,
    {
      sourceWidth: sourceDimensions?.width,
      sourceHeight: sourceDimensions?.height,
      outputSize
    }
  );

  return {
    requestId,
    source_image: sourceImage,
    pose_guide_image: poseGuideImage,
    camera_pose_image: cameraPoseImage,
    rotation_degrees: rotation,
    camera_distance: cameraDistance,
    source_width: sourceDimensions?.width,
    source_height: sourceDimensions?.height,
    prompt_language: promptLanguage,
    user_prompt:
      typeof input.user_prompt === "string" ? input.user_prompt.trim() : "",
    background_mode: "preserve_scene",
    api_key: apiKey,
    reasoning_model:
      input.reasoning_model?.trim() || DEFAULT_SINGLE_IMAGE_REASONING_MODEL,
    image_model:
      input.image_model?.trim() || DEFAULT_SINGLE_IMAGE_IMAGE_MODEL,
    output_size: outputSize,
    endpoint_override: {
      baseURL: input.endpoint_override?.baseURL?.trim(),
      editURL: input.endpoint_override?.editURL?.trim(),
      headers: sanitizeHeaders(input.endpoint_override?.headers)
    },
    pose,
    cameraPrompt,
    sourceDimensions
  };
}

export function buildSingleImageReasoningRequest(
  request: SingleImageViewpointRequest & {
    cameraPrompt?: SingleImageCameraPrompt;
    pose?: SingleImageCameraPose;
  }
) {
  const pose =
    request.pose ?? buildSingleImageCameraPose(request.rotation_degrees);
  const cameraPrompt =
    request.cameraPrompt ??
    buildSingleImageCameraPrompt(
      pose.cumulativeDegrees,
      request.camera_distance,
      {
        sourceWidth: request.source_width,
        sourceHeight: request.source_height,
        outputSize: request.output_size
      }
    );
  const localizedPlanSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      optimized_prompt: { type: "string" },
      source_view_description: { type: "string" },
      visibility_constraints: {
        type: "array",
        items: { type: "string" },
        maxItems: 4
      },
      occlusion_constraints: {
        type: "array",
        items: { type: "string" },
        maxItems: 4
      },
      identity_constraints: {
        type: "array",
        items: { type: "string" },
        maxItems: 4
      },
      hidden_surface_plan: {
        type: "array",
        items: { type: "string" },
        maxItems: 4
      },
      scene_plan: {
        type: "array",
        items: { type: "string" },
        maxItems: 4
      },
      uncertainty_notes: {
        type: "array",
        items: { type: "string" },
        maxItems: 4
      }
    },
    required: [
      "optimized_prompt",
      "source_view_description",
      "visibility_constraints",
      "occlusion_constraints",
      "identity_constraints",
      "hidden_surface_plan",
      "scene_plan",
      "uncertainty_notes"
    ]
  };

  return {
    model: request.reasoning_model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "你是单图新视角重绘的视觉事实分析师。快速检查三张图并输出精简双语 JSON。",
              "图像1是身份、结构、材质、文字、光线、画风和环境的唯一事实来源。",
              "图像2是无坐标轴的目标投影引导，只用于判断新投影中哪些真实结构会显露、缩短或遮挡。",
              "图像3是完整 XYZ 机位图，用于核对坐标轴、旋转环、Roll 和机位方向；它不会发送给生图模型。",
              `服务端只读机位参数：${JSON.stringify({
                cumulativeXYZ: pose.cumulativeDegrees,
                equivalentXYZ: pose.normalizedDegrees,
                azimuthDegrees: cameraPrompt.cameraAzimuthDegrees,
                elevationDegrees: cameraPrompt.cameraElevationDegrees,
                rollDegrees: cameraPrompt.cameraRollDegrees,
                cameraDistance: cameraPrompt.cameraDistance,
                azimuthLabelZh: cameraPrompt.azimuthLabelZh,
                elevationLabelZh: cameraPrompt.elevationLabelZh,
                distanceLabelZh: cameraPrompt.distanceLabelZh,
                viewerOrbitDirectionZh:
                  cameraPrompt.viewerOrbitDirectionZh,
                objectOrbitDirectionZh:
                  cameraPrompt.objectOrbitDirectionZh,
                sourceAspectRatio:
                  cameraPrompt.sourceAspectRatioLabel,
                outputSize: cameraPrompt.outputSize
              })}`,
              "规则：",
              "1. 不得输出或改写任何相机角度、方向、Roll、景别、构图命令；服务端相机块是唯一相机来源。",
              "1.1 左右必须同时使用两套参照：原图观看者的屏幕左右，以及被摄对象自身左右。对象大致正对原相机时，两套左右相反。任何可见/遮挡判断都不得把这两套坐标混为一谈。",
              "2. 识别主体类别和图像1中真实存在的身份、结构、材质、光影、场景层次与标记。",
              "3. 只按已识别类别规划新显露结构；非人物主体禁止出现人体器官、服饰或解剖描述。",
              "3.1 hidden_surface_plan 必须列出因目标偏航、俯仰、Roll 或景别变化而首次可见、但图像1未拍到或被遮挡的真实对象结构，并给出符合类别、构造、材质和连接关系的保守补全方案；不得用裁切、模糊或额外遮挡跳过。",
              "4. visibility/occlusion 必须点名真实结构并描述缩短、重叠、遮挡或显露，不使用“主体左/右侧表面”模板。",
              "5. scene_plan 覆盖前景、中景、背景、地面、墙面、环境物体和原图未覆盖空间，并识别原图的焦点区域、景深、背景虚化与镜头质感，不得只描述主体。",
              "5.1 scene_plan 必须明确补全因新视锥、新景别或新构图而进入画面、但图像1范围外没有记录的环境区域；依据原图空间关系和环境风格推断，不得把源图背景冻结、复制边缘或留空。",
              "5.2 输出画幅必须保持图像1的原始宽高比；不得建议横竖改版、拉伸、压扁、黑边或其他比例。",
              "6. 每个数组最多4条，每条一句；optimized_prompt 不超过120个英文词或180个汉字。",
              "7. zh 与 en 表达完全相同的事实；zh 用中文，en 用自然英文。用户附加约束由服务端另行追加。",
              "严格返回 schema 指定字段。"
            ].join("\n\n")
          },
          {
            type: "input_image",
            image_url: request.source_image,
            detail: "high"
          },
          {
            type: "input_image",
            image_url: request.pose_guide_image,
            detail: "low"
          },
          {
            type: "input_image",
            image_url: request.camera_pose_image,
            detail: "high"
          }
        ]
      }
    ],
    reasoning: {
      effort: "low"
    },
    text: {
      format: {
        type: "json_schema",
        name: "single_image_novel_view_plan",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            subject_category: {
              type: "string",
              enum: [
                "person",
                "animal",
                "product_object",
                "vehicle",
                "architecture_scene",
                "other"
              ]
            },
            zh: localizedPlanSchema,
            en: localizedPlanSchema
          },
          required: ["subject_category", "zh", "en"]
        }
      }
    },
    max_output_tokens: 3000
  };
}

export function parseSingleImageBilingualReasoningResponse(
  body: unknown
): SingleImageBilingualReasoningAnalysis {
  const outputText = extractResponseOutputText(body);

  if (!outputText) {
    throw new SingleImageViewpointServiceError(
      502,
      "SINGLE_VIEW_REASONING_EMPTY",
      "空间推理模型没有返回新视角规划。",
      { retryable: true }
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(stripJSONFence(outputText));
  } catch {
    throw new SingleImageViewpointServiceError(
      502,
      "SINGLE_VIEW_REASONING_INVALID_JSON",
      "空间推理模型返回的结果不是合法 JSON。",
      { retryable: true }
    );
  }

  if (!isRecord(parsed)) {
    throw new SingleImageViewpointServiceError(
      502,
      "SINGLE_VIEW_REASONING_INVALID",
      "空间推理结果结构无效。",
      { retryable: true }
    );
  }

  return {
    subjectCategory: readSubjectCategory(parsed.subject_category),
    zh: readLocalizedReasoningPlan(parsed.zh, "zh"),
    en: readLocalizedReasoningPlan(parsed.en, "en")
  };
}

async function getSharedSingleImageReasoningAnalysis(
  request: NormalizedRequest,
  responsesEndpoint: string,
  requestHeaders: Record<string, string>,
  signal?: AbortSignal
) {
  pruneSingleImageReasoningCache();
  const cacheKey = buildSingleImageReasoningCacheKey(
    request,
    responsesEndpoint,
    requestHeaders
  );
  let entry = singleImageReasoningCache.get(cacheKey);

  if (!entry) {
    let sharedPromise: Promise<SingleImageBilingualReasoningAnalysis>;
    sharedPromise = requestJSON(
      responsesEndpoint,
      {
        method: "POST",
        headers: {
          ...requestHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(buildSingleImageReasoningRequest(request)),
        timeoutMs: REASONING_TIMEOUT_MS,
        label: "空间视角推理"
      }
    )
      .then(parseSingleImageBilingualReasoningResponse)
      .catch((error) => {
        if (
          singleImageReasoningCache.get(cacheKey)?.promise === sharedPromise
        ) {
          singleImageReasoningCache.delete(cacheKey);
        }
        throw error;
      });
    entry = {
      expiresAt: Date.now() + REASONING_CACHE_TTL_MS,
      promise: sharedPromise
    };
    singleImageReasoningCache.set(cacheKey, entry);
  }

  return awaitSharedSingleImageReasoning(entry.promise, signal);
}

function buildSingleImageReasoningCacheKey(
  request: NormalizedRequest,
  responsesEndpoint: string,
  requestHeaders: Record<string, string>
) {
  const headerEntries = Object.entries(requestHeaders)
    .map(([name, value]) => [name.toLowerCase(), value] as const)
    .sort(([left], [right]) => left.localeCompare(right));

  return createHash("sha256")
    .update(
      JSON.stringify({
        sourceImage: request.source_image,
        poseGuideImage: request.pose_guide_image,
        cameraPoseImage: request.camera_pose_image,
        rotation: request.rotation_degrees,
        cameraDistance: request.camera_distance,
        sourceWidth: request.source_width,
        sourceHeight: request.source_height,
        outputSize: request.output_size,
        reasoningModel: request.reasoning_model,
        responsesEndpoint,
        headers: headerEntries
      })
    )
    .digest("hex");
}

function pruneSingleImageReasoningCache() {
  const now = Date.now();

  for (const [key, entry] of singleImageReasoningCache) {
    if (entry.expiresAt <= now) {
      singleImageReasoningCache.delete(key);
    }
  }

  while (singleImageReasoningCache.size >= REASONING_CACHE_MAX_ENTRIES) {
    const oldestKey = singleImageReasoningCache.keys().next().value;

    if (typeof oldestKey !== "string") {
      break;
    }

    singleImageReasoningCache.delete(oldestKey);
  }
}

function awaitSharedSingleImageReasoning(
  promise: Promise<SingleImageBilingualReasoningAnalysis>,
  signal?: AbortSignal
) {
  if (!signal) {
    return promise;
  }

  if (signal.aborted) {
    return Promise.reject(createSingleImageAbortError());
  }

  return new Promise<SingleImageBilingualReasoningAnalysis>(
    (resolve, reject) => {
      const handleAbort = () => {
        cleanup();
        reject(createSingleImageAbortError());
      };
      const cleanup = () => {
        signal.removeEventListener("abort", handleAbort);
      };

      signal.addEventListener("abort", handleAbort, { once: true });
      promise.then(
        (analysis) => {
          cleanup();
          resolve(analysis);
        },
        (error) => {
          cleanup();
          reject(error);
        }
      );
    }
  );
}

function createSingleImageAbortError() {
  return new SingleImageViewpointServiceError(
    499,
    "SINGLE_VIEW_REQUEST_ABORTED",
    "新视角生成请求已取消。"
  );
}

export function clearSingleImageReasoningCacheForTests() {
  singleImageReasoningCache.clear();
}

function selectSingleImageReasoningAnalysis(
  bilingualAnalysis: SingleImageBilingualReasoningAnalysis,
  cameraPrompt: SingleImageCameraPrompt,
  promptLanguage: SingleImagePromptLanguage
): SingleImageViewpointAnalysis {
  const localized = bilingualAnalysis[promptLanguage];
  const targetView =
    promptLanguage === "en"
      ? `${cameraPrompt.azimuthLabelEn}, ${cameraPrompt.elevationLabelEn}, ${cameraPrompt.distanceLabelEn}, ${cameraPrompt.rollLabelEn}`
      : `${cameraPrompt.azimuthLabelZh}、${cameraPrompt.elevationLabelZh}、${cameraPrompt.distanceLabelZh}，${cameraPrompt.rollLabelZh}`;

  return {
    subjectCategory: bilingualAnalysis.subjectCategory,
    optimizedPrompt: localized.optimizedPrompt,
    viewDescription: localized.optimizedPrompt,
    sourceViewDescription: localized.sourceViewDescription,
    targetViewDescription: targetView,
    relativeCameraMotion:
      promptLanguage === "en"
        ? "The camera moves from the source zero-degree reference to the server-locked target pose, and the complete scene is reprojected through the new view frustum."
        : "相机从原图零度基准移动到服务端锁定姿态，整幅场景通过新的目标视锥重新投影。",
    visibilityConstraints: localized.visibilityConstraints,
    occlusionConstraints: localized.occlusionConstraints,
    identityConstraints: localized.identityConstraints,
    hiddenSurfacePlan: localized.hiddenSurfacePlan,
    scenePlan: localized.scenePlan,
    uncertaintyNotes: localized.uncertaintyNotes
  };
}

export function parseSingleImageReasoningResponse(
  body: unknown
): SingleImageViewpointAnalysis {
  const outputText = extractResponseOutputText(body);

  if (!outputText) {
    throw new SingleImageViewpointServiceError(
      502,
      "SINGLE_VIEW_REASONING_EMPTY",
      "空间推理模型没有返回新视角规划。",
      { retryable: true }
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(stripJSONFence(outputText));
  } catch {
    throw new SingleImageViewpointServiceError(
      502,
      "SINGLE_VIEW_REASONING_INVALID_JSON",
      "空间推理模型返回的结果不是合法 JSON。",
      { retryable: true }
    );
  }

  if (!isRecord(parsed)) {
    throw new SingleImageViewpointServiceError(
      502,
      "SINGLE_VIEW_REASONING_INVALID",
      "空间推理结果结构无效。",
      { retryable: true }
    );
  }

  return {
    subjectCategory: readSubjectCategory(parsed.subject_category),
    optimizedPrompt: requireString(
      parsed.optimized_prompt,
      "optimized_prompt"
    ),
    viewDescription: requireString(
      parsed.view_description,
      "view_description"
    ),
    sourceViewDescription: requireString(
      parsed.source_view_description,
      "source_view_description"
    ),
    targetViewDescription: requireString(
      parsed.target_view_description,
      "target_view_description"
    ),
    relativeCameraMotion: requireString(
      parsed.relative_camera_motion,
      "relative_camera_motion"
    ),
    visibilityConstraints: readStringArray(parsed.visibility_constraints),
    occlusionConstraints: readStringArray(parsed.occlusion_constraints),
    identityConstraints: readStringArray(parsed.identity_constraints),
    hiddenSurfacePlan: readStringArray(parsed.hidden_surface_plan),
    scenePlan: readStringArray(parsed.scene_plan),
    uncertaintyNotes: readStringArray(parsed.uncertainty_notes)
  };
}

export function buildSingleImageDirectRenderPrompt(
  pose: SingleImageCameraPose,
  userPrompt: string,
  cameraDistance = SINGLE_IMAGE_CAMERA_DISTANCE_DEFAULT,
  promptLanguage: SingleImagePromptLanguage = "zh",
  frameSpec: SingleImageFrameSpec = {}
) {
  return buildSingleImageRenderPrompt(
    pose,
    userPrompt,
    cameraDistance,
    promptLanguage,
    [],
    frameSpec
  );
}

export function buildSingleImageAnalyzedRenderPrompt(
  analysis: SingleImageViewpointAnalysis,
  pose: SingleImageCameraPose,
  userPrompt: string,
  cameraDistance = SINGLE_IMAGE_CAMERA_DISTANCE_DEFAULT,
  promptLanguage: SingleImagePromptLanguage = "zh",
  frameSpec: SingleImageFrameSpec = {}
) {
  return buildSingleImageRenderPrompt(
    pose,
    userPrompt,
    cameraDistance,
    promptLanguage,
    buildSingleImageAnalysisSupplement(analysis, promptLanguage),
    frameSpec,
    analysis
  );
}

function buildSingleImageRenderPrompt(
  pose: SingleImageCameraPose,
  userPrompt: string,
  cameraDistance: number,
  promptLanguage: SingleImagePromptLanguage,
  analysisSupplement: string[],
  frameSpec: SingleImageFrameSpec,
  analysis?: SingleImageViewpointAnalysis
) {
  const cameraPrompt = buildSingleImageCameraPrompt(
    pose.cumulativeDegrees,
    cameraDistance,
    frameSpec
  );
  const userConstraint =
    userPrompt.trim() ||
    (promptLanguage === "en"
      ? DEFAULT_SINGLE_IMAGE_USER_PROMPT_EN
      : DEFAULT_SINGLE_IMAGE_USER_PROMPT_ZH);
  const categoryScreenDirective = analysis
    ? buildCategoryScreenProjectionDirective(
        analysis,
        cameraPrompt,
        promptLanguage
      )
    : [];
  const renderPrompt =
    promptLanguage === "en"
      ? [
          "[Single highest-priority task | camera viewpoint recapture]",
          cameraPrompt.deterministicPromptEn,
          buildImageModelPrimaryCameraDirectiveEn(cameraPrompt),
          "Inputs: image 1 is the factual reference for the depicted elements and complete environment. Image 2 is the clean rotated target projection and indicates foreshortening, roll, composition, and shot size. Image 3 is the complete XYZ camera-position diagram and confirms the camera side, orbit, lens direction, pitch, yaw, and roll. Do not copy the guide card, axes, rings, border, background color, labels, or preview appearance.",
          ...analysisSupplement,
          ...categoryScreenDirective,
          "Execution: physically move the virtual camera to the locked orbit position and recapture the complete fixed 3D scene through the new view frustum. The foreground, central element, environment, background, ground, and frame edges must all update perspective, parallax, scale, occlusion, and composition together.",
          "Mandatory unseen-area completion: reconstruct everything visible from the target camera but absent or occluded in image 1, including the background and the symmetric counterpart structures of people, objects, or other depicted elements. “Symmetric counterpart completion” means conservative 3D inference from the detected category and source evidence, not a horizontal flip, mirror reflection, duplicate, or copied pixels.",
          `Additional requirement: ${userConstraint}`,
          "Failure condition: a near-frontal result, a frozen source background, or a result showing only local subject rotation has not executed the requested camera move.",
          "Output: return one clean, high-fidelity image photographed from the specified camera position. Do not show axes, rotation rings, guides, captions, or watermarks."
        ].join("\n")
      : [
          "【唯一最高优先级任务｜相机新视角重拍】",
          cameraPrompt.deterministicPromptZh,
          buildImageModelPrimaryCameraDirectiveZh(cameraPrompt),
          "输入：第一张图是画面元素与完整环境的事实参考；第二张图是干净的旋转目标投影图，用于确认透视缩短、Roll、构图和景别；第三张图是完整 XYZ 机位图，用于确认相机所在一侧、环绕轨道、镜头朝向、Pitch、Yaw 与 Roll。不要照抄引导图中的卡片、坐标轴、旋转环、边框、底色、标签或预览外观。",
          ...analysisSupplement,
          ...categoryScreenDirective,
          "执行：把虚拟相机真实移动到锁定的轨道机位，通过新视锥重拍完整且固定的三维场景。前景、中心对象、环境、背景、地面和画面边缘必须一起更新透视、视差、尺度、遮挡和构图。",
          "不可见区域补全（必须执行）：补全目标机位可见、但图像 1 未拍到或被遮挡的全部范围，包括背景，以及人物、物品或其他对象在新机位下才显露的对称对应结构。用户所说的“人物的镜像、物品的镜像”专指依据真实类别和原图证据进行三维对侧补全，不是整图水平翻转、镜面倒影、复制对象或复制原图像素。",
          `补充要求：${userConstraint}`,
          "失败判据：若结果仍接近原图正面、背景仍冻结在原构图，或只有局部对象发生转向，则说明没有执行相机移动，必须重建。",
          "输出：只输出一张从指定相机机位拍摄的干净、高保真图片，不显示坐标轴、旋转环、辅助线、字幕或水印。"
        ].join("\n");

  assertSingleImageRenderPromptSafety(renderPrompt);

  return renderPrompt;
}

function buildImageModelPrimaryCameraDirectiveZh(
  cameraPrompt: SingleImageCameraPrompt
) {
  const azimuth = normalizeCameraAngle(cameraPrompt.cameraAzimuthDegrees);
  const pitchDirection =
    cameraPrompt.cameraElevationDegrees >= 0 ? "抬高" : "降低";
  const pitchLookDirection =
    cameraPrompt.cameraElevationDegrees >= 0 ? "向下" : "向上";
  const frameInstruction = cameraPrompt.sourceAspectRatioLabel
    ? `保持图像 1 的 ${cameraPrompt.sourceAspectRatioLabel} 宽高比`
    : "保持图像 1 的原始宽高比";
  const outputInstruction = cameraPrompt.outputSize
    ? `，最终输出 ${cameraPrompt.outputSize}`
    : "";

  if (Math.abs(azimuth) < 0.5) {
    return [
      "主指令：保持原图零度正面机位，从同一相机位置重拍完整场景。",
      `相机参数：Pitch ${formatSignedCameraAngle(cameraPrompt.cameraElevationDegrees)}，Roll ${formatSignedCameraAngle(cameraPrompt.cameraRollDegrees)}，${cameraPrompt.distanceLabelZh}；${frameInstruction}${outputInstruction}。`
    ].join("\n");
  }

  if (Math.abs(Math.abs(azimuth) - 180) < 0.5) {
    return [
      "主指令：将镜头沿轨道转到中心人物/物品的背后 180.00°，看回同一场景中心并重拍整幅画面。",
      `相机参数：Pitch ${formatSignedCameraAngle(cameraPrompt.cameraElevationDegrees)}，Roll ${formatSignedCameraAngle(cameraPrompt.cameraRollDegrees)}，${cameraPrompt.distanceLabelZh}；${frameInstruction}${outputInstruction}。`
    ].join("\n");
  }

  const frameSide = azimuth > 0 ? "左侧" : "右侧";
  const objectSide = azimuth > 0 ? "右侧" : "左侧";

  return [
    `核心口令：将镜头转向中心人物/物品的${frameSide}，自动补全原图不可见的部分，包括背景、人物的镜像、物品的镜像。`,
    `精确定义：这里的${frameSide}以原图观看者的画面方向为准；相机沿该侧轨道环绕 ${formatAbsoluteCameraAngle(azimuth)} 后看回同一场景中心。整幅画面随镜头转动并重新成像；不是只让人物或物品转身。`,
    `左右锁定：镜头位于原图画面${frameSide}，若中心对象大致正对原相机，则相机位于对象自身${objectSide}；最终二维朝向、轮廓和遮挡只由这个新机位决定。`,
    "反镜头跟随：场景中的人物、动物、可动部件或物品不能为了继续正对新镜头而做补偿性转动。延续同一现实瞬间和世界空间关系，但最终二维画面中的朝向、轮廓、投影宽度与遮挡必须随相机相对位置改变。",
    `相机参数：相机${pitchDirection} ${formatAbsoluteCameraAngle(cameraPrompt.cameraElevationDegrees)} 并${pitchLookDirection}看回中心；Roll ${formatSignedCameraAngle(cameraPrompt.cameraRollDegrees)}；${cameraPrompt.distanceLabelZh}；${frameInstruction}${outputInstruction}。`
  ].join("\n");
}

function buildImageModelPrimaryCameraDirectiveEn(
  cameraPrompt: SingleImageCameraPrompt
) {
  const azimuth = normalizeCameraAngle(cameraPrompt.cameraAzimuthDegrees);
  const pitchDirection =
    cameraPrompt.cameraElevationDegrees >= 0 ? "raise" : "lower";
  const pitchLookDirection =
    cameraPrompt.cameraElevationDegrees >= 0 ? "downward" : "upward";
  const frameInstruction = cameraPrompt.sourceAspectRatioLabel
    ? `preserve image 1's ${cameraPrompt.sourceAspectRatioLabel} aspect ratio`
    : "preserve image 1's source aspect ratio";
  const outputInstruction = cameraPrompt.outputSize
    ? ` and render ${cameraPrompt.outputSize}`
    : "";

  if (Math.abs(azimuth) < 0.5) {
    return [
      "Primary instruction: keep the source zero-degree front camera and recapture the complete scene from the same camera position.",
      `Camera parameters: pitch ${formatSignedCameraAngle(cameraPrompt.cameraElevationDegrees)}, roll ${formatSignedCameraAngle(cameraPrompt.cameraRollDegrees)}, ${cameraPrompt.distanceLabelEn}; ${frameInstruction}${outputInstruction}.`
    ].join("\n");
  }

  if (Math.abs(Math.abs(azimuth) - 180) < 0.5) {
    return [
      "Primary instruction: orbit the camera 180.00 degrees behind the central person or object, look back toward the same scene center, and recapture the complete image.",
      `Camera parameters: pitch ${formatSignedCameraAngle(cameraPrompt.cameraElevationDegrees)}, roll ${formatSignedCameraAngle(cameraPrompt.cameraRollDegrees)}, ${cameraPrompt.distanceLabelEn}; ${frameInstruction}${outputInstruction}.`
    ].join("\n");
  }

  const frameSide = azimuth > 0 ? "LEFT" : "RIGHT";
  const objectSide = azimuth > 0 ? "RIGHT" : "LEFT";

  return [
    `Core command: turn the camera toward the ${frameSide} side of the central person or object and automatically complete everything absent from the source image, including the background and the mirrored counterpart structures of people and objects.`,
    `Precise definition: ${frameSide} is measured in the source viewer's frame direction. Orbit along that side by ${formatAbsoluteCameraAngle(azimuth)} and look back toward the same scene center. The whole image moves with the camera and is recaptured; this is not merely turning a person or object.`,
    `Left/right lock: the camera is on the source frame's ${frameSide}; when the central element approximately faces the source camera, this places the camera on the element's own ${objectSide}. The final screen orientation, contour, and occlusion are determined only by this new camera position.`,
    "Reject camera-following compensation: a person, animal, movable component, or object tracking and turning to remain front-facing to the new lens is a failed camera orbit. Continue the same world-space moment and relationships, while the final 2D orientation, contour, projection width, and occlusion change with the camera's relative position.",
    `Camera parameters: ${pitchDirection} the camera ${formatAbsoluteCameraAngle(cameraPrompt.cameraElevationDegrees)} and look ${pitchLookDirection} toward the center; roll ${formatSignedCameraAngle(cameraPrompt.cameraRollDegrees)}; ${cameraPrompt.distanceLabelEn}; ${frameInstruction}${outputInstruction}.`
  ].join("\n");
}

function normalizeCameraAngle(value: number) {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function formatAbsoluteCameraAngle(value: number) {
  return `${Math.abs(value).toFixed(2)}°`;
}

function formatSignedCameraAngle(value: number) {
  const normalized = Object.is(value, -0) ? 0 : value;
  return `${normalized >= 0 ? "+" : ""}${normalized.toFixed(2)}°`;
}

function buildCategoryScreenProjectionDirective(
  analysis: SingleImageViewpointAnalysis,
  cameraPrompt: SingleImageCameraPrompt,
  promptLanguage: SingleImagePromptLanguage
) {
  if (
    analysis.subjectCategory !== "person" ||
    !hasPersonDirectionalStructurePlan(analysis)
  ) {
    return [];
  }

  const targetSide =
    cameraPrompt.azimuthKey === "right-front" ||
    cameraPrompt.azimuthKey === "right"
      ? "right"
      : cameraPrompt.azimuthKey === "left-front" ||
          cameraPrompt.azimuthKey === "left"
        ? "left"
        : undefined;

  if (!targetSide) {
    return [];
  }

  if (promptLanguage === "en") {
    return targetSide === "right"
      ? [
          "[Person-only final-screen direction discriminator]",
          "The target camera is on the woman's own RIGHT. Her own right ear, right hairline, and right cheek are the near side and must form the LEFT contour of the final image, becoming more visible than in image 1. Her own left ear is the far side and must recede on the RIGHT side of the final image.",
          "The woman does not track the orbiting camera by turning her head or torso to face the new lens. Continue the same world-space instant; only the target camera reprojects it.",
          "Her nose tip and facial forward axis must point toward the RIGHT side of the final image. The far left eye and left cheek must narrow behind the nasal bridge. The woman's own right is not the final image's right.",
          "Failure condition: if the final image still clearly shows her own left ear on the image's right as in image 1, or if the nose still points toward the image's left, the viewpoint is reversed. Reject and rebuild rather than preserving the source facial projection."
        ]
      : [
          "[Person-only final-screen direction discriminator]",
          "The target camera is on the woman's own LEFT. Her own left ear, left hairline, and left cheek are the near side and must form the RIGHT contour of the final image, becoming more visible than in image 1. Her own right ear is the far side and must recede on the LEFT side of the final image.",
          "The woman does not track the orbiting camera by turning her head or torso to face the new lens. Continue the same world-space instant; only the target camera reprojects it.",
          "Her nose tip and facial forward axis must point toward the LEFT side of the final image. The far right eye and right cheek must narrow behind the nasal bridge. The woman's own left is not the final image's left.",
          "Failure condition: if the final image still clearly shows her own right ear on the image's left as in image 1, or if the nose still points toward the image's right, the viewpoint is reversed. Reject and rebuild rather than preserving the source facial projection."
        ];
  }

  return targetSide === "right"
    ? [
        "【人物专用最终屏幕方向判据】",
        "目标相机位于人物自身右边。人物自身右耳、右侧发际和右颊属于近侧，必须构成最终画面左侧轮廓，并比图像 1 更明显；人物自身左耳属于远侧，必须在最终画面右侧退隐。",
        "人物不追随环绕相机转动头部或躯干来重新正对新镜头；延续同一世界空间瞬间，只由目标相机重新投影。",
        "鼻尖和面部前向轴必须指向最终画面右边，远侧左眼与左颊必须在鼻梁后方收窄。人物自身右边不等于最终画面右边。",
        "失败判据：若最终图仍像图像 1 一样在画面右侧清楚显示人物自身左耳，或鼻尖仍指向画面左边，则视角左右反了；必须放弃源图脸部投影并重新生成。"
      ]
    : [
        "【人物专用最终屏幕方向判据】",
        "目标相机位于人物自身左边。人物自身左耳、左侧发际和左颊属于近侧，必须构成最终画面右侧轮廓，并比图像 1 更明显；人物自身右耳属于远侧，必须在最终画面左侧退隐。",
        "人物不追随环绕相机转动头部或躯干来重新正对新镜头；延续同一世界空间瞬间，只由目标相机重新投影。",
        "鼻尖和面部前向轴必须指向最终画面左边，远侧右眼与右颊必须在鼻梁后方收窄。人物自身左边不等于最终画面左边。",
        "失败判据：若最终图仍像图像 1 一样在画面左侧清楚显示人物自身右耳，或鼻尖仍指向画面右边，则视角左右反了；必须放弃源图脸部投影并重新生成。"
      ];
}

function hasPersonDirectionalStructurePlan(
  analysis: SingleImageViewpointAnalysis
) {
  const directionalEvidence = [
    analysis.sourceViewDescription,
    ...analysis.visibilityConstraints,
    ...analysis.occlusionConstraints,
    ...analysis.hiddenSurfacePlan
  ].join(" ");
  const hasOwnRight =
    /人物自身右|主体自身右|她自身右|他自身右|(?:subject|woman|man|person)(?:'|’)?s own right|(?:subject|woman|man|person)(?:'|’)?s right|her own right|his own right/iu.test(
      directionalEvidence
    );
  const hasOwnLeft =
    /人物自身左|主体自身左|她自身左|他自身左|(?:subject|woman|man|person)(?:'|’)?s own left|(?:subject|woman|man|person)(?:'|’)?s left|her own left|his own left/iu.test(
      directionalEvidence
    );

  return hasOwnRight && hasOwnLeft;
}

function buildSingleImageAnalysisSupplement(
  analysis: SingleImageViewpointAnalysis,
  promptLanguage: SingleImagePromptLanguage
) {
  if (promptLanguage === "en") {
    return [
      "[gpt-5.6-sol category gate | no free camera wording]",
      `Detected category: ${subjectCategoryLabelEn(analysis.subjectCategory)}.`,
      "Use image 1 itself to preserve identity or model, real construction, materials, colors, lighting, depth of field, and style. Do not reuse the source 2D facial/object projection, source contour, or source occlusion order as camera guidance."
    ];
  }

  return [
    "【gpt-5.6-sol 类别闸门｜不输出自由机位描述】",
    `识别类别：${subjectCategoryLabel(analysis.subjectCategory)}。`,
    "身份或型号、真实构造、材质、颜色、光线、景深与画风直接以图像 1 为准；不得把源图二维脸部/物体投影、源图轮廓或源图遮挡顺序当作相机指引继续沿用。"
  ];
}

export function buildSingleImageEditPrompt(
  analysis: SingleImageViewpointAnalysis,
  pose: SingleImageCameraPose,
  userPrompt: string,
  cameraDistance = SINGLE_IMAGE_CAMERA_DISTANCE_DEFAULT
) {
  const cameraPrompt = buildSingleImageCameraPrompt(
    pose.cumulativeDegrees,
    cameraDistance
  );
  const projectionAcceptance = sanitizeProjectionAcceptanceCriteria(
    analysis.visibilityConstraints,
    analysis.subjectCategory
  );
  const occlusionAcceptance = sanitizeProjectionAcceptanceCriteria(
    analysis.occlusionConstraints,
    analysis.subjectCategory
  );
  const identityFacts = sanitizeModelSupplement(
    analysis.identityConstraints,
    analysis.subjectCategory
  );
  const hiddenSurfacePlan = sanitizeModelSupplement(
    analysis.hiddenSurfacePlan,
    analysis.subjectCategory
  );
  const scenePlan = sanitizeModelSupplement(
    analysis.scenePlan,
    analysis.subjectCategory
  );
  const uncertaintyNotes = sanitizeModelSupplement(
    analysis.uncertaintyNotes,
    analysis.subjectCategory
  );
  const subjectProjectionDirective = buildSubjectProjectionDirective(
    analysis.subjectCategory
  );

  const renderPrompt = [
    cameraPrompt.deterministicPromptZh,
    "",
    "【输入图像角色｜严格区分】",
    "1. 图像 1 是身份或型号、类别、结构、材质、颜色、标记、文字、画风、光照和场景的唯一事实来源，必须高保真保持。",
    "2. 图像 2 只提供目标相机投影、Roll 与构图参考，不是隐藏表面证据。不得复制图像 2 的平面卡片、暗色边框、预览底色或任何辅助预览外观。",
    "2.1 图像 2 的投影压缩方向和幅度是硬几何参考。对图像 1 中与零度画面近似平行的固定平面、圆环或规则框架，最终图像的透视缩短强度不得弱于图像 2；同一刚性组件的外轮廓与内部共面结构必须沿同一方向同步压缩，只重建真实三维体积，不复制引导图的卡片外观。",
    "",
    "【整场景新视锥重建】",
    "先建立目标相机新视锥中的完整画面，再处理单个结构细节。前景、主体、中景、背景、地面和画面边界必须作为同一三维场景一起重新投影，不得只旋转人物、物品或局部轮廓。",
    "原图未拍到但在目标机位可见的环境空间，依据图像 1 的空间结构、材质、光线、色彩和画风进行合理想象与自然补全。补全范围不局限于主体的新可见结构，也包括新进入画面的背景、地面、家具、建筑或其他场景内容。",
    "允许原有元素随相机移动自然入画、出画、遮挡或重新显露。不得为了保留源图全部元素而复制源图背景、固定二维坐标或维持原构图。",
    "识图模型给出的完整新视锥场景计划：",
    ...formatZhList(scenePlan),
    "",
    "【目标投影与遮挡验收】",
    "服务端确定性投影要求：",
    ...formatZhList(cameraPrompt.requiredVisibleSurfaces),
    "服务端确定性退隐要求：",
    ...formatZhList(cameraPrompt.requiredOccludedSurfaces),
    "识图模型按主体类别生成的可见结构验收：",
    ...formatZhList(projectionAcceptance),
    "识图模型按主体类别生成的遮挡结构验收：",
    ...formatZhList(occlusionAcceptance),
    "透视与地平线：",
    ...formatZhList(cameraPrompt.perspectiveConstraints),
    "",
    "【原图事实与三维连续性】",
    `主体类别：${subjectCategoryLabel(analysis.subjectCategory)}。后续所有结构名称和投影验收必须来自这一类别及图像 1 的真实内容，不得套用其他类别模板。`,
    "图像 1 是唯一事实图。连续的是同一主体的类别、身份或型号、比例、构造、材质、颜色、标记、可读文字、画风、光照特征、动作事件或装配关系以及场景拓扑；这些连续性不锁定主体在原图中朝向屏幕的方向。源图里的二维像素坐标、屏幕朝向、屏幕轮廓和遮挡顺序全部作废。目标相机必须重新建立画面中的投影方向、轮廓、投影宽度、可见结构分布和遮挡顺序。",
    "同一身份、动作事件、装配关系、材质与场景事实只能作为重建内容，不能覆盖目标相机投影。目标相机机位是最终屏幕朝向、轮廓、投影宽度、可见结构与遮挡顺序的唯一来源。目标相机改变后，主体在屏幕中的可见朝向必须随观察方向改变；源图二维坐标与屏幕投影不得沿用，动作构型、零件装配和场景关系必须从目标机位重新成像。",
    ...formatZhList(identityFacts),
    "",
    "【目标机位新增可见结构的保守补全】",
    "只依据图像 1 的事实、已确认类别对应的结构规律、语义对称、制造装配、空间连续性、材质连续性和场景上下文，补全目标机位新进入视野的真实结构；不得重新设计主体，也不得把其他类别的结构术语强加给当前主体。",
    ...formatZhList(hiddenSurfacePlan),
    "",
    "【不确定信息处理】",
    "对原图不可确认的信息采用最保守、最符合身份与结构连续性的方案，不得用装饰、裁切或额外遮挡逃避目标投影验收。",
    ...formatZhList(uncertaintyNotes),
    "",
    "【用户附加约束】",
    userPrompt.trim() || "不引入额外概念或重新设计。",
    "",
    "【最终执行与验收】",
    "对整张图进行高保真三维新视角重绘，不是局部修补。先让相机沿锁定轨道到达目标位置并对准场景关注中心，再从该机位重新拍摄整个固定三维场景。",
    "前景、主体、中景、背景、地平线和画面边界必须一起重新计算投影、透视、视差、轮廓、可见区域和遮挡顺序。原图没有拍到但进入新视锥的空间，按原环境连续性自然补全；原有元素可以合理入画、出画、遮挡或显露。",
    "若只有主体朝向、局部轮廓或局部表面发生变化，而背景各深度层、地面、环境物体和画面边界仍沿用源图构图，则本次生成失败。",
    "允许且必须改变主体在最终二维画面中的可见朝向、轮廓与遮挡关系。同一身份、动作事件、装配关系、材质与场景事实只定义需要重建的内容，不定义最终屏幕方向；目标相机改变后，主体在屏幕中的可见朝向必须随观察方向改变。",
    "本次场景变换的运动变量集合仅包含相机轨道。主体及固定部件采用场景坐标中的既定装配变换，该变换独立于目标相机方向。相机沿轨道移动后，从新的相对方向重新投影这些结构。最终屏幕朝向、轮廓和投影缩短必须随目标机位改变。",
    "图像 2 的投影压缩方向和幅度是硬几何参考；固定平面、圆环或规则框架在目标俯仰方向上的最终投影必须达到至少同等的缩短强度，同一刚性组件的外轮廓与内部共面结构必须同步压缩。",
    "投影压缩只改变二维成像，不改变真实三维装配拓扑；主平面后方的深度结构必须继续沿原深度轴延伸，不得坍缩到同一平面、压扁贴合或错误悬挂。",
    "支撑、连接件与主体之间必须保持连续的三维连接路径；连接点、穿插关系和遮挡顺序按目标机位重投影，但不得断裂、漂浮或改接。",
    "高低机位必须由主体投影缩短、上下结构显露与退隐、背景各深度层视差和地平线位置或方向共同验收；只改变局部轮廓不足以证明目标俯仰。",
    "相机轨道变化是本次编辑的强制目标。身份连续与目标机位投影必须同时成立；最终画面看到正面、侧面、背面、上方或下方，只服从锁定相机块。",
    `锁定相机块是唯一相机来源，优先级高于任何模型分析文字。${subjectProjectionDirective}`,
    "禁止镜像、二维平面旋转、透视拉伸、卡片翻转、保留原图投影、重复主体、额外结构或部件、虚构标志、字幕、水印、坐标轴和无关物体。",
    "只输出一张干净的最终图像。"
  ].join("\n");

  assertSingleImageRenderPromptSafety(renderPrompt);

  return renderPrompt;
}

export function assertSingleImageRenderPromptSafety(prompt: string) {
  const conflict = findSingleImagePromptConflict(prompt);

  if (!conflict) {
    return;
  }

  const conflictingLine =
    prompt
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && findSingleImagePromptConflict(line)) ?? "";
  const conflictContext = conflictingLine
    ? ` 冲突段落：${conflictingLine}`
    : "";

  throw new SingleImageViewpointServiceError(
    500,
    "SINGLE_VIEW_RENDER_PROMPT_CONFLICT",
    conflict === "generic-subject-surface"
      ? `最终提示词包含与目标机位无关的泛化表面描述，已在发送给图像模型前阻断。${conflictContext}`
      : `最终提示词包含会锁定原图二维朝向的冲突约束，已在发送给图像模型前阻断。${conflictContext}`,
    { retryable: false }
  );
}

export function buildSingleImageEditForm(input: {
  request: NormalizedRequest;
  renderPrompt?: string;
  cameraPoseImage: ParsedDataURL;
  poseGuideImage: ParsedDataURL;
  sourceImage: ParsedDataURL;
}) {
  const form = new FormData();
  form.append("model", input.request.image_model);
  form.append(
    "prompt",
    input.renderPrompt ??
      buildSingleImageDirectRenderPrompt(
        input.request.pose,
        input.request.user_prompt,
        input.request.camera_distance,
        input.request.prompt_language,
        buildFrameSpec(input.request)
      )
  );
  form.append(
    "image[]",
    new Blob([input.sourceImage.bytes], { type: input.sourceImage.mimeType }),
    extensionFilename("source", input.sourceImage.mimeType)
  );
  form.append(
    "image[]",
    new Blob([input.poseGuideImage.bytes], {
      type: input.poseGuideImage.mimeType
    }),
    extensionFilename("pose-guide", input.poseGuideImage.mimeType)
  );
  form.append(
    "image[]",
    new Blob([input.cameraPoseImage.bytes], {
      type: input.cameraPoseImage.mimeType
    }),
    extensionFilename("camera-pose", input.cameraPoseImage.mimeType)
  );
  form.append("quality", "high");
  form.append("input_fidelity", "high");
  form.append("size", input.request.output_size);
  form.append("output_format", "png");
  form.append("n", "1");

  return form;
}

function buildFrameSpec(
  request: Pick<
    SingleImageViewpointRequest,
    "source_width" | "source_height" | "output_size"
  >
): SingleImageFrameSpec {
  return {
    sourceWidth: request.source_width,
    sourceHeight: request.source_height,
    outputSize: request.output_size
  };
}

export async function normalizeSingleImageRenderedImage(
  renderedImage: { image: string; mimeType: string },
  outputSize: string,
  signal?: AbortSignal
) {
  const target = parseOutputSize(outputSize);

  try {
    const sourceBytes = await readRenderedImageBytes(
      renderedImage.image,
      signal
    );
    const metadata = await sharp(sourceBytes).metadata();

    if (
      metadata.width === target.width &&
      metadata.height === target.height &&
      renderedImage.image.startsWith("data:image/png;base64,")
    ) {
      return renderedImage;
    }

    const normalizedBytes = await sharp(sourceBytes)
      .rotate()
      .resize(target.width, target.height, {
        fit: "cover",
        position: "attention"
      })
      .png({
        compressionLevel: 9,
        force: true
      })
      .toBuffer();

    return {
      image: `data:image/png;base64,${normalizedBytes.toString("base64")}`,
      mimeType: "image/png"
    };
  } catch (error) {
    if (signal?.aborted) {
      throw createSingleImageAbortError();
    }

    throw new SingleImageViewpointServiceError(
      502,
      "SINGLE_VIEW_OUTPUT_NORMALIZATION_FAILED",
      `图像模型已返回结果，但无法将画幅锁定为 ${outputSize}。`,
      { retryable: true }
    );
  }
}

async function readRenderedImageBytes(
  image: string,
  signal?: AbortSignal
) {
  const dataURLMatch =
    /^data:[^;,]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(image);

  if (dataURLMatch?.[1]) {
    return Buffer.from(dataURLMatch[1].replace(/\s+/g, ""), "base64");
  }

  const response = await fetch(image, { signal });

  if (!response.ok) {
    throw new Error(`Rendered image download failed with ${response.status}.`);
  }

  return Buffer.from(await response.arrayBuffer());
}

export function parseSingleImageEditResponse(body: unknown) {
  const record = isRecord(body) ? body : {};
  const data = Array.isArray(record.data) ? record.data : [];
  const first = isRecord(data[0]) ? data[0] : undefined;
  const b64 = first?.b64_json;
  const url = first?.url;

  if (typeof b64 === "string" && b64.trim()) {
    return {
      image: `data:image/png;base64,${b64.trim()}`,
      mimeType: "image/png"
    };
  }

  if (typeof url === "string" && url.trim()) {
    return {
      image: url.trim(),
      mimeType: "image/png"
    };
  }

  const output = Array.isArray(record.output) ? record.output : [];

  for (const item of output) {
    if (!isRecord(item)) {
      continue;
    }

    const result = item.result ?? item.b64_json;

    if (typeof result === "string" && result.trim()) {
      return {
        image: result.startsWith("data:")
          ? result.trim()
          : `data:image/png;base64,${result.trim()}`,
        mimeType: "image/png"
      };
    }
  }

  throw new SingleImageViewpointServiceError(
    502,
    "SINGLE_VIEW_IMAGE_EMPTY",
    "GPT Image 2 已返回响应，但没有找到可显示的图像。",
    { retryable: true }
  );
}

export function resolveSingleImageViewpointEndpoints(
  endpointOverride: SingleImageViewpointRequest["endpoint_override"]
) {
  const responsesBase = endpointOverride?.baseURL || DEFAULT_OPENAI_ROOT;
  const imageEditsBase =
    endpointOverride?.editURL ||
    endpointOverride?.baseURL ||
    DEFAULT_OPENAI_ROOT;

  return {
    responses: appendEndpointPath(responsesBase, "v1/responses"),
    imageEdits: appendEndpointPath(imageEditsBase, "v1/images/edits")
  };
}

function parseImageDataURL(value: string, field: string): ParsedDataURL {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(value);

  if (!match) {
    throw new SingleImageViewpointServiceError(
      400,
      "SINGLE_VIEW_IMAGE_DATA_URL_INVALID",
      `${field} 必须是 Base64 图片 Data URL。`
    );
  }

  const mimeType = match[1]?.toLowerCase() ?? "";

  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new SingleImageViewpointServiceError(
      400,
      "SINGLE_VIEW_IMAGE_TYPE_UNSUPPORTED",
      `${field} 仅支持 PNG、JPEG 或 WebP。`
    );
  }

  const base64 = (match[2] ?? "").replace(/\s+/g, "");
  const buffer = Buffer.from(base64, "base64");

  if (buffer.byteLength === 0) {
    throw new SingleImageViewpointServiceError(
      400,
      "SINGLE_VIEW_IMAGE_EMPTY",
      `${field} 不包含有效图片数据。`
    );
  }

  return {
    mimeType,
    bytes: Uint8Array.from(buffer)
  };
}

function validateXYZRotation(value: unknown): XYZRotation {
  if (!isRecord(value)) {
    throw new SingleImageViewpointServiceError(
      400,
      "SINGLE_VIEW_ROTATION_REQUIRED",
      "缺少 XYZ 旋转参数。"
    );
  }

  const rotation = {
    x: requireFiniteNumber(value.x, "rotation_degrees.x"),
    y: requireFiniteNumber(value.y, "rotation_degrees.y"),
    z: requireFiniteNumber(value.z, "rotation_degrees.z")
  };

  for (const [axis, angle] of Object.entries(rotation)) {
    if (angle < -720 || angle > 720) {
      throw new SingleImageViewpointServiceError(
        400,
        "SINGLE_VIEW_ROTATION_INVALID",
        `${axis.toUpperCase()} 轴角度必须在 -720° 到 720° 之间。`
      );
    }
  }

  return rotation;
}

function validateCameraDistance(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return SINGLE_IMAGE_CAMERA_DISTANCE_DEFAULT;
  }

  const distance = requireFiniteNumber(value, "camera_distance");

  if (
    distance < SINGLE_IMAGE_CAMERA_DISTANCE_MIN ||
    distance > SINGLE_IMAGE_CAMERA_DISTANCE_MAX
  ) {
    throw new SingleImageViewpointServiceError(
      400,
      "SINGLE_VIEW_CAMERA_DISTANCE_INVALID",
      "景别控制值必须在 0 到 10 之间。"
    );
  }

  return distance;
}

function validatePromptLanguage(value: unknown): SingleImagePromptLanguage {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_SINGLE_IMAGE_PROMPT_LANGUAGE;
  }

  if (value === "zh" || value === "en") {
    return value;
  }

  throw new SingleImageViewpointServiceError(
    400,
    "SINGLE_VIEW_PROMPT_LANGUAGE_INVALID",
    "提示词语言仅支持 zh 或 en。"
  );
}

function validateSourceDimensions(widthValue: unknown, heightValue: unknown) {
  if (
    (widthValue === undefined || widthValue === null) &&
    (heightValue === undefined || heightValue === null)
  ) {
    return undefined;
  }

  const width = Number(widthValue);
  const height = Number(heightValue);

  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 20_000 ||
    height > 20_000
  ) {
    throw new SingleImageViewpointServiceError(
      400,
      "SINGLE_VIEW_SOURCE_DIMENSIONS_INVALID",
      "源图宽高必须同时提供，并使用有效的正整数像素值。"
    );
  }

  return { width, height };
}

function lockOutputSizeToSourceAspect(
  requestedOutputSize: string,
  sourceDimensions: { width: number; height: number }
) {
  const requested = parseOutputSize(requestedOutputSize);
  const locked = calculateSingleImageOutputSize(
    sourceDimensions.width,
    sourceDimensions.height,
    Math.max(requested.width, requested.height)
  );

  return validateOutputSize(locked);
}

function validateOutputSize(value: unknown) {
  const outputSize = requireString(value, "output_size");
  const match = /^(\d{2,5})x(\d{2,5})$/i.exec(outputSize);

  if (!match) {
    throw new SingleImageViewpointServiceError(
      400,
      "SINGLE_VIEW_OUTPUT_SIZE_INVALID",
      "输出尺寸必须使用 WIDTHxHEIGHT 格式。"
    );
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  const totalPixels = width * height;
  const aspectRatio = Math.max(width / height, height / width);

  if (
    width > MAX_OUTPUT_EDGE ||
    height > MAX_OUTPUT_EDGE ||
    width % 16 !== 0 ||
    height % 16 !== 0 ||
    totalPixels < MIN_OUTPUT_PIXELS ||
    totalPixels > MAX_OUTPUT_PIXELS ||
    aspectRatio > MAX_OUTPUT_ASPECT_RATIO
  ) {
    throw new SingleImageViewpointServiceError(
      400,
      "SINGLE_VIEW_OUTPUT_SIZE_INVALID",
      "输出尺寸超出支持范围。"
    );
  }

  return `${width}x${height}`;
}

function parseOutputSize(value: string) {
  const match = /^(\d+)x(\d+)$/i.exec(value);

  if (!match) {
    throw new SingleImageViewpointServiceError(
      400,
      "SINGLE_VIEW_OUTPUT_SIZE_INVALID",
      "输出尺寸必须使用 WIDTHxHEIGHT 格式。"
    );
  }

  return {
    width: Number(match[1]),
    height: Number(match[2])
  };
}

function extractResponseOutputText(body: unknown) {
  if (!isRecord(body)) {
    return undefined;
  }

  if (typeof body.output_text === "string" && body.output_text.trim()) {
    return body.output_text;
  }

  if (Array.isArray(body.output)) {
    for (const item of body.output) {
      if (!isRecord(item) || !Array.isArray(item.content)) {
        continue;
      }

      for (const content of item.content) {
        if (
          isRecord(content) &&
          typeof content.text === "string" &&
          content.text.trim()
        ) {
          return content.text;
        }
      }
    }
  }

  const choices = Array.isArray(body.choices) ? body.choices : [];
  const firstChoice = isRecord(choices[0]) ? choices[0] : undefined;
  const message =
    firstChoice && isRecord(firstChoice.message)
      ? firstChoice.message
      : undefined;

  return typeof message?.content === "string" ? message.content : undefined;
}

async function requestJSON(
  url: string,
  input: {
    method: "POST";
    headers: Record<string, string>;
    body: string | FormData;
    timeoutMs: number;
    label: string;
  },
  parentSignal?: AbortSignal
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  const abortFromParent = () => controller.abort();
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    const response = await fetch(url, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      signal: controller.signal
    });
    const text = await response.text();
    const body = parseJSONOrText(text);

    if (!response.ok) {
      const upstreamMessage = extractUpstreamErrorMessage(body);
      const statusCode =
        response.status === 401 ||
        response.status === 403 ||
        response.status === 429
          ? response.status
          : 502;

      throw new SingleImageViewpointServiceError(
        statusCode,
        `SINGLE_VIEW_UPSTREAM_${response.status}`,
        `${input.label}失败：${upstreamMessage || `HTTP ${response.status}`}`,
        { retryable: response.status === 429 || response.status >= 500 }
      );
    }

    return body;
  } catch (error) {
    if (error instanceof SingleImageViewpointServiceError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      if (parentSignal?.aborted) {
        throw new SingleImageViewpointServiceError(
          499,
          "SINGLE_VIEW_REQUEST_ABORTED",
          "新视角生成请求已取消。"
        );
      }

      throw new SingleImageViewpointServiceError(
        504,
        "SINGLE_VIEW_UPSTREAM_TIMEOUT",
        `${input.label}请求超时。`,
        { retryable: true }
      );
    }

    throw new SingleImageViewpointServiceError(
      502,
      "SINGLE_VIEW_UPSTREAM_UNREACHABLE",
      `${input.label}无法连接上游服务。`,
      { retryable: true }
    );
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

function buildRequestHeaders(
  apiKey: string,
  customHeaders?: Record<string, string>,
  omitContentType = false
) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...sanitizeHeaders(customHeaders)
  };

  if (omitContentType) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "content-type") {
        delete headers[key];
      }
    }
  }

  for (const [name, value] of Object.entries(headers)) {
    if (findInvalidHeaderValueCharacter(value)) {
      throw new SingleImageViewpointServiceError(
        400,
        "SINGLE_VIEW_HEADER_INVALID",
        `请求头 ${name} 包含非法字符。`
      );
    }
  }

  return headers;
}

function sanitizeHeaders(value: unknown) {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([name, item]) =>
          Boolean(name.trim()) &&
          typeof item === "string" &&
          name.toLowerCase() !== "authorization" &&
          name.toLowerCase() !== "content-type"
      )
      .map(([name, item]) => [name.trim(), String(item)])
  );
}

function appendEndpointPath(value: string, endpointPath: string) {
  const prefix = stripKnownEndpointSuffix(value || DEFAULT_OPENAI_ROOT);
  const cleanPrefix = prefix.replace(/\/+$/, "");
  const endpointSegments = endpointPath.split("/").filter(Boolean);

  try {
    const parsed = new URL(cleanPrefix);
    const prefixSegments = parsed.pathname.split("/").filter(Boolean);
    const overlap = countSegmentOverlap(prefixSegments, endpointSegments);
    parsed.pathname = `/${[
      ...prefixSegments,
      ...endpointSegments.slice(overlap)
    ].join("/")}`;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    const prefixSegments = cleanPrefix.split("/").filter(Boolean);
    const overlap = countSegmentOverlap(prefixSegments, endpointSegments);
    return [...prefixSegments, ...endpointSegments.slice(overlap)].join("/");
  }
}

function countSegmentOverlap(prefix: string[], endpoint: string[]) {
  for (
    let length = Math.min(prefix.length, endpoint.length);
    length > 0;
    length -= 1
  ) {
    const left = prefix.slice(-length).map((item) => item.toLowerCase());
    const right = endpoint.slice(0, length).map((item) => item.toLowerCase());

    if (left.every((item, index) => item === right[index])) {
      return length;
    }
  }

  return 0;
}

function parseJSONOrText(text: string) {
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { rawText: text.slice(0, 500) };
  }
}

function extractUpstreamErrorMessage(body: unknown) {
  if (!isRecord(body)) {
    return "";
  }

  const error = isRecord(body.error) ? body.error : undefined;

  if (typeof error?.message === "string") {
    return error.message;
  }

  if (typeof body.message === "string") {
    return body.message;
  }

  if (typeof body.rawText === "string") {
    return body.rawText;
  }

  return "";
}

function extensionFilename(prefix: string, mimeType: string) {
  const extension =
    mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1] || "png";
  return `${prefix}.${extension}`;
}

function sanitizeModelSupplement(
  items: string[],
  subjectCategory: SingleImageSubjectCategory
) {
  const cameraControlPattern =
    /\b(?:camera|viewpoint|view|angle|yaw|pitch|roll|orbit|azimuth|elevation|framing)\b|相机|视角|机位|方位角|俯仰角|偏航|滚转|景别|镜头位置|环绕/iu;
  const humanTemplatePattern =
    /\b(?:human anatomy|facial|ear|cheek|jaw|jawline|shoulder|nostril|hairstyle|hair|clothing|garment|limb)\b|人体|人物|人脸|面部|脸部|脸颊|耳朵|下颌|下颌线|肩部|鼻孔|发型|头发|服装|衣物|解剖/iu;
  const allowBiologicalAnatomy =
    subjectCategory === "person" || subjectCategory === "animal";

  return items
    .map((item) => item.trim())
    .map(removeProjectionLockClauses)
    .filter(
      (item) =>
        item &&
        !cameraControlPattern.test(item) &&
        (allowBiologicalAnatomy || !humanTemplatePattern.test(item))
    )
    .filter(Boolean);
}

function removeProjectionLockClauses(item: string) {
  if (!findSingleImagePromptConflict(item)) {
    return item;
  }

  const safeClauses = item
    .split(/[，,；;。.!?！？]+/u)
    .map((clause) => clause.trim())
    .filter((clause) => clause && !findSingleImagePromptConflict(clause));

  return safeClauses.length > 0 ? `${safeClauses.join("；")}。` : "";
}

export function sanitizeProjectionAcceptanceCriteria(
  items: string[],
  subjectCategory: SingleImageSubjectCategory
) {
  const cameraRedefinitionPattern =
    /\b(?:camera|viewpoint|view angle|yaw|pitch|roll|orbit|azimuth|elevation|framing)\b|相机|视角|机位|方位角|俯仰角|偏航|滚转|景别|镜头位置|环绕|正面视图|背面视图|侧面视图|左侧面|右侧面|左前|右前|左后|右后|俯视|仰视|平视|(?:保持|改成|切换到|设为|目标为).{0,10}(?:正面|背面|左侧|右侧|俯视|仰视|平视)|(?:不要|不得).{0,10}(?:显露|显示).{0,10}(?:左侧|右侧|正面|背面)/iu;
  const numericAnglePattern =
    /(?:^|[^\d])[-+]?\d+(?:\.\d+)?\s*(?:°|度)(?:[^\d]|$)/u;
  const humanTemplatePattern =
    /\b(?:human anatomy|human face|facial|ear|cheek|jaw|jawline|shoulder|nostril|hairstyle|hair|clothing|garment|limb)\b|人体|人物|人脸|面部|脸部|脸颊|耳朵|下颌|下颌线|肩部|鼻孔|发型|头发|服装|衣物|解剖/iu;
  const allowHumanTerms = subjectCategory === "person";

  return items
    .map((item) => item.trim())
    .filter(
      (item) =>
        item &&
        !cameraRedefinitionPattern.test(item) &&
        !numericAnglePattern.test(item) &&
        !findSingleImagePromptConflict(item) &&
        (allowHumanTerms || !humanTemplatePattern.test(item))
    );
}

function buildSubjectProjectionDirective(
  subjectCategory: SingleImageSubjectCategory
) {
  switch (subjectCategory) {
    case "person":
      return "保持同一人物身份与同一现实瞬间，从目标相机重新成像；人物在画面中的投影方向、轮廓、近远遮挡与可见比例必须按目标机位重建，原图正向投影不构成锁定。";
    case "animal":
      return "保持同一动物身份与同一现实瞬间，从目标相机重新成像；画面投影方向、轮廓、近远遮挡与可见比例必须按目标机位重建。";
    case "product_object":
      return "保持同一物体的零件装配与工作状态，从目标相机重新成像；固定平面、圆环、网罩与规则框架以场景坐标中的物体装配方向为基准，相机轨道与这些部件的世界方向相互解耦；整体画面投影、轮廓、可见部件与遮挡必须按目标机位重建，原图正向投影可变为侧向、后向、俯视或仰视投影。";
    case "vehicle":
      return "保持同一车辆身份、部件关系与工作状态，从目标相机重新成像；车身画面投影、轮廓、近远结构与遮挡必须按目标机位重建。";
    case "architecture_scene":
      return "保持同一建筑或场景的空间拓扑与对象关系，从目标相机重新成像；立面投影、可见空间、遮挡顺序与背景视差必须按目标机位重建。";
    case "other":
      return "保持同一主体的身份、结构与现实状态，从目标相机重新成像；画面投影方向、轮廓、可见区域与遮挡必须按目标机位重建。";
  }
}

function readSubjectCategory(value: unknown): SingleImageSubjectCategory {
  switch (value) {
    case "person":
    case "animal":
    case "product_object":
    case "vehicle":
    case "architecture_scene":
    case "other":
      return value;
    default:
      throw new SingleImageViewpointServiceError(
        502,
        "SINGLE_VIEW_REASONING_INVALID_CATEGORY",
        "空间推理模型没有返回有效的主体类别。",
        { retryable: true }
      );
  }
}

function subjectCategoryLabel(category: SingleImageSubjectCategory) {
  switch (category) {
    case "person":
      return "人物";
    case "animal":
      return "动物";
    case "product_object":
      return "产品或物体";
    case "vehicle":
      return "车辆";
    case "architecture_scene":
      return "建筑或场景";
    case "other":
      return "其他";
  }
}

function subjectCategoryLabelEn(category: SingleImageSubjectCategory) {
  switch (category) {
    case "person":
      return "person";
    case "animal":
      return "animal";
    case "product_object":
      return "product or object";
    case "vehicle":
      return "vehicle";
    case "architecture_scene":
      return "architecture or scene";
    case "other":
      return "other";
  }
}

function formatZhList(items: string[]) {
  return items.length > 0
    ? items.map((item) => `- ${item}`)
    : ["- 无额外条目，以原图事实和锁定相机协议为准。"];
}

function formatEnList(items: string[]) {
  return items.length > 0
    ? items.map((item) => `- ${item}`)
    : ["- No additional item; follow the source facts and locked camera protocol."];
}

function stripJSONFence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && Boolean(item.trim())
      )
    : [];
}

function readLocalizedReasoningPlan(
  value: unknown,
  field: SingleImagePromptLanguage
): SingleImageLocalizedReasoningPlan {
  if (!isRecord(value)) {
    throw new SingleImageViewpointServiceError(
      502,
      "SINGLE_VIEW_REASONING_INVALID",
      `空间推理结果缺少 ${field} 双语事实包。`,
      { retryable: true }
    );
  }

  return {
    optimizedPrompt: requireString(
      value.optimized_prompt,
      `${field}.optimized_prompt`
    ),
    sourceViewDescription: requireString(
      value.source_view_description,
      `${field}.source_view_description`
    ),
    visibilityConstraints: readStringArray(value.visibility_constraints),
    occlusionConstraints: readStringArray(value.occlusion_constraints),
    identityConstraints: readStringArray(value.identity_constraints),
    hiddenSurfacePlan: readStringArray(value.hidden_surface_plan),
    scenePlan: readStringArray(value.scene_plan),
    uncertaintyNotes: readStringArray(value.uncertainty_notes)
  };
}

function requireString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new SingleImageViewpointServiceError(
      400,
      "SINGLE_VIEW_FIELD_REQUIRED",
      `${field} 不能为空。`
    );
  }

  return value.trim();
}

function requireFiniteNumber(value: unknown, field: string) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    throw new SingleImageViewpointServiceError(
      400,
      "SINGLE_VIEW_NUMBER_INVALID",
      `${field} 必须是有效数字。`
    );
  }

  return numberValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
