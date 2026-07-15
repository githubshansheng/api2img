import type { EndpointOverride } from "./generation";

export const SINGLE_IMAGE_ROTATION_MIN = -720;
export const SINGLE_IMAGE_ROTATION_MAX = 720;
export const SINGLE_IMAGE_CAMERA_DISTANCE_MIN = 0;
export const SINGLE_IMAGE_CAMERA_DISTANCE_MAX = 10;
export const SINGLE_IMAGE_CAMERA_DISTANCE_DEFAULT = 5;
export const DEFAULT_SINGLE_IMAGE_REASONING_MODEL = "gpt-5.6-sol";
export const DEFAULT_SINGLE_IMAGE_IMAGE_MODEL = "gpt-image-2";
export const SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER =
  "相机协议版本：2.4｜目标相机重新投影，世界状态连续而屏幕投影重建";

export type XYZRotation = {
  x: number;
  y: number;
  z: number;
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
  cameraAzimuthDegrees: number;
  cameraElevationDegrees: number;
  cameraRollDegrees: number;
  cameraDistance: number;
  azimuthKey: CameraAzimuthKey;
  elevationKey: CameraElevationKey;
  distanceKey: CameraDistanceKey;
  azimuthLabelZh: string;
  elevationLabelZh: string;
  distanceLabelZh: string;
  rollLabelZh: string;
  requiredVisibleSurfaces: string[];
  requiredOccludedSurfaces: string[];
  perspectiveConstraints: string[];
  forbiddenShortcuts: string[];
  deterministicPromptZh: string;
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
    x: normalizeSingleImageRotationAngle(cumulativeDegrees.x),
    y: normalizeSingleImageRotationAngle(cumulativeDegrees.y),
    z: normalizeSingleImageRotationAngle(cumulativeDegrees.z)
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
  cameraDistance = SINGLE_IMAGE_CAMERA_DISTANCE_DEFAULT
): SingleImageCameraPrompt {
  const pose = buildSingleImageCameraPose(rotation);
  const direction = deriveSingleImageCameraDirection(pose);
  const distance = clampSingleImageCameraDistance(cameraDistance);
  const azimuth = classifyCameraAzimuth(direction.azimuth);
  const elevation = classifyCameraElevation(direction.elevation);
  const distanceClass = classifyCameraDistance(distance);
  const directional = buildDirectionalConstraints({
    azimuthKey: azimuth.key,
    elevationKey: elevation.key,
    distanceKey: distanceClass.key,
    rollDegrees: pose.normalizedDegrees.z
  });
  const rollLabelZh = describeRollZh(pose.normalizedDegrees.z);
  const prompt = {
    cameraAzimuthDegrees: direction.azimuth,
    cameraElevationDegrees: direction.elevation,
    cameraRollDegrees: pose.normalizedDegrees.z,
    cameraDistance: distance,
    azimuthKey: azimuth.key,
    elevationKey: elevation.key,
    distanceKey: distanceClass.key,
    azimuthLabelZh: azimuth.label,
    elevationLabelZh: elevation.label,
    distanceLabelZh: distanceClass.label,
    rollLabelZh,
    requiredVisibleSurfaces: directional.visibilityConstraints,
    requiredOccludedSurfaces: directional.occlusionConstraints,
    perspectiveConstraints: directional.perspectiveCues,
    forbiddenShortcuts: directional.forbiddenShortcuts,
    deterministicPromptZh: ""
  } satisfies SingleImageCameraPrompt;

  prompt.deterministicPromptZh = buildDeterministicCameraPromptZh(
    pose,
    prompt
  );

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
} {
  const index = Math.floor((normalizeUnsignedDegrees(value) + 22.5) / 45) % 8;
  const options: Array<{ key: CameraAzimuthKey; label: string }> = [
    { key: "front", label: "基准正前方机位" },
    { key: "right-front", label: "基准右前方机位" },
    { key: "right", label: "基准右侧机位" },
    { key: "right-back", label: "基准右后方机位" },
    { key: "back", label: "基准正后方机位" },
    { key: "left-back", label: "基准左后方机位" },
    { key: "left", label: "基准左侧机位" },
    { key: "left-front", label: "基准左前方机位" }
  ];

  return options[index] ?? options[0]!;
}

