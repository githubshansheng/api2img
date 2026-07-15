import type {
  SingleImageCameraPrompt,
  SingleImageCameraPose,
  SingleImageSubjectCategory,
  SingleImageViewpointAnalysis,
  SingleImageViewpointRequest,
  SingleImageViewpointResult,
  XYZRotation
} from "../../src/domain";
import {
  buildSingleImageCameraPrompt,
  buildSingleImageCameraPose,
  DEFAULT_SINGLE_IMAGE_IMAGE_MODEL,
  DEFAULT_SINGLE_IMAGE_REASONING_MODEL,
  SINGLE_IMAGE_CAMERA_DISTANCE_DEFAULT,
  SINGLE_IMAGE_CAMERA_DISTANCE_MAX,
  SINGLE_IMAGE_CAMERA_DISTANCE_MIN,
  SINGLE_IMAGE_VIEWPOINT_LIMITS
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
  cameraPrompt: SingleImageCameraPrompt;
  pose: SingleImageCameraPose;
  endpoint_override: NonNullable<
    SingleImageViewpointRequest["endpoint_override"]
  >;
};

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
    message: `${request.reasoning_model} 正在识别主体、画风与不可见表面`,
    cameraPrompt: request.cameraPrompt
  });

  const reasoningStartedAt = Date.now();
  const reasoningResponse = await requestJSON(
    endpoints.responses,
    {
      method: "POST",
      headers: {
        ...requestHeaders,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildSingleImageReasoningRequest(request)),
      timeoutMs: REASONING_TIMEOUT_MS,
      label: "空间视角推理"
    },
    signal
  );
  const analysis = parseSingleImageReasoningResponse(reasoningResponse);
  const reasoningDurationMs = Date.now() - reasoningStartedAt;
  const renderPrompt = buildSingleImageEditPrompt(
    analysis,
    request.pose,
    request.user_prompt,
    request.camera_distance
  );

  onStage?.({
    stage: "rendering",
    message: `${request.image_model} 正在按锁定相机协议重绘完整新视图`,
    analysis,
    cameraPrompt: request.cameraPrompt,
    renderPrompt
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
        analysis,
        renderPrompt,
        sourceImage,
        poseGuideImage
      }),
      timeoutMs: IMAGE_EDIT_TIMEOUT_MS,
      label: "新视角图像生成"
    },
    signal
  );
  const renderedImage = parseSingleImageEditResponse(imageResponse);
  const renderingDurationMs = Date.now() - renderingStartedAt;

  return {
    requestId: request.requestId,
    image: renderedImage.image,
    imageMimeType: renderedImage.mimeType,
    pose: request.pose,
    cameraPrompt: request.cameraPrompt,
    renderPrompt,
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
  const pose = buildSingleImageCameraPose(rotation);
  const cameraPrompt = buildSingleImageCameraPrompt(
    rotation,
    cameraDistance
  );

  return {
    requestId,
    source_image: sourceImage,
    pose_guide_image: poseGuideImage,
    camera_pose_image: cameraPoseImage,
    rotation_degrees: rotation,
    camera_distance: cameraDistance,
    user_prompt:
      typeof input.user_prompt === "string" ? input.user_prompt.trim() : "",
    background_mode: "preserve_scene",
    api_key: apiKey,
    reasoning_model:
      input.reasoning_model?.trim() || DEFAULT_SINGLE_IMAGE_REASONING_MODEL,
    image_model:
      input.image_model?.trim() || DEFAULT_SINGLE_IMAGE_IMAGE_MODEL,
    output_size: validateOutputSize(input.output_size),
    endpoint_override: {
      baseURL: input.endpoint_override?.baseURL?.trim(),
      editURL: input.endpoint_override?.editURL?.trim(),
      headers: sanitizeHeaders(input.endpoint_override?.headers)
    },
    pose,
    cameraPrompt
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
      request.camera_distance
    );
  const userIntent =
    request.user_prompt ||
    "不增加额外概念，保持原主体身份、原始造型、光线和场景。";

  return {
    model: request.reasoning_model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "你是一名单图新视角重绘的视觉事实分析师与隐藏表面规划师。",
              "图像 1 是主体类别、身份或型号、可见结构、材质、标记、文字、光线、画风与场景的唯一事实来源。",
              "图像 2 是不含坐标轴与旋转环的干净姿态引导图，只用于理解目标投影、构图和 Roll；它不是三维重建，不提供不可见表面的事实。最终生图模型会同时接收图像 1 和图像 2。",
              "图像 3 是完整机位图，包含 XYZ 坐标轴、三色旋转环、轴标签和当前姿态，只用于解释相机控制与核对锁定机位。最终生图模型不会接收图像 3。",
              cameraPrompt.deterministicPromptZh,
              "【你的职责边界】",
              "1. 锁定相机协议由服务端确定。不得修改、纠正、近似、重述或重新定义其中的方位、俯仰、Roll、景别或 XYZ 数值。你输出的结构验收条件必须服从该机位。",
              "2. 先判定主体类别：人物、动物、产品/物体、车辆、建筑/场景或其他。只有图像事实明确支持时才可使用类别专属术语，禁止把人体器官、服装或解剖术语套用到非人物主体。",
              "3. 只识别并记录：主体类别、身份或型号、原图实际视角、可见结构、姿态或构型、画风、材质、色彩、光源方向、镜头质感、场景事实以及可见文字或标记。",
              "4. 根据锁定协议规划原图不可见表面的保守补全，按已确认类别采用对应的生物形态、制造装配、建筑空间或自然结构规律，保持身份、比例、构造、材质、标记和功能关系连续。",
              "5. visibility_constraints 和 occlusion_constraints 必须是按主体类别生成、可从最终像素客观验收的投影条件。必须点名图像 1 中真实存在的结构、零件、轮廓或空间层次，并描述其投影宽度、重叠、遮挡、缩短或显露变化。",
              "6. 禁止输出“主体右侧表面”“主体左侧表面”“显示更多侧面”这类与类别无关的泛化模板。人物只能使用图像中确实存在的人体或服饰结构；产品、车辆、建筑等必须使用其真实零件、构造或空间名称。",
              "7. 世界坐标中的同一动作事件、关节相对关系、装配状态和场景拓扑只作为三维连续基准，不是原图屏幕姿态或朝向锁。屏幕坐标中的主体朝向、轮廓、投影宽度、近远侧结构、遮挡顺序和背景视差必须由目标相机重新投影。",
              "8. 必须由锁定目标相机对图像 1 所代表的同一三维时刻重新投影。人物、动物或物体在屏幕中的朝向、轮廓和可见结构必须随目标机位变化，可从原图正向投影重建为侧向、后向、俯视或仰视投影；新增结构只允许用于合理补全该新机位原本不可见的部分。",
              "9. 规划完整画幅重绘和场景视差重建，使前景、主体与背景的相对位移共同证明机位变化；不得提出二维透视扭曲、平面旋转、卡片翻面、镜像、边缘扩图或复制原投影。",
              "10. optimized_prompt 必须使用中文，只能汇总类别、身份、结构、材质、光影、隐藏面补全和场景连续性，不得包含任何新的相机方位、角度、Roll 或景别描述。",
              `用户附加约束：${userIntent}`,
              "严格返回指定 JSON 字段。所有字段内容默认使用中文。"
            ].join("\n\n")
          },
          {
            type: "input_image",
            image_url: request.source_image,
            detail: "original"
          },
          {
            type: "input_image",
            image_url: request.pose_guide_image,
            detail: "original"
          },
          {
            type: "input_image",
            image_url: request.camera_pose_image,
            detail: "original"
          }
        ]
      }
    ],
    reasoning: {
      effort: "high"
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
            optimized_prompt: { type: "string" },
            view_description: { type: "string" },
            source_view_description: { type: "string" },
            target_view_description: { type: "string" },
            relative_camera_motion: { type: "string" },
            visibility_constraints: {
              type: "array",
              items: { type: "string" }
            },
            occlusion_constraints: {
              type: "array",
              items: { type: "string" }
            },
            identity_constraints: {
              type: "array",
              items: { type: "string" }
            },
            hidden_surface_plan: {
              type: "array",
              items: { type: "string" }
            },
            scene_plan: {
              type: "array",
              items: { type: "string" }
            },
            uncertainty_notes: {
              type: "array",
              items: { type: "string" }
            }
          },
          required: [
            "subject_category",
            "optimized_prompt",
            "view_description",
            "source_view_description",
            "target_view_description",
            "relative_camera_motion",
            "visibility_constraints",
            "occlusion_constraints",
            "identity_constraints",
            "hidden_surface_plan",
            "scene_plan",
            "uncertainty_notes"
          ]
        }
      }
    },
    max_output_tokens: 5000
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

  return [
    "【输入图像角色｜严格区分】",
    "1. 图像 1 是身份或型号、类别、结构、材质、颜色、标记、文字、画风、光照和场景的唯一事实来源，必须高保真保持。",
    "2. 图像 2 只提供目标相机投影、Roll 与构图参考，不是隐藏表面证据。不得复制图像 2 的平面卡片、暗色边框、预览底色或任何辅助预览外观。",
    "",
    cameraPrompt.deterministicPromptZh,
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
    "图像 1 是唯一事实图。保持同一主体的类别、身份或型号、比例、构造、材质、颜色、标记、可读文字、画风、光照特征和原始环境。世界坐标中的动作事件、关节相对关系或装配关系保持连续，但原图屏幕姿态与朝向不锁定；由锁定目标相机重新投影屏幕朝向、轮廓、投影宽度、可见结构分布和遮挡顺序。",
    ...formatZhList(identityFacts),
    "",
    "【不可见表面保守补全】",
    "只依据图像 1 的事实、已确认类别对应的结构规律、语义对称、制造装配、空间连续性、材质连续性和场景上下文补全新显露表面；不得重新设计主体，也不得把其他类别的结构术语强加给当前主体。",
    ...formatZhList(hiddenSurfacePlan),
    "",
    "【场景与光影连续性】",
    "保持原环境、时间、色彩分级、光源方向、镜头质感和景深；按锁定相机位置重建背景视差、遮挡区域和完整画幅。",
    ...formatZhList(scenePlan),
    "",
    "【不确定信息处理】",
    "对原图不可确认的信息采用最保守、最符合身份与结构连续性的方案，不得用装饰或遮挡逃避目标可见面。",
    ...formatZhList(uncertaintyNotes),
    "",
    "【用户附加约束】",
    userPrompt.trim() || "不引入额外概念或重新设计。",
    "",
    "【最终执行与验收】",
    "对整张图进行高保真三维新视角重绘，不是局部修补。由锁定目标相机对同一三维时刻重新投影：世界坐标中的动作事件与结构关系连续；屏幕坐标中的主体朝向、轮廓、投影宽度、可见区域、遮挡顺序、透视缩短、从上方或下方可见结构的面积和背景视差必须重新计算并明显改变，以证明目标机位。",
    `锁定相机块是唯一相机来源，优先级高于任何模型分析文字。${subjectProjectionDirective}`,
    "禁止镜像、二维平面旋转、透视拉伸、卡片翻转、保留原图投影、重复主体、额外结构或部件、虚构标志、字幕、水印、坐标轴和无关物体。",
    "只输出一张干净的最终图像。"
  ].join("\n");
}

