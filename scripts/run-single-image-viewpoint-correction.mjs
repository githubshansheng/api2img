import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const args = parseArguments(process.argv.slice(2));
const apiKey = process.env.CODEX_CUSTOM_API_KEY?.trim();

if (!apiKey) {
  throw new Error("CODEX_CUSTOM_API_KEY is required.");
}

await mkdir(args.output, { recursive: true });

const [draftBytes, sourceBytes, guideBytes] = await Promise.all([
  readFile(args.draft),
  readFile(args.source),
  readFile(args.guide)
]);
const prompt = buildPrompt(args.promptMode, args.direction);
const form = new FormData();
form.append("model", args.model);
form.append("prompt", prompt);
form.append(
  "image[]",
  new Blob([draftBytes], { type: "image/png" }),
  args.promptMode === "user-zh-left"
    ? "original-factual-reference.png"
    : "failed-viewpoint-draft.png"
);
form.append(
  "image[]",
  new Blob([sourceBytes], { type: "image/png" }),
  args.promptMode === "user-zh-left"
    ? "rotated-target-projection.png"
    : "original-identity-reference.png"
);
form.append(
  "image[]",
  new Blob([guideBytes], { type: "image/png" }),
  args.promptMode === "user-zh-left"
    ? "full-camera-pose.png"
    : "target-depth-guide.png"
);
form.append("quality", "high");
form.append("input_fidelity", "high");
form.append("size", "2048x2048");
form.append("output_format", "png");
form.append("n", "1");