function classifyCameraElevation(value: number): {
  key: CameraElevationKey;
  label: string;
} {
  if (value <= -75) {
    return { key: "near-bottom", label: "近底视仰拍" };
  }

  if (value < -15) {
    return { key: "low-angle", label: "低机位仰拍" };
  }

  if (value < 15) {
    return { key: "eye-level", label: "平视" };
  }

  if (value < 45) {
    return { key: "elevated", label: "高角度观察" };
  }

  if (value < 75) {
    return { key: "high-angle", label: "俯拍" };
  }

  return { key: "near-top", label: "近顶视俯拍" };
}

function classifyCameraDistance(value: number): {
  key: CameraDistanceKey;
  label: string;
} {
  if (value < 2) {
    return { key: "wide", label: "远景" };
  }

  if (value < 6) {
    return { key: "medium", label: "中景" };
  }

  return { key: "close-up", label: "特写" };
}

function buildDirectionalConstraints(input: {
  azimuthKey: CameraAzimuthKey;
  elevationKey: CameraElevationKey;
  distanceKey: CameraDistanceKey;
  rollDegrees: number;
}): Omit<SingleImageDirectionalConstraints, "relativeCameraMotion"> {
  const visibilityConstraints: string[] = [];
  const occlusionConstraints: string[] = [];
  const perspectiveCues: string[] = [];
  const forbiddenShortcuts = [
    "执行目标是由锁定目标相机对同一三维时刻重新投影；相机变化必须真实改变屏幕投影，而不是让原图二维外观保持不变。",
    "世界坐标中只连续保持主体身份、动作事件、关节相对关系、装配状态与场景拓扑；这些连续性条件绝不是原图屏幕姿态或朝向锁。",
    "屏幕坐标中的主体朝向、轮廓、投影宽度、可见结构、遮挡顺序和背景视差必须由目标相机重新投影并明显变化。",
    "原图正面在目标机位要求时必须重建为侧向、后向、俯视或仰视投影；身份一致性不等于投影一致性。",
    "主体自身坐标与相机、屏幕坐标严格区分；以锁定的相机方位、俯仰和 Roll 作为最终渲染依据。",
    "禁止水平镜像、二维平面旋转、透视拉伸、卡片翻转、边缘压扁或复制原图投影。"
  ];

  if (input.azimuthKey === "front") {
    visibilityConstraints.push(
      "目标画面必须呈现零度基准的真实正面投影；具体结构验收由识图模型依据主体类别生成，不得硬套人体或器官模板。"
    );
    occlusionConstraints.push(
      "不得残留三分之四、侧面或背面投影特征，也不得用二维拉正代替真实正面重建。"
    );
  } else if (input.azimuthKey === "back") {
    visibilityConstraints.push(
      "相机必须绕到零度基准背后形成真实背面投影；原图未显示的结构按已识别类别保守补全，不预设主体一定具有某种器官或表面。"
    );
    occlusionConstraints.push(
      "零度基准的正面投影必须大幅退隐或不可见，不得把原图正面复制、镜像或贴到背面结果上。"
    );
  } else if (
    input.azimuthKey === "right-front" ||
    input.azimuthKey === "left-front"
  ) {
    const orbitDirection =
      input.azimuthKey === "right-front" ? "右侧" : "左侧";
    visibilityConstraints.push(
      `相机必须从零度基准正面向${orbitDirection}环绕，形成真实四分之三投影；轮廓、投影宽度和前后遮挡必须按主体类别与真实体积重建。`
    );
    occlusionConstraints.push(
      "不得保留零度正面投影，也不得把四分之三视角弱化成几乎不变的原图。"
    );
  } else if (
    input.azimuthKey === "right" ||
    input.azimuthKey === "left"
  ) {
    const orbitDirection =
      input.azimuthKey === "right" ? "右侧约 90°" : "左侧约 90°";
    visibilityConstraints.push(
      `相机必须位于零度基准的${orbitDirection}并形成严格侧向投影；具体可见结构由识图模型按主体类别生成可客观检查的投影条件。`
    );
    occlusionConstraints.push(
      "零度正面投影必须显著退隐，不能仍保留两侧对称的正面形态，也不能伪装成轻微四分之三视角。"
    );
  } else {
    const orbitDirection =
      input.azimuthKey === "right-back" ? "右后方" : "左后方";
    visibilityConstraints.push(
      `相机必须绕到零度基准的${orbitDirection}，形成以后向投影为主的真实四分之三视角；轮廓和遮挡按主体类别重建。`
    );
    occlusionConstraints.push(
      "零度正面投影必须明显退隐，不得通过镜像、贴图或保留原轮廓来假装后方机位。"
    );
  }

  if (
    input.elevationKey === "elevated" ||
    input.elevationKey === "high-angle" ||
    input.elevationKey === "near-top"
  ) {
    visibilityConstraints.push(
      "目标高机位必须增加从上方真实可见的轮廓、部件、区域、材质与标记；具体结构名称由识图模型按主体类别和原图事实生成，不预设任何类别专属结构或泛化表面。"
    );
    occlusionConstraints.push(
      "仅从下方机位才可见的真实轮廓与结构必须减少可见性，并形成符合体积的遮挡和透视缩短。"
    );
    perspectiveCues.push(
      input.elevationKey === "near-top"
        ? "使用明确的近顶视透视：从上方可见的真实结构占主导，垂直高度显著压缩，但主体仍保持真实体积。"
        : "使用明确的高机位向下观察透视：从上方可见的真实结构扩展，从下方可见的真实结构压缩，空间深度符合俯视相机。"
    );
  } else if (
    input.elevationKey === "low-angle" ||
    input.elevationKey === "near-bottom"
  ) {
    visibilityConstraints.push(
      "目标低机位必须增加从下方真实可见的轮廓、部件、区域、材质与标记；具体结构名称由识图模型按主体类别和原图事实生成，不预设任何类别专属结构或泛化表面。"
    );
    occlusionConstraints.push(
      "仅从上方机位才可见的真实轮廓与结构必须减少可见性，并形成符合体积的遮挡和透视缩短。"
    );
    perspectiveCues.push(
      input.elevationKey === "near-bottom"
        ? "使用明确的近底视透视：从下方可见的真实结构占主导，主体从下方向上观察，禁止伪装成普通平视。"
        : "使用明确的低机位向上观察透视：从下方可见的真实结构扩展，从上方可见的真实结构压缩，主体呈现真实仰拍体积。"
    );
  } else {
    perspectiveCues.push(
      "保持平视对应的自然透视，不得加入与目标俯仰矛盾的顶视或底视特征。"
    );
  }

  if (input.distanceKey === "wide") {
    perspectiveCues.push(
      "远景硬验收：环境和空间关系占主导，主体完整包围盒建议占画面高度约 15% 至 30%，不得只把近景主体二维缩小后贴回原背景。"
    );
  } else if (input.distanceKey === "medium") {
    perspectiveCues.push(
      "中景硬验收：主体主要结构完整可读，包围盒建议占画面高度约 40% 至 60%，同时保留足够环境信息与真实空间纵深。"
    );
  } else {
    perspectiveCues.push(
      "特写硬验收：主体关键细节占画面主导，包围盒或核心结构建议占画面短边约 70% 至 90%；允许合理裁切次要边缘，但不得只是数字放大。"
    );
  }

  if (Math.abs(input.rollDegrees) < 0.5) {
    perspectiveCues.push(
      "保持原图零度基准的地平线 Roll，不得自行倾斜画面。"
    );
  } else {
    const direction = input.rollDegrees > 0 ? "顺时针" : "逆时针";
    perspectiveCues.push(
      `相机画框绕光轴${direction}滚转 ${formatDegreesZh(Math.abs(input.rollDegrees))}；只改变地平线与构图方向，不得变成主体自身姿态或构型倾斜。`
    );
  }

  return {
    visibilityConstraints,
    occlusionConstraints,
    perspectiveCues,
    forbiddenShortcuts
  };
}

