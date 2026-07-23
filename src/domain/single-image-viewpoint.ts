import type { EndpointOverride } from "./generation";

export const SINGLE_IMAGE_ROTATION_MIN = -720;
export const SINGLE_IMAGE_ROTATION_MAX = 720;
export const SINGLE_IMAGE_CAMERA_DISTANCE_MIN = 0;
export const SINGLE_IMAGE_CAMERA_DISTANCE_MAX = 10;
export const SINGLE_IMAGE_CAMERA_DISTANCE_DEFAULT = 5;
export const DEFAULT_SINGLE_IMAGE_REASONING_MODEL = "gpt-5.6-sol";
export const DEFAULT_SINGLE_IMAGE_IMAGE_MODEL = "gpt-image-2";
export const DEFAULT_SINGLE_IMAGE_PROMPT_LANGUAGE = "en" as const;
export const SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER =
  "相机直绘版本：10.6｜画面侧主指令、反镜头跟随与整场景新视锥重拍";
export const SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER_EN =
  "Camera recapture protocol: 10.6 | source-frame-side directive, anti-camera-tracking, and whole-scene view-frustum recapture";
export const DEFAULT_SINGLE_IMAGE_USER_PROMPT_ZH =
  "延续同一现实瞬间的场景内容、空间关系、材质、光线、色彩和风格，不增加无关概念。";
export const DEFAULT_SINGLE_IMAGE_USER_PROMPT_EN =
  "Continue the same real-world moment, spatial relationships, materials, lighting, colors, and visual style without adding unrelated concepts.";

export type SingleImagePromptLanguage = "zh" | "en";

export type SingleImagePromptConflict =
  | "generic-subject-surface"
  | "source-projection-lock";