const startedAt = Date.now();
const response = await fetch(args.endpoint, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`
  },
  body: form,
  signal: AbortSignal.timeout(30 * 60 * 1000)
});
const body = await response.json();

if (!response.ok) {
  throw new Error(
    `Correction request failed with HTTP ${response.status}: ${JSON.stringify(body)}`
  );
}

const image = body?.data?.[0]?.b64_json;

if (typeof image !== "string" || !image) {
  throw new Error("Correction response did not include data[0].b64_json.");
}

const resultPath = path.join(args.output, "result.png");
await Promise.all([
  writeFile(resultPath, Buffer.from(image, "base64")),
  writeFile(path.join(args.output, "prompt.txt"), `${prompt}\n`, "utf8"),
  writeFile(
    path.join(args.output, "result.json"),
    `${JSON.stringify(
      {
        draft: args.draft,
        source: args.source,
        guide: args.guide,
        direction: args.direction,
        promptMode: args.promptMode,
        model: args.model,
        endpoint: args.endpoint,
        inputFidelity: "high",
        size: "2048x2048",
        durationMs: Date.now() - startedAt
      },
      null,
      2
    )}\n`,
    "utf8"
  )
]);

console.log(
  JSON.stringify({
    event: "single-image-viewpoint-correction-completed",
    durationMs: Date.now() - startedAt,
    resultPath
  })
);

function buildPrompt(promptMode, direction) {
  if (promptMode === "user-zh-left") {
    return buildUserSuggestedLeftCameraPromptZh();
  }

  if (promptMode === "correction-zh-screen-left") {
    return buildChineseScreenSideCorrectionPrompt("left");
  }

  if (promptMode === "correction-zh-screen-right") {
    return buildChineseScreenSideCorrectionPrompt("right");
  }

  return buildCorrectionPrompt(direction);
}

function buildChineseScreenSideCorrectionPrompt(screenSide) {
  const isLeft = screenSide === "left";
  const frameSide = isLeft ? "左侧" : "右侧";
  const objectSide = isLeft ? "右侧" : "左侧";
  const noseDirection = isLeft ? "右侧" : "左侧";
  const nearContour = isLeft ? "左侧" : "右侧";
  const farContour = isLeft ? "右侧" : "左侧";

  return [
    "【唯一任务：修复错误的近正面机位】",
    `将镜头转向中心人物/物品的${frameSide}，自动补全原图不可见的部分，包括背景、人物的镜像、物品的镜像。`,
    "",
    "【输入角色】",
    "第一张图是当前生成草稿。保留其清晰度、色彩、光线和画幅，但必须放弃其中接近正面的二维投影。",
    "第二张图是原始身份与场景事实参考，用于保持同一人物/物品、材质、服装、发型、环境风格和现实瞬间。",
    "第三张图是完整 XYZ 机位图，只用于确认相机所在一侧、环绕轨道、Pitch、Yaw、Roll 和景别；不得把坐标轴、文字、环线或卡片画入结果。",
    "",
    "【相机修复】",
    `这里的${frameSide}以原图观看者的画面方向为准：相机沿画面${frameSide}轨道环绕约 56.2°，来到大致正对原相机的中心对象自身${objectSide}，镜头始终看回同一场景中心。`,
    "这是明显的三分之四侧向重拍，不是 5° 到 15° 的轻微变化。原来正对镜头的大面积投影必须显著横向收窄并显露真实前后深度。",
    "反镜头跟随：人物、动物、可动部件或物品不能为了继续正对新镜头而做补偿性转动。延续同一现实瞬间和世界空间关系，但最终二维画面中的朝向、轮廓、投影宽度与遮挡必须随相机相对位置改变。",
    `若中心对象确实是人物，鼻尖和面部前向轴必须指向最终画面${noseDirection}，近侧结构构成最终画面${nearContour}轮廓，远侧眼、脸颊和耳部在${farContour}自然收窄或退隐；非人物图像不得套用人体术语。`,
    "",
    "【整场景重拍与补全】",
    "相机移动时，人物/物品、窗户、墙面、家具、地面、前景、背景和画面边界必须作为同一个固定三维场景一起改变透视、视差、尺度、遮挡和构图。若背景仍与第一张图基本相同，只改变人物或物品朝向，则修复失败。",
    "补全目标新视锥中原图没有拍到或被遮挡的全部范围，包括对象的新可见对侧结构和新进入画面的环境。所谓人物/物品的镜像，是依据真实类别、对称关系、三维构造、材质和连接关系推断不可见侧，不是水平翻转、镜面倒影、复制对象或复制像素。",
    "",
    "【其他参数】",
    "保持 Pitch +7.1° 的轻微高机位、Roll 等效 -2°、远景和自然浅景深。保持原图 1:1 宽高比，输出完整方形画面。",
    "",
    "只输出一张修复后的高保真新机位照片，不输出文字、坐标轴、边框、引导线或水印。"
  ].join("\n");
}

function buildUserSuggestedLeftCameraPromptZh() {
  return [
    "【核心指令】",
    "将镜头转向中心人物/物品的左侧，自动补全原图不可见的部分，包括背景、人物的镜像、物品的镜像。",
    "",
    "【这句话在本任务中的精确定义】",
    "1. “转向中心人物/物品的左侧”表示：让虚拟相机围绕固定的场景中心移动到中心对象自身左前方约 56.2°，镜头始终看回同一个中心。改变的是相机机位，不是让人物、物品或其他对象在冻结的背景中自行转身。",
    "2. “人物的镜像、物品的镜像”不是镜面、倒影、复制对象或水平翻转原图；它表示依据对象真实类别、左右对称关系、三维构造、材质与连接关系，合理推断并重建原图未拍到或被遮挡、但从新机位能够看到的对侧结构。",
    "3. 第一张图是原始事实图，锁定同一人物/物品、同一现实瞬间、结构、材质、颜色、服装、光线与整体风格。第二张图是旋转后的目标投影引导，只用于判断投影压缩、构图和 Roll，不复制其中的卡片边缘或预览外观。第三张图是完整机位图，用于确认 XYZ 轴、相机所在一侧和镜头朝向，不把坐标轴或旋转环画入结果。",
    "",
    "【整幅场景随镜头重新成像】",
    "相机到达新机位后，从该位置重新拍摄完整三维场景。中心对象、前景、中景、背景、窗户、墙面、地面、家具以及画面边缘必须一起更新透视、尺度、视差、遮挡和构图。不得只改变中心对象而保留原背景投影。",
    "自动补全目标新视锥内原图不可见的全部范围：既包括中心对象新显露的真实结构，也包括新进入画面的背景、地面、墙体、家具和其他环境空间。依据原图环境的空间关系、风格、材质、光线、色彩和景深自然想象并无缝补全；不得用裁切、模糊、空白、额外遮挡或复制边缘逃避补全。",
    "",
    "【目标机位与可观察验收】",
    "目标参数为 Pitch +7.1°、水平环绕约 56.2°、Roll 等效 -2°、远景。保留原图的 1:1 画幅比例、自然窗光、浅景深和摄影质感。",
    "因为本指令要求相机到达中心对象自身左侧，若中心对象大致正对原相机，相机应从原图观看者的画面右侧绕行。中心对象原来朝向镜头的正面投影必须明显横向收窄，并显露其自身左侧及相应的环境视差；不得仍生成近似正面照片。",
    "若中心对象确实是人物，本例中鼻尖和面部前向轴应朝最终画面左侧延伸，人物自身左侧成为近侧；这条人物验收仅在识别结果确实为人物时启用，非人物图像不得套用任何人体器官描述。",
    "",
    "【禁止】",
    "禁止整图水平翻转、镜面倒影、复制人物或物品、二维旋转、卡片翻转、透视拉伸、冻结背景、只让主体转身、添加坐标轴、文字、边框或水印。",
    "",
    "只输出一张干净、高保真、完整补全的新机位照片。"
  ].join("\n");
}

function buildCorrectionPrompt(direction) {
  const rightSideInstructions = [
    "- Place the virtual camera on the woman's own RIGHT, equivalent to moving toward the LEFT edge of the original source frame by about 56 degrees.",
    "- Re-photograph the same stationary woman and room from a clear right-front three-quarter camera position. Do not make the woman turn back to face the camera.",
    "- In the FINAL image, the woman's own RIGHT ear, right hairline, and right cheek are the near side and form the LEFT facial contour.",
    "- Her own LEFT ear, currently visible on the RIGHT side of image 1, must disappear behind the far facial contour and hair.",
    "- Her nose tip and facial forward axis must point toward the RIGHT side of the final image. The far left eye and left cheek must be visibly narrower behind the nasal bridge.",
    "- This must read as a substantial 56-degree camera change, not a five-degree variation. If both eyes remain similarly wide or the left ear remains visible on image-right, the edit has failed."
  ];
  const leftSideInstructions = [
    "- Place the virtual camera on the woman's own LEFT, equivalent to moving toward the RIGHT edge of the original source frame by about 56 degrees.",
    "- Re-photograph the same stationary woman and room from a clear left-front three-quarter camera position. Do not make the woman turn back to face the camera.",
    "- In the FINAL image, the woman's own LEFT ear, left hairline, and left cheek are the near side and form the RIGHT facial contour.",
    "- Her own RIGHT ear must disappear behind the far facial contour and hair.",
    "- Her nose tip and facial forward axis must point toward the LEFT side of the final image. The far right eye and right cheek must be visibly narrower behind the nasal bridge.",
    "- This must read as a substantial 56-degree camera change, not a five-degree variation. If both eyes remain similarly wide or the right ear remains visible on image-left, the edit has failed."
  ];

  return [
    "TASK: Correct the camera viewpoint of image 1. This is a viewpoint repair, not a new front-facing portrait.",
    "INPUT ROLES:",
    "- Image 1 is the current high-quality draft. Keep its square composition, room, window light, clothing, hairstyle, color, and depth of field, but reject its near-frontal facial projection.",
    "- Image 2 is the authoritative identity reference for the same woman.",
    "- Image 3 is a rough depth-and-camera guide. Use only its target side, foreshortening direction, and parallax; do not copy its dots or dark background.",
    "CAMERA CORRECTION:",
    ...(direction === "left" ? leftSideInstructions : rightSideInstructions),
    "SCENE:",
    "- Move the camera around the complete fixed room, so the window, wall, furniture, chair, floor, and background parallax all respond to the same target viewpoint.",
    "- Naturally infer the newly visible right-side anatomy and newly framed environment. Preserve the same person and realistic anatomy without mirroring the source pixels.",
    "- Keep the slight +7.1-degree elevated camera position, approximately -2-degree frame roll, wide framing, shallow natural depth of field, and exact 2048x2048 square output.",
    "OUTPUT: one clean photorealistic corrected image, no text, guides, dots, borders, or watermarks."
  ].join("\n");
}

function parseArguments(args) {
  const values = new Map();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (!argument?.startsWith("--")) {
      continue;
    }

    const [name, inlineValue] = argument.slice(2).split("=", 2);
    const value =
      inlineValue ??
      (args[index + 1] && !args[index + 1].startsWith("--")
        ? args[++index]
        : "true");
    values.set(name, value);
  }

  const draft = values.get("draft");
  const source = values.get("source");
  const guide = values.get("guide");
  const output = values.get("output");

  if (!draft || !source || !guide || !output) {
    throw new Error(
      "Usage: node scripts/run-single-image-viewpoint-correction.mjs --draft <path> --source <path> --guide <path> --output <directory>"
    );
  }

  return {
    draft: path.resolve(draft),
    direction: values.get("direction") === "left" ? "left" : "right",
    endpoint:
      values.get("endpoint") ?? "https://ai.heigh.vip/v1/images/edits",
    guide: path.resolve(guide),
    model: values.get("model") ?? "gpt-image-2",
    output: path.resolve(output),
    promptMode:
      values.get("prompt-mode") === "user-zh-left" ||
      values.get("prompt-mode") === "correction-zh-screen-left" ||
      values.get("prompt-mode") === "correction-zh-screen-right"
        ? values.get("prompt-mode")
        : "correction-en",
    source: path.resolve(source)
  };
}