function buildDeterministicCameraPromptZh(
  pose: SingleImageCameraPose,
  prompt: Omit<SingleImageCameraPrompt, "deterministicPromptZh"> & {
    deterministicPromptZh: string;
  }
) {
  return [
    "【锁定相机协议｜服务端确定性生成，禁止改写】",
    SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER,
    "1. 原图零度基准：输入原图的相机位置定义为 XYZ=0°。XYZ 控制的是相机围绕同一三维时刻移动，不是对原图做二维旋转。相机运动与主体世界状态是独立变量；世界坐标中的身份、动作事件、关节关系、装配状态与场景拓扑保持连续，原图屏幕姿态和屏幕朝向不锁定，主体轮廓、投影宽度、可见区域、遮挡顺序与背景视差必须由目标相机重新投影。",
    `2. 离散目标视角：${prompt.azimuthLabelZh} + ${prompt.elevationLabelZh} + ${prompt.distanceLabelZh}。`,
    `3. 精确相机方向：方位角 ${formatSignedDegreesZh(prompt.cameraAzimuthDegrees)}（沿水平轨道向基准画面右方环绕为正），俯仰角 ${formatSignedDegreesZh(prompt.cameraElevationDegrees)}（相机升高为正）。方位与俯仰由最终 YXZ 四元数旋转基准相机向量后计算，不得直接按单一 X/Y 控制值猜测。`,
    `4. 原始累计控制值：X=${formatSignedDegreesZh(pose.cumulativeDegrees.x)}，Y=${formatSignedDegreesZh(pose.cumulativeDegrees.y)}，Z=${formatSignedDegreesZh(pose.cumulativeDegrees.z)}；等价周期姿态为 X=${formatSignedDegreesZh(pose.normalizedDegrees.x)}，Y=${formatSignedDegreesZh(pose.normalizedDegrees.y)}，Z=${formatSignedDegreesZh(pose.normalizedDegrees.z)}，欧拉顺序 YXZ。`,
    `5. Roll：${prompt.rollLabelZh}。Roll 只控制相机光轴与地平线；普通 Yaw/Pitch 环绕不得改变 Roll。`,
    `6. 景别：${prompt.distanceLabelZh}，距离控制值 ${prompt.cameraDistance.toFixed(1)}/10。保持主体尺度与该景别一致。`,
    "7. 目标机位下的确定性投影：",
    ...prompt.requiredVisibleSurfaces.map((item) => `- ${item}`),
    "8. 目标机位下的退隐与排除：",
    ...prompt.requiredOccludedSurfaces.map((item) => `- ${item}`),
    "9. 透视与地平线约束：",
    ...prompt.perspectiveConstraints.map((item) => `- ${item}`),
    "10. 重新成像规则：",
    ...prompt.forbiddenShortcuts.map((item) => `- ${item}`)
  ].join("\n");
}

function describeRollZh(value: number) {
  if (Math.abs(value) < 0.5) {
    return "Roll 0°，地平线保持零度基准";
  }

  return `Roll ${formatSignedDegreesZh(value)}，画框相对原图${value > 0 ? "顺时针" : "逆时针"}滚转`;
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

function formatDegreesZh(value: number) {
  return `${Math.abs(value).toFixed(2)}°`;
}

function formatSignedDegreesZh(value: number) {
  const clean = cleanDisplayAngle(value);

  return `${clean > 0 ? "+" : ""}${clean.toFixed(2)}°`;
}