const SINGLE_IMAGE_GENERIC_SUBJECT_SURFACE_PATTERN =
  /主体(?:的)?(?:朝)?(?:(?:左|右|前|后|上|下)侧?(?:表面|侧面|区域|结构)|(?:侧面|表面))|(?:左|右|前|后|上|下)侧?(?:表面|侧面|区域)|显示更多(?:左|右|前|后|侧)?面|显露(?:左|右|前|后|侧)?面|\b(?:the\s+)?(?:subject(?:'s)?\s+)?(?:left|right|front|rear|back|top|bottom)(?:[-\s]+side)?\s+surface\b|\bshow\s+more\s+(?:of\s+the\s+)?(?:left|right|front|rear|back|top|bottom)?\s*side\b/iu;

const SINGLE_IMAGE_SOURCE_PROJECTION_LOCK_PATTERN =
  /\b(?:do not|don't|must not|never)\b.{0,30}\b(?:turn|rotate|change)\b.{0,20}\b(?:pose|orientation|facing|view)\b|\b(?:keep|preserve|lock)\b.{0,25}\b(?:original|source)\b.{0,20}\b(?:pose|orientation|facing|projection)\b|(?:禁止|不得|不要).{0,24}(?:主体|人物|动物|物体|车辆|建筑)?.{0,16}(?:主动)?(?:转身|旋转自身|改变|调整).{0,10}(?:姿态|朝向|屏幕朝向|投影)|(?<!不得)(?<!不能)(?<!避免)(?<!禁止)(?<!不要)(?<!不)(?<!未)(?<!勿)(?<!无)(?<!非)(?<!别)(?:保持|锁定|固定).{0,16}(?:原图|原始|主体|人物|物体)?.{0,16}(?:屏幕朝向|原图朝向|原始朝向|正面朝向|投影不变)|(?:主体|人物|动物|物体|车辆|建筑).{0,16}(?:世界空间|三维空间).{0,16}(?:状态|姿态|朝向).{0,12}(?:保持不变|固定|锁定)/iu;
const SINGLE_IMAGE_LEGACY_SUBJECT_MOTION_LOCK_PATTERN =
  /不得让主体.{0,60}(?:相机|镜头|转向|旋转|正对)|不得转动主体.{0,60}(?:相机|投影|缩短)/iu;
const SINGLE_IMAGE_CATEGORY_POSE_LOCK_PATTERN =
  /(?<!not )(?<!n't )\b(?:keep|preserve|maintain|lock)\b.{0,48}\b(?:pose|orientation|facing|heading)\b|\b(?:pose|orientation|facing|heading)\b.{0,24}\bunchanged\b|(?:不改变|不得改变|禁止改变|不要改变|不能改变|不可改变).{0,32}(?:姿态|朝向|面向|转向)|(?<!不)(?<!未)(?<!勿)(?<!非)(?<!得)(?<!止)(?<!要)(?<!能)(?<!可)(?:保持|维持|锁定|固定).{0,32}(?:姿态|朝向|面向|转向)/iu;
const SINGLE_IMAGE_SOURCE_DIRECTION_STATE_LOCK_PATTERN =
  /(?:保持|维持|锁定|固定).{0,36}(?:图像\s*1|原图|源图|原有|原始).{0,28}(?:直立|俯仰|偏航|倾斜)(?:状态|角度|方向)?|(?:不改变|不得改变|禁止改变|不要改变|不能改变|不可改变).{0,36}(?:直立|俯仰|偏航|倾斜)(?:状态|角度|方向)?/iu;
const SINGLE_IMAGE_CATEGORY_AXIS_LOCK_PATTERN =
  /(?:保持|维持|锁定|固定).{0,48}(?:主体|人物|身体|头部|扇头|风扇头|物体|产品|车辆|建筑).{0,32}(?:直立|俯仰|偏航|倾斜)(?:状态|角度|方向)?|\b(?:keep|preserve|maintain|lock)\b.{0,48}\b(?:subject|person|body|head|object|product|vehicle|building)\b.{0,32}\b(?:pitch|yaw|tilt|upright)\b|\b(?:subject|person|body|head|object|product|vehicle|building)\b.{0,32}\b(?:pitch|yaw|tilt|upright)\b.{0,24}\b(?:unchanged|fixed|locked)\b/iu;

export function findSingleImagePromptConflict(
  prompt: string
): SingleImagePromptConflict | undefined {
  if (SINGLE_IMAGE_GENERIC_SUBJECT_SURFACE_PATTERN.test(prompt)) {
    return "generic-subject-surface";
  }

  if (
    SINGLE_IMAGE_SOURCE_PROJECTION_LOCK_PATTERN.test(prompt) ||
    SINGLE_IMAGE_LEGACY_SUBJECT_MOTION_LOCK_PATTERN.test(prompt) ||
    SINGLE_IMAGE_CATEGORY_POSE_LOCK_PATTERN.test(prompt) ||
    SINGLE_IMAGE_SOURCE_DIRECTION_STATE_LOCK_PATTERN.test(prompt) ||
    SINGLE_IMAGE_CATEGORY_AXIS_LOCK_PATTERN.test(prompt)
  ) {
    return "source-projection-lock";
  }

  return undefined;
}

export type XYZRotation = {
  x: number;
  y: number;
  z: number;
};

export type SingleImageFrameSpec = {
  sourceWidth?: number;
  sourceHeight?: number;
  outputSize?: string;
};

export type ViewpointQuaternion = {
  x: number;
  y: number;
  z: number;
  w: number;
};

export type SingleImageCameraPose = {
  cumulativeDegrees: XYZRotation;
  normalizedDegrees: XYZRotation;
  quaternion: ViewpointQuaternion;
  eulerOrder: "YXZ";
  coordinateSystem: "right-handed-camera-orbit";
};

export type SingleImageDirectionalConstraints = {
  relativeCameraMotion: string[];
  visibilityConstraints: string[];
  occlusionConstraints: string[];
  perspectiveCues: string[];
  forbiddenShortcuts: string[];
};

export type CameraAzimuthKey =
  | "front"
  | "right-front"
  | "right"
  | "right-back"
  | "back"
  | "left-back"
  | "left"
  | "left-front";

export type CameraElevationKey =
  | "near-bottom"
  | "low-angle"
  | "eye-level"
  | "elevated"
  | "high-angle"
  | "near-top";

export type CameraDistanceKey = "wide" | "medium" | "close-up";

export type SingleImageCameraPrompt = {
  cumulativeRotationDegrees: XYZRotation;
  equivalentRotationDegrees: XYZRotation;
  cameraAzimuthDegrees: number;
  cameraElevationDegrees: number;
  cameraRollDegrees: number;
  cameraDistance: number;
  azimuthKey: CameraAzimuthKey;
  elevationKey: CameraElevationKey;
  distanceKey: CameraDistanceKey;
  azimuthLabelZh: string;
  azimuthLabelEn: string;
  elevationLabelZh: string;
  elevationLabelEn: string;
  distanceLabelZh: string;
  distanceLabelEn: string;
  rollLabelZh: string;
  rollLabelEn: string;
  viewerOrbitDirectionZh: string;
  viewerOrbitDirectionEn: string;
  objectOrbitDirectionZh: string;
  objectOrbitDirectionEn: string;
  sourceAspectRatioLabel?: string;
  outputSize?: string;
  requiredVisibleSurfaces: string[];
  requiredOccludedSurfaces: string[];
  perspectiveConstraints: string[];
  forbiddenShortcuts: string[];
  deterministicPromptZh: string;
  deterministicPromptEn: string;
};

export type SingleImageViewpointStage = "reasoning" | "rendering";

export type SingleImageSubjectCategory =
  | "person"
  | "animal"
  | "product_object"
  | "vehicle"
  | "architecture_scene"
  | "other";

export type SingleImageViewpointAnalysis = {
  subjectCategory: SingleImageSubjectCategory;
  optimizedPrompt: string;
  viewDescription: string;
  sourceViewDescription: string;
  targetViewDescription: string;
  relativeCameraMotion: string;
  visibilityConstraints: string[];
  occlusionConstraints: string[];
  identityConstraints: string[];
  hiddenSurfacePlan: string[];
  scenePlan: string[];
  uncertaintyNotes: string[];
};

export type SingleImageViewpointRequest = {
  requestId: string;
  source_image: string;
  pose_guide_image: string;
  camera_pose_image: string;
  rotation_degrees: XYZRotation;
  camera_distance?: number;
  source_width?: number;
  source_height?: number;
  prompt_language?: SingleImagePromptLanguage;
  user_prompt: string;
  background_mode: "preserve_scene";
  api_key?: string;
  reasoning_model: string;
  image_model: string;
  output_size: string;
  endpoint_override?: Pick<
    EndpointOverride,
    "baseURL" | "editURL" | "headers"
  >;
};

export type SingleImageViewpointResult = SingleImageViewpointAnalysis & {
  requestId: string;
  image: string;
  imageMimeType: string;
  pose: SingleImageCameraPose;
  cameraPrompt: SingleImageCameraPrompt;
  renderPrompt: string;
  promptLanguage: SingleImagePromptLanguage;
  outputSize: string;
  reasoningModel: string;
  imageModel: string;
  reasoningDurationMs: number;
  renderingDurationMs: number;
  totalDurationMs: number;
};

export type SingleImageViewpointStreamEvent =
  | {
      type: "stage";
      stage: SingleImageViewpointStage;
      message: string;
      analysis?: SingleImageViewpointAnalysis;
      cameraPrompt?: SingleImageCameraPrompt;
      renderPrompt?: string;
      promptLanguage?: SingleImagePromptLanguage;
    }
  | {
      type: "result";
      data: SingleImageViewpointResult;
    }
  | {
      type: "error";
      error: {
        code: string;
        message: string;
        requestId?: string;
        retryable: boolean;
      };
    };

export const SINGLE_IMAGE_VIEWPOINT_LIMITS = {
  sourceImageBytes: 20 * 1024 * 1024,
  guideImageBytes: 20 * 1024 * 1024,
  cameraPoseImageBytes: 20 * 1024 * 1024,
  combinedImageBytes: 48 * 1024 * 1024
} as const;

export function clampSingleImageRotationAngle(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(
    SINGLE_IMAGE_ROTATION_MAX,
    Math.max(SINGLE_IMAGE_ROTATION_MIN, value)
  );
}

export function normalizeSingleImageRotationAngle(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  const signed = normalized === -180 ? 180 : normalized;

  return Object.is(signed, -0) ? 0 : signed;
}

export function calculateShortestAxisRotationDelta(
  previousVisualAngle: number,
  currentVisualAngle: number
) {
  let delta =
    normalizeUnsignedDegrees(currentVisualAngle) -
    normalizeUnsignedDegrees(previousVisualAngle);

  if (delta > 180) {
    delta -= 360;
  } else if (delta < -180) {
    delta += 360;
  }

  return Object.is(delta, -0) ? 0 : delta;
}

export function accumulateSingleImageRotation(
  cumulativeAngle: number,
  previousVisualAngle: number,
  currentVisualAngle: number
) {
  return clampSingleImageRotationAngle(
    cumulativeAngle +
      calculateShortestAxisRotationDelta(
        previousVisualAngle,
        currentVisualAngle
      )
  );
}

export function clampSingleImageCameraDistance(value: number) {
  if (!Number.isFinite(value)) {
    return SINGLE_IMAGE_CAMERA_DISTANCE_DEFAULT;
  }

  return Math.min(
    SINGLE_IMAGE_CAMERA_DISTANCE_MAX,
    Math.max(SINGLE_IMAGE_CAMERA_DISTANCE_MIN, value)
  );
}

export function buildSingleImageCameraPose(
  rotation: XYZRotation
): SingleImageCameraPose {
  const cumulativeDegrees = {
    x: clampSingleImageRotationAngle(rotation.x),
    y: clampSingleImageRotationAngle(rotation.y),
    z: clampSingleImageRotationAngle(rotation.z)
  };
  const normalizedDegrees = {
    x: cleanDisplayAngle(
      normalizeSingleImageRotationAngle(cumulativeDegrees.x)
    ),
    y: cleanDisplayAngle(
      normalizeSingleImageRotationAngle(cumulativeDegrees.y)
    ),
    z: cleanDisplayAngle(
      normalizeSingleImageRotationAngle(cumulativeDegrees.z)
    )
  };
  const pitch = quaternionFromAxisAngle(
    { x: 1, y: 0, z: 0 },
    degreesToRadians(normalizedDegrees.x)
  );
  const yaw = quaternionFromAxisAngle(
    { x: 0, y: 1, z: 0 },
    degreesToRadians(-normalizedDegrees.y)
  );
  const roll = quaternionFromAxisAngle(
    { x: 0, y: 0, z: 1 },
    degreesToRadians(normalizedDegrees.z)
  );

  return {
    cumulativeDegrees,
    normalizedDegrees,
    quaternion: normalizeQuaternion(
      multiplyQuaternions(multiplyQuaternions(yaw, pitch), roll)
    ),
    eulerOrder: "YXZ",
    coordinateSystem: "right-handed-camera-orbit"
  };
}

export function buildSingleImageCameraPrompt(
  rotation: XYZRotation,
  cameraDistance = SINGLE_IMAGE_CAMERA_DISTANCE_DEFAULT,
  frameSpec: SingleImageFrameSpec = {}
): SingleImageCameraPrompt {
  const pose = buildSingleImageCameraPose(rotation);
  const direction = deriveSingleImageCameraDirection(pose);
  const distance = clampSingleImageCameraDistance(cameraDistance);
  const azimuth = classifyCameraAzimuth(direction.azimuth);
  const elevation = classifyCameraElevation(direction.elevation);
  const distanceClass = classifyCameraDistance(distance);
  const horizontalReference = describeHorizontalReference(
    direction.azimuth
  );
  const normalizedFrame = normalizeSingleImageFrameSpec(frameSpec);
  const directional = buildDirectionalConstraints({
    azimuthKey: azimuth.key,
    elevationKey: elevation.key,
    elevationDegrees: direction.elevation,
    distanceKey: distanceClass.key,
    rollDegrees: pose.normalizedDegrees.z
  });
  const rollLabelZh = describeRollZh(
    pose.cumulativeDegrees.z,
    pose.normalizedDegrees.z
  );
  const prompt = {
    cumulativeRotationDegrees: pose.cumulativeDegrees,
    equivalentRotationDegrees: pose.normalizedDegrees,
    cameraAzimuthDegrees: direction.azimuth,
    cameraElevationDegrees: direction.elevation,
    cameraRollDegrees: pose.normalizedDegrees.z,
    cameraDistance: distance,
    azimuthKey: azimuth.key,
    elevationKey: elevation.key,
    distanceKey: distanceClass.key,
    azimuthLabelZh: azimuth.label,
    azimuthLabelEn: azimuth.labelEn,
    elevationLabelZh: elevation.label,
    elevationLabelEn: elevation.labelEn,
    distanceLabelZh: distanceClass.label,
    distanceLabelEn: distanceClass.labelEn,
    rollLabelZh,
    rollLabelEn: describeRollEn(
      pose.cumulativeDegrees.z,
      pose.normalizedDegrees.z
    ),
    viewerOrbitDirectionZh: horizontalReference.viewerZh,
    viewerOrbitDirectionEn: horizontalReference.viewerEn,
    objectOrbitDirectionZh: horizontalReference.objectZh,
    objectOrbitDirectionEn: horizontalReference.objectEn,
    sourceAspectRatioLabel: normalizedFrame.sourceAspectRatioLabel,
    outputSize: normalizedFrame.outputSize,
    requiredVisibleSurfaces: directional.visibilityConstraints,
    requiredOccludedSurfaces: directional.occlusionConstraints,
    perspectiveConstraints: directional.perspectiveCues,
    forbiddenShortcuts: directional.forbiddenShortcuts,
    deterministicPromptZh: "",
    deterministicPromptEn: ""
  } satisfies SingleImageCameraPrompt;

  prompt.deterministicPromptZh = buildDeterministicCameraPromptZh(prompt);
  prompt.deterministicPromptEn = buildDeterministicCameraPromptEn(prompt);

  return prompt;
}

export function buildSingleImageDirectionalConstraints(
  pose: SingleImageCameraPose,
  cameraDistance = SINGLE_IMAGE_CAMERA_DISTANCE_DEFAULT
): SingleImageDirectionalConstraints {
  const prompt = buildSingleImageCameraPrompt(
    pose.cumulativeDegrees,
    cameraDistance
  );

  return {
    relativeCameraMotion: [
      "原图是唯一的零度相机基准。XYZ 表示目标相机相对零度基准的轨道运动，结果必须是目标相机对同一三维时刻的重新投影。",
      `目标相机为${prompt.azimuthLabelZh}、${prompt.elevationLabelZh}、${prompt.distanceLabelZh}；精确方位角 ${formatSignedDegreesZh(prompt.cameraAzimuthDegrees)}，精确俯仰角 ${formatSignedDegreesZh(prompt.cameraElevationDegrees)}，${prompt.rollLabelZh}。`
    ],
    visibilityConstraints: prompt.requiredVisibleSurfaces,
    occlusionConstraints: prompt.requiredOccludedSurfaces,
    perspectiveCues: prompt.perspectiveConstraints,
    forbiddenShortcuts: prompt.forbiddenShortcuts
  };
}

function deriveSingleImageCameraDirection(pose: SingleImageCameraPose) {
  const position = rotateVectorByQuaternion(
    { x: 0, y: 0, z: -1 },
    pose.quaternion
  );
  const horizontalLength = Math.hypot(position.x, position.z);
  const azimuth = normalizeSingleImageRotationAngle(
    radiansToDegrees(Math.atan2(position.x, -position.z))
  );
  const elevation = radiansToDegrees(
    Math.atan2(position.y, horizontalLength)
  );

  return {
    azimuth: cleanDisplayAngle(azimuth),
    elevation: cleanDisplayAngle(elevation)
  };
}

function classifyCameraAzimuth(value: number): {
  key: CameraAzimuthKey;
  label: string;
  labelEn: string;
} {
  const index = Math.floor((normalizeUnsignedDegrees(value) + 22.5) / 45) % 8;
  const options: Array<{
    key: CameraAzimuthKey;
    label: string;
    labelEn: string;
  }> = [
    { key: "front", label: "基准正前方机位", labelEn: "source front view" },
    {
      key: "right-front",
      label: "对象右前方机位（原图观看者左侧轨道）",
      labelEn:
        "object-right-front three-quarter view on the source viewer's left orbit"
    },
    {
      key: "right",
      label: "对象右侧机位（原图观看者左侧轨道）",
      labelEn:
        "strict object-right-side view on the source viewer's left orbit"
    },
    {
      key: "right-back",
      label: "对象右后方机位（原图观看者左侧轨道）",
      labelEn:
        "object-right-rear three-quarter view on the source viewer's left orbit"
    },
    { key: "back", label: "基准正后方机位", labelEn: "rear view" },
    {
      key: "left-back",
      label: "对象左后方机位（原图观看者右侧轨道）",
      labelEn:
        "object-left-rear three-quarter view on the source viewer's right orbit"
    },
    {
      key: "left",
      label: "对象左侧机位（原图观看者右侧轨道）",
      labelEn:
        "strict object-left-side view on the source viewer's right orbit"
    },
    {
      key: "left-front",
      label: "对象左前方机位（原图观看者右侧轨道）",
      labelEn:
        "object-left-front three-quarter view on the source viewer's right orbit"
    }
  ];

  return options[index] ?? options[0]!;
}

function classifyCameraElevation(value: number): {
  key: CameraElevationKey;
  label: string;
  labelEn: string;
} {
  if (value <= -75) {
    return {
      key: "near-bottom",
      label: "近底视仰拍",
      labelEn: "near-bottom upward view"
    };
  }

  if (value < -15) {
    return {
      key: "low-angle",
      label: "低机位仰拍",
      labelEn: "low-angle upward view"
    };
  }

  if (value < 15) {
    return { key: "eye-level", label: "平视", labelEn: "eye level" };
  }

  if (value < 45) {
    return {
      key: "elevated",
      label: "高角度观察",
      labelEn: "elevated view"
    };
  }

  if (value < 75) {
    return { key: "high-angle", label: "俯拍", labelEn: "high-angle view" };
  }

  return {
    key: "near-top",
    label: "近顶视俯拍",
    labelEn: "near-top downward view"
  };
}

function classifyCameraDistance(value: number): {
  key: CameraDistanceKey;
  label: string;
  labelEn: string;
} {
  if (value < 2) {
    return { key: "wide", label: "远景", labelEn: "wide shot" };
  }

  if (value < 6) {
    return { key: "medium", label: "中景", labelEn: "medium shot" };
  }

  return { key: "close-up", label: "特写", labelEn: "close-up" };
}

function describeHorizontalReference(value: number) {
  const azimuth = normalizeSingleImageRotationAngle(value);

  if (Math.abs(azimuth) < 0.5) {
    return {
      viewerZh: "原图观看者正前方",
      viewerEn: "directly in front of the source viewer",
      objectZh: "被摄对象正前方",
      objectEn: "directly in front of the depicted object"
    };
  }

  if (Math.abs(Math.abs(azimuth) - 180) < 0.5) {
    return {
      viewerZh: "原图相机正后方",
      viewerEn: "directly behind the source camera position",
      objectZh: "被摄对象背后",
      objectEn: "behind the depicted object"
    };
  }

  if (azimuth > 0) {
    return {
      viewerZh: "原图观看者左侧",
      viewerEn: "the source viewer's left",
      objectZh: "被摄对象自身右侧",
      objectEn: "the depicted object's own right"
    };
  }

  return {
    viewerZh: "原图观看者右侧",
    viewerEn: "the source viewer's right",
    objectZh: "被摄对象自身左侧",
    objectEn: "the depicted object's own left"
  };
}

function normalizeSingleImageFrameSpec(frameSpec: SingleImageFrameSpec) {
  const sourceWidth =
    Number.isFinite(frameSpec.sourceWidth) &&
    Number(frameSpec.sourceWidth) > 0
      ? Math.round(Number(frameSpec.sourceWidth))
      : undefined;
  const sourceHeight =
    Number.isFinite(frameSpec.sourceHeight) &&
    Number(frameSpec.sourceHeight) > 0
      ? Math.round(Number(frameSpec.sourceHeight))
      : undefined;
  const outputSize =
    typeof frameSpec.outputSize === "string" &&
    /^\d{2,5}x\d{2,5}$/i.test(frameSpec.outputSize.trim())
      ? frameSpec.outputSize.trim().toLowerCase()
      : undefined;

  return {
    sourceAspectRatioLabel:
      sourceWidth && sourceHeight
        ? formatAspectRatioLabel(sourceWidth, sourceHeight)
        : undefined,
    outputSize
  };
}

function buildDirectionalConstraints(input: {
  azimuthKey: CameraAzimuthKey;
  elevationKey: CameraElevationKey;
  elevationDegrees: number;
  distanceKey: CameraDistanceKey;
  rollDegrees: number;
}): Omit<SingleImageDirectionalConstraints, "relativeCameraMotion"> {
  const visibilityConstraints = [
    "目标画面必须来自锁定机位的新视锥；前景、关注对象、中景、背景、地面、环境物体和画面边界必须一起重新成像。",
    "原图未拍到但会进入目标新视锥的对象结构与环境区域，依据原图的空间、材质、光线、色彩和画风合理想象并自然补全。"
  ];
  const occlusionConstraints = [
    "所有近远遮挡、入画、出画和重新显露关系必须按目标相机位置重新计算，不得沿用源图的二维遮挡顺序。",
    "目标机位看不到的源图区域可以自然退隐或离开画面，不得为了保留原构图而复制、镜像或贴回。"
  ];
  const perspectiveCues = [
    "整幅画面的透视、视差、地平线、构图、轮廓和尺度必须共同证明相机已沿轨道移动到目标机位。",
    "相机以固定的场景关注点为轨道圆心，镜头光轴在移动过程中持续指向同一关注点；这是环绕拍摄，不是横向平移，也不是让画面中的某个对象代替相机转动。"
  ];
  const forbiddenShortcuts = [
    "不得把任务执行成只修改关注对象而保留源图背景构图；这种结果视为失败。",
    "不得对源图做二维旋转、镜像、卡片翻转、透视拉伸、剪贴或边缘扩图来伪装新机位。",
    "不得复制姿态引导图的卡片、边框、底色、坐标轴、旋转环或预览外观。"
  ];

  const azimuthDescriptions: Record<CameraAzimuthKey, string> = {
    front: "从零度基准正前方观察整个场景",
    "right-front":
      "相机沿原图观看者左侧轨道移动，到达被摄对象自身右前方的三分之四机位",
    right:
      "相机沿原图观看者左侧轨道移动，到达被摄对象自身右侧的严格侧面机位",
    "right-back":
      "相机继续沿原图观看者左侧轨道移动，到达被摄对象自身右后方机位",
    back: "相机绕到零度基准背后观察整个场景",
    "left-back":
      "相机沿原图观看者右侧轨道移动，到达被摄对象自身左后方机位",
    left:
      "相机沿原图观看者右侧轨道移动，到达被摄对象自身左侧的严格侧面机位",
    "left-front":
      "相机沿原图观看者右侧轨道移动，到达被摄对象自身左前方的三分之四机位"
  };
  perspectiveCues.push(
    `${azimuthDescriptions[input.azimuthKey]}；所有深度层必须出现与该水平机位一致的视差和遮挡变化。`
  );
  perspectiveCues.push(
    buildAzimuthProjectionAcceptanceZh(input.azimuthKey)
  );

  if (
    input.elevationKey === "elevated" ||
    input.elevationKey === "high-angle" ||
    input.elevationKey === "near-top"
  ) {
    perspectiveCues.push(
      input.elevationKey === "near-top"
        ? "使用明确的近顶视透视，整幅场景从高处向下重新成像；世界高度方向产生强烈透视缩短，地面、背景层次、画面边界与新进入视锥的空间同步改变。"
        : "使用明确的高机位俯视透视，世界高度方向产生可见的纵向透视缩短，地面、环境、地平线和各深度层都必须响应俯拍机位。"
    );
  } else if (
    input.elevationKey === "low-angle" ||
    input.elevationKey === "near-bottom"
  ) {
    perspectiveCues.push(
      input.elevationKey === "near-bottom"
        ? "使用明确的近底视透视，整幅场景从极低位置向上重新成像；世界高度方向产生强烈透视缩短，地面、背景层次、画面边界与新进入视锥的空间同步改变。"
        : "使用明确的低机位仰拍透视，世界高度方向产生可见的纵向透视缩短，地面、环境、地平线和各深度层都必须响应仰拍机位。"
    );
  } else {
    perspectiveCues.push(
      "保持平视对应的自然透视，不得加入与目标俯仰矛盾的顶视或底视特征。"
    );
  }

  if (input.distanceKey === "wide") {
    perspectiveCues.push(
      "远景：相机真实后移并扩大环境视野，补全新进入画面的空间；不得只把源图内容二维缩小。"
    );
  } else if (input.distanceKey === "medium") {
    perspectiveCues.push(
      "中景：保持关注对象与周围环境都清晰可读，并呈现真实空间纵深。"
    );
  } else {
    perspectiveCues.push(
      "特写：相机真实前移，近大远小、遮挡、背景视差和景深随之改变；不得只对源图数字放大。"
    );
  }

  if (Math.abs(input.rollDegrees) < 0.5) {
    perspectiveCues.push(
      "Roll 为 0°：目标画面的地平线与零度基准一致，不得自行增加画框滚转。"
    );
  } else {
    const direction = input.rollDegrees > 0 ? "顺时针" : "逆时针";
    perspectiveCues.push(
      `相机画框绕光轴${direction}滚转 ${formatDegreesZh(Math.abs(input.rollDegrees))}；必须改变整幅画面的地平线与构图方向，不得只对主体局部做二维倾斜。`
    );
  }

  return {
    visibilityConstraints,
    occlusionConstraints,
    perspectiveCues,
    forbiddenShortcuts
  };
}

function buildAzimuthProjectionAcceptanceZh(
  azimuthKey: CameraAzimuthKey
) {
  if (azimuthKey === "right" || azimuthKey === "left") {
    return "严格侧面机位验收：源图中朝向镜头、占据较大面积的主要投影必须在新画面中接近边缘投影并明显变窄，同时显露真实前后深度；如果该主要投影仍大面积正对镜头，则判定相机没有到达侧面机位。";
  }

  if (azimuthKey === "right-front" || azimuthKey === "left-front") {
    return "前侧三分之四机位验收：源图中朝向镜头的主要投影必须出现明确的横向透视缩短，并与环境各深度层的视差变化一致，不得继续保持零度正面投影。";
  }

  if (azimuthKey === "right-back" || azimuthKey === "left-back") {
    return "后侧三分之四机位验收：源图中朝向镜头的主要投影应大幅退隐，原图未拍到但会进入新视锥的后向结构与环境区域必须自然显露并补全。";
  }

  if (azimuthKey === "back") {
    return "背面机位验收：源图中朝向镜头的主要投影必须基本退出直接视野，画面由新机位能够看到的结构、轮廓和环境空间重新组成。";
  }

  return "正面机位验收：采用零度基准机位，同时仍按当前景别、俯仰和 Roll 对完整场景重新成像。";
}

function buildDeterministicCameraPromptZh(
  prompt: Omit<
    SingleImageCameraPrompt,
    "deterministicPromptZh" | "deterministicPromptEn"
  > & {
    deterministicPromptZh: string;
    deterministicPromptEn: string;
  }
) {
  return [
    "【相机直绘｜中文】",
    SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER,
    "任务类型：相机轨道重拍（camera-orbit recapture）。场景中的人物、物品、建筑与环境属于同一个三维世界；改变的是观察相机，不是把某个对象从原背景中抠出后原地转动。",
    "执行顺序：先围绕原图场景中心移动相机，再让镜头看回同一中心，最后从目标新视锥一次性渲染整张新照片；不得先冻结原图，再只修补局部。",
    buildPrimaryOrbitInstructionZh(prompt),
    "左右基准（硬约束）：先按原图观看者的屏幕坐标理解左右，再换算被摄对象自身的左右；对象大致正对原相机时，这两套左右正好相反。最终以“原图画面左边/右边”作为不可歧义的相机运动基准。",
    `原始参数：Pitch X=${formatSignedDegreesZh(prompt.cumulativeRotationDegrees.x)}，Yaw Y=${formatSignedDegreesZh(prompt.cumulativeRotationDegrees.y)}，Roll Z=${formatSignedDegreesZh(prompt.cumulativeRotationDegrees.z)}；YXZ 等效姿态为 X=${formatSignedDegreesZh(prompt.equivalentRotationDegrees.x)}，Y=${formatSignedDegreesZh(prompt.equivalentRotationDegrees.y)}，Z=${formatSignedDegreesZh(prompt.equivalentRotationDegrees.z)}。`,
    `大白话机位：${describeCameraMotionZh(prompt)}。目标标签为${prompt.azimuthLabelZh}、${prompt.elevationLabelZh}；四元数推导的精确方位角为 ${formatSignedDegreesZh(prompt.cameraAzimuthDegrees)}，精确俯仰角为 ${formatSignedDegreesZh(prompt.cameraElevationDegrees)}。镜头始终看回原图中的同一场景中心。`,
    `${describeCameraDistanceZh(prompt)}。`,
    `画幅比例：${buildFrameInstructionZh(prompt)}`,
    "景深与焦点：以原图为光学基准，识别原图真正清晰的焦点区域、前后景虚化和镜头质感；新机位下按真实拍摄距离自然更新景深，但不要无故把整张图变得全清晰，也不要抹掉原有的自然背景虚化。",
    "空间：移动相机后重新拍摄完整场景。前景、所有对象、中景、背景、地面、墙面、天花和画面边缘全部按新机位重建透视、尺度、视差、遮挡与构图；不能冻结原背景后只转动其中的人物、物品或局部。",
    "补全（硬约束）：画面随镜头转动，并必须一起进入目标新视锥。新视锥中原图没有拍到的对象结构和环境区域，也就是目标机位能够看到但原照片未拍到、被遮挡，或因新机位、新景别与新构图而首次进入画面的内容，都必须由模型补全：既包括新显露的对象真实结构，也包括新进入画幅的背景、地面、墙面、建筑、家具及其他环境范围。依据原图的空间关系、环境风格、材质、光线与色彩合理想象并自然补全；对象结构还必须服从已识别类别、真实构造与连接关系。不得用裁切、额外遮挡、模糊、空白、复制边缘或冻结背景逃避补全。新机位看不到的原有内容可以自然出画。",
    "连续性：保持原图中的对象身份与结构、同一现实瞬间、环境关系、材质、颜色、光线和整体风格，但不要沿用原图的二维投影、遮挡顺序或背景排布。",
    `视角验收：${buildPlainCameraAcceptanceZh(prompt)}`,
    "禁止：整图水平翻转、镜面倒影、复制人物或物品、二维旋转、卡片翻转、透视拉伸、剪贴、普通扩图，以及只改变单个对象角度而不重建整幅场景。"
  ].join("\n");
}

function buildPlainCameraAcceptanceZh(
  prompt: Omit<
    SingleImageCameraPrompt,
    "deterministicPromptZh" | "deterministicPromptEn"
  > & {
    deterministicPromptZh: string;
    deterministicPromptEn: string;
  }
) {
  const azimuth = buildPlainAzimuthAcceptanceZh(prompt.azimuthKey);
  const screenProjection = buildScreenProjectionAcceptanceZh(
    prompt.cameraAzimuthDegrees
  );
  const elevation = buildPlainElevationAcceptanceZh(
    prompt.elevationKey,
    prompt.cameraElevationDegrees
  );
  const distance = buildPlainDistanceAcceptanceZh(prompt.distanceKey);

  return `${azimuth}${screenProjection}${elevation}${distance}`;
}

function buildDeterministicCameraPromptEn(
  prompt: Omit<
    SingleImageCameraPrompt,
    "deterministicPromptZh" | "deterministicPromptEn"
  > & {
    deterministicPromptZh: string;
    deterministicPromptEn: string;
  }
) {
  return [
    "[Direct camera recapture | English]",
    SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER_EN,
    "Task type: camera-orbit recapture. The people, objects, architecture, and environment belong to one 3D world. Change the viewing camera; do not cut out and rotate one element inside a frozen source background.",
    "Execution order: first orbit the camera around the source scene center, then aim the lens back at that same center, and finally render one complete new photograph through the target view frustum. Do not freeze the source image and patch only a local region.",
    buildPrimaryOrbitInstructionEn(prompt),
    "Left/right reference (hard constraint): interpret left and right first in the source viewer's screen coordinates, then translate them into the depicted object's own coordinates. For an object approximately facing the source camera, these two left/right systems are opposite. The source frame's left or right edge is the unambiguous camera-motion reference.",
    `Raw controls: Pitch X=${formatSignedDegreesEn(prompt.cumulativeRotationDegrees.x)}, Yaw Y=${formatSignedDegreesEn(prompt.cumulativeRotationDegrees.y)}, Roll Z=${formatSignedDegreesEn(prompt.cumulativeRotationDegrees.z)}. The equivalent YXZ pose is X=${formatSignedDegreesEn(prompt.equivalentRotationDegrees.x)}, Y=${formatSignedDegreesEn(prompt.equivalentRotationDegrees.y)}, Z=${formatSignedDegreesEn(prompt.equivalentRotationDegrees.z)}.`,
    `Plain-language camera position: ${describeCameraMotionEn(prompt)}. Target label: ${prompt.azimuthLabelEn}, ${prompt.elevationLabelEn}. Quaternion-derived azimuth is ${formatSignedDegreesEn(prompt.cameraAzimuthDegrees)} and elevation is ${formatSignedDegreesEn(prompt.cameraElevationDegrees)}. Keep the lens aimed at the same scene center as in the source image.`,
    `${describeCameraDistanceEn(prompt)}.`,
    `Frame and aspect ratio: ${buildFrameInstructionEn(prompt)}`,
    "Depth of field and focus: use the source image as the optical reference. Identify its true focal plane, sharp region, foreground/background blur, and lens character. Update depth of field naturally for the new camera distance, but do not make the entire image uniformly sharp or erase the source's natural background separation.",
    "Space: move the camera and recapture the complete scene. Rebuild the perspective, scale, parallax, occlusion, and composition of the foreground, every object, midground, background, ground, walls, ceiling, and frame edges from the new camera position. Do not freeze the source background and rotate only a person, object, or local region.",
    "Completion (hard constraint): the whole image moves with the camera and must enter the target view frustum. Infer and naturally complete every object structure and environment region that enters the new view frustum but was not captured in the source. This includes everything absent from the source photograph, previously occluded, or newly entering the frame because of the target camera position, shot size, and composition: both newly revealed real object structures and newly framed background, ground, walls, architecture, furniture, and other environment areas. Infer them conservatively from the source spatial relationships, environment style, materials, lighting, and colors; object structures must also follow the detected category, real construction, and connection logic. Do not evade completion with cropping, extra occluders, blur, blank areas, duplicated edges, or a frozen source background. Source content outside the target view may naturally leave the frame.",
    "Continuity: retain the identities and structures of the depicted elements, the same real-world moment, environment relationships, materials, colors, lighting, and overall style. Recompute the 2D projection, occlusion order, and background layout from the target camera instead of reusing those from the source image.",
    `Acceptance: ${buildPlainCameraAcceptanceEn(prompt)}`,
    "Reject: horizontally flipping the complete image, creating a mirror reflection, duplicating a person or object, 2D rotation, card flipping, perspective warping, cut-and-paste, ordinary outpainting, or changing only one object's angle without rebuilding the complete scene."
  ].join("\n");
}

function buildPrimaryOrbitInstructionZh(
  prompt: Pick<SingleImageCameraPrompt, "cameraAzimuthDegrees">
) {
  const azimuth = normalizeSingleImageRotationAngle(
    prompt.cameraAzimuthDegrees
  );
  const completion =
    "自动补全原图不可见的全部部分，包括背景，以及人物、物品或其他对象在新机位下才可见的对称对应结构。这里的“镜像补全”只表示依据真实类别、左右对称关系、三维构造、材质与连接关系推断未拍到或被遮挡的对侧结构，不是整图水平翻转、镜面倒影、复制对象或复制原图像素。";

  if (Math.abs(azimuth) < 0.5) {
    return `大白话主指令：保持原图零度正面机位，从同一位置重新拍摄完整场景。${completion}`;
  }

  if (Math.abs(Math.abs(azimuth) - 180) < 0.5) {
    return `大白话主指令：将镜头沿轨道转到中心人物/物品的背后 180.00°，再看回同一场景中心。${completion}`;
  }

  const frameSide = azimuth > 0 ? "左侧" : "右侧";

  return `大白话主指令：从原图观看者角度，将镜头转向中心人物/物品在原图画面中的${frameSide}，沿轨道环绕 ${formatDegreesZh(azimuth)} 后看回同一场景中心；整幅画面必须随镜头重新成像，不是只让人物或物品转身。${completion}`;
}

function buildPrimaryOrbitInstructionEn(
  prompt: Pick<SingleImageCameraPrompt, "cameraAzimuthDegrees">
) {
  const azimuth = normalizeSingleImageRotationAngle(
    prompt.cameraAzimuthDegrees
  );
  const completion =
    "Automatically complete every part absent from the source image, including the background and the symmetric counterpart structures of people, objects, or other depicted elements that become visible only from the new camera position. “Symmetric counterpart completion” means inferring occluded opposite-side structure from the real category, bilateral symmetry, 3D construction, material, and connection logic; it never means horizontally flipping the complete image, creating a mirror reflection, duplicating an object, or copying source pixels.";

  if (Math.abs(azimuth) < 0.5) {
    return `Plain-language primary instruction: keep the source zero-degree front camera and recapture the complete scene from that position. ${completion}`;
  }

  if (Math.abs(Math.abs(azimuth) - 180) < 0.5) {
    return `Plain-language primary instruction: orbit the camera 180.00 degrees behind the central person or object, then look back toward the same scene center. ${completion}`;
  }

  const frameSide = azimuth > 0 ? "LEFT" : "RIGHT";

  return `Plain-language primary instruction: from the source viewer's perspective, move the camera toward the ${frameSide} side of the central person or object as located in the source frame, orbit ${formatDegreesEn(azimuth)}, and look back toward the same scene center. The whole image must be recaptured with the moving camera; do not merely turn a person or object. ${completion}`;
}

function buildPlainAzimuthAcceptanceZh(azimuthKey: CameraAzimuthKey) {
  if (azimuthKey === "right") {
    return "严格 90° 侧面验收：镜头必须位于原图观看者左边，也就是大致正对原相机的被摄对象自身右边，并朝场景中心看回去。严禁走到原图观看者右边或对象自身左边。原来正对镜头的大面积投影要明显收窄成边缘，背景产生与观看者左侧轨道一致的视差。";
  }

  if (azimuthKey === "left") {
    return "严格 90° 侧面验收：镜头必须位于原图观看者右边，也就是大致正对原相机的被摄对象自身左边，并朝场景中心看回去。严禁走到原图观看者左边或对象自身右边。原来正对镜头的大面积投影要明显收窄成边缘，背景产生与观看者右侧轨道一致的视差。";
  }

  if (azimuthKey === "right-front") {
    return "右前三分之四验收：镜头从原图观看者左边绕过去，来到对象自身右前方；不得生成观看者右边或对象自身左前方的相反视图。原来朝向镜头的投影要自然收窄，环境各深度层向正确方向产生视差。";
  }

  if (azimuthKey === "left-front") {
    return "左前三分之四验收：镜头从原图观看者右边绕过去，来到对象自身左前方；不得生成观看者左边或对象自身右前方的相反视图。原来朝向镜头的投影要自然收窄，环境各深度层向正确方向产生视差。";
  }

  if (azimuthKey === "right-back") {
    return "右后三分之四验收：沿原图观看者左侧轨道绕过对象自身右边到达后方，原图正面大幅退隐，并补出该方向新显露的结构与环境。";
  }

  if (azimuthKey === "left-back") {
    return "左后三分之四验收：沿原图观看者右侧轨道绕过对象自身左边到达后方，原图正面大幅退隐，并补出该方向新显露的结构与环境。";
  }

  if (azimuthKey === "back") {
    return "背视要让原图正面基本离开视野，由新机位看到的背向结构和环境重新组成画面。";
  }

  return "正视使用原图零度机位，并按当前俯仰、Roll 和景别重新拍摄完整场景。";
}

function buildPlainElevationAcceptanceZh(
  elevationKey: CameraElevationKey,
  elevationDegrees: number
) {
  if (elevationKey === "near-top" || elevationKey === "high-angle") {
    return "俯视要让上方结构、地面、背景层次和纵向缩短一起证明相机真的升高。";
  }

  if (elevationKey === "elevated") {
    return "高机位要让上方结构、地面和背景层次出现自然的俯拍变化。";
  }

  if (elevationKey === "near-bottom" || elevationKey === "low-angle") {
    return "仰视要让下方结构、地平线和背景层次一起证明相机真的降低。";
  }

  if (Math.abs(elevationDegrees) < 0.5) {
    return "采用自然平视，不要自行增加俯拍或仰拍效果。";
  }

  if (elevationDegrees > 0) {
    return `仍在平视档，但必须保留精确 ${formatSignedDegreesZh(elevationDegrees)} 的轻微高机位和轻微向下观察；不得把角度归零，也不得夸大成明显俯拍。`;
  }

  return `仍在平视档，但必须保留精确 ${formatSignedDegreesZh(elevationDegrees)} 的轻微低机位和轻微向上观察；不得把角度归零，也不得夸大成明显仰拍。`;
}

function buildPlainDistanceAcceptanceZh(distanceKey: CameraDistanceKey) {
  if (distanceKey === "wide") {
    return "远景要让相机真实后退并看到更多环境，不是把原图缩小后留边。";
  }

  if (distanceKey === "close-up") {
    return "特写要让相机真实靠近，近大远小、遮挡、背景视差和景深都要随之改变，不是裁切放大。";
  }

  return "中景要让关注对象和周围环境都清楚可读，并保留真实空间纵深。";
}

function buildPlainCameraAcceptanceEn(
  prompt: Omit<
    SingleImageCameraPrompt,
    "deterministicPromptZh" | "deterministicPromptEn"
  > & {
    deterministicPromptZh: string;
    deterministicPromptEn: string;
  }
) {
  return `${buildPlainAzimuthAcceptanceEn(
    prompt.azimuthKey
  )}${buildScreenProjectionAcceptanceEn(
    prompt.cameraAzimuthDegrees
  )}${buildPlainElevationAcceptanceEn(
    prompt.elevationKey,
    prompt.cameraElevationDegrees
  )}${buildPlainDistanceAcceptanceEn(prompt.distanceKey)}`;
}

function buildScreenProjectionAcceptanceZh(azimuthDegrees: number) {
  const azimuth = normalizeSingleImageRotationAngle(azimuthDegrees);

  if (
    Math.abs(azimuth) < 0.5 ||
    Math.abs(Math.abs(azimuth) - 180) < 0.5
  ) {
    return "";
  }

  if (azimuth > 0) {
    return "最终屏幕投影验收：镜头向原图画面左边绕行后，近层必须相对远层向最终画面右边产生视差偏移，原图中朝向零度相机的前向深度轴也必须投向最终画面右边。对象大致正对原相机时，对象自身右边的新显露近侧结构应落在最终画面左侧轮廓，而前向突出结构应延伸到最终画面右侧；“对象自身右边”绝不等于“最终画面右边”。若近层或前向结构反向投影，则说明相机实际走到了相反侧，必须判定失败并重建。";
  }

  return "最终屏幕投影验收：镜头向原图画面右边绕行后，近层必须相对远层向最终画面左边产生视差偏移，原图中朝向零度相机的前向深度轴也必须投向最终画面左边。对象大致正对原相机时，对象自身左边的新显露近侧结构应落在最终画面右侧轮廓，而前向突出结构应延伸到最终画面左侧；“对象自身左边”绝不等于“最终画面左边”。若近层或前向结构反向投影，则说明相机实际走到了相反侧，必须判定失败并重建。";
}

function buildScreenProjectionAcceptanceEn(azimuthDegrees: number) {
  const azimuth = normalizeSingleImageRotationAngle(azimuthDegrees);

  if (
    Math.abs(azimuth) < 0.5 ||
    Math.abs(Math.abs(azimuth) - 180) < 0.5
  ) {
    return "";
  }

  if (azimuth > 0) {
    return "Final screen-projection audit: after the camera orbits toward the LEFT edge of the source frame, near depth layers must shift toward the RIGHT side of the final image relative to far layers, and the source-facing forward depth axis must also project toward the final image's RIGHT. When the depicted object approximately faces the source camera, newly revealed near structures on the object's own right belong on the LEFT contour of the final image, while forward-projecting structures extend toward the final image's RIGHT. The object's own right never means the final image's right. If these projections reverse, the camera reached the opposite side; reject and rebuild. ";
  }

  return "Final screen-projection audit: after the camera orbits toward the RIGHT edge of the source frame, near depth layers must shift toward the LEFT side of the final image relative to far layers, and the source-facing forward depth axis must also project toward the final image's LEFT. When the depicted object approximately faces the source camera, newly revealed near structures on the object's own left belong on the RIGHT contour of the final image, while forward-projecting structures extend toward the final image's LEFT. The object's own left never means the final image's left. If these projections reverse, the camera reached the opposite side; reject and rebuild. ";
}

function buildPlainAzimuthAcceptanceEn(azimuthKey: CameraAzimuthKey) {
  if (azimuthKey === "right") {
    return "Strict 90-degree side-view check: place the camera on the source viewer's LEFT, which is the depicted object's own RIGHT when it approximately faces the source camera, and look back toward the scene center. Do not generate the opposite source-viewer-right or object-left view. Source-facing projections must become narrow edge projections, with background parallax moving in the source-viewer-left orbit direction. ";
  }

  if (azimuthKey === "left") {
    return "Strict 90-degree side-view check: place the camera on the source viewer's RIGHT, which is the depicted object's own LEFT when it approximately faces the source camera, and look back toward the scene center. Do not generate the opposite source-viewer-left or object-right view. Source-facing projections must become narrow edge projections, with background parallax moving in the source-viewer-right orbit direction. ";
  }

  if (azimuthKey === "right-front") {
    return "For the object-right-front three-quarter view, orbit toward the LEFT edge of the source frame and arrive on the object's own right-front side. Do not produce the opposite source-frame-right or object-left-front view. Source-facing projections must narrow naturally and every depth layer must show parallax in the correct direction. ";
  }

  if (azimuthKey === "left-front") {
    return "For the object-left-front three-quarter view, orbit toward the RIGHT edge of the source frame and arrive on the object's own left-front side. Do not produce the opposite source-frame-left or object-right-front view. Source-facing projections must narrow naturally and every depth layer must show parallax in the correct direction. ";
  }

  if (azimuthKey === "right-back") {
    return "Continue along the source viewer's left orbit, passing the object's own right side into an object-right-rear three-quarter view. The source-facing projection must recede and newly visible structures and environment must be completed in that direction. ";
  }

  if (azimuthKey === "left-back") {
    return "Continue along the source viewer's right orbit, passing the object's own left side into an object-left-rear three-quarter view. The source-facing projection must recede and newly visible structures and environment must be completed in that direction. ";
  }

  if (azimuthKey === "back") {
    return "The rear view must move the source-facing projection mostly out of direct sight and rebuild the image from the rearward structures and environment visible at the new camera position. ";
  }

  return "Use the source zero-degree front camera position and recapture the complete scene with the requested elevation, roll, and shot size. ";
}

function buildPlainElevationAcceptanceEn(
  elevationKey: CameraElevationKey,
  elevationDegrees: number
) {
  if (elevationKey === "near-top" || elevationKey === "high-angle") {
    return "The top view must be proven by newly visible upper structures, the ground, background depth changes, and vertical foreshortening. ";
  }

  if (elevationKey === "elevated") {
    return "The elevated camera must produce natural downward-view changes in upper structures, the ground, and background depth. ";
  }

  if (elevationKey === "near-bottom" || elevationKey === "low-angle") {
    return "The low view must be proven by newly visible lower structures, the horizon, and background depth changes. ";
  }

  if (Math.abs(elevationDegrees) < 0.5) {
    return "Use natural eye-level perspective without adding an unrequested high-angle or low-angle effect. ";
  }

  if (elevationDegrees > 0) {
    return `This remains in the eye-level band, but preserve the exact ${formatSignedDegreesEn(elevationDegrees)} subtle elevated camera position and slight downward look. Do not round it to zero or exaggerate it into an obvious high-angle shot. `;
  }

  return `This remains in the eye-level band, but preserve the exact ${formatSignedDegreesEn(elevationDegrees)} subtle lowered camera position and slight upward look. Do not round it to zero or exaggerate it into an obvious low-angle shot. `;
}

function buildPlainDistanceAcceptanceEn(distanceKey: CameraDistanceKey) {
  if (distanceKey === "wide") {
    return "For the wide shot, physically move the camera back and reveal more environment; do not merely shrink the source image and add borders.";
  }

  if (distanceKey === "close-up") {
    return "For the close-up, physically move the camera closer so perspective scale, occlusion, background parallax, and depth of field change; do not merely crop and enlarge.";
  }

  return "For the medium shot, keep the scene focus and surrounding environment readable while preserving real spatial depth.";
}

function describeCameraDistanceZh(
  prompt: Pick<
    SingleImageCameraPrompt,
    "cameraDistance" | "distanceKey" | "distanceLabelZh"
  >
) {
  const parameter = `${prompt.cameraDistance.toFixed(1)}/10`;

  if (prompt.distanceKey === "wide") {
    return `景别：${prompt.distanceLabelZh}。观察距离控制值：${parameter}。把相机明显向后移，画面关注内容的占比自然减小，并让更多原图外的环境进入画面；这不是把原图内容缩小后贴回固定背景`;
  }

  if (prompt.distanceKey === "close-up") {
    return `景别：${prompt.distanceLabelZh}。观察距离控制值：${parameter}。把相机真实靠近场景关注点，使画面关注内容占比增大，透视、遮挡、背景视差与景深自然变化；这不是简单裁切放大`;
  }

  return `景别：${prompt.distanceLabelZh}。观察距离控制值：${parameter}。保持画面关注内容与周围环境都清楚可读，让其占比和空间纵深处于自然中等范围`;
}

function describeCameraDistanceEn(
  prompt: Pick<
    SingleImageCameraPrompt,
    "cameraDistance" | "distanceKey" | "distanceLabelEn"
  >
) {
  const parameter = `${prompt.cameraDistance.toFixed(1)}/10`;

  if (prompt.distanceKey === "wide") {
    return `Shot size: ${prompt.distanceLabelEn}. Camera-distance control: ${parameter}. Move the camera clearly backward so the depicted focus occupies less of the frame and more previously unseen environment enters the image. Do not merely shrink the source subject inside a frozen background`;
  }

  if (prompt.distanceKey === "close-up") {
    return `Shot size: ${prompt.distanceLabelEn}. Camera-distance control: ${parameter}. Move the camera physically closer to the scene focus so subject scale, perspective, occlusion, background parallax, and depth of field change naturally. Do not merely crop and enlarge`;
  }

  return `Shot size: ${prompt.distanceLabelEn}. Camera-distance control: ${parameter}. Keep both the scene focus and its surrounding environment readable with a natural medium subject scale and spatial depth`;
}

function buildFrameInstructionZh(
  prompt: Pick<
    SingleImageCameraPrompt,
    "sourceAspectRatioLabel" | "outputSize"
  >
) {
  if (prompt.sourceAspectRatioLabel && prompt.outputSize) {
    return `图像 1 的原始宽高比为 ${prompt.sourceAspectRatioLabel}，目标输出尺寸为 ${prompt.outputSize}，必须继续保持同一 ${prompt.sourceAspectRatioLabel} 比例。不得擅自改成横图或竖图，不得拉伸、压扁、裁成其他比例或添加黑边。`;
  }

  if (prompt.outputSize) {
    return `目标输出尺寸为 ${prompt.outputSize}，并且必须严格保持图像 1 的原始宽高比和横竖方向。不得拉伸、压扁、改版或添加黑边。`;
  }

  return "严格保持图像 1 的原始宽高比和横竖方向；不得擅自改成横图或竖图，不得拉伸、压扁、裁成其他比例或添加黑边。";
}

function buildFrameInstructionEn(
  prompt: Pick<
    SingleImageCameraPrompt,
    "sourceAspectRatioLabel" | "outputSize"
  >
) {
  if (prompt.sourceAspectRatioLabel && prompt.outputSize) {
    return `image 1 has a source aspect ratio of ${prompt.sourceAspectRatioLabel}; render exactly ${prompt.outputSize} with the same ${prompt.sourceAspectRatioLabel} ratio. Do not change it into a landscape or portrait canvas, stretch it, squash it, crop it to another ratio, or add letterboxing.`;
  }

  if (prompt.outputSize) {
    return `render exactly ${prompt.outputSize} while strictly preserving image 1's source aspect ratio and orientation. Do not stretch, squash, reformat, or add letterboxing.`;
  }

  return "strictly preserve image 1's source aspect ratio and landscape/portrait orientation. Do not stretch, squash, crop to another ratio, or add letterboxing.";
}

function describeCameraMotionZh(
  prompt: Pick<
    SingleImageCameraPrompt,
    | "cameraAzimuthDegrees"
    | "cameraElevationDegrees"
    | "cameraRollDegrees"
    | "cumulativeRotationDegrees"
  >
) {
  return [
    describeCameraAzimuthMotionZh(prompt.cameraAzimuthDegrees),
    describeCameraElevationMotionZh(prompt.cameraElevationDegrees),
    describeRollZh(
      prompt.cumulativeRotationDegrees.z,
      prompt.cameraRollDegrees
    )
  ].join("；");
}

function describeCameraMotionEn(
  prompt: Pick<
    SingleImageCameraPrompt,
    | "cameraAzimuthDegrees"
    | "cameraElevationDegrees"
    | "cameraRollDegrees"
    | "cumulativeRotationDegrees"
  >
) {
  return [
    describeCameraAzimuthMotionEn(prompt.cameraAzimuthDegrees),
    describeCameraElevationMotionEn(prompt.cameraElevationDegrees),
    describeRollEn(
      prompt.cumulativeRotationDegrees.z,
      prompt.cameraRollDegrees
    )
  ].join("; ");
}

function describeCameraAzimuthMotionZh(value: number) {
  const azimuth = normalizeSingleImageRotationAngle(value);

  if (Math.abs(azimuth) < 0.5) {
    return "使用原图零度正面机位";
  }

  if (Math.abs(Math.abs(azimuth) - 180) < 0.5) {
    return "镜头沿轨道绕到原图相机正后方 180.00°，从背面看回同一场景中心";
  }

  if (azimuth > 0) {
    return `从原图观看者角度，把镜头沿轨道向画面左边移动 ${formatDegreesZh(azimuth)}；若对象大致正对原相机，这等于来到对象自身右边；严禁走到画面右边或对象自身左边`;
  }

  return `从原图观看者角度，把镜头沿轨道向画面右边移动 ${formatDegreesZh(azimuth)}；若对象大致正对原相机，这等于来到对象自身左边；严禁走到画面左边或对象自身右边`;
}

function describeCameraAzimuthMotionEn(value: number) {
  const azimuth = normalizeSingleImageRotationAngle(value);

  if (Math.abs(azimuth) < 0.5) {
    return "use the source zero-degree front camera position";
  }

  if (Math.abs(Math.abs(azimuth) - 180) < 0.5) {
    return "orbit 180.00 degrees to the position directly behind the source camera and look back toward the same scene center";
  }

  if (azimuth > 0) {
    return `from the source viewer's perspective, orbit the camera ${formatDegreesEn(azimuth)} toward the LEFT edge of the source frame; for an object approximately facing the source camera, this places the camera on the object's own RIGHT; do not move toward the source frame's right edge or the object's own left`;
  }

  return `from the source viewer's perspective, orbit the camera ${formatDegreesEn(azimuth)} toward the RIGHT edge of the source frame; for an object approximately facing the source camera, this places the camera on the object's own LEFT; do not move toward the source frame's left edge or the object's own right`;
}

function describeCameraElevationMotionZh(value: number) {
  if (Math.abs(value) < 0.5) {
    return "相机高度保持原图基准，镜头自然平视场景中心";
  }

  if (value > 0 && value < 15) {
    return `把相机抬高到场景中心上方 ${formatDegreesZh(value)}，再让镜头轻微向下看回同一中心；这仍属于平视档内的轻微高机位，不要归零或夸大成明显俯拍`;
  }

  if (value < 0 && value > -15) {
    return `把相机降低到场景中心下方 ${formatDegreesZh(value)}，再让镜头轻微向上看回同一中心；这仍属于平视档内的轻微低机位，不要归零或夸大成明显仰拍`;
  }

  if (value > 0) {
    return `把相机抬高到场景中心上方 ${formatDegreesZh(value)}，再让镜头向下看回同一中心，形成与精确角度一致的高机位俯视`;
  }

  return `把相机降低到场景中心下方 ${formatDegreesZh(value)}，再让镜头向上看回同一中心，形成仰视`;
}

function describeCameraElevationMotionEn(value: number) {
  if (Math.abs(value) < 0.5) {
    return "keep the camera at the source height and look naturally level toward the scene center";
  }

  if (value > 0 && value < 15) {
    return `raise the camera ${formatDegreesEn(value)} above the scene center and look slightly downward toward that same center; this remains a subtle elevated position within the eye-level band, so do not round it to zero or exaggerate it into an obvious high-angle shot`;
  }

  if (value < 0 && value > -15) {
    return `lower the camera ${formatDegreesEn(value)} below the scene center and look slightly upward toward that same center; this remains a subtle lowered position within the eye-level band, so do not round it to zero or exaggerate it into an obvious low-angle shot`;
  }

  if (value > 0) {
    return `raise the camera ${formatDegreesEn(value)} above the scene center and tilt the lens downward to look back at that same center`;
  }

  return `lower the camera ${formatDegreesEn(value)} below the scene center and tilt the lens upward to look back at that same center`;
}

function describeRollZh(cumulativeValue: number, equivalentValue: number) {
  if (Math.abs(equivalentValue) < 0.5) {
    return `Roll 累计控制值 ${formatSignedDegreesZh(cumulativeValue)}，等效为 0.00°，画面地平线保持原图基准`;
  }

  return `Roll 累计控制值 ${formatSignedDegreesZh(cumulativeValue)}，等效为 ${formatSignedDegreesZh(equivalentValue)}，整幅画框相对原图${equivalentValue > 0 ? "顺时针" : "逆时针"}滚转 ${formatDegreesZh(equivalentValue)}`;
}

function describeRollEn(
  cumulativeValue: number,
  equivalentValue: number
) {
  if (Math.abs(equivalentValue) < 0.5) {
    return `the cumulative roll control is ${formatSignedDegreesEn(cumulativeValue)}, equivalent to 0.00 degrees, so keep the source horizon`;
  }

  return `the cumulative roll control is ${formatSignedDegreesEn(cumulativeValue)}, equivalent to ${formatSignedDegreesEn(equivalentValue)}, rotating the complete camera frame ${equivalentValue > 0 ? "clockwise" : "counterclockwise"} by ${formatDegreesEn(equivalentValue)} relative to the source`;
}

export function selectSingleImageCameraPrompt(
  prompt: SingleImageCameraPrompt,
  language: SingleImagePromptLanguage
) {
  return language === "en"
    ? prompt.deterministicPromptEn
    : prompt.deterministicPromptZh;
}

export function calculateSingleImageOutputSize(
  width: number,
  height: number,
  longEdge = 2048
) {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 1;
  const safeLongEdge = Math.max(1024, Math.min(3840, longEdge));
  const aspect = Math.min(3, Math.max(1 / 3, safeWidth / safeHeight));
  let outputWidth: number;
  let outputHeight: number;

  if (aspect >= 1) {
    outputWidth = roundToMultiple(safeLongEdge, 16);
    outputHeight = roundToMultiple(safeLongEdge / aspect, 16);
  } else {
    outputHeight = roundToMultiple(safeLongEdge, 16);
    outputWidth = roundToMultiple(safeLongEdge * aspect, 16);
  }

  return `${Math.max(16, outputWidth)}x${Math.max(16, outputHeight)}`;
}

function normalizeUnsignedDegrees(value: number) {
  const normalized = ((value % 360) + 360) % 360;

  return Object.is(normalized, -0) ? 0 : normalized;
}

function quaternionFromAxisAngle(
  axis: { x: number; y: number; z: number },
  radians: number
): ViewpointQuaternion {
  const half = radians / 2;
  const sine = Math.sin(half);

  return {
    x: axis.x * sine,
    y: axis.y * sine,
    z: axis.z * sine,
    w: Math.cos(half)
  };
}

function multiplyQuaternions(
  left: ViewpointQuaternion,
  right: ViewpointQuaternion
): ViewpointQuaternion {
  return {
    x:
      left.w * right.x +
      left.x * right.w +
      left.y * right.z -
      left.z * right.y,
    y:
      left.w * right.y -
      left.x * right.z +
      left.y * right.w +
      left.z * right.x,
    z:
      left.w * right.z +
      left.x * right.y -
      left.y * right.x +
      left.z * right.w,
    w:
      left.w * right.w -
      left.x * right.x -
      left.y * right.y -
      left.z * right.z
  };
}

function normalizeQuaternion(
  quaternion: ViewpointQuaternion
): ViewpointQuaternion {
  const magnitude = Math.hypot(
    quaternion.x,
    quaternion.y,
    quaternion.z,
    quaternion.w
  );

  if (!Number.isFinite(magnitude) || magnitude === 0) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }

  return {
    x: cleanFloat(quaternion.x / magnitude),
    y: cleanFloat(quaternion.y / magnitude),
    z: cleanFloat(quaternion.z / magnitude),
    w: cleanFloat(quaternion.w / magnitude)
  };
}

function rotateVectorByQuaternion(
  vector: { x: number; y: number; z: number },
  quaternion: ViewpointQuaternion
) {
  const dot =
    quaternion.x * vector.x +
    quaternion.y * vector.y +
    quaternion.z * vector.z;
  const quaternionLength =
    quaternion.x ** 2 + quaternion.y ** 2 + quaternion.z ** 2;
  const cross = {
    x: quaternion.y * vector.z - quaternion.z * vector.y,
    y: quaternion.z * vector.x - quaternion.x * vector.z,
    z: quaternion.x * vector.y - quaternion.y * vector.x
  };

  return {
    x:
      2 * dot * quaternion.x +
      (quaternion.w ** 2 - quaternionLength) * vector.x +
      2 * quaternion.w * cross.x,
    y:
      2 * dot * quaternion.y +
      (quaternion.w ** 2 - quaternionLength) * vector.y +
      2 * quaternion.w * cross.y,
    z:
      2 * dot * quaternion.z +
      (quaternion.w ** 2 - quaternionLength) * vector.z +
      2 * quaternion.w * cross.z
  };
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value: number) {
  return (value * 180) / Math.PI;
}

function roundToMultiple(value: number, multiple: number) {
  return Math.round(value / multiple) * multiple;
}

function cleanFloat(value: number) {
  return Math.abs(value) < 1e-12 ? 0 : value;
}

function cleanDisplayAngle(value: number) {
  const rounded = Math.round(value * 100) / 100;

  return Object.is(rounded, -0) ? 0 : rounded;
}

function formatAspectRatioLabel(width: number, height: number) {
  const divisor = greatestCommonDivisor(width, height);
  const reducedWidth = width / divisor;
  const reducedHeight = height / divisor;

  if (reducedWidth <= 100 && reducedHeight <= 100) {
    return `${reducedWidth}:${reducedHeight}`;
  }

  return `${(width / height).toFixed(3)}:1`;
}

function greatestCommonDivisor(left: number, right: number) {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));

  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }

  return Math.max(1, a);
}

function formatDegreesZh(value: number) {
  return `${Math.abs(value).toFixed(2)}°`;
}

function formatSignedDegreesZh(value: number) {
  const clean = cleanDisplayAngle(value);

  return `${clean > 0 ? "+" : ""}${clean.toFixed(2)}°`;
}

function formatDegreesEn(value: number) {
  return `${Math.abs(value).toFixed(2)} degrees`;
}

function formatSignedDegreesEn(value: number) {
  const clean = cleanDisplayAngle(value);

  return `${clean > 0 ? "+" : ""}${clean.toFixed(2)} degrees`;
}