export function buildSingleImageEditForm(input: {
  request: NormalizedRequest;
  analysis: SingleImageViewpointAnalysis;
  renderPrompt?: string;
  poseGuideImage: ParsedDataURL;
  sourceImage: ParsedDataURL;
}) {
  const form = new FormData();
  form.append("model", input.request.image_model);
  form.append(
    "prompt",
    input.renderPrompt ??
      buildSingleImageEditPrompt(
        input.analysis,
        input.request.pose,
        input.request.user_prompt,
        input.request.camera_distance
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
  form.append("quality", "high");
  form.append("size", input.request.output_size);
  form.append("output_format", "png");
  form.append("n", "1");

  return form;
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
    .filter(
      (item) =>
        item &&
        !cameraControlPattern.test(item) &&
        !GENERIC_SUBJECT_SURFACE_PATTERN.test(item) &&
        !ORIGINAL_PROJECTION_LOCK_PATTERN.test(item) &&
        (allowBiologicalAnatomy || !humanTemplatePattern.test(item))
    );
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
        !GENERIC_SUBJECT_SURFACE_PATTERN.test(item) &&
        !ORIGINAL_PROJECTION_LOCK_PATTERN.test(item) &&
        (allowHumanTerms || !humanTemplatePattern.test(item))
    );
}

const GENERIC_SUBJECT_SURFACE_PATTERN =
  /主体(?:的)?(?:朝)?(?:(?:左|右|前|后|上|下)侧?(?:表面|侧面|区域|结构)|(?:侧面|表面))|(?:左|右|前|后|上|下)侧?(?:表面|侧面|区域)|显示更多(?:左|右|前|后|侧)?面|显露(?:左|右|前|后|侧)?面|\b(?:the\s+)?(?:subject(?:'s)?\s+)?(?:left|right|front|rear|back|top|bottom)(?:[-\s]+side)?\s+surface\b|\bshow\s+more\s+(?:of\s+the\s+)?(?:left|right|front|rear|back|top|bottom)?\s*side\b/iu;

const ORIGINAL_PROJECTION_LOCK_PATTERN =
  /\b(?:do not|don't|must not|never)\b.{0,30}\b(?:turn|rotate|change)\b.{0,20}\b(?:pose|orientation|facing|view)\b|\b(?:keep|preserve|lock)\b.{0,25}\b(?:original|source)\b.{0,20}\b(?:pose|orientation|facing|projection)\b|(?:禁止|不得|不要).{0,24}(?:主体|人物|动物|物体|车辆|建筑)?.{0,16}(?:主动)?(?:转身|旋转自身|改变|调整).{0,10}(?:姿态|朝向|屏幕朝向|投影)|(?:保持|锁定|固定).{0,16}(?:原图|原始|主体|人物|物体)?.{0,16}(?:屏幕朝向|原图朝向|原始朝向|正面朝向|投影不变)/iu;

function buildSubjectProjectionDirective(
  subjectCategory: SingleImageSubjectCategory
) {
  switch (subjectCategory) {
    case "person":
      return "把人物的同一动作事件作为三维连续参考，从目标相机重新成像；头部、躯干和四肢相对屏幕的朝向、轮廓、近远侧遮挡与可见比例必须按目标机位重建，原图正脸不构成二维投影锁。";
    case "animal":
      return "把动物的同一动作事件作为三维连续参考，从目标相机重新成像；头部、躯干和肢体相对屏幕的朝向、轮廓、近远侧遮挡与可见比例必须按目标机位重建。";
    case "product_object":
      return "把物体的零件装配与工作状态作为三维连续参考，从目标相机重新成像；整体相对屏幕的朝向、轮廓、可见部件与遮挡必须按目标机位重建，原图正向投影可变为侧向或后向投影。";
    case "vehicle":
      return "把车辆的车轮、舱门和部件状态作为三维连续参考，从目标相机重新成像；车身相对屏幕的朝向、轮廓、近远侧结构与遮挡必须按目标机位重建。";
    case "architecture_scene":
      return "把建筑与场景的空间拓扑和对象关系作为三维连续参考，从目标相机重新成像；立面投影、可见空间、遮挡顺序与背景视差必须按目标机位重建。";
    case "other":
      return "把主体的结构与状态作为三维连续参考，从目标相机重新成像；其相对屏幕的朝向、轮廓、可见区域与遮挡必须按目标机位重建。";
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

function formatZhList(items: string[]) {
  return items.length > 0
    ? items.map((item) => `- ${item}`)
    : ["- 无额外条目，以原图事实和锁定相机协议为准。"];
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
