export const SINGLE_IMAGE_ROTATION_MIN = -720;
export const SINGLE_IMAGE_ROTATION_MAX = 720;
export const SINGLE_IMAGE_CAMERA_DISTANCE_MIN = 0;
export const SINGLE_IMAGE_CAMERA_DISTANCE_MAX = 10;
export const SINGLE_IMAGE_CAMERA_DISTANCE_DEFAULT = 5;
export const DEFAULT_SINGLE_IMAGE_REASONING_MODEL = "gpt-5.6-sol";
export const DEFAULT_SINGLE_IMAGE_IMAGE_MODEL = "gpt-image-2";
export const SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER = "相机协议版本：3.2｜XYZ 指定目标观察机位：最终二维朝向必须随目标机位重建，不继承原图屏幕朝向";
const SINGLE_IMAGE_GENERIC_SUBJECT_SURFACE_PATTERN = /主体(?:的)?(?:朝)?(?:(?:左|右|前|后|上|下)侧?(?:表面|侧面|区域|结构)|(?:侧面|表面))|(?:左|右|前|后|上|下)侧?(?:表面|侧面|区域)|显示更多(?:左|右|前|后|侧)?面|显露(?:左|右|前|后|侧)?面|\b(?:the\s+)?(?:subject(?:'s)?\s+)?(?:left|right|front|rear|back|top|bottom)(?:[-\s]+side)?\s+surface\b|\bshow\s+more\s+(?:of\s+the\s+)?(?:left|right|front|rear|back|top|bottom)?\s*side\b/iu;
const SINGLE_IMAGE_SOURCE_PROJECTION_LOCK_PATTERN = /\b(?:do not|don't|must not|never)\b.{0,30}\b(?:turn|rotate|change)\b.{0,20}\b(?:pose|orientation|facing|view)\b|\b(?:keep|preserve|lock)\b.{0,25}\b(?:original|source)\b.{0,20}\b(?:pose|orientation|facing|projection)\b|(?:禁止|不得|不要).{0,24}(?:主体|人物|动物|物体|车辆|建筑)?.{0,16}(?:主动)?(?:转身|旋转自身|改变|调整).{0,10}(?:姿态|朝向|屏幕朝向|投影)|(?<!不得)(?<!不能)(?<!避免)(?<!禁止)(?<!不要)(?<!不)(?<!未)(?<!勿)(?<!无)(?<!非)(?<!别)(?:保持|锁定|固定).{0,16}(?:原图|原始|主体|人物|物体)?.{0,16}(?:屏幕朝向|原图朝向|原始朝向|正面朝向|投影不变)|(?:主体|人物|动物|物体|车辆|建筑).{0,16}(?:世界空间|三维空间).{0,16}(?:状态|姿态|朝向).{0,12}(?:保持不变|固定|锁定)/iu;
export function findSingleImagePromptConflict(prompt) {
  if (SINGLE_IMAGE_GENERIC_SUBJECT_SURFACE_PATTERN.test(prompt)) {
    return "generic-subject-surface";
  }
  if (SINGLE_IMAGE_SOURCE_PROJECTION_LOCK_PATTERN.test(prompt)) {
    return "source-projection-lock";
  }
  return void 0;
}
export const SINGLE_IMAGE_VIEWPOINT_LIMITS = {
  sourceImageBytes: 20 * 1024 * 1024,
  guideImageBytes: 20 * 1024 * 1024,
  cameraPoseImageBytes: 20 * 1024 * 1024,
  combinedImageBytes: 48 * 1024 * 1024
};
export function clampSingleImageRotationAngle(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(
    SINGLE_IMAGE_ROTATION_MAX,
    Math.max(SINGLE_IMAGE_ROTATION_MIN, value)
  );
}
export function normalizeSingleImageRotationAngle(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  const signed = normalized === -180 ? 180 : normalized;
  return Object.is(signed, -0) ? 0 : signed;
}
export function calculateShortestAxisRotationDelta(previousVisualAngle, currentVisualAngle) {
  let delta = normalizeUnsignedDegrees(currentVisualAngle) - normalizeUnsignedDegrees(previousVisualAngle);
  if (delta > 180) {
    delta -= 360;
  } else if (delta < -180) {
    delta += 360;
  }
  return Object.is(delta, -0) ? 0 : delta;
}
export function accumulateSingleImageRotation(cumulativeAngle, previousVisualAngle, currentVisualAngle) {
  return clampSingleImageRotationAngle(
    cumulativeAngle + calculateShortestAxisRotationDelta(
      previousVisualAngle,
      currentVisualAngle
    )
  );
}
export function clampSingleImageCameraDistance(value) {
  if (!Number.isFinite(value)) {
    return SINGLE_IMAGE_CAMERA_DISTANCE_DEFAULT;
  }
  return Math.min(
    SINGLE_IMAGE_CAMERA_DISTANCE_MAX,
    Math.max(SINGLE_IMAGE_CAMERA_DISTANCE_MIN, value)
  );
}
export function buildSingleImageCameraPose(rotation) {
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
export function buildSingleImageCameraPrompt(rotation, cameraDistance = SINGLE_IMAGE_CAMERA_DISTANCE_DEFAULT) {
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
  };
  prompt.deterministicPromptZh = buildDeterministicCameraPromptZh(
    pose,
    prompt
  );
  return prompt;
}
export function buildSingleImageDirectionalConstraints(pose, cameraDistance = SINGLE_IMAGE_CAMERA_DISTANCE_DEFAULT) {
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
function deriveSingleImageCameraDirection(pose) {
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
function classifyCameraAzimuth(value) {
  const index = Math.floor((normalizeUnsignedDegrees(value) + 22.5) / 45) % 8;
  const options = [
    { key: "front", label: "基准正前方机位" },
    { key: "right-front", label: "基准右前方机位" },
    { key: "right", label: "基准右侧机位" },
    { key: "right-back", label: "基准右后方机位" },
    { key: "back", label: "基准正后方机位" },
    { key: "left-back", label: "基准左后方机位" },
    { key: "left", label: "基准左侧机位" },
    { key: "left-front", label: "基准左前方机位" }
  ];
  return options[index] ?? options[0];
}
function classifyCameraElevation(value) {
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
function classifyCameraDistance(value) {
  if (value < 2) {
    return { key: "wide", label: "远景" };
  }
  if (value < 6) {
    return { key: "medium", label: "中景" };
  }
  return { key: "close-up", label: "特写" };
}
function buildDirectionalConstraints(input) {
  const visibilityConstraints = [];
  const occlusionConstraints = [];
  const perspectiveCues = [];
  const forbiddenShortcuts = [
    "最高优先级：先把相机沿 XYZ 轨道移动到目标机位并对准主体中心，再从该机位重新生成整幅画面。",
    "连续的是同一现实瞬间中的主体身份、动作事件、关节或零件关系与场景拓扑；这不锁定原图朝向屏幕的方向。源图二维坐标、屏幕轮廓和屏幕投影不连续，必须在新机位重新建立。",
    "允许且必须改变主体在最终二维画面中的可见朝向、轮廓、投影宽度和遮挡关系；这是目标相机机位变化的预期结果，不是主体身份或动作事件发生改变。",
    "目标相机的位置变化就是本次编辑目标。最终画面呈现正面、侧面、背面、上方或下方，只能由目标相机方向决定，不得被身份连续性或动作事件连续性覆盖。",
    "画面中的投影方向、轮廓、投影宽度、可见结构、遮挡顺序、地平线和背景视差必须由目标相机重新计算并明显改变。",
    "当目标相机位于侧面、后方、上方或下方时，原图正向投影必须分别重建为侧向、后向、俯视或仰视投影。",
    "主体自身坐标与相机、屏幕坐标严格区分；以锁定的相机方位、俯仰和 Roll 作为最终渲染依据。",
    "若只有主体投影变化而背景各深度层仍保持源图构图，判定为没有执行机位变化。",
    "禁止水平镜像、二维平面旋转、透视拉伸、卡片翻转、边缘压扁、主体剪贴或复制原图投影。"
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
  } else if (input.azimuthKey === "right-front" || input.azimuthKey === "left-front") {
    const orbitDirection = input.azimuthKey === "right-front" ? "右侧" : "左侧";
    visibilityConstraints.push(
      `相机必须从零度基准正面向${orbitDirection}环绕，形成真实四分之三投影；轮廓、投影宽度和前后遮挡必须按主体类别与真实体积重建。`
    );
    occlusionConstraints.push(
      "不得保留零度正面投影，也不得把四分之三视角弱化成几乎不变的原图。"
    );
  } else if (input.azimuthKey === "right" || input.azimuthKey === "left") {
    const orbitDirection = input.azimuthKey === "right" ? "右侧约 90°" : "左侧约 90°";
    visibilityConstraints.push(
      `相机必须沿水平圆轨道到达零度基准的${orbitDirection}，高度、轨道半径和焦距不变，并形成严格侧向投影；具体可见结构由识图模型按主体类别生成可客观检查的投影条件。`,
      "对具有明确正面平面的主体，该平面的投影宽度不得超过其投影高度的 20%；正面中心结构应压缩为窄条、薄弧或被近侧结构遮挡，并显露真实前后厚度。"
    );
    occlusionConstraints.push(
      "零度正面投影必须显著退隐，不能仍保留两侧对称的正面形态，也不能伪装成轻微四分之三视角。"
    );
    perspectiveCues.push(
      "严格侧视必须让背景所有深度层产生不同幅度的水平位移、重叠和出入画变化；主体变化但背景保持源图构图即为失败。"
    );
  } else {
    const orbitDirection = input.azimuthKey === "right-back" ? "右后方" : "左后方";
    visibilityConstraints.push(
      `相机必须绕到零度基准的${orbitDirection}，形成以后向投影为主的真实四分之三视角；轮廓和遮挡按主体类别重建。`
    );
    occlusionConstraints.push(
      "零度正面投影必须明显退隐，不得通过镜像、贴图或保留原轮廓来假装后方机位。"
    );
  }
  if (input.elevationKey === "elevated" || input.elevationKey === "high-angle" || input.elevationKey === "near-top") {
    visibilityConstraints.push(
      "目标高机位必须增加从上方真实可见的轮廓、部件、区域、材质与标记；具体结构名称由识图模型按主体类别和原图事实生成，不预设任何类别专属结构或泛化表面。"
    );
    occlusionConstraints.push(
      "仅从下方机位才可见的真实轮廓与结构必须减少可见性，并形成符合体积的遮挡和透视缩短。"
    );
    perspectiveCues.push(
      input.elevationKey === "near-top" ? "使用明确的近顶视透视：从上方可见的真实结构占主导，垂直高度显著压缩，但主体仍保持真实体积。" : "使用明确的高机位向下观察透视：从上方可见的真实结构扩展，从下方可见的真实结构压缩，空间深度符合俯视相机。"
    );
  } else if (input.elevationKey === "low-angle" || input.elevationKey === "near-bottom") {
    visibilityConstraints.push(
      "目标低机位必须增加从下方真实可见的轮廓、部件、区域、材质与标记；具体结构名称由识图模型按主体类别和原图事实生成，不预设任何类别专属结构或泛化表面。"
    );
    occlusionConstraints.push(
      "仅从上方机位才可见的真实轮廓与结构必须减少可见性，并形成符合体积的遮挡和透视缩短。"
    );
    perspectiveCues.push(
      input.elevationKey === "near-bottom" ? "使用明确的近底视透视：从下方可见的真实结构占主导，主体从下方向上观察，禁止伪装成普通平视。" : "使用明确的低机位向上观察透视：从下方可见的真实结构扩展，从上方可见的真实结构压缩，主体呈现真实仰拍体积。"
    );
  } else {
    perspectiveCues.push(
      "保持平视对应的自然透视，不得加入与目标俯仰矛盾的顶视或底视特征。"
    );
  }
  if (input.distanceKey === "wide") {
    perspectiveCues.push(
      "远景硬验收：执行真实 Dolly Out，焦距不变；相机退到当前场景可成立的明确远端，例如房间另一端或入口附近。结果是环境建立镜头，环境建议占画面 70% 至 85%，主体完整包围盒建议占画面高度约 15% 至 30%，不得只把近景主体二维缩小后贴回原背景。"
    );
  } else if (input.distanceKey === "medium") {
    perspectiveCues.push(
      "中景硬验收：相机位于可读主体主要结构的中等距离，主体包围盒建议占画面高度约 40% 至 60%，同时保留足够环境信息与真实空间纵深；具体裁切边界由识图模型按主体类别和原图结构给出。"
    );
  } else {
    perspectiveCues.push(
      "特写硬验收：执行真实 Dolly In，焦距不变；主体关键细节占画面主导，包围盒或核心结构建议占画面短边约 70% 至 90%。近大远小、前后遮挡、背景视差和景深必须随相机前移增强；允许合理裁切次要边缘，但不得只是数字放大。"
    );
  }
  if (Math.abs(input.rollDegrees) < 0.5) {
    perspectiveCues.push(
      "保持原图零度基准的地平线 Roll，不得自行倾斜画面。"
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
function buildDeterministicCameraPromptZh(pose, prompt) {
  return [
    "【最高优先级：先执行目标相机重投影】",
    "【锁定相机协议｜服务端确定性生成，禁止改写】",
    SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER,
    "1. 原图零度基准：输入原图的拍摄机位定义为 XYZ=0°。图像只提供同一主体与场景的三维事实，不锁定任何源图二维像素坐标、屏幕轮廓、屏幕朝向或屏幕投影。XYZ 控制相机围绕同一现实瞬间移动，不是对原图做二维旋转。相机到达目标机位后，废弃源图二维构图，并从新机位重新计算整幅画面的投影方向、轮廓、投影宽度、可见区域、遮挡顺序、地平线与背景视差。",
    "1.1 最终二维朝向规则：目标相机改变后，允许且必须改变主体在最终画面中的可见朝向与投影。主体身份、动作事件或装配关系连续，只表示仍是同一现实内容；绝不表示保留原图正面、侧面、轮廓或屏幕朝向。",
    `2. 离散目标视角：${prompt.azimuthLabelZh} + ${prompt.elevationLabelZh} + ${prompt.distanceLabelZh}。`,
    `3. 精确相机方向：方位角 ${formatSignedDegreesZh(prompt.cameraAzimuthDegrees)}（沿水平轨道向基准画面右方环绕为正），俯仰角 ${formatSignedDegreesZh(prompt.cameraElevationDegrees)}（相机升高为正）。方位与俯仰由最终 YXZ 四元数旋转基准相机向量后计算，不得直接按单一 X/Y 控制值猜测。`,
    `4. 原始累计控制值：X=${formatSignedDegreesZh(pose.cumulativeDegrees.x)}，Y=${formatSignedDegreesZh(pose.cumulativeDegrees.y)}，Z=${formatSignedDegreesZh(pose.cumulativeDegrees.z)}；等价周期姿态为 X=${formatSignedDegreesZh(pose.normalizedDegrees.x)}，Y=${formatSignedDegreesZh(pose.normalizedDegrees.y)}，Z=${formatSignedDegreesZh(pose.normalizedDegrees.z)}，欧拉顺序 YXZ。`,
    `5. Roll：${prompt.rollLabelZh}。Roll 只控制相机光轴与地平线；普通 Yaw/Pitch 环绕不得改变 Roll。`,
    `6. 景别：${prompt.distanceLabelZh}，距离控制值 ${prompt.cameraDistance.toFixed(1)}/10。保持主体尺度与该景别一致。`,
    "7. 目标机位下必须形成的画面投影：",
    ...prompt.requiredVisibleSurfaces.map((item) => `- ${item}`),
    "8. 目标机位下必须发生的遮挡变化：",
    ...prompt.requiredOccludedSurfaces.map((item) => `- ${item}`),
    "9. 透视与地平线约束：",
    ...prompt.perspectiveConstraints.map((item) => `- ${item}`),
    "10. 重新成像规则：",
    ...prompt.forbiddenShortcuts.map((item) => `- ${item}`)
  ].join("\n");
}
function describeRollZh(value) {
  if (Math.abs(value) < 0.5) {
    return "Roll 0°，地平线保持零度基准";
  }
  return `Roll ${formatSignedDegreesZh(value)}，画框相对原图${value > 0 ? "顺时针" : "逆时针"}滚转`;
}
export function calculateSingleImageOutputSize(width, height, longEdge = 2048) {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 1;
  const safeLongEdge = Math.max(1024, Math.min(3840, longEdge));
  const aspect = Math.min(3, Math.max(1 / 3, safeWidth / safeHeight));
  let outputWidth;
  let outputHeight;
  if (aspect >= 1) {
    outputWidth = roundToMultiple(safeLongEdge, 16);
    outputHeight = roundToMultiple(safeLongEdge / aspect, 16);
  } else {
    outputHeight = roundToMultiple(safeLongEdge, 16);
    outputWidth = roundToMultiple(safeLongEdge * aspect, 16);
  }
  return `${Math.max(16, outputWidth)}x${Math.max(16, outputHeight)}`;
}
function normalizeUnsignedDegrees(value) {
  const normalized = (value % 360 + 360) % 360;
  return Object.is(normalized, -0) ? 0 : normalized;
}
function quaternionFromAxisAngle(axis, radians) {
  const half = radians / 2;
  const sine = Math.sin(half);
  return {
    x: axis.x * sine,
    y: axis.y * sine,
    z: axis.z * sine,
    w: Math.cos(half)
  };
}
function multiplyQuaternions(left, right) {
  return {
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z
  };
}
function normalizeQuaternion(quaternion) {
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
function rotateVectorByQuaternion(vector, quaternion) {
  const dot = quaternion.x * vector.x + quaternion.y * vector.y + quaternion.z * vector.z;
  const quaternionLength = quaternion.x ** 2 + quaternion.y ** 2 + quaternion.z ** 2;
  const cross = {
    x: quaternion.y * vector.z - quaternion.z * vector.y,
    y: quaternion.z * vector.x - quaternion.x * vector.z,
    z: quaternion.x * vector.y - quaternion.y * vector.x
  };
  return {
    x: 2 * dot * quaternion.x + (quaternion.w ** 2 - quaternionLength) * vector.x + 2 * quaternion.w * cross.x,
    y: 2 * dot * quaternion.y + (quaternion.w ** 2 - quaternionLength) * vector.y + 2 * quaternion.w * cross.y,
    z: 2 * dot * quaternion.z + (quaternion.w ** 2 - quaternionLength) * vector.z + 2 * quaternion.w * cross.z
  };
}
function degreesToRadians(value) {
  return value * Math.PI / 180;
}
function radiansToDegrees(value) {
  return value * 180 / Math.PI;
}
function roundToMultiple(value, multiple) {
  return Math.round(value / multiple) * multiple;
}
function cleanFloat(value) {
  return Math.abs(value) < 1e-12 ? 0 : value;
}
function cleanDisplayAngle(value) {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}
function formatDegreesZh(value) {
  return `${Math.abs(value).toFixed(2)}°`;
}
function formatSignedDegreesZh(value) {
  const clean = cleanDisplayAngle(value);
  return `${clean > 0 ? "+" : ""}${clean.toFixed(2)}°`;
}

//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInNpbmdsZS1pbWFnZS12aWV3cG9pbnQudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBFbmRwb2ludE92ZXJyaWRlIH0gZnJvbSBcIi4vZ2VuZXJhdGlvblwiO1xuXG5leHBvcnQgY29uc3QgU0lOR0xFX0lNQUdFX1JPVEFUSU9OX01JTiA9IC03MjA7XG5leHBvcnQgY29uc3QgU0lOR0xFX0lNQUdFX1JPVEFUSU9OX01BWCA9IDcyMDtcbmV4cG9ydCBjb25zdCBTSU5HTEVfSU1BR0VfQ0FNRVJBX0RJU1RBTkNFX01JTiA9IDA7XG5leHBvcnQgY29uc3QgU0lOR0xFX0lNQUdFX0NBTUVSQV9ESVNUQU5DRV9NQVggPSAxMDtcbmV4cG9ydCBjb25zdCBTSU5HTEVfSU1BR0VfQ0FNRVJBX0RJU1RBTkNFX0RFRkFVTFQgPSA1O1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfU0lOR0xFX0lNQUdFX1JFQVNPTklOR19NT0RFTCA9IFwiZ3B0LTUuNi1zb2xcIjtcbmV4cG9ydCBjb25zdCBERUZBVUxUX1NJTkdMRV9JTUFHRV9JTUFHRV9NT0RFTCA9IFwiZ3B0LWltYWdlLTJcIjtcbmV4cG9ydCBjb25zdCBTSU5HTEVfSU1BR0VfQ0FNRVJBX1BST1RPQ09MX01BUktFUiA9XG4gIFwi55u45py65Y2P6K6u54mI5pys77yaMy4y772cWFlaIOaMh+Wumuebruagh+inguWvn+acuuS9je+8muacgOe7iOS6jOe7tOacneWQkeW/hemhu+maj+ebruagh+acuuS9jemHjeW7uu+8jOS4jee7p+aJv+WOn+WbvuWxj+W5leacneWQkVwiO1xuXG5leHBvcnQgdHlwZSBTaW5nbGVJbWFnZVByb21wdENvbmZsaWN0ID1cbiAgfCBcImdlbmVyaWMtc3ViamVjdC1zdXJmYWNlXCJcbiAgfCBcInNvdXJjZS1wcm9qZWN0aW9uLWxvY2tcIjtcblxuY29uc3QgU0lOR0xFX0lNQUdFX0dFTkVSSUNfU1VCSkVDVF9TVVJGQUNFX1BBVFRFUk4gPVxuICAv5Li75L2TKD8655qEKT8oPzrmnJ0pPyg/Oig/OuW3pnzlj7N85YmNfOWQjnzkuIp85LiLKeS+pz8oPzrooajpnaJ85L6n6Z2ifOWMuuWfn3znu5PmnoQpfCg/OuS+p+mdonzooajpnaIpKXwoPzrlt6Z85Y+zfOWJjXzlkI585LiKfOS4iynkvqc/KD866KGo6Z2ifOS+p+mdonzljLrln58pfOaYvuekuuabtOWkmig/OuW3pnzlj7N85YmNfOWQjnzkvqcpP+mdonzmmL7pnLIoPzrlt6Z85Y+zfOWJjXzlkI585L6nKT/pnaJ8XFxiKD86dGhlXFxzKyk/KD86c3ViamVjdCg/OidzKT9cXHMrKT8oPzpsZWZ0fHJpZ2h0fGZyb250fHJlYXJ8YmFja3x0b3B8Ym90dG9tKSg/OlstXFxzXStzaWRlKT9cXHMrc3VyZmFjZVxcYnxcXGJzaG93XFxzK21vcmVcXHMrKD86b2ZcXHMrdGhlXFxzKyk/KD86bGVmdHxyaWdodHxmcm9udHxyZWFyfGJhY2t8dG9wfGJvdHRvbSk/XFxzKnNpZGVcXGIvaXU7XG5cbmNvbnN0IFNJTkdMRV9JTUFHRV9TT1VSQ0VfUFJPSkVDVElPTl9MT0NLX1BBVFRFUk4gPVxuICAvXFxiKD86ZG8gbm90fGRvbid0fG11c3Qgbm90fG5ldmVyKVxcYi57MCwzMH1cXGIoPzp0dXJufHJvdGF0ZXxjaGFuZ2UpXFxiLnswLDIwfVxcYig/OnBvc2V8b3JpZW50YXRpb258ZmFjaW5nfHZpZXcpXFxifFxcYig/OmtlZXB8cHJlc2VydmV8bG9jaylcXGIuezAsMjV9XFxiKD86b3JpZ2luYWx8c291cmNlKVxcYi57MCwyMH1cXGIoPzpwb3NlfG9yaWVudGF0aW9ufGZhY2luZ3xwcm9qZWN0aW9uKVxcYnwoPzrnpoHmraJ85LiN5b6XfOS4jeimgSkuezAsMjR9KD865Li75L2TfOS6uueJqXzliqjnial854mp5L2TfOi9pui+hnzlu7rnrZEpPy57MCwxNn0oPzrkuLvliqgpPyg/Oui9rOi6q3zml4vovazoh6rouqt85pS55Y+YfOiwg+aVtCkuezAsMTB9KD865ae/5oCBfOacneWQkXzlsY/luZXmnJ3lkJF85oqV5b2xKXwoPzwh5LiN5b6XKSg/PCHkuI3og70pKD88IemBv+WFjSkoPzwh56aB5q2iKSg/PCHkuI3opoEpKD88IeS4jSkoPzwh5pyqKSg/PCHli78pKD88IeaXoCkoPzwh6Z2eKSg/PCHliKspKD865L+d5oyBfOmUgeWumnzlm7rlrpopLnswLDE2fSg/OuWOn+Wbvnzljp/lp4t85Li75L2TfOS6uueJqXzniankvZMpPy57MCwxNn0oPzrlsY/luZXmnJ3lkJF85Y6f5Zu+5pyd5ZCRfOWOn+Wni+acneWQkXzmraPpnaLmnJ3lkJF85oqV5b2x5LiN5Y+YKXwoPzrkuLvkvZN85Lq654mpfOWKqOeJqXzniankvZN86L2m6L6GfOW7uuetkSkuezAsMTZ9KD865LiW55WM56m66Ze0fOS4iee7tOepuumXtCkuezAsMTZ9KD8654q25oCBfOWnv+aAgXzmnJ3lkJEpLnswLDEyfSg/OuS/neaMgeS4jeWPmHzlm7rlrpp86ZSB5a6aKS9pdTtcblxuZXhwb3J0IGZ1bmN0aW9uIGZpbmRTaW5nbGVJbWFnZVByb21wdENvbmZsaWN0KFxuICBwcm9tcHQ6IHN0cmluZ1xuKTogU2luZ2xlSW1hZ2VQcm9tcHRDb25mbGljdCB8IHVuZGVmaW5lZCB7XG4gIGlmIChTSU5HTEVfSU1BR0VfR0VORVJJQ19TVUJKRUNUX1NVUkZBQ0VfUEFUVEVSTi50ZXN0KHByb21wdCkpIHtcbiAgICByZXR1cm4gXCJnZW5lcmljLXN1YmplY3Qtc3VyZmFjZVwiO1xuICB9XG5cbiAgaWYgKFNJTkdMRV9JTUFHRV9TT1VSQ0VfUFJPSkVDVElPTl9MT0NLX1BBVFRFUk4udGVzdChwcm9tcHQpKSB7XG4gICAgcmV0dXJuIFwic291cmNlLXByb2plY3Rpb24tbG9ja1wiO1xuICB9XG5cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuZXhwb3J0IHR5cGUgWFlaUm90YXRpb24gPSB7XG4gIHg6IG51bWJlcjtcbiAgeTogbnVtYmVyO1xuICB6OiBudW1iZXI7XG59O1xuXG5leHBvcnQgdHlwZSBWaWV3cG9pbnRRdWF0ZXJuaW9uID0ge1xuICB4OiBudW1iZXI7XG4gIHk6IG51bWJlcjtcbiAgejogbnVtYmVyO1xuICB3OiBudW1iZXI7XG59O1xuXG5leHBvcnQgdHlwZSBTaW5nbGVJbWFnZUNhbWVyYVBvc2UgPSB7XG4gIGN1bXVsYXRpdmVEZWdyZWVzOiBYWVpSb3RhdGlvbjtcbiAgbm9ybWFsaXplZERlZ3JlZXM6IFhZWlJvdGF0aW9uO1xuICBxdWF0ZXJuaW9uOiBWaWV3cG9pbnRRdWF0ZXJuaW9uO1xuICBldWxlck9yZGVyOiBcIllYWlwiO1xuICBjb29yZGluYXRlU3lzdGVtOiBcInJpZ2h0LWhhbmRlZC1jYW1lcmEtb3JiaXRcIjtcbn07XG5cbmV4cG9ydCB0eXBlIFNpbmdsZUltYWdlRGlyZWN0aW9uYWxDb25zdHJhaW50cyA9IHtcbiAgcmVsYXRpdmVDYW1lcmFNb3Rpb246IHN0cmluZ1tdO1xuICB2aXNpYmlsaXR5Q29uc3RyYWludHM6IHN0cmluZ1tdO1xuICBvY2NsdXNpb25Db25zdHJhaW50czogc3RyaW5nW107XG4gIHBlcnNwZWN0aXZlQ3Vlczogc3RyaW5nW107XG4gIGZvcmJpZGRlblNob3J0Y3V0czogc3RyaW5nW107XG59O1xuXG5leHBvcnQgdHlwZSBDYW1lcmFBemltdXRoS2V5ID1cbiAgfCBcImZyb250XCJcbiAgfCBcInJpZ2h0LWZyb250XCJcbiAgfCBcInJpZ2h0XCJcbiAgfCBcInJpZ2h0LWJhY2tcIlxuICB8IFwiYmFja1wiXG4gIHwgXCJsZWZ0LWJhY2tcIlxuICB8IFwibGVmdFwiXG4gIHwgXCJsZWZ0LWZyb250XCI7XG5cbmV4cG9ydCB0eXBlIENhbWVyYUVsZXZhdGlvbktleSA9XG4gIHwgXCJuZWFyLWJvdHRvbVwiXG4gIHwgXCJsb3ctYW5nbGVcIlxuICB8IFwiZXllLWxldmVsXCJcbiAgfCBcImVsZXZhdGVkXCJcbiAgfCBcImhpZ2gtYW5nbGVcIlxuICB8IFwibmVhci10b3BcIjtcblxuZXhwb3J0IHR5cGUgQ2FtZXJhRGlzdGFuY2VLZXkgPSBcIndpZGVcIiB8IFwibWVkaXVtXCIgfCBcImNsb3NlLXVwXCI7XG5cbmV4cG9ydCB0eXBlIFNpbmdsZUltYWdlQ2FtZXJhUHJvbXB0ID0ge1xuICBjYW1lcmFBemltdXRoRGVncmVlczogbnVtYmVyO1xuICBjYW1lcmFFbGV2YXRpb25EZWdyZWVzOiBudW1iZXI7XG4gIGNhbWVyYVJvbGxEZWdyZWVzOiBudW1iZXI7XG4gIGNhbWVyYURpc3RhbmNlOiBudW1iZXI7XG4gIGF6aW11dGhLZXk6IENhbWVyYUF6aW11dGhLZXk7XG4gIGVsZXZhdGlvbktleTogQ2FtZXJhRWxldmF0aW9uS2V5O1xuICBkaXN0YW5jZUtleTogQ2FtZXJhRGlzdGFuY2VLZXk7XG4gIGF6aW11dGhMYWJlbFpoOiBzdHJpbmc7XG4gIGVsZXZhdGlvbkxhYmVsWmg6IHN0cmluZztcbiAgZGlzdGFuY2VMYWJlbFpoOiBzdHJpbmc7XG4gIHJvbGxMYWJlbFpoOiBzdHJpbmc7XG4gIHJlcXVpcmVkVmlzaWJsZVN1cmZhY2VzOiBzdHJpbmdbXTtcbiAgcmVxdWlyZWRPY2NsdWRlZFN1cmZhY2VzOiBzdHJpbmdbXTtcbiAgcGVyc3BlY3RpdmVDb25zdHJhaW50czogc3RyaW5nW107XG4gIGZvcmJpZGRlblNob3J0Y3V0czogc3RyaW5nW107XG4gIGRldGVybWluaXN0aWNQcm9tcHRaaDogc3RyaW5nO1xufTtcblxuZXhwb3J0IHR5cGUgU2luZ2xlSW1hZ2VWaWV3cG9pbnRTdGFnZSA9IFwicmVhc29uaW5nXCIgfCBcInJlbmRlcmluZ1wiO1xuXG5leHBvcnQgdHlwZSBTaW5nbGVJbWFnZVN1YmplY3RDYXRlZ29yeSA9XG4gIHwgXCJwZXJzb25cIlxuICB8IFwiYW5pbWFsXCJcbiAgfCBcInByb2R1Y3Rfb2JqZWN0XCJcbiAgfCBcInZlaGljbGVcIlxuICB8IFwiYXJjaGl0ZWN0dXJlX3NjZW5lXCJcbiAgfCBcIm90aGVyXCI7XG5cbmV4cG9ydCB0eXBlIFNpbmdsZUltYWdlVmlld3BvaW50QW5hbHlzaXMgPSB7XG4gIHN1YmplY3RDYXRlZ29yeTogU2luZ2xlSW1hZ2VTdWJqZWN0Q2F0ZWdvcnk7XG4gIG9wdGltaXplZFByb21wdDogc3RyaW5nO1xuICB2aWV3RGVzY3JpcHRpb246IHN0cmluZztcbiAgc291cmNlVmlld0Rlc2NyaXB0aW9uOiBzdHJpbmc7XG4gIHRhcmdldFZpZXdEZXNjcmlwdGlvbjogc3RyaW5nO1xuICByZWxhdGl2ZUNhbWVyYU1vdGlvbjogc3RyaW5nO1xuICB2aXNpYmlsaXR5Q29uc3RyYWludHM6IHN0cmluZ1tdO1xuICBvY2NsdXNpb25Db25zdHJhaW50czogc3RyaW5nW107XG4gIGlkZW50aXR5Q29uc3RyYWludHM6IHN0cmluZ1tdO1xuICBoaWRkZW5TdXJmYWNlUGxhbjogc3RyaW5nW107XG4gIHNjZW5lUGxhbjogc3RyaW5nW107XG4gIHVuY2VydGFpbnR5Tm90ZXM6IHN0cmluZ1tdO1xufTtcblxuZXhwb3J0IHR5cGUgU2luZ2xlSW1hZ2VWaWV3cG9pbnRSZXF1ZXN0ID0ge1xuICByZXF1ZXN0SWQ6IHN0cmluZztcbiAgc291cmNlX2ltYWdlOiBzdHJpbmc7XG4gIHBvc2VfZ3VpZGVfaW1hZ2U6IHN0cmluZztcbiAgY2FtZXJhX3Bvc2VfaW1hZ2U6IHN0cmluZztcbiAgcm90YXRpb25fZGVncmVlczogWFlaUm90YXRpb247XG4gIGNhbWVyYV9kaXN0YW5jZT86IG51bWJlcjtcbiAgdXNlcl9wcm9tcHQ6IHN0cmluZztcbiAgYmFja2dyb3VuZF9tb2RlOiBcInByZXNlcnZlX3NjZW5lXCI7XG4gIGFwaV9rZXk/OiBzdHJpbmc7XG4gIHJlYXNvbmluZ19tb2RlbDogc3RyaW5nO1xuICBpbWFnZV9tb2RlbDogc3RyaW5nO1xuICBvdXRwdXRfc2l6ZTogc3RyaW5nO1xuICBlbmRwb2ludF9vdmVycmlkZT86IFBpY2s8XG4gICAgRW5kcG9pbnRPdmVycmlkZSxcbiAgICBcImJhc2VVUkxcIiB8IFwiZWRpdFVSTFwiIHwgXCJoZWFkZXJzXCJcbiAgPjtcbn07XG5cbmV4cG9ydCB0eXBlIFNpbmdsZUltYWdlVmlld3BvaW50UmVzdWx0ID0gU2luZ2xlSW1hZ2VWaWV3cG9pbnRBbmFseXNpcyAmIHtcbiAgcmVxdWVzdElkOiBzdHJpbmc7XG4gIGltYWdlOiBzdHJpbmc7XG4gIGltYWdlTWltZVR5cGU6IHN0cmluZztcbiAgcG9zZTogU2luZ2xlSW1hZ2VDYW1lcmFQb3NlO1xuICBjYW1lcmFQcm9tcHQ6IFNpbmdsZUltYWdlQ2FtZXJhUHJvbXB0O1xuICByZW5kZXJQcm9tcHQ6IHN0cmluZztcbiAgcmVhc29uaW5nTW9kZWw6IHN0cmluZztcbiAgaW1hZ2VNb2RlbDogc3RyaW5nO1xuICByZWFzb25pbmdEdXJhdGlvbk1zOiBudW1iZXI7XG4gIHJlbmRlcmluZ0R1cmF0aW9uTXM6IG51bWJlcjtcbiAgdG90YWxEdXJhdGlvbk1zOiBudW1iZXI7XG59O1xuXG5leHBvcnQgdHlwZSBTaW5nbGVJbWFnZVZpZXdwb2ludFN0cmVhbUV2ZW50ID1cbiAgfCB7XG4gICAgICB0eXBlOiBcInN0YWdlXCI7XG4gICAgICBzdGFnZTogU2luZ2xlSW1hZ2VWaWV3cG9pbnRTdGFnZTtcbiAgICAgIG1lc3NhZ2U6IHN0cmluZztcbiAgICAgIGFuYWx5c2lzPzogU2luZ2xlSW1hZ2VWaWV3cG9pbnRBbmFseXNpcztcbiAgICAgIGNhbWVyYVByb21wdD86IFNpbmdsZUltYWdlQ2FtZXJhUHJvbXB0O1xuICAgICAgcmVuZGVyUHJvbXB0Pzogc3RyaW5nO1xuICAgIH1cbiAgfCB7XG4gICAgICB0eXBlOiBcInJlc3VsdFwiO1xuICAgICAgZGF0YTogU2luZ2xlSW1hZ2VWaWV3cG9pbnRSZXN1bHQ7XG4gICAgfVxuICB8IHtcbiAgICAgIHR5cGU6IFwiZXJyb3JcIjtcbiAgICAgIGVycm9yOiB7XG4gICAgICAgIGNvZGU6IHN0cmluZztcbiAgICAgICAgbWVzc2FnZTogc3RyaW5nO1xuICAgICAgICByZXF1ZXN0SWQ/OiBzdHJpbmc7XG4gICAgICAgIHJldHJ5YWJsZTogYm9vbGVhbjtcbiAgICAgIH07XG4gICAgfTtcblxuZXhwb3J0IGNvbnN0IFNJTkdMRV9JTUFHRV9WSUVXUE9JTlRfTElNSVRTID0ge1xuICBzb3VyY2VJbWFnZUJ5dGVzOiAyMCAqIDEwMjQgKiAxMDI0LFxuICBndWlkZUltYWdlQnl0ZXM6IDIwICogMTAyNCAqIDEwMjQsXG4gIGNhbWVyYVBvc2VJbWFnZUJ5dGVzOiAyMCAqIDEwMjQgKiAxMDI0LFxuICBjb21iaW5lZEltYWdlQnl0ZXM6IDQ4ICogMTAyNCAqIDEwMjRcbn0gYXMgY29uc3Q7XG5cbmV4cG9ydCBmdW5jdGlvbiBjbGFtcFNpbmdsZUltYWdlUm90YXRpb25BbmdsZSh2YWx1ZTogbnVtYmVyKSB7XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHZhbHVlKSkge1xuICAgIHJldHVybiAwO1xuICB9XG5cbiAgcmV0dXJuIE1hdGgubWluKFxuICAgIFNJTkdMRV9JTUFHRV9ST1RBVElPTl9NQVgsXG4gICAgTWF0aC5tYXgoU0lOR0xFX0lNQUdFX1JPVEFUSU9OX01JTiwgdmFsdWUpXG4gICk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVTaW5nbGVJbWFnZVJvdGF0aW9uQW5nbGUodmFsdWU6IG51bWJlcikge1xuICBpZiAoIU51bWJlci5pc0Zpbml0ZSh2YWx1ZSkpIHtcbiAgICByZXR1cm4gMDtcbiAgfVxuXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSAoKHZhbHVlICsgMTgwKSAlIDM2MCArIDM2MCkgJSAzNjAgLSAxODA7XG4gIGNvbnN0IHNpZ25lZCA9IG5vcm1hbGl6ZWQgPT09IC0xODAgPyAxODAgOiBub3JtYWxpemVkO1xuXG4gIHJldHVybiBPYmplY3QuaXMoc2lnbmVkLCAtMCkgPyAwIDogc2lnbmVkO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2FsY3VsYXRlU2hvcnRlc3RBeGlzUm90YXRpb25EZWx0YShcbiAgcHJldmlvdXNWaXN1YWxBbmdsZTogbnVtYmVyLFxuICBjdXJyZW50VmlzdWFsQW5nbGU6IG51bWJlclxuKSB7XG4gIGxldCBkZWx0YSA9XG4gICAgbm9ybWFsaXplVW5zaWduZWREZWdyZWVzKGN1cnJlbnRWaXN1YWxBbmdsZSkgLVxuICAgIG5vcm1hbGl6ZVVuc2lnbmVkRGVncmVlcyhwcmV2aW91c1Zpc3VhbEFuZ2xlKTtcblxuICBpZiAoZGVsdGEgPiAxODApIHtcbiAgICBkZWx0YSAtPSAzNjA7XG4gIH0gZWxzZSBpZiAoZGVsdGEgPCAtMTgwKSB7XG4gICAgZGVsdGEgKz0gMzYwO1xuICB9XG5cbiAgcmV0dXJuIE9iamVjdC5pcyhkZWx0YSwgLTApID8gMCA6IGRlbHRhO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYWNjdW11bGF0ZVNpbmdsZUltYWdlUm90YXRpb24oXG4gIGN1bXVsYXRpdmVBbmdsZTogbnVtYmVyLFxuICBwcmV2aW91c1Zpc3VhbEFuZ2xlOiBudW1iZXIsXG4gIGN1cnJlbnRWaXN1YWxBbmdsZTogbnVtYmVyXG4pIHtcbiAgcmV0dXJuIGNsYW1wU2luZ2xlSW1hZ2VSb3RhdGlvbkFuZ2xlKFxuICAgIGN1bXVsYXRpdmVBbmdsZSArXG4gICAgICBjYWxjdWxhdGVTaG9ydGVzdEF4aXNSb3RhdGlvbkRlbHRhKFxuICAgICAgICBwcmV2aW91c1Zpc3VhbEFuZ2xlLFxuICAgICAgICBjdXJyZW50VmlzdWFsQW5nbGVcbiAgICAgIClcbiAgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNsYW1wU2luZ2xlSW1hZ2VDYW1lcmFEaXN0YW5jZSh2YWx1ZTogbnVtYmVyKSB7XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHZhbHVlKSkge1xuICAgIHJldHVybiBTSU5HTEVfSU1BR0VfQ0FNRVJBX0RJU1RBTkNFX0RFRkFVTFQ7XG4gIH1cblxuICByZXR1cm4gTWF0aC5taW4oXG4gICAgU0lOR0xFX0lNQUdFX0NBTUVSQV9ESVNUQU5DRV9NQVgsXG4gICAgTWF0aC5tYXgoU0lOR0xFX0lNQUdFX0NBTUVSQV9ESVNUQU5DRV9NSU4sIHZhbHVlKVxuICApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRTaW5nbGVJbWFnZUNhbWVyYVBvc2UoXG4gIHJvdGF0aW9uOiBYWVpSb3RhdGlvblxuKTogU2luZ2xlSW1hZ2VDYW1lcmFQb3NlIHtcbiAgY29uc3QgY3VtdWxhdGl2ZURlZ3JlZXMgPSB7XG4gICAgeDogY2xhbXBTaW5nbGVJbWFnZVJvdGF0aW9uQW5nbGUocm90YXRpb24ueCksXG4gICAgeTogY2xhbXBTaW5nbGVJbWFnZVJvdGF0aW9uQW5nbGUocm90YXRpb24ueSksXG4gICAgejogY2xhbXBTaW5nbGVJbWFnZVJvdGF0aW9uQW5nbGUocm90YXRpb24ueilcbiAgfTtcbiAgY29uc3Qgbm9ybWFsaXplZERlZ3JlZXMgPSB7XG4gICAgeDogbm9ybWFsaXplU2luZ2xlSW1hZ2VSb3RhdGlvbkFuZ2xlKGN1bXVsYXRpdmVEZWdyZWVzLngpLFxuICAgIHk6IG5vcm1hbGl6ZVNpbmdsZUltYWdlUm90YXRpb25BbmdsZShjdW11bGF0aXZlRGVncmVlcy55KSxcbiAgICB6OiBub3JtYWxpemVTaW5nbGVJbWFnZVJvdGF0aW9uQW5nbGUoY3VtdWxhdGl2ZURlZ3JlZXMueilcbiAgfTtcbiAgY29uc3QgcGl0Y2ggPSBxdWF0ZXJuaW9uRnJvbUF4aXNBbmdsZShcbiAgICB7IHg6IDEsIHk6IDAsIHo6IDAgfSxcbiAgICBkZWdyZWVzVG9SYWRpYW5zKG5vcm1hbGl6ZWREZWdyZWVzLngpXG4gICk7XG4gIGNvbnN0IHlhdyA9IHF1YXRlcm5pb25Gcm9tQXhpc0FuZ2xlKFxuICAgIHsgeDogMCwgeTogMSwgejogMCB9LFxuICAgIGRlZ3JlZXNUb1JhZGlhbnMoLW5vcm1hbGl6ZWREZWdyZWVzLnkpXG4gICk7XG4gIGNvbnN0IHJvbGwgPSBxdWF0ZXJuaW9uRnJvbUF4aXNBbmdsZShcbiAgICB7IHg6IDAsIHk6IDAsIHo6IDEgfSxcbiAgICBkZWdyZWVzVG9SYWRpYW5zKG5vcm1hbGl6ZWREZWdyZWVzLnopXG4gICk7XG5cbiAgcmV0dXJuIHtcbiAgICBjdW11bGF0aXZlRGVncmVlcyxcbiAgICBub3JtYWxpemVkRGVncmVlcyxcbiAgICBxdWF0ZXJuaW9uOiBub3JtYWxpemVRdWF0ZXJuaW9uKFxuICAgICAgbXVsdGlwbHlRdWF0ZXJuaW9ucyhtdWx0aXBseVF1YXRlcm5pb25zKHlhdywgcGl0Y2gpLCByb2xsKVxuICAgICksXG4gICAgZXVsZXJPcmRlcjogXCJZWFpcIixcbiAgICBjb29yZGluYXRlU3lzdGVtOiBcInJpZ2h0LWhhbmRlZC1jYW1lcmEtb3JiaXRcIlxuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRTaW5nbGVJbWFnZUNhbWVyYVByb21wdChcbiAgcm90YXRpb246IFhZWlJvdGF0aW9uLFxuICBjYW1lcmFEaXN0YW5jZSA9IFNJTkdMRV9JTUFHRV9DQU1FUkFfRElTVEFOQ0VfREVGQVVMVFxuKTogU2luZ2xlSW1hZ2VDYW1lcmFQcm9tcHQge1xuICBjb25zdCBwb3NlID0gYnVpbGRTaW5nbGVJbWFnZUNhbWVyYVBvc2Uocm90YXRpb24pO1xuICBjb25zdCBkaXJlY3Rpb24gPSBkZXJpdmVTaW5nbGVJbWFnZUNhbWVyYURpcmVjdGlvbihwb3NlKTtcbiAgY29uc3QgZGlzdGFuY2UgPSBjbGFtcFNpbmdsZUltYWdlQ2FtZXJhRGlzdGFuY2UoY2FtZXJhRGlzdGFuY2UpO1xuICBjb25zdCBhemltdXRoID0gY2xhc3NpZnlDYW1lcmFBemltdXRoKGRpcmVjdGlvbi5hemltdXRoKTtcbiAgY29uc3QgZWxldmF0aW9uID0gY2xhc3NpZnlDYW1lcmFFbGV2YXRpb24oZGlyZWN0aW9uLmVsZXZhdGlvbik7XG4gIGNvbnN0IGRpc3RhbmNlQ2xhc3MgPSBjbGFzc2lmeUNhbWVyYURpc3RhbmNlKGRpc3RhbmNlKTtcbiAgY29uc3QgZGlyZWN0aW9uYWwgPSBidWlsZERpcmVjdGlvbmFsQ29uc3RyYWludHMoe1xuICAgIGF6aW11dGhLZXk6IGF6aW11dGgua2V5LFxuICAgIGVsZXZhdGlvbktleTogZWxldmF0aW9uLmtleSxcbiAgICBkaXN0YW5jZUtleTogZGlzdGFuY2VDbGFzcy5rZXksXG4gICAgcm9sbERlZ3JlZXM6IHBvc2Uubm9ybWFsaXplZERlZ3JlZXMuelxuICB9KTtcbiAgY29uc3Qgcm9sbExhYmVsWmggPSBkZXNjcmliZVJvbGxaaChwb3NlLm5vcm1hbGl6ZWREZWdyZWVzLnopO1xuICBjb25zdCBwcm9tcHQgPSB7XG4gICAgY2FtZXJhQXppbXV0aERlZ3JlZXM6IGRpcmVjdGlvbi5hemltdXRoLFxuICAgIGNhbWVyYUVsZXZhdGlvbkRlZ3JlZXM6IGRpcmVjdGlvbi5lbGV2YXRpb24sXG4gICAgY2FtZXJhUm9sbERlZ3JlZXM6IHBvc2Uubm9ybWFsaXplZERlZ3JlZXMueixcbiAgICBjYW1lcmFEaXN0YW5jZTogZGlzdGFuY2UsXG4gICAgYXppbXV0aEtleTogYXppbXV0aC5rZXksXG4gICAgZWxldmF0aW9uS2V5OiBlbGV2YXRpb24ua2V5LFxuICAgIGRpc3RhbmNlS2V5OiBkaXN0YW5jZUNsYXNzLmtleSxcbiAgICBhemltdXRoTGFiZWxaaDogYXppbXV0aC5sYWJlbCxcbiAgICBlbGV2YXRpb25MYWJlbFpoOiBlbGV2YXRpb24ubGFiZWwsXG4gICAgZGlzdGFuY2VMYWJlbFpoOiBkaXN0YW5jZUNsYXNzLmxhYmVsLFxuICAgIHJvbGxMYWJlbFpoLFxuICAgIHJlcXVpcmVkVmlzaWJsZVN1cmZhY2VzOiBkaXJlY3Rpb25hbC52aXNpYmlsaXR5Q29uc3RyYWludHMsXG4gICAgcmVxdWlyZWRPY2NsdWRlZFN1cmZhY2VzOiBkaXJlY3Rpb25hbC5vY2NsdXNpb25Db25zdHJhaW50cyxcbiAgICBwZXJzcGVjdGl2ZUNvbnN0cmFpbnRzOiBkaXJlY3Rpb25hbC5wZXJzcGVjdGl2ZUN1ZXMsXG4gICAgZm9yYmlkZGVuU2hvcnRjdXRzOiBkaXJlY3Rpb25hbC5mb3JiaWRkZW5TaG9ydGN1dHMsXG4gICAgZGV0ZXJtaW5pc3RpY1Byb21wdFpoOiBcIlwiXG4gIH0gc2F0aXNmaWVzIFNpbmdsZUltYWdlQ2FtZXJhUHJvbXB0O1xuXG4gIHByb21wdC5kZXRlcm1pbmlzdGljUHJvbXB0WmggPSBidWlsZERldGVybWluaXN0aWNDYW1lcmFQcm9tcHRaaChcbiAgICBwb3NlLFxuICAgIHByb21wdFxuICApO1xuXG4gIHJldHVybiBwcm9tcHQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFNpbmdsZUltYWdlRGlyZWN0aW9uYWxDb25zdHJhaW50cyhcbiAgcG9zZTogU2luZ2xlSW1hZ2VDYW1lcmFQb3NlLFxuICBjYW1lcmFEaXN0YW5jZSA9IFNJTkdMRV9JTUFHRV9DQU1FUkFfRElTVEFOQ0VfREVGQVVMVFxuKTogU2luZ2xlSW1hZ2VEaXJlY3Rpb25hbENvbnN0cmFpbnRzIHtcbiAgY29uc3QgcHJvbXB0ID0gYnVpbGRTaW5nbGVJbWFnZUNhbWVyYVByb21wdChcbiAgICBwb3NlLmN1bXVsYXRpdmVEZWdyZWVzLFxuICAgIGNhbWVyYURpc3RhbmNlXG4gICk7XG5cbiAgcmV0dXJuIHtcbiAgICByZWxhdGl2ZUNhbWVyYU1vdGlvbjogW1xuICAgICAgXCLljp/lm77mmK/llK/kuIDnmoTpm7bluqbnm7jmnLrln7rlh4bjgIJYWVog6KGo56S655uu5qCH55u45py655u45a+56Zu25bqm5Z+65YeG55qE6L2o6YGT6L+Q5Yqo77yM57uT5p6c5b+F6aG75piv55uu5qCH55u45py65a+55ZCM5LiA5LiJ57u05pe25Yi755qE6YeN5paw5oqV5b2x44CCXCIsXG4gICAgICBg55uu5qCH55u45py65Li6JHtwcm9tcHQuYXppbXV0aExhYmVsWmh944CBJHtwcm9tcHQuZWxldmF0aW9uTGFiZWxaaH3jgIEke3Byb21wdC5kaXN0YW5jZUxhYmVsWmh977yb57K+56Gu5pa55L2N6KeSICR7Zm9ybWF0U2lnbmVkRGVncmVlc1poKHByb21wdC5jYW1lcmFBemltdXRoRGVncmVlcyl977yM57K+56Gu5L+v5Luw6KeSICR7Zm9ybWF0U2lnbmVkRGVncmVlc1poKHByb21wdC5jYW1lcmFFbGV2YXRpb25EZWdyZWVzKX3vvIwke3Byb21wdC5yb2xsTGFiZWxaaH3jgIJgXG4gICAgXSxcbiAgICB2aXNpYmlsaXR5Q29uc3RyYWludHM6IHByb21wdC5yZXF1aXJlZFZpc2libGVTdXJmYWNlcyxcbiAgICBvY2NsdXNpb25Db25zdHJhaW50czogcHJvbXB0LnJlcXVpcmVkT2NjbHVkZWRTdXJmYWNlcyxcbiAgICBwZXJzcGVjdGl2ZUN1ZXM6IHByb21wdC5wZXJzcGVjdGl2ZUNvbnN0cmFpbnRzLFxuICAgIGZvcmJpZGRlblNob3J0Y3V0czogcHJvbXB0LmZvcmJpZGRlblNob3J0Y3V0c1xuICB9O1xufVxuXG5mdW5jdGlvbiBkZXJpdmVTaW5nbGVJbWFnZUNhbWVyYURpcmVjdGlvbihwb3NlOiBTaW5nbGVJbWFnZUNhbWVyYVBvc2UpIHtcbiAgY29uc3QgcG9zaXRpb24gPSByb3RhdGVWZWN0b3JCeVF1YXRlcm5pb24oXG4gICAgeyB4OiAwLCB5OiAwLCB6OiAtMSB9LFxuICAgIHBvc2UucXVhdGVybmlvblxuICApO1xuICBjb25zdCBob3Jpem9udGFsTGVuZ3RoID0gTWF0aC5oeXBvdChwb3NpdGlvbi54LCBwb3NpdGlvbi56KTtcbiAgY29uc3QgYXppbXV0aCA9IG5vcm1hbGl6ZVNpbmdsZUltYWdlUm90YXRpb25BbmdsZShcbiAgICByYWRpYW5zVG9EZWdyZWVzKE1hdGguYXRhbjIocG9zaXRpb24ueCwgLXBvc2l0aW9uLnopKVxuICApO1xuICBjb25zdCBlbGV2YXRpb24gPSByYWRpYW5zVG9EZWdyZWVzKFxuICAgIE1hdGguYXRhbjIocG9zaXRpb24ueSwgaG9yaXpvbnRhbExlbmd0aClcbiAgKTtcblxuICByZXR1cm4ge1xuICAgIGF6aW11dGg6IGNsZWFuRGlzcGxheUFuZ2xlKGF6aW11dGgpLFxuICAgIGVsZXZhdGlvbjogY2xlYW5EaXNwbGF5QW5nbGUoZWxldmF0aW9uKVxuICB9O1xufVxuXG5mdW5jdGlvbiBjbGFzc2lmeUNhbWVyYUF6aW11dGgodmFsdWU6IG51bWJlcik6IHtcbiAga2V5OiBDYW1lcmFBemltdXRoS2V5O1xuICBsYWJlbDogc3RyaW5nO1xufSB7XG4gIGNvbnN0IGluZGV4ID0gTWF0aC5mbG9vcigobm9ybWFsaXplVW5zaWduZWREZWdyZWVzKHZhbHVlKSArIDIyLjUpIC8gNDUpICUgODtcbiAgY29uc3Qgb3B0aW9uczogQXJyYXk8eyBrZXk6IENhbWVyYUF6aW11dGhLZXk7IGxhYmVsOiBzdHJpbmcgfT4gPSBbXG4gICAgeyBrZXk6IFwiZnJvbnRcIiwgbGFiZWw6IFwi5Z+65YeG5q2j5YmN5pa55py65L2NXCIgfSxcbiAgICB7IGtleTogXCJyaWdodC1mcm9udFwiLCBsYWJlbDogXCLln7rlh4blj7PliY3mlrnmnLrkvY1cIiB9LFxuICAgIHsga2V5OiBcInJpZ2h0XCIsIGxhYmVsOiBcIuWfuuWHhuWPs+S+p+acuuS9jVwiIH0sXG4gICAgeyBrZXk6IFwicmlnaHQtYmFja1wiLCBsYWJlbDogXCLln7rlh4blj7PlkI7mlrnmnLrkvY1cIiB9LFxuICAgIHsga2V5OiBcImJhY2tcIiwgbGFiZWw6IFwi5Z+65YeG5q2j5ZCO5pa55py65L2NXCIgfSxcbiAgICB7IGtleTogXCJsZWZ0LWJhY2tcIiwgbGFiZWw6IFwi5Z+65YeG5bem5ZCO5pa55py65L2NXCIgfSxcbiAgICB7IGtleTogXCJsZWZ0XCIsIGxhYmVsOiBcIuWfuuWHhuW3puS+p+acuuS9jVwiIH0sXG4gICAgeyBrZXk6IFwibGVmdC1mcm9udFwiLCBsYWJlbDogXCLln7rlh4blt6bliY3mlrnmnLrkvY1cIiB9XG4gIF07XG5cbiAgcmV0dXJuIG9wdGlvbnNbaW5kZXhdID8/IG9wdGlvbnNbMF0hO1xufVxuXG5mdW5jdGlvbiBjbGFzc2lmeUNhbWVyYUVsZXZhdGlvbih2YWx1ZTogbnVtYmVyKToge1xuICBrZXk6IENhbWVyYUVsZXZhdGlvbktleTtcbiAgbGFiZWw6IHN0cmluZztcbn0ge1xuICBpZiAodmFsdWUgPD0gLTc1KSB7XG4gICAgcmV0dXJuIHsga2V5OiBcIm5lYXItYm90dG9tXCIsIGxhYmVsOiBcIui/keW6leinhuS7sOaLjVwiIH07XG4gIH1cblxuICBpZiAodmFsdWUgPCAtMTUpIHtcbiAgICByZXR1cm4geyBrZXk6IFwibG93LWFuZ2xlXCIsIGxhYmVsOiBcIuS9juacuuS9jeS7sOaLjVwiIH07XG4gIH1cblxuICBpZiAodmFsdWUgPCAxNSkge1xuICAgIHJldHVybiB7IGtleTogXCJleWUtbGV2ZWxcIiwgbGFiZWw6IFwi5bmz6KeGXCIgfTtcbiAgfVxuXG4gIGlmICh2YWx1ZSA8IDQ1KSB7XG4gICAgcmV0dXJuIHsga2V5OiBcImVsZXZhdGVkXCIsIGxhYmVsOiBcIumrmOinkuW6puinguWvn1wiIH07XG4gIH1cblxuICBpZiAodmFsdWUgPCA3NSkge1xuICAgIHJldHVybiB7IGtleTogXCJoaWdoLWFuZ2xlXCIsIGxhYmVsOiBcIuS/r+aLjVwiIH07XG4gIH1cblxuICByZXR1cm4geyBrZXk6IFwibmVhci10b3BcIiwgbGFiZWw6IFwi6L+R6aG26KeG5L+v5ouNXCIgfTtcbn1cblxuZnVuY3Rpb24gY2xhc3NpZnlDYW1lcmFEaXN0YW5jZSh2YWx1ZTogbnVtYmVyKToge1xuICBrZXk6IENhbWVyYURpc3RhbmNlS2V5O1xuICBsYWJlbDogc3RyaW5nO1xufSB7XG4gIGlmICh2YWx1ZSA8IDIpIHtcbiAgICByZXR1cm4geyBrZXk6IFwid2lkZVwiLCBsYWJlbDogXCLov5zmma9cIiB9O1xuICB9XG5cbiAgaWYgKHZhbHVlIDwgNikge1xuICAgIHJldHVybiB7IGtleTogXCJtZWRpdW1cIiwgbGFiZWw6IFwi5Lit5pmvXCIgfTtcbiAgfVxuXG4gIHJldHVybiB7IGtleTogXCJjbG9zZS11cFwiLCBsYWJlbDogXCLnibnlhplcIiB9O1xufVxuXG5mdW5jdGlvbiBidWlsZERpcmVjdGlvbmFsQ29uc3RyYWludHMoaW5wdXQ6IHtcbiAgYXppbXV0aEtleTogQ2FtZXJhQXppbXV0aEtleTtcbiAgZWxldmF0aW9uS2V5OiBDYW1lcmFFbGV2YXRpb25LZXk7XG4gIGRpc3RhbmNlS2V5OiBDYW1lcmFEaXN0YW5jZUtleTtcbiAgcm9sbERlZ3JlZXM6IG51bWJlcjtcbn0pOiBPbWl0PFNpbmdsZUltYWdlRGlyZWN0aW9uYWxDb25zdHJhaW50cywgXCJyZWxhdGl2ZUNhbWVyYU1vdGlvblwiPiB7XG4gIGNvbnN0IHZpc2liaWxpdHlDb25zdHJhaW50czogc3RyaW5nW10gPSBbXTtcbiAgY29uc3Qgb2NjbHVzaW9uQ29uc3RyYWludHM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IHBlcnNwZWN0aXZlQ3Vlczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgZm9yYmlkZGVuU2hvcnRjdXRzID0gW1xuICAgIFwi5pyA6auY5LyY5YWI57qn77ya5YWI5oqK55u45py65rK/IFhZWiDovajpgZPnp7vliqjliLDnm67moIfmnLrkvY3lubblr7nlh4bkuLvkvZPkuK3lv4PvvIzlho3ku47or6XmnLrkvY3ph43mlrDnlJ/miJDmlbTluYXnlLvpnaLjgIJcIixcbiAgICBcIui/nue7reeahOaYr+WQjOS4gOeOsOWunueerOmXtOS4reeahOS4u+S9k+i6q+S7veOAgeWKqOS9nOS6i+S7tuOAgeWFs+iKguaIlumbtuS7tuWFs+ezu+S4juWcuuaZr+aLk+aJke+8m+i/meS4jemUgeWumuWOn+WbvuacneWQkeWxj+W5leeahOaWueWQkeOAgua6kOWbvuS6jOe7tOWdkOagh+OAgeWxj+W5lei9ruW7k+WSjOWxj+W5leaKleW9seS4jei/nue7re+8jOW/hemhu+WcqOaWsOacuuS9jemHjeaWsOW7uueri+OAglwiLFxuICAgIFwi5YWB6K645LiU5b+F6aG75pS55Y+Y5Li75L2T5Zyo5pyA57uI5LqM57u055S76Z2i5Lit55qE5Y+v6KeB5pyd5ZCR44CB6L2u5buT44CB5oqV5b2x5a695bqm5ZKM6YGu5oyh5YWz57O777yb6L+Z5piv55uu5qCH55u45py65py65L2N5Y+Y5YyW55qE6aKE5pyf57uT5p6c77yM5LiN5piv5Li75L2T6Lqr5Lu95oiW5Yqo5L2c5LqL5Lu25Y+R55Sf5pS55Y+Y44CCXCIsXG4gICAgXCLnm67moIfnm7jmnLrnmoTkvY3nva7lj5jljJblsLHmmK/mnKzmrKHnvJbovpHnm67moIfjgILmnIDnu4jnlLvpnaLlkYjnjrDmraPpnaLjgIHkvqfpnaLjgIHog4zpnaLjgIHkuIrmlrnmiJbkuIvmlrnvvIzlj6rog73nlLHnm67moIfnm7jmnLrmlrnlkJHlhrPlrprvvIzkuI3lvpfooqvouqvku73ov57nu63mgKfmiJbliqjkvZzkuovku7bov57nu63mgKfopobnm5bjgIJcIixcbiAgICBcIueUu+mdouS4reeahOaKleW9seaWueWQkeOAgei9ruW7k+OAgeaKleW9seWuveW6puOAgeWPr+ingee7k+aehOOAgemBruaMoemhuuW6j+OAgeWcsOW5s+e6v+WSjOiDjOaZr+inhuW3ruW/hemhu+eUseebruagh+ebuOacuumHjeaWsOiuoeeul+W5tuaYjuaYvuaUueWPmOOAglwiLFxuICAgIFwi5b2T55uu5qCH55u45py65L2N5LqO5L6n6Z2i44CB5ZCO5pa544CB5LiK5pa55oiW5LiL5pa55pe277yM5Y6f5Zu+5q2j5ZCR5oqV5b2x5b+F6aG75YiG5Yir6YeN5bu65Li65L6n5ZCR44CB5ZCO5ZCR44CB5L+v6KeG5oiW5Luw6KeG5oqV5b2x44CCXCIsXG4gICAgXCLkuLvkvZPoh6rouqvlnZDmoIfkuI7nm7jmnLrjgIHlsY/luZXlnZDmoIfkuKXmoLzljLrliIbvvJvku6XplIHlrprnmoTnm7jmnLrmlrnkvY3jgIHkv6/ku7DlkowgUm9sbCDkvZzkuLrmnIDnu4jmuLLmn5Pkvp3mja7jgIJcIixcbiAgICBcIuiLpeWPquacieS4u+S9k+aKleW9seWPmOWMluiAjOiDjOaZr+WQhOa3seW6puWxguS7jeS/neaMgea6kOWbvuaehOWbvu+8jOWIpOWumuS4uuayoeacieaJp+ihjOacuuS9jeWPmOWMluOAglwiLFxuICAgIFwi56aB5q2i5rC05bmz6ZWc5YOP44CB5LqM57u05bmz6Z2i5peL6L2s44CB6YCP6KeG5ouJ5Ly444CB5Y2h54mH57+76L2s44CB6L6557yY5Y6L5omB44CB5Li75L2T5Ymq6LS05oiW5aSN5Yi25Y6f5Zu+5oqV5b2x44CCXCJcbiAgXTtcblxuICBpZiAoaW5wdXQuYXppbXV0aEtleSA9PT0gXCJmcm9udFwiKSB7XG4gICAgdmlzaWJpbGl0eUNvbnN0cmFpbnRzLnB1c2goXG4gICAgICBcIuebruagh+eUu+mdouW/hemhu+WRiOeOsOmbtuW6puWfuuWHhueahOecn+Wunuato+mdouaKleW9se+8m+WFt+S9k+e7k+aehOmqjOaUtueUseivhuWbvuaooeWei+S+neaNruS4u+S9k+exu+WIq+eUn+aIkO+8jOS4jeW+l+ehrOWll+S6uuS9k+aIluWZqOWumOaooeadv+OAglwiXG4gICAgKTtcbiAgICBvY2NsdXNpb25Db25zdHJhaW50cy5wdXNoKFxuICAgICAgXCLkuI3lvpfmrovnlZnkuInliIbkuYvlm5vjgIHkvqfpnaLmiJbog4zpnaLmipXlvbHnibnlvoHvvIzkuZ/kuI3lvpfnlKjkuoznu7Tmi4nmraPku6Pmm7/nnJ/lrp7mraPpnaLph43lu7rjgIJcIlxuICAgICk7XG4gIH0gZWxzZSBpZiAoaW5wdXQuYXppbXV0aEtleSA9PT0gXCJiYWNrXCIpIHtcbiAgICB2aXNpYmlsaXR5Q29uc3RyYWludHMucHVzaChcbiAgICAgIFwi55u45py65b+F6aG757uV5Yiw6Zu25bqm5Z+65YeG6IOM5ZCO5b2i5oiQ55yf5a6e6IOM6Z2i5oqV5b2x77yb5Y6f5Zu+5pyq5pi+56S655qE57uT5p6E5oyJ5bey6K+G5Yir57G75Yir5L+d5a6I6KGl5YWo77yM5LiN6aKE6K6+5Li75L2T5LiA5a6a5YW35pyJ5p+Q56eN5Zmo5a6Y5oiW6KGo6Z2i44CCXCJcbiAgICApO1xuICAgIG9jY2x1c2lvbkNvbnN0cmFpbnRzLnB1c2goXG4gICAgICBcIumbtuW6puWfuuWHhueahOato+mdouaKleW9seW/hemhu+Wkp+W5hemAgOmakOaIluS4jeWPr+inge+8jOS4jeW+l+aKiuWOn+Wbvuato+mdouWkjeWItuOAgemVnOWDj+aIlui0tOWIsOiDjOmdoue7k+aenOS4iuOAglwiXG4gICAgKTtcbiAgfSBlbHNlIGlmIChcbiAgICBpbnB1dC5hemltdXRoS2V5ID09PSBcInJpZ2h0LWZyb250XCIgfHxcbiAgICBpbnB1dC5hemltdXRoS2V5ID09PSBcImxlZnQtZnJvbnRcIlxuICApIHtcbiAgICBjb25zdCBvcmJpdERpcmVjdGlvbiA9XG4gICAgICBpbnB1dC5hemltdXRoS2V5ID09PSBcInJpZ2h0LWZyb250XCIgPyBcIuWPs+S+p1wiIDogXCLlt6bkvqdcIjtcbiAgICB2aXNpYmlsaXR5Q29uc3RyYWludHMucHVzaChcbiAgICAgIGDnm7jmnLrlv4Xpobvku47pm7bluqbln7rlh4bmraPpnaLlkJEke29yYml0RGlyZWN0aW9ufeeOr+e7le+8jOW9ouaIkOecn+WunuWbm+WIhuS5i+S4ieaKleW9se+8m+i9ruW7k+OAgeaKleW9seWuveW6puWSjOWJjeWQjumBruaMoeW/hemhu+aMieS4u+S9k+exu+WIq+S4juecn+WunuS9k+enr+mHjeW7uuOAgmBcbiAgICApO1xuICAgIG9jY2x1c2lvbkNvbnN0cmFpbnRzLnB1c2goXG4gICAgICBcIuS4jeW+l+S/neeVmembtuW6puato+mdouaKleW9se+8jOS5n+S4jeW+l+aKiuWbm+WIhuS5i+S4ieinhuinkuW8seWMluaIkOWHoOS5juS4jeWPmOeahOWOn+WbvuOAglwiXG4gICAgKTtcbiAgfSBlbHNlIGlmIChcbiAgICBpbnB1dC5hemltdXRoS2V5ID09PSBcInJpZ2h0XCIgfHxcbiAgICBpbnB1dC5hemltdXRoS2V5ID09PSBcImxlZnRcIlxuICApIHtcbiAgICBjb25zdCBvcmJpdERpcmVjdGlvbiA9XG4gICAgICBpbnB1dC5hemltdXRoS2V5ID09PSBcInJpZ2h0XCIgPyBcIuWPs+S+p+e6piA5MMKwXCIgOiBcIuW3puS+p+e6piA5MMKwXCI7XG4gICAgdmlzaWJpbGl0eUNvbnN0cmFpbnRzLnB1c2goXG4gICAgICBg55u45py65b+F6aG75rK/5rC05bmz5ZyG6L2o6YGT5Yiw6L6+6Zu25bqm5Z+65YeG55qEJHtvcmJpdERpcmVjdGlvbn3vvIzpq5jluqbjgIHovajpgZPljYrlvoTlkoznhKbot53kuI3lj5jvvIzlubblvaLmiJDkuKXmoLzkvqflkJHmipXlvbHvvJvlhbfkvZPlj6/op4Hnu5PmnoTnlLHor4blm77mqKHlnovmjInkuLvkvZPnsbvliKvnlJ/miJDlj6/lrqLop4Lmo4Dmn6XnmoTmipXlvbHmnaHku7bjgIJgLFxuICAgICAgXCLlr7nlhbfmnInmmI7noa7mraPpnaLlubPpnaLnmoTkuLvkvZPvvIzor6XlubPpnaLnmoTmipXlvbHlrr3luqbkuI3lvpfotoXov4flhbbmipXlvbHpq5jluqbnmoQgMjAl77yb5q2j6Z2i5Lit5b+D57uT5p6E5bqU5Y6L57yp5Li656qE5p2h44CB6JaE5byn5oiW6KKr6L+R5L6n57uT5p6E6YGu5oyh77yM5bm25pi+6Zyy55yf5a6e5YmN5ZCO5Y6a5bqm44CCXCJcbiAgICApO1xuICAgIG9jY2x1c2lvbkNvbnN0cmFpbnRzLnB1c2goXG4gICAgICBcIumbtuW6puato+mdouaKleW9seW/hemhu+aYvuiRl+mAgOmakO+8jOS4jeiDveS7jeS/neeVmeS4pOS+p+WvueensOeahOato+mdouW9ouaAge+8jOS5n+S4jeiDveS8quijheaIkOi9u+W+ruWbm+WIhuS5i+S4ieinhuinkuOAglwiXG4gICAgKTtcbiAgICBwZXJzcGVjdGl2ZUN1ZXMucHVzaChcbiAgICAgIFwi5Lil5qC85L6n6KeG5b+F6aG76K6p6IOM5pmv5omA5pyJ5rex5bqm5bGC5Lqn55Sf5LiN5ZCM5bmF5bqm55qE5rC05bmz5L2N56e744CB6YeN5Y+g5ZKM5Ye65YWl55S75Y+Y5YyW77yb5Li75L2T5Y+Y5YyW5L2G6IOM5pmv5L+d5oyB5rqQ5Zu+5p6E5Zu+5Y2z5Li65aSx6LSl44CCXCJcbiAgICApO1xuICB9IGVsc2Uge1xuICAgIGNvbnN0IG9yYml0RGlyZWN0aW9uID1cbiAgICAgIGlucHV0LmF6aW11dGhLZXkgPT09IFwicmlnaHQtYmFja1wiID8gXCLlj7PlkI7mlrlcIiA6IFwi5bem5ZCO5pa5XCI7XG4gICAgdmlzaWJpbGl0eUNvbnN0cmFpbnRzLnB1c2goXG4gICAgICBg55u45py65b+F6aG757uV5Yiw6Zu25bqm5Z+65YeG55qEJHtvcmJpdERpcmVjdGlvbn3vvIzlvaLmiJDku6XlkI7lkJHmipXlvbHkuLrkuLvnmoTnnJ/lrp7lm5vliIbkuYvkuInop4bop5LvvJvova7lu5Plkozpga7mjKHmjInkuLvkvZPnsbvliKvph43lu7rjgIJgXG4gICAgKTtcbiAgICBvY2NsdXNpb25Db25zdHJhaW50cy5wdXNoKFxuICAgICAgXCLpm7bluqbmraPpnaLmipXlvbHlv4XpobvmmI7mmL7pgIDpmpDvvIzkuI3lvpfpgJrov4fplZzlg4/jgIHotLTlm77miJbkv53nlZnljp/ova7lu5PmnaXlgYfoo4XlkI7mlrnmnLrkvY3jgIJcIlxuICAgICk7XG4gIH1cblxuICBpZiAoXG4gICAgaW5wdXQuZWxldmF0aW9uS2V5ID09PSBcImVsZXZhdGVkXCIgfHxcbiAgICBpbnB1dC5lbGV2YXRpb25LZXkgPT09IFwiaGlnaC1hbmdsZVwiIHx8XG4gICAgaW5wdXQuZWxldmF0aW9uS2V5ID09PSBcIm5lYXItdG9wXCJcbiAgKSB7XG4gICAgdmlzaWJpbGl0eUNvbnN0cmFpbnRzLnB1c2goXG4gICAgICBcIuebruagh+mrmOacuuS9jeW/hemhu+WinuWKoOS7juS4iuaWueecn+WunuWPr+ingeeahOi9ruW7k+OAgemDqOS7tuOAgeWMuuWfn+OAgeadkOi0qOS4juagh+iusO+8m+WFt+S9k+e7k+aehOWQjeensOeUseivhuWbvuaooeWei+aMieS4u+S9k+exu+WIq+WSjOWOn+WbvuS6i+WunueUn+aIkO+8jOS4jemihOiuvuS7u+S9leexu+WIq+S4k+Wxnue7k+aehOaIluazm+WMluihqOmdouOAglwiXG4gICAgKTtcbiAgICBvY2NsdXNpb25Db25zdHJhaW50cy5wdXNoKFxuICAgICAgXCLku4Xku47kuIvmlrnmnLrkvY3miY3lj6/op4HnmoTnnJ/lrp7ova7lu5PkuI7nu5PmnoTlv4Xpobvlh4/lsJHlj6/op4HmgKfvvIzlubblvaLmiJDnrKblkIjkvZPnp6/nmoTpga7mjKHlkozpgI/op4bnvKnnn63jgIJcIlxuICAgICk7XG4gICAgcGVyc3BlY3RpdmVDdWVzLnB1c2goXG4gICAgICBpbnB1dC5lbGV2YXRpb25LZXkgPT09IFwibmVhci10b3BcIlxuICAgICAgICA/IFwi5L2/55So5piO56Gu55qE6L+R6aG26KeG6YCP6KeG77ya5LuO5LiK5pa55Y+v6KeB55qE55yf5a6e57uT5p6E5Y2g5Li75a+877yM5Z6C55u06auY5bqm5pi+6JGX5Y6L57yp77yM5L2G5Li75L2T5LuN5L+d5oyB55yf5a6e5L2T56ev44CCXCJcbiAgICAgICAgOiBcIuS9v+eUqOaYjuehrueahOmrmOacuuS9jeWQkeS4i+inguWvn+mAj+inhu+8muS7juS4iuaWueWPr+ingeeahOecn+Wunue7k+aehOaJqeWxle+8jOS7juS4i+aWueWPr+ingeeahOecn+Wunue7k+aehOWOi+e8qe+8jOepuumXtOa3seW6puespuWQiOS/r+inhuebuOacuuOAglwiXG4gICAgKTtcbiAgfSBlbHNlIGlmIChcbiAgICBpbnB1dC5lbGV2YXRpb25LZXkgPT09IFwibG93LWFuZ2xlXCIgfHxcbiAgICBpbnB1dC5lbGV2YXRpb25LZXkgPT09IFwibmVhci1ib3R0b21cIlxuICApIHtcbiAgICB2aXNpYmlsaXR5Q29uc3RyYWludHMucHVzaChcbiAgICAgIFwi55uu5qCH5L2O5py65L2N5b+F6aG75aKe5Yqg5LuO5LiL5pa555yf5a6e5Y+v6KeB55qE6L2u5buT44CB6YOo5Lu244CB5Yy65Z+f44CB5p2Q6LSo5LiO5qCH6K6w77yb5YW35L2T57uT5p6E5ZCN56ew55Sx6K+G5Zu+5qih5Z6L5oyJ5Li75L2T57G75Yir5ZKM5Y6f5Zu+5LqL5a6e55Sf5oiQ77yM5LiN6aKE6K6+5Lu75L2V57G75Yir5LiT5bGe57uT5p6E5oiW5rOb5YyW6KGo6Z2i44CCXCJcbiAgICApO1xuICAgIG9jY2x1c2lvbkNvbnN0cmFpbnRzLnB1c2goXG4gICAgICBcIuS7heS7juS4iuaWueacuuS9jeaJjeWPr+ingeeahOecn+Wunui9ruW7k+S4jue7k+aehOW/hemhu+WHj+WwkeWPr+ingeaAp++8jOW5tuW9ouaIkOespuWQiOS9k+enr+eahOmBruaMoeWSjOmAj+inhue8qeefreOAglwiXG4gICAgKTtcbiAgICBwZXJzcGVjdGl2ZUN1ZXMucHVzaChcbiAgICAgIGlucHV0LmVsZXZhdGlvbktleSA9PT0gXCJuZWFyLWJvdHRvbVwiXG4gICAgICAgID8gXCLkvb/nlKjmmI7noa7nmoTov5HlupXop4bpgI/op4bvvJrku47kuIvmlrnlj6/op4HnmoTnnJ/lrp7nu5PmnoTljaDkuLvlr7zvvIzkuLvkvZPku47kuIvmlrnlkJHkuIrop4Llr5/vvIznpoHmraLkvKroo4XmiJDmma7pgJrlubPop4bjgIJcIlxuICAgICAgICA6IFwi5L2/55So5piO56Gu55qE5L2O5py65L2N5ZCR5LiK6KeC5a+f6YCP6KeG77ya5LuO5LiL5pa55Y+v6KeB55qE55yf5a6e57uT5p6E5omp5bGV77yM5LuO5LiK5pa55Y+v6KeB55qE55yf5a6e57uT5p6E5Y6L57yp77yM5Li75L2T5ZGI546w55yf5a6e5Luw5ouN5L2T56ev44CCXCJcbiAgICApO1xuICB9IGVsc2Uge1xuICAgIHBlcnNwZWN0aXZlQ3Vlcy5wdXNoKFxuICAgICAgXCLkv53mjIHlubPop4blr7nlupTnmoToh6rnhLbpgI/op4bvvIzkuI3lvpfliqDlhaXkuI7nm67moIfkv6/ku7Dnn5vnm77nmoTpobbop4bmiJblupXop4bnibnlvoHjgIJcIlxuICAgICk7XG4gIH1cblxuICBpZiAoaW5wdXQuZGlzdGFuY2VLZXkgPT09IFwid2lkZVwiKSB7XG4gICAgcGVyc3BlY3RpdmVDdWVzLnB1c2goXG4gICAgICBcIui/nOaZr+ehrOmqjOaUtu+8muaJp+ihjOecn+WuniBEb2xseSBPdXTvvIznhKbot53kuI3lj5jvvJvnm7jmnLrpgIDliLDlvZPliY3lnLrmma/lj6/miJDnq4vnmoTmmI7noa7ov5znq6/vvIzkvovlpoLmiL/pl7Tlj6bkuIDnq6/miJblhaXlj6PpmYTov5HjgILnu5PmnpzmmK/njq/looPlu7rnq4vplZzlpLTvvIznjq/looPlu7rorq7ljaDnlLvpnaIgNzAlIOiHsyA4NSXvvIzkuLvkvZPlrozmlbTljIXlm7Tnm5Llu7rorq7ljaDnlLvpnaLpq5jluqbnuqYgMTUlIOiHsyAzMCXvvIzkuI3lvpflj6rmiorov5Hmma/kuLvkvZPkuoznu7TnvKnlsI/lkI7otLTlm57ljp/og4zmma/jgIJcIlxuICAgICk7XG4gIH0gZWxzZSBpZiAoaW5wdXQuZGlzdGFuY2VLZXkgPT09IFwibWVkaXVtXCIpIHtcbiAgICBwZXJzcGVjdGl2ZUN1ZXMucHVzaChcbiAgICAgIFwi5Lit5pmv56Gs6aqM5pS277ya55u45py65L2N5LqO5Y+v6K+75Li75L2T5Li76KaB57uT5p6E55qE5Lit562J6Led56a777yM5Li75L2T5YyF5Zu055uS5bu66K6u5Y2g55S76Z2i6auY5bqm57qmIDQwJSDoh7MgNjAl77yM5ZCM5pe25L+d55WZ6Laz5aSf546v5aKD5L+h5oGv5LiO55yf5a6e56m66Ze057q15rex77yb5YW35L2T6KOB5YiH6L6555WM55Sx6K+G5Zu+5qih5Z6L5oyJ5Li75L2T57G75Yir5ZKM5Y6f5Zu+57uT5p6E57uZ5Ye644CCXCJcbiAgICApO1xuICB9IGVsc2Uge1xuICAgIHBlcnNwZWN0aXZlQ3Vlcy5wdXNoKFxuICAgICAgXCLnibnlhpnnoazpqozmlLbvvJrmiafooYznnJ/lrp4gRG9sbHkgSW7vvIznhKbot53kuI3lj5jvvJvkuLvkvZPlhbPplK7nu4boioLljaDnlLvpnaLkuLvlr7zvvIzljIXlm7Tnm5LmiJbmoLjlv4Pnu5PmnoTlu7rorq7ljaDnlLvpnaLnn63ovrnnuqYgNzAlIOiHsyA5MCXjgILov5HlpKfov5zlsI/jgIHliY3lkI7pga7mjKHjgIHog4zmma/op4blt67lkozmma/mt7Hlv4Xpobvpmo/nm7jmnLrliY3np7vlop7lvLrvvJvlhYHorrjlkIjnkIboo4HliIfmrKHopoHovrnnvJjvvIzkvYbkuI3lvpflj6rmmK/mlbDlrZfmlL7lpKfjgIJcIlxuICAgICk7XG4gIH1cblxuICBpZiAoTWF0aC5hYnMoaW5wdXQucm9sbERlZ3JlZXMpIDwgMC41KSB7XG4gICAgcGVyc3BlY3RpdmVDdWVzLnB1c2goXG4gICAgICBcIuS/neaMgeWOn+WbvumbtuW6puWfuuWHhueahOWcsOW5s+e6vyBSb2xs77yM5LiN5b6X6Ieq6KGM5YC+5pac55S76Z2i44CCXCJcbiAgICApO1xuICB9IGVsc2Uge1xuICAgIGNvbnN0IGRpcmVjdGlvbiA9IGlucHV0LnJvbGxEZWdyZWVzID4gMCA/IFwi6aG65pe26ZKIXCIgOiBcIumAhuaXtumSiFwiO1xuICAgIHBlcnNwZWN0aXZlQ3Vlcy5wdXNoKFxuICAgICAgYOebuOacuueUu+ahhue7leWFiei9tCR7ZGlyZWN0aW9ufea7mui9rCAke2Zvcm1hdERlZ3JlZXNaaChNYXRoLmFicyhpbnB1dC5yb2xsRGVncmVlcykpfe+8m+W/hemhu+aUueWPmOaVtOW5heeUu+mdoueahOWcsOW5s+e6v+S4juaehOWbvuaWueWQke+8jOS4jeW+l+WPquWvueS4u+S9k+WxgOmDqOWBmuS6jOe7tOWAvuaWnOOAgmBcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICB2aXNpYmlsaXR5Q29uc3RyYWludHMsXG4gICAgb2NjbHVzaW9uQ29uc3RyYWludHMsXG4gICAgcGVyc3BlY3RpdmVDdWVzLFxuICAgIGZvcmJpZGRlblNob3J0Y3V0c1xuICB9O1xufVxuXG5mdW5jdGlvbiBidWlsZERldGVybWluaXN0aWNDYW1lcmFQcm9tcHRaaChcbiAgcG9zZTogU2luZ2xlSW1hZ2VDYW1lcmFQb3NlLFxuICBwcm9tcHQ6IE9taXQ8U2luZ2xlSW1hZ2VDYW1lcmFQcm9tcHQsIFwiZGV0ZXJtaW5pc3RpY1Byb21wdFpoXCI+ICYge1xuICAgIGRldGVybWluaXN0aWNQcm9tcHRaaDogc3RyaW5nO1xuICB9XG4pIHtcbiAgcmV0dXJuIFtcbiAgICBcIuOAkOacgOmrmOS8mOWFiOe6p++8muWFiOaJp+ihjOebruagh+ebuOacuumHjeaKleW9seOAkVwiLFxuICAgIFwi44CQ6ZSB5a6a55u45py65Y2P6K6u772c5pyN5Yqh56uv56Gu5a6a5oCn55Sf5oiQ77yM56aB5q2i5pS55YaZ44CRXCIsXG4gICAgU0lOR0xFX0lNQUdFX0NBTUVSQV9QUk9UT0NPTF9NQVJLRVIsXG4gICAgXCIxLiDljp/lm77pm7bluqbln7rlh4bvvJrovpPlhaXljp/lm77nmoTmi43mkYTmnLrkvY3lrprkuYnkuLogWFlaPTDCsOOAguWbvuWDj+WPquaPkOS+m+WQjOS4gOS4u+S9k+S4juWcuuaZr+eahOS4iee7tOS6i+Wunu+8jOS4jemUgeWumuS7u+S9lea6kOWbvuS6jOe7tOWDj+e0oOWdkOagh+OAgeWxj+W5lei9ruW7k+OAgeWxj+W5leacneWQkeaIluWxj+W5leaKleW9seOAglhZWiDmjqfliLbnm7jmnLrlm7Tnu5XlkIzkuIDnjrDlrp7nnqzpl7Tnp7vliqjvvIzkuI3mmK/lr7nljp/lm77lgZrkuoznu7Tml4vovazjgILnm7jmnLrliLDovr7nm67moIfmnLrkvY3lkI7vvIzlup/lvIPmupDlm77kuoznu7TmnoTlm77vvIzlubbku47mlrDmnLrkvY3ph43mlrDorqHnrpfmlbTluYXnlLvpnaLnmoTmipXlvbHmlrnlkJHjgIHova7lu5PjgIHmipXlvbHlrr3luqbjgIHlj6/op4HljLrln5/jgIHpga7mjKHpobrluo/jgIHlnLDlubPnur/kuI7og4zmma/op4blt67jgIJcIixcbiAgICBcIjEuMSDmnIDnu4jkuoznu7TmnJ3lkJHop4TliJnvvJrnm67moIfnm7jmnLrmlLnlj5jlkI7vvIzlhYHorrjkuJTlv4XpobvmlLnlj5jkuLvkvZPlnKjmnIDnu4jnlLvpnaLkuK3nmoTlj6/op4HmnJ3lkJHkuI7mipXlvbHjgILkuLvkvZPouqvku73jgIHliqjkvZzkuovku7bmiJboo4XphY3lhbPns7vov57nu63vvIzlj6rooajnpLrku43mmK/lkIzkuIDnjrDlrp7lhoXlrrnvvJvnu53kuI3ooajnpLrkv53nlZnljp/lm77mraPpnaLjgIHkvqfpnaLjgIHova7lu5PmiJblsY/luZXmnJ3lkJHjgIJcIixcbiAgICBgMi4g56a75pWj55uu5qCH6KeG6KeS77yaJHtwcm9tcHQuYXppbXV0aExhYmVsWmh9ICsgJHtwcm9tcHQuZWxldmF0aW9uTGFiZWxaaH0gKyAke3Byb21wdC5kaXN0YW5jZUxhYmVsWmh944CCYCxcbiAgICBgMy4g57K+56Gu55u45py65pa55ZCR77ya5pa55L2N6KeSICR7Zm9ybWF0U2lnbmVkRGVncmVlc1poKHByb21wdC5jYW1lcmFBemltdXRoRGVncmVlcyl977yI5rK/5rC05bmz6L2o6YGT5ZCR5Z+65YeG55S76Z2i5Y+z5pa5546v57uV5Li65q2j77yJ77yM5L+v5Luw6KeSICR7Zm9ybWF0U2lnbmVkRGVncmVlc1poKHByb21wdC5jYW1lcmFFbGV2YXRpb25EZWdyZWVzKX3vvIjnm7jmnLrljYfpq5jkuLrmraPvvInjgILmlrnkvY3kuI7kv6/ku7DnlLHmnIDnu4ggWVhaIOWbm+WFg+aVsOaXi+i9rOWfuuWHhuebuOacuuWQkemHj+WQjuiuoeeul++8jOS4jeW+l+ebtOaOpeaMieWNleS4gCBYL1kg5o6n5Yi25YC854yc5rWL44CCYCxcbiAgICBgNC4g5Y6f5aeL57Sv6K6h5o6n5Yi25YC877yaWD0ke2Zvcm1hdFNpZ25lZERlZ3JlZXNaaChwb3NlLmN1bXVsYXRpdmVEZWdyZWVzLngpfe+8jFk9JHtmb3JtYXRTaWduZWREZWdyZWVzWmgocG9zZS5jdW11bGF0aXZlRGVncmVlcy55KX3vvIxaPSR7Zm9ybWF0U2lnbmVkRGVncmVlc1poKHBvc2UuY3VtdWxhdGl2ZURlZ3JlZXMueil977yb562J5Lu35ZGo5pyf5ae/5oCB5Li6IFg9JHtmb3JtYXRTaWduZWREZWdyZWVzWmgocG9zZS5ub3JtYWxpemVkRGVncmVlcy54KX3vvIxZPSR7Zm9ybWF0U2lnbmVkRGVncmVlc1poKHBvc2Uubm9ybWFsaXplZERlZ3JlZXMueSl977yMWj0ke2Zvcm1hdFNpZ25lZERlZ3JlZXNaaChwb3NlLm5vcm1hbGl6ZWREZWdyZWVzLnopfe+8jOasp+aLiemhuuW6jyBZWFrjgIJgLFxuICAgIGA1LiBSb2xs77yaJHtwcm9tcHQucm9sbExhYmVsWmh944CCUm9sbCDlj6rmjqfliLbnm7jmnLrlhYnovbTkuI7lnLDlubPnur/vvJvmma7pgJogWWF3L1BpdGNoIOeOr+e7leS4jeW+l+aUueWPmCBSb2xs44CCYCxcbiAgICBgNi4g5pmv5Yir77yaJHtwcm9tcHQuZGlzdGFuY2VMYWJlbFpofe+8jOi3neemu+aOp+WItuWAvCAke3Byb21wdC5jYW1lcmFEaXN0YW5jZS50b0ZpeGVkKDEpfS8xMOOAguS/neaMgeS4u+S9k+WwuuW6puS4juivpeaZr+WIq+S4gOiHtOOAgmAsXG4gICAgXCI3LiDnm67moIfmnLrkvY3kuIvlv4XpobvlvaLmiJDnmoTnlLvpnaLmipXlvbHvvJpcIixcbiAgICAuLi5wcm9tcHQucmVxdWlyZWRWaXNpYmxlU3VyZmFjZXMubWFwKChpdGVtKSA9PiBgLSAke2l0ZW19YCksXG4gICAgXCI4LiDnm67moIfmnLrkvY3kuIvlv4Xpobvlj5HnlJ/nmoTpga7mjKHlj5jljJbvvJpcIixcbiAgICAuLi5wcm9tcHQucmVxdWlyZWRPY2NsdWRlZFN1cmZhY2VzLm1hcCgoaXRlbSkgPT4gYC0gJHtpdGVtfWApLFxuICAgIFwiOS4g6YCP6KeG5LiO5Zyw5bmz57q/57qm5p2f77yaXCIsXG4gICAgLi4ucHJvbXB0LnBlcnNwZWN0aXZlQ29uc3RyYWludHMubWFwKChpdGVtKSA9PiBgLSAke2l0ZW19YCksXG4gICAgXCIxMC4g6YeN5paw5oiQ5YOP6KeE5YiZ77yaXCIsXG4gICAgLi4ucHJvbXB0LmZvcmJpZGRlblNob3J0Y3V0cy5tYXAoKGl0ZW0pID0+IGAtICR7aXRlbX1gKVxuICBdLmpvaW4oXCJcXG5cIik7XG59XG5cbmZ1bmN0aW9uIGRlc2NyaWJlUm9sbFpoKHZhbHVlOiBudW1iZXIpIHtcbiAgaWYgKE1hdGguYWJzKHZhbHVlKSA8IDAuNSkge1xuICAgIHJldHVybiBcIlJvbGwgMMKw77yM5Zyw5bmz57q/5L+d5oyB6Zu25bqm5Z+65YeGXCI7XG4gIH1cblxuICByZXR1cm4gYFJvbGwgJHtmb3JtYXRTaWduZWREZWdyZWVzWmgodmFsdWUpfe+8jOeUu+ahhuebuOWvueWOn+WbviR7dmFsdWUgPiAwID8gXCLpobrml7bpkohcIiA6IFwi6YCG5pe26ZKIXCJ95rua6L2sYDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhbGN1bGF0ZVNpbmdsZUltYWdlT3V0cHV0U2l6ZShcbiAgd2lkdGg6IG51bWJlcixcbiAgaGVpZ2h0OiBudW1iZXIsXG4gIGxvbmdFZGdlID0gMjA0OFxuKSB7XG4gIGNvbnN0IHNhZmVXaWR0aCA9IE51bWJlci5pc0Zpbml0ZSh3aWR0aCkgJiYgd2lkdGggPiAwID8gd2lkdGggOiAxO1xuICBjb25zdCBzYWZlSGVpZ2h0ID0gTnVtYmVyLmlzRmluaXRlKGhlaWdodCkgJiYgaGVpZ2h0ID4gMCA/IGhlaWdodCA6IDE7XG4gIGNvbnN0IHNhZmVMb25nRWRnZSA9IE1hdGgubWF4KDEwMjQsIE1hdGgubWluKDM4NDAsIGxvbmdFZGdlKSk7XG4gIGNvbnN0IGFzcGVjdCA9IE1hdGgubWluKDMsIE1hdGgubWF4KDEgLyAzLCBzYWZlV2lkdGggLyBzYWZlSGVpZ2h0KSk7XG4gIGxldCBvdXRwdXRXaWR0aDogbnVtYmVyO1xuICBsZXQgb3V0cHV0SGVpZ2h0OiBudW1iZXI7XG5cbiAgaWYgKGFzcGVjdCA+PSAxKSB7XG4gICAgb3V0cHV0V2lkdGggPSByb3VuZFRvTXVsdGlwbGUoc2FmZUxvbmdFZGdlLCAxNik7XG4gICAgb3V0cHV0SGVpZ2h0ID0gcm91bmRUb011bHRpcGxlKHNhZmVMb25nRWRnZSAvIGFzcGVjdCwgMTYpO1xuICB9IGVsc2Uge1xuICAgIG91dHB1dEhlaWdodCA9IHJvdW5kVG9NdWx0aXBsZShzYWZlTG9uZ0VkZ2UsIDE2KTtcbiAgICBvdXRwdXRXaWR0aCA9IHJvdW5kVG9NdWx0aXBsZShzYWZlTG9uZ0VkZ2UgKiBhc3BlY3QsIDE2KTtcbiAgfVxuXG4gIHJldHVybiBgJHtNYXRoLm1heCgxNiwgb3V0cHV0V2lkdGgpfXgke01hdGgubWF4KDE2LCBvdXRwdXRIZWlnaHQpfWA7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVVuc2lnbmVkRGVncmVlcyh2YWx1ZTogbnVtYmVyKSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSAoKHZhbHVlICUgMzYwKSArIDM2MCkgJSAzNjA7XG5cbiAgcmV0dXJuIE9iamVjdC5pcyhub3JtYWxpemVkLCAtMCkgPyAwIDogbm9ybWFsaXplZDtcbn1cblxuZnVuY3Rpb24gcXVhdGVybmlvbkZyb21BeGlzQW5nbGUoXG4gIGF4aXM6IHsgeDogbnVtYmVyOyB5OiBudW1iZXI7IHo6IG51bWJlciB9LFxuICByYWRpYW5zOiBudW1iZXJcbik6IFZpZXdwb2ludFF1YXRlcm5pb24ge1xuICBjb25zdCBoYWxmID0gcmFkaWFucyAvIDI7XG4gIGNvbnN0IHNpbmUgPSBNYXRoLnNpbihoYWxmKTtcblxuICByZXR1cm4ge1xuICAgIHg6IGF4aXMueCAqIHNpbmUsXG4gICAgeTogYXhpcy55ICogc2luZSxcbiAgICB6OiBheGlzLnogKiBzaW5lLFxuICAgIHc6IE1hdGguY29zKGhhbGYpXG4gIH07XG59XG5cbmZ1bmN0aW9uIG11bHRpcGx5UXVhdGVybmlvbnMoXG4gIGxlZnQ6IFZpZXdwb2ludFF1YXRlcm5pb24sXG4gIHJpZ2h0OiBWaWV3cG9pbnRRdWF0ZXJuaW9uXG4pOiBWaWV3cG9pbnRRdWF0ZXJuaW9uIHtcbiAgcmV0dXJuIHtcbiAgICB4OlxuICAgICAgbGVmdC53ICogcmlnaHQueCArXG4gICAgICBsZWZ0LnggKiByaWdodC53ICtcbiAgICAgIGxlZnQueSAqIHJpZ2h0LnogLVxuICAgICAgbGVmdC56ICogcmlnaHQueSxcbiAgICB5OlxuICAgICAgbGVmdC53ICogcmlnaHQueSAtXG4gICAgICBsZWZ0LnggKiByaWdodC56ICtcbiAgICAgIGxlZnQueSAqIHJpZ2h0LncgK1xuICAgICAgbGVmdC56ICogcmlnaHQueCxcbiAgICB6OlxuICAgICAgbGVmdC53ICogcmlnaHQueiArXG4gICAgICBsZWZ0LnggKiByaWdodC55IC1cbiAgICAgIGxlZnQueSAqIHJpZ2h0LnggK1xuICAgICAgbGVmdC56ICogcmlnaHQudyxcbiAgICB3OlxuICAgICAgbGVmdC53ICogcmlnaHQudyAtXG4gICAgICBsZWZ0LnggKiByaWdodC54IC1cbiAgICAgIGxlZnQueSAqIHJpZ2h0LnkgLVxuICAgICAgbGVmdC56ICogcmlnaHQuelxuICB9O1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVRdWF0ZXJuaW9uKFxuICBxdWF0ZXJuaW9uOiBWaWV3cG9pbnRRdWF0ZXJuaW9uXG4pOiBWaWV3cG9pbnRRdWF0ZXJuaW9uIHtcbiAgY29uc3QgbWFnbml0dWRlID0gTWF0aC5oeXBvdChcbiAgICBxdWF0ZXJuaW9uLngsXG4gICAgcXVhdGVybmlvbi55LFxuICAgIHF1YXRlcm5pb24ueixcbiAgICBxdWF0ZXJuaW9uLndcbiAgKTtcblxuICBpZiAoIU51bWJlci5pc0Zpbml0ZShtYWduaXR1ZGUpIHx8IG1hZ25pdHVkZSA9PT0gMCkge1xuICAgIHJldHVybiB7IHg6IDAsIHk6IDAsIHo6IDAsIHc6IDEgfTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgeDogY2xlYW5GbG9hdChxdWF0ZXJuaW9uLnggLyBtYWduaXR1ZGUpLFxuICAgIHk6IGNsZWFuRmxvYXQocXVhdGVybmlvbi55IC8gbWFnbml0dWRlKSxcbiAgICB6OiBjbGVhbkZsb2F0KHF1YXRlcm5pb24ueiAvIG1hZ25pdHVkZSksXG4gICAgdzogY2xlYW5GbG9hdChxdWF0ZXJuaW9uLncgLyBtYWduaXR1ZGUpXG4gIH07XG59XG5cbmZ1bmN0aW9uIHJvdGF0ZVZlY3RvckJ5UXVhdGVybmlvbihcbiAgdmVjdG9yOiB7IHg6IG51bWJlcjsgeTogbnVtYmVyOyB6OiBudW1iZXIgfSxcbiAgcXVhdGVybmlvbjogVmlld3BvaW50UXVhdGVybmlvblxuKSB7XG4gIGNvbnN0IGRvdCA9XG4gICAgcXVhdGVybmlvbi54ICogdmVjdG9yLnggK1xuICAgIHF1YXRlcm5pb24ueSAqIHZlY3Rvci55ICtcbiAgICBxdWF0ZXJuaW9uLnogKiB2ZWN0b3IuejtcbiAgY29uc3QgcXVhdGVybmlvbkxlbmd0aCA9XG4gICAgcXVhdGVybmlvbi54ICoqIDIgKyBxdWF0ZXJuaW9uLnkgKiogMiArIHF1YXRlcm5pb24ueiAqKiAyO1xuICBjb25zdCBjcm9zcyA9IHtcbiAgICB4OiBxdWF0ZXJuaW9uLnkgKiB2ZWN0b3IueiAtIHF1YXRlcm5pb24ueiAqIHZlY3Rvci55LFxuICAgIHk6IHF1YXRlcm5pb24ueiAqIHZlY3Rvci54IC0gcXVhdGVybmlvbi54ICogdmVjdG9yLnosXG4gICAgejogcXVhdGVybmlvbi54ICogdmVjdG9yLnkgLSBxdWF0ZXJuaW9uLnkgKiB2ZWN0b3IueFxuICB9O1xuXG4gIHJldHVybiB7XG4gICAgeDpcbiAgICAgIDIgKiBkb3QgKiBxdWF0ZXJuaW9uLnggK1xuICAgICAgKHF1YXRlcm5pb24udyAqKiAyIC0gcXVhdGVybmlvbkxlbmd0aCkgKiB2ZWN0b3IueCArXG4gICAgICAyICogcXVhdGVybmlvbi53ICogY3Jvc3MueCxcbiAgICB5OlxuICAgICAgMiAqIGRvdCAqIHF1YXRlcm5pb24ueSArXG4gICAgICAocXVhdGVybmlvbi53ICoqIDIgLSBxdWF0ZXJuaW9uTGVuZ3RoKSAqIHZlY3Rvci55ICtcbiAgICAgIDIgKiBxdWF0ZXJuaW9uLncgKiBjcm9zcy55LFxuICAgIHo6XG4gICAgICAyICogZG90ICogcXVhdGVybmlvbi56ICtcbiAgICAgIChxdWF0ZXJuaW9uLncgKiogMiAtIHF1YXRlcm5pb25MZW5ndGgpICogdmVjdG9yLnogK1xuICAgICAgMiAqIHF1YXRlcm5pb24udyAqIGNyb3NzLnpcbiAgfTtcbn1cblxuZnVuY3Rpb24gZGVncmVlc1RvUmFkaWFucyh2YWx1ZTogbnVtYmVyKSB7XG4gIHJldHVybiAodmFsdWUgKiBNYXRoLlBJKSAvIDE4MDtcbn1cblxuZnVuY3Rpb24gcmFkaWFuc1RvRGVncmVlcyh2YWx1ZTogbnVtYmVyKSB7XG4gIHJldHVybiAodmFsdWUgKiAxODApIC8gTWF0aC5QSTtcbn1cblxuZnVuY3Rpb24gcm91bmRUb011bHRpcGxlKHZhbHVlOiBudW1iZXIsIG11bHRpcGxlOiBudW1iZXIpIHtcbiAgcmV0dXJuIE1hdGgucm91bmQodmFsdWUgLyBtdWx0aXBsZSkgKiBtdWx0aXBsZTtcbn1cblxuZnVuY3Rpb24gY2xlYW5GbG9hdCh2YWx1ZTogbnVtYmVyKSB7XG4gIHJldHVybiBNYXRoLmFicyh2YWx1ZSkgPCAxZS0xMiA/IDAgOiB2YWx1ZTtcbn1cblxuZnVuY3Rpb24gY2xlYW5EaXNwbGF5QW5nbGUodmFsdWU6IG51bWJlcikge1xuICBjb25zdCByb3VuZGVkID0gTWF0aC5yb3VuZCh2YWx1ZSAqIDEwMCkgLyAxMDA7XG5cbiAgcmV0dXJuIE9iamVjdC5pcyhyb3VuZGVkLCAtMCkgPyAwIDogcm91bmRlZDtcbn1cblxuZnVuY3Rpb24gZm9ybWF0RGVncmVlc1poKHZhbHVlOiBudW1iZXIpIHtcbiAgcmV0dXJuIGAke01hdGguYWJzKHZhbHVlKS50b0ZpeGVkKDIpfcKwYDtcbn1cblxuZnVuY3Rpb24gZm9ybWF0U2lnbmVkRGVncmVlc1poKHZhbHVlOiBudW1iZXIpIHtcbiAgY29uc3QgY2xlYW4gPSBjbGVhbkRpc3BsYXlBbmdsZSh2YWx1ZSk7XG5cbiAgcmV0dXJuIGAke2NsZWFuID4gMCA/IFwiK1wiIDogXCJcIn0ke2NsZWFuLnRvRml4ZWQoMil9wrBgO1xufVxuIl0sIm1hcHBpbmdzIjoiQUFFTyxhQUFNLDRCQUE0QjtBQUNsQyxhQUFNLDRCQUE0QjtBQUNsQyxhQUFNLG1DQUFtQztBQUN6QyxhQUFNLG1DQUFtQztBQUN6QyxhQUFNLHVDQUF1QztBQUM3QyxhQUFNLHVDQUF1QztBQUM3QyxhQUFNLG1DQUFtQztBQUN6QyxhQUFNLHNDQUNYO0FBTUYsTUFBTSwrQ0FDSjtBQUVGLE1BQU0sOENBQ0o7QUFFSyxnQkFBUyw4QkFDZCxRQUN1QztBQUN2QyxNQUFJLDZDQUE2QyxLQUFLLE1BQU0sR0FBRztBQUM3RCxXQUFPO0FBQUEsRUFDVDtBQUVBLE1BQUksNENBQTRDLEtBQUssTUFBTSxHQUFHO0FBQzVELFdBQU87QUFBQSxFQUNUO0FBRUEsU0FBTztBQUNUO0FBdUpPLGFBQU0sZ0NBQWdDO0FBQUEsRUFDM0Msa0JBQWtCLEtBQUssT0FBTztBQUFBLEVBQzlCLGlCQUFpQixLQUFLLE9BQU87QUFBQSxFQUM3QixzQkFBc0IsS0FBSyxPQUFPO0FBQUEsRUFDbEMsb0JBQW9CLEtBQUssT0FBTztBQUNsQztBQUVPLGdCQUFTLDhCQUE4QixPQUFlO0FBQzNELE1BQUksQ0FBQyxPQUFPLFNBQVMsS0FBSyxHQUFHO0FBQzNCLFdBQU87QUFBQSxFQUNUO0FBRUEsU0FBTyxLQUFLO0FBQUEsSUFDVjtBQUFBLElBQ0EsS0FBSyxJQUFJLDJCQUEyQixLQUFLO0FBQUEsRUFDM0M7QUFDRjtBQUVPLGdCQUFTLGtDQUFrQyxPQUFlO0FBQy9ELE1BQUksQ0FBQyxPQUFPLFNBQVMsS0FBSyxHQUFHO0FBQzNCLFdBQU87QUFBQSxFQUNUO0FBRUEsUUFBTSxlQUFlLFFBQVEsT0FBTyxNQUFNLE9BQU8sTUFBTTtBQUN2RCxRQUFNLFNBQVMsZUFBZSxPQUFPLE1BQU07QUFFM0MsU0FBTyxPQUFPLEdBQUcsUUFBUSxFQUFFLElBQUksSUFBSTtBQUNyQztBQUVPLGdCQUFTLG1DQUNkLHFCQUNBLG9CQUNBO0FBQ0EsTUFBSSxRQUNGLHlCQUF5QixrQkFBa0IsSUFDM0MseUJBQXlCLG1CQUFtQjtBQUU5QyxNQUFJLFFBQVEsS0FBSztBQUNmLGFBQVM7QUFBQSxFQUNYLFdBQVcsUUFBUSxNQUFNO0FBQ3ZCLGFBQVM7QUFBQSxFQUNYO0FBRUEsU0FBTyxPQUFPLEdBQUcsT0FBTyxFQUFFLElBQUksSUFBSTtBQUNwQztBQUVPLGdCQUFTLDhCQUNkLGlCQUNBLHFCQUNBLG9CQUNBO0FBQ0EsU0FBTztBQUFBLElBQ0wsa0JBQ0U7QUFBQSxNQUNFO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFBQSxFQUNKO0FBQ0Y7QUFFTyxnQkFBUywrQkFBK0IsT0FBZTtBQUM1RCxNQUFJLENBQUMsT0FBTyxTQUFTLEtBQUssR0FBRztBQUMzQixXQUFPO0FBQUEsRUFDVDtBQUVBLFNBQU8sS0FBSztBQUFBLElBQ1Y7QUFBQSxJQUNBLEtBQUssSUFBSSxrQ0FBa0MsS0FBSztBQUFBLEVBQ2xEO0FBQ0Y7QUFFTyxnQkFBUywyQkFDZCxVQUN1QjtBQUN2QixRQUFNLG9CQUFvQjtBQUFBLElBQ3hCLEdBQUcsOEJBQThCLFNBQVMsQ0FBQztBQUFBLElBQzNDLEdBQUcsOEJBQThCLFNBQVMsQ0FBQztBQUFBLElBQzNDLEdBQUcsOEJBQThCLFNBQVMsQ0FBQztBQUFBLEVBQzdDO0FBQ0EsUUFBTSxvQkFBb0I7QUFBQSxJQUN4QixHQUFHLGtDQUFrQyxrQkFBa0IsQ0FBQztBQUFBLElBQ3hELEdBQUcsa0NBQWtDLGtCQUFrQixDQUFDO0FBQUEsSUFDeEQsR0FBRyxrQ0FBa0Msa0JBQWtCLENBQUM7QUFBQSxFQUMxRDtBQUNBLFFBQU0sUUFBUTtBQUFBLElBQ1osRUFBRSxHQUFHLEdBQUcsR0FBRyxHQUFHLEdBQUcsRUFBRTtBQUFBLElBQ25CLGlCQUFpQixrQkFBa0IsQ0FBQztBQUFBLEVBQ3RDO0FBQ0EsUUFBTSxNQUFNO0FBQUEsSUFDVixFQUFFLEdBQUcsR0FBRyxHQUFHLEdBQUcsR0FBRyxFQUFFO0FBQUEsSUFDbkIsaUJBQWlCLENBQUMsa0JBQWtCLENBQUM7QUFBQSxFQUN2QztBQUNBLFFBQU0sT0FBTztBQUFBLElBQ1gsRUFBRSxHQUFHLEdBQUcsR0FBRyxHQUFHLEdBQUcsRUFBRTtBQUFBLElBQ25CLGlCQUFpQixrQkFBa0IsQ0FBQztBQUFBLEVBQ3RDO0FBRUEsU0FBTztBQUFBLElBQ0w7QUFBQSxJQUNBO0FBQUEsSUFDQSxZQUFZO0FBQUEsTUFDVixvQkFBb0Isb0JBQW9CLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUMzRDtBQUFBLElBQ0EsWUFBWTtBQUFBLElBQ1osa0JBQWtCO0FBQUEsRUFDcEI7QUFDRjtBQUVPLGdCQUFTLDZCQUNkLFVBQ0EsaUJBQWlCLHNDQUNRO0FBQ3pCLFFBQU0sT0FBTywyQkFBMkIsUUFBUTtBQUNoRCxRQUFNLFlBQVksaUNBQWlDLElBQUk7QUFDdkQsUUFBTSxXQUFXLCtCQUErQixjQUFjO0FBQzlELFFBQU0sVUFBVSxzQkFBc0IsVUFBVSxPQUFPO0FBQ3ZELFFBQU0sWUFBWSx3QkFBd0IsVUFBVSxTQUFTO0FBQzdELFFBQU0sZ0JBQWdCLHVCQUF1QixRQUFRO0FBQ3JELFFBQU0sY0FBYyw0QkFBNEI7QUFBQSxJQUM5QyxZQUFZLFFBQVE7QUFBQSxJQUNwQixjQUFjLFVBQVU7QUFBQSxJQUN4QixhQUFhLGNBQWM7QUFBQSxJQUMzQixhQUFhLEtBQUssa0JBQWtCO0FBQUEsRUFDdEMsQ0FBQztBQUNELFFBQU0sY0FBYyxlQUFlLEtBQUssa0JBQWtCLENBQUM7QUFDM0QsUUFBTSxTQUFTO0FBQUEsSUFDYixzQkFBc0IsVUFBVTtBQUFBLElBQ2hDLHdCQUF3QixVQUFVO0FBQUEsSUFDbEMsbUJBQW1CLEtBQUssa0JBQWtCO0FBQUEsSUFDMUMsZ0JBQWdCO0FBQUEsSUFDaEIsWUFBWSxRQUFRO0FBQUEsSUFDcEIsY0FBYyxVQUFVO0FBQUEsSUFDeEIsYUFBYSxjQUFjO0FBQUEsSUFDM0IsZ0JBQWdCLFFBQVE7QUFBQSxJQUN4QixrQkFBa0IsVUFBVTtBQUFBLElBQzVCLGlCQUFpQixjQUFjO0FBQUEsSUFDL0I7QUFBQSxJQUNBLHlCQUF5QixZQUFZO0FBQUEsSUFDckMsMEJBQTBCLFlBQVk7QUFBQSxJQUN0Qyx3QkFBd0IsWUFBWTtBQUFBLElBQ3BDLG9CQUFvQixZQUFZO0FBQUEsSUFDaEMsdUJBQXVCO0FBQUEsRUFDekI7QUFFQSxTQUFPLHdCQUF3QjtBQUFBLElBQzdCO0FBQUEsSUFDQTtBQUFBLEVBQ0Y7QUFFQSxTQUFPO0FBQ1Q7QUFFTyxnQkFBUyx1Q0FDZCxNQUNBLGlCQUFpQixzQ0FDa0I7QUFDbkMsUUFBTSxTQUFTO0FBQUEsSUFDYixLQUFLO0FBQUEsSUFDTDtBQUFBLEVBQ0Y7QUFFQSxTQUFPO0FBQUEsSUFDTCxzQkFBc0I7QUFBQSxNQUNwQjtBQUFBLE1BQ0EsUUFBUSxPQUFPLGNBQWMsSUFBSSxPQUFPLGdCQUFnQixJQUFJLE9BQU8sZUFBZSxVQUFVLHNCQUFzQixPQUFPLG9CQUFvQixDQUFDLFVBQVUsc0JBQXNCLE9BQU8sc0JBQXNCLENBQUMsSUFBSSxPQUFPLFdBQVc7QUFBQSxJQUNwTztBQUFBLElBQ0EsdUJBQXVCLE9BQU87QUFBQSxJQUM5QixzQkFBc0IsT0FBTztBQUFBLElBQzdCLGlCQUFpQixPQUFPO0FBQUEsSUFDeEIsb0JBQW9CLE9BQU87QUFBQSxFQUM3QjtBQUNGO0FBRUEsU0FBUyxpQ0FBaUMsTUFBNkI7QUFDckUsUUFBTSxXQUFXO0FBQUEsSUFDZixFQUFFLEdBQUcsR0FBRyxHQUFHLEdBQUcsR0FBRyxHQUFHO0FBQUEsSUFDcEIsS0FBSztBQUFBLEVBQ1A7QUFDQSxRQUFNLG1CQUFtQixLQUFLLE1BQU0sU0FBUyxHQUFHLFNBQVMsQ0FBQztBQUMxRCxRQUFNLFVBQVU7QUFBQSxJQUNkLGlCQUFpQixLQUFLLE1BQU0sU0FBUyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUM7QUFBQSxFQUN0RDtBQUNBLFFBQU0sWUFBWTtBQUFBLElBQ2hCLEtBQUssTUFBTSxTQUFTLEdBQUcsZ0JBQWdCO0FBQUEsRUFDekM7QUFFQSxTQUFPO0FBQUEsSUFDTCxTQUFTLGtCQUFrQixPQUFPO0FBQUEsSUFDbEMsV0FBVyxrQkFBa0IsU0FBUztBQUFBLEVBQ3hDO0FBQ0Y7QUFFQSxTQUFTLHNCQUFzQixPQUc3QjtBQUNBLFFBQU0sUUFBUSxLQUFLLE9BQU8seUJBQXlCLEtBQUssSUFBSSxRQUFRLEVBQUUsSUFBSTtBQUMxRSxRQUFNLFVBQTJEO0FBQUEsSUFDL0QsRUFBRSxLQUFLLFNBQVMsT0FBTyxVQUFVO0FBQUEsSUFDakMsRUFBRSxLQUFLLGVBQWUsT0FBTyxVQUFVO0FBQUEsSUFDdkMsRUFBRSxLQUFLLFNBQVMsT0FBTyxTQUFTO0FBQUEsSUFDaEMsRUFBRSxLQUFLLGNBQWMsT0FBTyxVQUFVO0FBQUEsSUFDdEMsRUFBRSxLQUFLLFFBQVEsT0FBTyxVQUFVO0FBQUEsSUFDaEMsRUFBRSxLQUFLLGFBQWEsT0FBTyxVQUFVO0FBQUEsSUFDckMsRUFBRSxLQUFLLFFBQVEsT0FBTyxTQUFTO0FBQUEsSUFDL0IsRUFBRSxLQUFLLGNBQWMsT0FBTyxVQUFVO0FBQUEsRUFDeEM7QUFFQSxTQUFPLFFBQVEsS0FBSyxLQUFLLFFBQVEsQ0FBQztBQUNwQztBQUVBLFNBQVMsd0JBQXdCLE9BRy9CO0FBQ0EsTUFBSSxTQUFTLEtBQUs7QUFDaEIsV0FBTyxFQUFFLEtBQUssZUFBZSxPQUFPLFFBQVE7QUFBQSxFQUM5QztBQUVBLE1BQUksUUFBUSxLQUFLO0FBQ2YsV0FBTyxFQUFFLEtBQUssYUFBYSxPQUFPLFFBQVE7QUFBQSxFQUM1QztBQUVBLE1BQUksUUFBUSxJQUFJO0FBQ2QsV0FBTyxFQUFFLEtBQUssYUFBYSxPQUFPLEtBQUs7QUFBQSxFQUN6QztBQUVBLE1BQUksUUFBUSxJQUFJO0FBQ2QsV0FBTyxFQUFFLEtBQUssWUFBWSxPQUFPLFFBQVE7QUFBQSxFQUMzQztBQUVBLE1BQUksUUFBUSxJQUFJO0FBQ2QsV0FBTyxFQUFFLEtBQUssY0FBYyxPQUFPLEtBQUs7QUFBQSxFQUMxQztBQUVBLFNBQU8sRUFBRSxLQUFLLFlBQVksT0FBTyxRQUFRO0FBQzNDO0FBRUEsU0FBUyx1QkFBdUIsT0FHOUI7QUFDQSxNQUFJLFFBQVEsR0FBRztBQUNiLFdBQU8sRUFBRSxLQUFLLFFBQVEsT0FBTyxLQUFLO0FBQUEsRUFDcEM7QUFFQSxNQUFJLFFBQVEsR0FBRztBQUNiLFdBQU8sRUFBRSxLQUFLLFVBQVUsT0FBTyxLQUFLO0FBQUEsRUFDdEM7QUFFQSxTQUFPLEVBQUUsS0FBSyxZQUFZLE9BQU8sS0FBSztBQUN4QztBQUVBLFNBQVMsNEJBQTRCLE9BSytCO0FBQ2xFLFFBQU0sd0JBQWtDLENBQUM7QUFDekMsUUFBTSx1QkFBaUMsQ0FBQztBQUN4QyxRQUFNLGtCQUE0QixDQUFDO0FBQ25DLFFBQU0scUJBQXFCO0FBQUEsSUFDekI7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLEVBQ0Y7QUFFQSxNQUFJLE1BQU0sZUFBZSxTQUFTO0FBQ2hDLDBCQUFzQjtBQUFBLE1BQ3BCO0FBQUEsSUFDRjtBQUNBLHlCQUFxQjtBQUFBLE1BQ25CO0FBQUEsSUFDRjtBQUFBLEVBQ0YsV0FBVyxNQUFNLGVBQWUsUUFBUTtBQUN0QywwQkFBc0I7QUFBQSxNQUNwQjtBQUFBLElBQ0Y7QUFDQSx5QkFBcUI7QUFBQSxNQUNuQjtBQUFBLElBQ0Y7QUFBQSxFQUNGLFdBQ0UsTUFBTSxlQUFlLGlCQUNyQixNQUFNLGVBQWUsY0FDckI7QUFDQSxVQUFNLGlCQUNKLE1BQU0sZUFBZSxnQkFBZ0IsT0FBTztBQUM5QywwQkFBc0I7QUFBQSxNQUNwQixlQUFlLGNBQWM7QUFBQSxJQUMvQjtBQUNBLHlCQUFxQjtBQUFBLE1BQ25CO0FBQUEsSUFDRjtBQUFBLEVBQ0YsV0FDRSxNQUFNLGVBQWUsV0FDckIsTUFBTSxlQUFlLFFBQ3JCO0FBQ0EsVUFBTSxpQkFDSixNQUFNLGVBQWUsVUFBVSxZQUFZO0FBQzdDLDBCQUFzQjtBQUFBLE1BQ3BCLG9CQUFvQixjQUFjO0FBQUEsTUFDbEM7QUFBQSxJQUNGO0FBQ0EseUJBQXFCO0FBQUEsTUFDbkI7QUFBQSxJQUNGO0FBQ0Esb0JBQWdCO0FBQUEsTUFDZDtBQUFBLElBQ0Y7QUFBQSxFQUNGLE9BQU87QUFDTCxVQUFNLGlCQUNKLE1BQU0sZUFBZSxlQUFlLFFBQVE7QUFDOUMsMEJBQXNCO0FBQUEsTUFDcEIsY0FBYyxjQUFjO0FBQUEsSUFDOUI7QUFDQSx5QkFBcUI7QUFBQSxNQUNuQjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBRUEsTUFDRSxNQUFNLGlCQUFpQixjQUN2QixNQUFNLGlCQUFpQixnQkFDdkIsTUFBTSxpQkFBaUIsWUFDdkI7QUFDQSwwQkFBc0I7QUFBQSxNQUNwQjtBQUFBLElBQ0Y7QUFDQSx5QkFBcUI7QUFBQSxNQUNuQjtBQUFBLElBQ0Y7QUFDQSxvQkFBZ0I7QUFBQSxNQUNkLE1BQU0saUJBQWlCLGFBQ25CLGtEQUNBO0FBQUEsSUFDTjtBQUFBLEVBQ0YsV0FDRSxNQUFNLGlCQUFpQixlQUN2QixNQUFNLGlCQUFpQixlQUN2QjtBQUNBLDBCQUFzQjtBQUFBLE1BQ3BCO0FBQUEsSUFDRjtBQUNBLHlCQUFxQjtBQUFBLE1BQ25CO0FBQUEsSUFDRjtBQUNBLG9CQUFnQjtBQUFBLE1BQ2QsTUFBTSxpQkFBaUIsZ0JBQ25CLGtEQUNBO0FBQUEsSUFDTjtBQUFBLEVBQ0YsT0FBTztBQUNMLG9CQUFnQjtBQUFBLE1BQ2Q7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUVBLE1BQUksTUFBTSxnQkFBZ0IsUUFBUTtBQUNoQyxvQkFBZ0I7QUFBQSxNQUNkO0FBQUEsSUFDRjtBQUFBLEVBQ0YsV0FBVyxNQUFNLGdCQUFnQixVQUFVO0FBQ3pDLG9CQUFnQjtBQUFBLE1BQ2Q7QUFBQSxJQUNGO0FBQUEsRUFDRixPQUFPO0FBQ0wsb0JBQWdCO0FBQUEsTUFDZDtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBRUEsTUFBSSxLQUFLLElBQUksTUFBTSxXQUFXLElBQUksS0FBSztBQUNyQyxvQkFBZ0I7QUFBQSxNQUNkO0FBQUEsSUFDRjtBQUFBLEVBQ0YsT0FBTztBQUNMLFVBQU0sWUFBWSxNQUFNLGNBQWMsSUFBSSxRQUFRO0FBQ2xELG9CQUFnQjtBQUFBLE1BQ2QsVUFBVSxTQUFTLE1BQU0sZ0JBQWdCLEtBQUssSUFBSSxNQUFNLFdBQVcsQ0FBQyxDQUFDO0FBQUEsSUFDdkU7QUFBQSxFQUNGO0FBRUEsU0FBTztBQUFBLElBQ0w7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxFQUNGO0FBQ0Y7QUFFQSxTQUFTLGlDQUNQLE1BQ0EsUUFHQTtBQUNBLFNBQU87QUFBQSxJQUNMO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0EsYUFBYSxPQUFPLGNBQWMsTUFBTSxPQUFPLGdCQUFnQixNQUFNLE9BQU8sZUFBZTtBQUFBLElBQzNGLGlCQUFpQixzQkFBc0IsT0FBTyxvQkFBb0IsQ0FBQywwQkFBMEIsc0JBQXNCLE9BQU8sc0JBQXNCLENBQUM7QUFBQSxJQUNqSixnQkFBZ0Isc0JBQXNCLEtBQUssa0JBQWtCLENBQUMsQ0FBQyxNQUFNLHNCQUFzQixLQUFLLGtCQUFrQixDQUFDLENBQUMsTUFBTSxzQkFBc0IsS0FBSyxrQkFBa0IsQ0FBQyxDQUFDLGNBQWMsc0JBQXNCLEtBQUssa0JBQWtCLENBQUMsQ0FBQyxNQUFNLHNCQUFzQixLQUFLLGtCQUFrQixDQUFDLENBQUMsTUFBTSxzQkFBc0IsS0FBSyxrQkFBa0IsQ0FBQyxDQUFDO0FBQUEsSUFDaFYsV0FBVyxPQUFPLFdBQVc7QUFBQSxJQUM3QixTQUFTLE9BQU8sZUFBZSxVQUFVLE9BQU8sZUFBZSxRQUFRLENBQUMsQ0FBQztBQUFBLElBQ3pFO0FBQUEsSUFDQSxHQUFHLE9BQU8sd0JBQXdCLElBQUksQ0FBQyxTQUFTLEtBQUssSUFBSSxFQUFFO0FBQUEsSUFDM0Q7QUFBQSxJQUNBLEdBQUcsT0FBTyx5QkFBeUIsSUFBSSxDQUFDLFNBQVMsS0FBSyxJQUFJLEVBQUU7QUFBQSxJQUM1RDtBQUFBLElBQ0EsR0FBRyxPQUFPLHVCQUF1QixJQUFJLENBQUMsU0FBUyxLQUFLLElBQUksRUFBRTtBQUFBLElBQzFEO0FBQUEsSUFDQSxHQUFHLE9BQU8sbUJBQW1CLElBQUksQ0FBQyxTQUFTLEtBQUssSUFBSSxFQUFFO0FBQUEsRUFDeEQsRUFBRSxLQUFLLElBQUk7QUFDYjtBQUVBLFNBQVMsZUFBZSxPQUFlO0FBQ3JDLE1BQUksS0FBSyxJQUFJLEtBQUssSUFBSSxLQUFLO0FBQ3pCLFdBQU87QUFBQSxFQUNUO0FBRUEsU0FBTyxRQUFRLHNCQUFzQixLQUFLLENBQUMsVUFBVSxRQUFRLElBQUksUUFBUSxLQUFLO0FBQ2hGO0FBRU8sZ0JBQVMsK0JBQ2QsT0FDQSxRQUNBLFdBQVcsTUFDWDtBQUNBLFFBQU0sWUFBWSxPQUFPLFNBQVMsS0FBSyxLQUFLLFFBQVEsSUFBSSxRQUFRO0FBQ2hFLFFBQU0sYUFBYSxPQUFPLFNBQVMsTUFBTSxLQUFLLFNBQVMsSUFBSSxTQUFTO0FBQ3BFLFFBQU0sZUFBZSxLQUFLLElBQUksTUFBTSxLQUFLLElBQUksTUFBTSxRQUFRLENBQUM7QUFDNUQsUUFBTSxTQUFTLEtBQUssSUFBSSxHQUFHLEtBQUssSUFBSSxJQUFJLEdBQUcsWUFBWSxVQUFVLENBQUM7QUFDbEUsTUFBSTtBQUNKLE1BQUk7QUFFSixNQUFJLFVBQVUsR0FBRztBQUNmLGtCQUFjLGdCQUFnQixjQUFjLEVBQUU7QUFDOUMsbUJBQWUsZ0JBQWdCLGVBQWUsUUFBUSxFQUFFO0FBQUEsRUFDMUQsT0FBTztBQUNMLG1CQUFlLGdCQUFnQixjQUFjLEVBQUU7QUFDL0Msa0JBQWMsZ0JBQWdCLGVBQWUsUUFBUSxFQUFFO0FBQUEsRUFDekQ7QUFFQSxTQUFPLEdBQUcsS0FBSyxJQUFJLElBQUksV0FBVyxDQUFDLElBQUksS0FBSyxJQUFJLElBQUksWUFBWSxDQUFDO0FBQ25FO0FBRUEsU0FBUyx5QkFBeUIsT0FBZTtBQUMvQyxRQUFNLGNBQWUsUUFBUSxNQUFPLE9BQU87QUFFM0MsU0FBTyxPQUFPLEdBQUcsWUFBWSxFQUFFLElBQUksSUFBSTtBQUN6QztBQUVBLFNBQVMsd0JBQ1AsTUFDQSxTQUNxQjtBQUNyQixRQUFNLE9BQU8sVUFBVTtBQUN2QixRQUFNLE9BQU8sS0FBSyxJQUFJLElBQUk7QUFFMUIsU0FBTztBQUFBLElBQ0wsR0FBRyxLQUFLLElBQUk7QUFBQSxJQUNaLEdBQUcsS0FBSyxJQUFJO0FBQUEsSUFDWixHQUFHLEtBQUssSUFBSTtBQUFBLElBQ1osR0FBRyxLQUFLLElBQUksSUFBSTtBQUFBLEVBQ2xCO0FBQ0Y7QUFFQSxTQUFTLG9CQUNQLE1BQ0EsT0FDcUI7QUFDckIsU0FBTztBQUFBLElBQ0wsR0FDRSxLQUFLLElBQUksTUFBTSxJQUNmLEtBQUssSUFBSSxNQUFNLElBQ2YsS0FBSyxJQUFJLE1BQU0sSUFDZixLQUFLLElBQUksTUFBTTtBQUFBLElBQ2pCLEdBQ0UsS0FBSyxJQUFJLE1BQU0sSUFDZixLQUFLLElBQUksTUFBTSxJQUNmLEtBQUssSUFBSSxNQUFNLElBQ2YsS0FBSyxJQUFJLE1BQU07QUFBQSxJQUNqQixHQUNFLEtBQUssSUFBSSxNQUFNLElBQ2YsS0FBSyxJQUFJLE1BQU0sSUFDZixLQUFLLElBQUksTUFBTSxJQUNmLEtBQUssSUFBSSxNQUFNO0FBQUEsSUFDakIsR0FDRSxLQUFLLElBQUksTUFBTSxJQUNmLEtBQUssSUFBSSxNQUFNLElBQ2YsS0FBSyxJQUFJLE1BQU0sSUFDZixLQUFLLElBQUksTUFBTTtBQUFBLEVBQ25CO0FBQ0Y7QUFFQSxTQUFTLG9CQUNQLFlBQ3FCO0FBQ3JCLFFBQU0sWUFBWSxLQUFLO0FBQUEsSUFDckIsV0FBVztBQUFBLElBQ1gsV0FBVztBQUFBLElBQ1gsV0FBVztBQUFBLElBQ1gsV0FBVztBQUFBLEVBQ2I7QUFFQSxNQUFJLENBQUMsT0FBTyxTQUFTLFNBQVMsS0FBSyxjQUFjLEdBQUc7QUFDbEQsV0FBTyxFQUFFLEdBQUcsR0FBRyxHQUFHLEdBQUcsR0FBRyxHQUFHLEdBQUcsRUFBRTtBQUFBLEVBQ2xDO0FBRUEsU0FBTztBQUFBLElBQ0wsR0FBRyxXQUFXLFdBQVcsSUFBSSxTQUFTO0FBQUEsSUFDdEMsR0FBRyxXQUFXLFdBQVcsSUFBSSxTQUFTO0FBQUEsSUFDdEMsR0FBRyxXQUFXLFdBQVcsSUFBSSxTQUFTO0FBQUEsSUFDdEMsR0FBRyxXQUFXLFdBQVcsSUFBSSxTQUFTO0FBQUEsRUFDeEM7QUFDRjtBQUVBLFNBQVMseUJBQ1AsUUFDQSxZQUNBO0FBQ0EsUUFBTSxNQUNKLFdBQVcsSUFBSSxPQUFPLElBQ3RCLFdBQVcsSUFBSSxPQUFPLElBQ3RCLFdBQVcsSUFBSSxPQUFPO0FBQ3hCLFFBQU0sbUJBQ0osV0FBVyxLQUFLLElBQUksV0FBVyxLQUFLLElBQUksV0FBVyxLQUFLO0FBQzFELFFBQU0sUUFBUTtBQUFBLElBQ1osR0FBRyxXQUFXLElBQUksT0FBTyxJQUFJLFdBQVcsSUFBSSxPQUFPO0FBQUEsSUFDbkQsR0FBRyxXQUFXLElBQUksT0FBTyxJQUFJLFdBQVcsSUFBSSxPQUFPO0FBQUEsSUFDbkQsR0FBRyxXQUFXLElBQUksT0FBTyxJQUFJLFdBQVcsSUFBSSxPQUFPO0FBQUEsRUFDckQ7QUFFQSxTQUFPO0FBQUEsSUFDTCxHQUNFLElBQUksTUFBTSxXQUFXLEtBQ3BCLFdBQVcsS0FBSyxJQUFJLG9CQUFvQixPQUFPLElBQ2hELElBQUksV0FBVyxJQUFJLE1BQU07QUFBQSxJQUMzQixHQUNFLElBQUksTUFBTSxXQUFXLEtBQ3BCLFdBQVcsS0FBSyxJQUFJLG9CQUFvQixPQUFPLElBQ2hELElBQUksV0FBVyxJQUFJLE1BQU07QUFBQSxJQUMzQixHQUNFLElBQUksTUFBTSxXQUFXLEtBQ3BCLFdBQVcsS0FBSyxJQUFJLG9CQUFvQixPQUFPLElBQ2hELElBQUksV0FBVyxJQUFJLE1BQU07QUFBQSxFQUM3QjtBQUNGO0FBRUEsU0FBUyxpQkFBaUIsT0FBZTtBQUN2QyxTQUFRLFFBQVEsS0FBSyxLQUFNO0FBQzdCO0FBRUEsU0FBUyxpQkFBaUIsT0FBZTtBQUN2QyxTQUFRLFFBQVEsTUFBTyxLQUFLO0FBQzlCO0FBRUEsU0FBUyxnQkFBZ0IsT0FBZSxVQUFrQjtBQUN4RCxTQUFPLEtBQUssTUFBTSxRQUFRLFFBQVEsSUFBSTtBQUN4QztBQUVBLFNBQVMsV0FBVyxPQUFlO0FBQ2pDLFNBQU8sS0FBSyxJQUFJLEtBQUssSUFBSSxRQUFRLElBQUk7QUFDdkM7QUFFQSxTQUFTLGtCQUFrQixPQUFlO0FBQ3hDLFFBQU0sVUFBVSxLQUFLLE1BQU0sUUFBUSxHQUFHLElBQUk7QUFFMUMsU0FBTyxPQUFPLEdBQUcsU0FBUyxFQUFFLElBQUksSUFBSTtBQUN0QztBQUVBLFNBQVMsZ0JBQWdCLE9BQWU7QUFDdEMsU0FBTyxHQUFHLEtBQUssSUFBSSxLQUFLLEVBQUUsUUFBUSxDQUFDLENBQUM7QUFDdEM7QUFFQSxTQUFTLHNCQUFzQixPQUFlO0FBQzVDLFFBQU0sUUFBUSxrQkFBa0IsS0FBSztBQUVyQyxTQUFPLEdBQUcsUUFBUSxJQUFJLE1BQU0sRUFBRSxHQUFHLE1BQU0sUUFBUSxDQUFDLENBQUM7QUFDbkQ7IiwibmFtZXMiOltdfQ==