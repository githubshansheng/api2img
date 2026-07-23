import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "canvas";
import * as THREE from "three";

const DEFAULT_SERVER_URL =
  "http://127.0.0.1:8787/api/single-image-viewpoint?stream=1";
const DEFAULT_UPSTREAM_ROOT = "https://ai.heigh.vip";
const GUIDE_LONG_EDGE = 1536;
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const CAMERA_TEST_ARCHIVE_ROOT = path.join(
  WORKSPACE_ROOT,
  "archive",
  "camera-test"
);

const options = parseArguments(process.argv.slice(2));
const apiKey = process.env.CODEX_CUSTOM_API_KEY?.trim();

if (!apiKey && !options.guideOnly) {
  throw new Error("CODEX_CUSTOM_API_KEY is required.");
}

const sourcePath = path.resolve(options.image);
const outputDirectory = resolveArchivedOutputDirectory(
  options.outputDirectory,
  path.join(
    CAMERA_TEST_ARCHIVE_ROOT,
    `${timestamp()}-${slugify(options.caseName)}`
  )
);

await mkdir(outputDirectory, { recursive: true });

const sourceBytes = await readFile(sourcePath);
const sourceImage = await loadImage(sourceBytes);
const generatedGuide = createPoseGuide({
  sourceImage,
  rotation: options.rotation,
  cameraDistance: options.cameraDistance
});
const [poseGuideBytes, cameraPoseBytes] = await Promise.all([
  options.poseGuide
    ? readFile(path.resolve(options.poseGuide))
    : Promise.resolve(generatedGuide.cleanBytes),
  options.cameraPose
    ? readFile(path.resolve(options.cameraPose))
    : Promise.resolve(generatedGuide.annotatedBytes)
]);
const requestId = crypto.randomUUID();
const request = {
  requestId,
  source_image: toDataURL(sourceBytes, "image/png"),
  pose_guide_image: toDataURL(poseGuideBytes, "image/png"),
  camera_pose_image: toDataURL(cameraPoseBytes, "image/png"),
  rotation_degrees: options.rotation,
  camera_distance: options.cameraDistance,
  source_width: sourceImage.width,
  source_height: sourceImage.height,
  prompt_language: options.promptLanguage,
  user_prompt: options.userPrompt,
  background_mode: "preserve_scene",
  api_key: apiKey ?? "",
  reasoning_model: options.reasoningModel,
  image_model: options.imageModel,
  output_size: options.outputSize,
  endpoint_override: {
    baseURL: options.upstreamRoot,
    editURL: options.upstreamRoot
  }
};

await Promise.all([
  writeFile(path.join(outputDirectory, "source.png"), sourceBytes),
  writeFile(path.join(outputDirectory, "pose-guide.png"), poseGuideBytes),
  writeFile(
    path.join(outputDirectory, "camera-pose.png"),
    cameraPoseBytes
  ),
  writeFile(
    path.join(outputDirectory, "request.json"),
    JSON.stringify(
      {
        ...request,
        api_key: apiKey
          ? `[redacted:${apiKey.length}]`
          : "[not-required-guide-only]",
        source_image: summarizeDataURL(request.source_image),
        pose_guide_image: summarizeDataURL(request.pose_guide_image),
        camera_pose_image: summarizeDataURL(request.camera_pose_image),
        source_path: sourcePath
      },
      null,
      2
    )
  )
]);

if (options.guideOnly) {
  console.log(
    JSON.stringify({
      event: "guide-only-completed",
      caseName: options.caseName,
      outputDirectory,
      rotation: options.rotation,
      cameraDistance: options.cameraDistance,
      promptLanguage: options.promptLanguage
    })
  );
  process.exit(0);
}

console.log(
  JSON.stringify({
    event: "case-started",
    caseName: options.caseName,
    outputDirectory,
    requestId,
    rotation: options.rotation,
    cameraDistance: options.cameraDistance,
    promptLanguage: options.promptLanguage
  })
);

const response = await fetch(options.serverURL, {
  method: "POST",
  headers: {
    Accept: "application/x-ndjson, application/json",
    "Content-Type": "application/json"
  },
  body: JSON.stringify(request)
});

if (!response.body) {
  throw new Error(`The server returned HTTP ${response.status} without a body.`);
}

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let rawStream = "";
let result;

while (true) {
  const { value, done } = await reader.read();
  buffer += decoder.decode(value, { stream: !done });
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";

  for (const line of lines) {
    rawStream += `${line}\n`;
    result = await processStreamLine(line, outputDirectory, result);
  }

  if (done) {
    break;
  }
}

if (buffer.trim()) {
  rawStream += buffer;
  result = await processStreamLine(buffer, outputDirectory, result);
}

await writeFile(path.join(outputDirectory, "stream.ndjson"), rawStream);

if (!response.ok) {
  throw new Error(`The local server returned HTTP ${response.status}.`);
}

if (!result) {
  throw new Error("The stream ended without a result event.");
}

await writeFile(
  path.join(outputDirectory, "result.json"),
  JSON.stringify(
    {
      ...result,
      image: summarizeDataURL(result.image)
    },
    null,
    2
  )
);

const resultImagePath = await saveResultImage(
  result.image,
  outputDirectory,
  result.imageMimeType
);

console.log(
  JSON.stringify({
    event: "case-completed",
    caseName: options.caseName,
    outputDirectory,
    resultImagePath,
    subjectCategory: result.subjectCategory,
    reasoningDurationMs: result.reasoningDurationMs,
    renderingDurationMs: result.renderingDurationMs,
    totalDurationMs: result.totalDurationMs
  })
);

function parseArguments(args) {
  const values = new Map();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (!argument.startsWith("--")) {
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

  const image = values.get("image");

  if (!image) {
    throw new Error(
      "Usage: node scripts/run-single-image-viewpoint-case.mjs --image <path> --case <name> [--x 0 --y 90 --z 0 --distance 5]"
    );
  }

  return {
    image,
    caseName: values.get("case") || "single-image-viewpoint",
    rotation: {
      x: parseFiniteNumber(values.get("x"), 0),
      y: parseFiniteNumber(values.get("y"), 0),
      z: parseFiniteNumber(values.get("z"), 0)
    },
    cameraDistance: parseFiniteNumber(values.get("distance"), 5),
    outputSize: values.get("size") || "1024x1024",
    outputDirectory: values.get("output"),
    poseGuide: values.get("pose-guide"),
    cameraPose: values.get("camera-pose"),
    guideOnly: values.get("guide-only") === "true",
    serverURL: values.get("server") || DEFAULT_SERVER_URL,
    upstreamRoot: values.get("upstream") || DEFAULT_UPSTREAM_ROOT,
    reasoningModel: values.get("reasoning-model") || "gpt-5.6-sol",
    imageModel: values.get("image-model") || "gpt-image-2",
    promptLanguage: parsePromptLanguage(
      values.get("prompt-language") || "zh"
    ),
    userPrompt: resolveUserPrompt(values)
  };
}

function parsePromptLanguage(value) {
  if (value === "zh" || value === "en") {
    return value;
  }

  throw new Error(
    `Expected --prompt-language zh or en, received "${value}".`
  );
}

function resolveUserPrompt(values) {
  const language = values.get("prompt-language") || "zh";
  const explicitPrompt =
    values.get(language === "en" ? "prompt-en" : "prompt-zh") ??
    values.get("prompt");

  if (explicitPrompt) {
    return explicitPrompt;
  }

  return language === "en"
    ? "Continue the same real-world moment, spatial relationships, materials, lighting, colors, and visual style without adding unrelated concepts."
    : "延续同一现实瞬间的场景内容、空间关系、材质、光线、色彩和风格，不增加无关概念。";
}

function parseFiniteNumber(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, received "${value}".`);
  }

  return number;
}

function resolveArchivedOutputDirectory(requestedPath, defaultPath) {
  const outputDirectory = path.resolve(requestedPath ?? defaultPath);
  const canonicalArchiveRoot = resolveCanonicalPath(CAMERA_TEST_ARCHIVE_ROOT);
  const canonicalOutputDirectory = resolveCanonicalPath(outputDirectory);
  const relativePath = path.relative(
    canonicalArchiveRoot,
    canonicalOutputDirectory
  );

  if (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  ) {
    return outputDirectory;
  }

  throw new Error(
    `Camera test output must stay inside ${CAMERA_TEST_ARCHIVE_ROOT}.`
  );
}

function resolveCanonicalPath(targetPath) {
  let existingPath = path.resolve(targetPath);
  const missingSegments = [];

  while (!existsSync(existingPath)) {
    const parentPath = path.dirname(existingPath);

    if (parentPath === existingPath) {
      return path.resolve(targetPath);
    }

    missingSegments.unshift(path.basename(existingPath));
    existingPath = parentPath;
  }

  return path.join(realpathSync.native(existingPath), ...missingSegments);
}

function createPoseGuide({ sourceImage, rotation, cameraDistance }) {
  const sourceAspect = sourceImage.width / sourceImage.height;
  const width =
    sourceAspect >= 1
      ? GUIDE_LONG_EDGE
      : Math.max(16, Math.round(GUIDE_LONG_EDGE * sourceAspect));
  const height =
    sourceAspect >= 1
      ? Math.max(16, Math.round(GUIDE_LONG_EDGE / sourceAspect))
      : GUIDE_LONG_EDGE;
  const cleanCanvas = createCanvas(width, height);
  const cleanContext = cleanCanvas.getContext("2d");
  const annotatedCanvas = createCanvas(width, height);
  const annotatedContext = annotatedCanvas.getContext("2d");
  const camera = buildCamera(width / height, rotation, cameraDistance);

  drawGuideBackground(cleanContext, width, height);
  drawReferenceCard({
    context: cleanContext,
    sourceImage,
    camera,
    width,
    height
  });

  annotatedContext.drawImage(cleanCanvas, 0, 0);
  drawCameraHelpers({
    context: annotatedContext,
    camera,
    width,
    height,
    rotation,
    cameraDistance
  });

  return {
    cleanBytes: cleanCanvas.toBuffer("image/png"),
    annotatedBytes: annotatedCanvas.toBuffer("image/png")
  };
}

function buildCamera(aspect, rotation, cameraDistance) {
  const camera = new THREE.PerspectiveCamera(34, aspect, 0.1, 100);
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(rotation.x),
      THREE.MathUtils.degToRad(-rotation.y),
      THREE.MathUtils.degToRad(rotation.z),
      "YXZ"
    )
  );
  const distance = 8.4 - (Math.min(10, Math.max(0, cameraDistance)) / 10) * 3.7;

  camera.position
    .set(0, 0, -distance)
    .applyQuaternion(quaternion);
  camera.up.set(0, 1, 0).applyQuaternion(quaternion);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

function drawGuideBackground(context, width, height) {
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#081019");
  gradient.addColorStop(1, "#05090f");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "rgba(115, 220, 232, 0.06)";
  context.lineWidth = 1;
  const spacing = Math.max(48, Math.round(Math.min(width, height) / 14));

  for (let x = 0; x <= width; x += spacing) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }

  for (let y = 0; y <= height; y += spacing) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
}

function drawReferenceCard({
  context,
  sourceImage,
  camera,
  width,
  height
}) {
  const aspect = sourceImage.width / sourceImage.height;
  const cardWidth = aspect >= 1 ? 3.65 : 3.65 * aspect;
  const cardHeight = aspect >= 1 ? 3.65 / aspect : 3.65;
  const depth = 0.075;
  const frontZ = -depth / 2;
  const backZ = depth / 2;
  const frontFacing =
    new THREE.Vector3(0, 0, -1).dot(camera.position.clone().normalize()) > 0;
  const frontCorners = [
    projectPoint(
      camera,
      new THREE.Vector3(cardWidth / 2, cardHeight / 2, frontZ),
      width,
      height
    ),
    projectPoint(
      camera,
      new THREE.Vector3(-cardWidth / 2, cardHeight / 2, frontZ),
      width,
      height
    ),
    projectPoint(
      camera,
      new THREE.Vector3(-cardWidth / 2, -cardHeight / 2, frontZ),
      width,
      height
    ),
    projectPoint(
      camera,
      new THREE.Vector3(cardWidth / 2, -cardHeight / 2, frontZ),
      width,
      height
    )
  ];
  const backCorners = [
    projectPoint(
      camera,
      new THREE.Vector3(cardWidth / 2, cardHeight / 2, backZ),
      width,
      height
    ),
    projectPoint(
      camera,
      new THREE.Vector3(-cardWidth / 2, cardHeight / 2, backZ),
      width,
      height
    ),
    projectPoint(
      camera,
      new THREE.Vector3(-cardWidth / 2, -cardHeight / 2, backZ),
      width,
      height
    ),
    projectPoint(
      camera,
      new THREE.Vector3(cardWidth / 2, -cardHeight / 2, backZ),
      width,
      height
    )
  ];

  drawPolygon(context, backCorners, "#111a24");
  drawCardEdges(context, [...frontCorners, ...backCorners]);

  if (frontFacing && polygonArea(frontCorners) > 16) {
    drawImageOnProjectedPlane({
      context,
      image: sourceImage,
      camera,
      width,
      height,
      cardWidth,
      cardHeight,
      z: frontZ
    });
  } else {
    drawPolygon(context, frontCorners, "#17212c");
  }

  context.strokeStyle = "rgba(115, 220, 232, 0.9)";
  context.lineWidth = Math.max(2, Math.round(Math.min(width, height) / 560));
  strokePolygon(context, frontCorners);
}

function drawImageOnProjectedPlane({
  context,
  image,
  camera,
  width,
  height,
  cardWidth,
  cardHeight,
  z
}) {
  const slices = Math.max(96, Math.min(320, Math.round(width / 5)));

  for (let index = 0; index < slices; index += 1) {
    const sourceX0 = (image.width * index) / slices;
    const sourceX1 = (image.width * (index + 1)) / slices;
    const u0 = index / slices;
    const u1 = (index + 1) / slices;
    const worldX0 = cardWidth / 2 - u0 * cardWidth;
    const worldX1 = cardWidth / 2 - u1 * cardWidth;
    const topLeft = projectPoint(
      camera,
      new THREE.Vector3(worldX0, cardHeight / 2, z),
      width,
      height
    );
    const topRight = projectPoint(
      camera,
      new THREE.Vector3(worldX1, cardHeight / 2, z),
      width,
      height
    );
    const bottomLeft = projectPoint(
      camera,
      new THREE.Vector3(worldX0, -cardHeight / 2, z),
      width,
      height
    );
    const bottomRight = projectPoint(
      camera,
      new THREE.Vector3(worldX1, -cardHeight / 2, z),
      width,
      height
    );

    context.save();
    context.beginPath();
    context.moveTo(topLeft.x, topLeft.y);
    context.lineTo(topRight.x, topRight.y);
    context.lineTo(bottomRight.x, bottomRight.y);
    context.lineTo(bottomLeft.x, bottomLeft.y);
    context.closePath();
    context.clip();

    const sourceWidth = Math.max(1, sourceX1 - sourceX0);
    const a = (topRight.x - topLeft.x) / sourceWidth;
    const b = (topRight.y - topLeft.y) / sourceWidth;
    const c = (bottomLeft.x - topLeft.x) / image.height;
    const d = (bottomLeft.y - topLeft.y) / image.height;
    context.setTransform(a, b, c, d, topLeft.x, topLeft.y);
    context.drawImage(
      image,
      sourceX0,
      0,
      sourceWidth,
      image.height,
      0,
      0,
      sourceWidth + 1,
      image.height
    );
    context.restore();
  }
}

function drawCardEdges(context, corners) {
  const edges = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7]
  ];
  context.strokeStyle = "rgba(115, 220, 232, 0.66)";
  context.lineWidth = 2;

  for (const [start, end] of edges) {
    context.beginPath();
    context.moveTo(corners[start].x, corners[start].y);
    context.lineTo(corners[end].x, corners[end].y);
    context.stroke();
  }
}

function drawCameraHelpers({
  context,
  camera,
  width,
  height,
  rotation,
  cameraDistance
}) {
  const axisLength = 2.75;
  const axes = [
    { end: new THREE.Vector3(axisLength, 0, 0), color: "#f26b6b", label: "X" },
    { end: new THREE.Vector3(0, axisLength, 0), color: "#68d391", label: "Y" },
    { end: new THREE.Vector3(0, 0, axisLength), color: "#64b5f6", label: "Z" }
  ];
  const origin = projectPoint(
    camera,
    new THREE.Vector3(0, 0, 0),
    width,
    height
  );

  for (const axis of axes) {
    const end = projectPoint(camera, axis.end, width, height);
    context.strokeStyle = axis.color;
    context.lineWidth = Math.max(3, Math.round(Math.min(width, height) / 420));
    context.beginPath();
    context.moveTo(origin.x, origin.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    drawAxisLabel(context, end, axis.label, axis.color, width, height);
  }

  drawOrbitRing(context, camera, width, height, "x", "#f26b6b");
  drawOrbitRing(context, camera, width, height, "y", "#68d391");
  drawOrbitRing(context, camera, width, height, "z", "#64b5f6");

  const panelWidth = Math.min(width - 48, Math.round(width * 0.62));
  const panelHeight = Math.max(142, Math.round(height * 0.18));
  const panelX = 24;
  const panelY = 24;
  context.fillStyle = "rgba(4, 9, 15, 0.88)";
  context.fillRect(panelX, panelY, panelWidth, panelHeight);
  context.strokeStyle = "rgba(115, 220, 232, 0.5)";
  context.lineWidth = 2;
  context.strokeRect(panelX, panelY, panelWidth, panelHeight);
  context.fillStyle = "#dceaf0";
  context.font = `700 ${Math.max(24, Math.round(height * 0.035))}px sans-serif`;
  context.fillText("完整 XYZ 目标机位图", panelX + 22, panelY + 42);
  context.fillStyle = "#86d9e5";
  context.font = `600 ${Math.max(20, Math.round(height * 0.027))}px monospace`;
  context.fillText(
    `X=${formatAngle(rotation.x)}  Y=${formatAngle(rotation.y)}  Z=${formatAngle(rotation.z)}`,
    panelX + 22,
    panelY + 84
  );
  context.fillText(
    `景别距离=${cameraDistance.toFixed(1)}/10  欧拉顺序=YXZ`,
    panelX + 22,
    panelY + 122
  );
}

function drawOrbitRing(context, camera, width, height, axis, color) {
  context.strokeStyle = color;
  context.globalAlpha = 0.42;
  context.lineWidth = 2;
  context.beginPath();

  for (let index = 0; index <= 128; index += 1) {
    const angle = (index / 128) * Math.PI * 2;
    const radius = 2.25;
    const point =
      axis === "x"
        ? new THREE.Vector3(0, Math.cos(angle) * radius, Math.sin(angle) * radius)
        : axis === "y"
          ? new THREE.Vector3(
              Math.cos(angle) * radius,
              0,
              Math.sin(angle) * radius
            )
          : new THREE.Vector3(
              Math.cos(angle) * radius,
              Math.sin(angle) * radius,
              0
            );
    const projected = projectPoint(camera, point, width, height);

    if (index === 0) {
      context.moveTo(projected.x, projected.y);
    } else {
      context.lineTo(projected.x, projected.y);
    }
  }

  context.stroke();
  context.globalAlpha = 1;
}

function drawAxisLabel(context, point, label, color, width, height) {
  const radius = Math.max(18, Math.round(Math.min(width, height) / 42));
  context.fillStyle = "rgba(5, 10, 16, 0.9)";
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = 3;
  context.stroke();
  context.fillStyle = color;
  context.font = `700 ${Math.round(radius * 1.15)}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, point.x, point.y + 1);
  context.textAlign = "start";
  context.textBaseline = "alphabetic";
}

function projectPoint(camera, point, width, height) {
  const projected = point.clone().project(camera);

  return {
    x: (projected.x * 0.5 + 0.5) * width,
    y: (-projected.y * 0.5 + 0.5) * height
  };
}

function drawPolygon(context, points, fillStyle) {
  context.fillStyle = fillStyle;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);

  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }

  context.closePath();
  context.fill();
}

function strokePolygon(context, points) {
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);

  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }

  context.closePath();
  context.stroke();
}

function polygonArea(points) {
  let area = 0;

  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    area +=
      points[index].x * points[next].y - points[next].x * points[index].y;
  }

  return Math.abs(area / 2);
}

async function processStreamLine(line, outputDirectory, currentResult) {
  if (!line.trim()) {
    return currentResult;
  }

  let event;

  try {
    event = JSON.parse(line);
  } catch {
    console.log(JSON.stringify({ event: "unparseable-line", line }));
    return currentResult;
  }

  if (event.type === "stage") {
    console.log(
      JSON.stringify({
        event: "stage",
        stage: event.stage,
        message: event.message,
        promptLanguage: event.promptLanguage,
        cameraProtocol:
          event.promptLanguage === "en"
            ? event.cameraPrompt?.deterministicPromptEn?.split("\n")[2]
            : event.cameraPrompt?.deterministicPromptZh?.split("\n")[2],
        hasRenderPrompt: Boolean(event.renderPrompt)
      })
    );

    if (event.cameraPrompt) {
      await writeFile(
        path.join(outputDirectory, "camera-prompt.json"),
        JSON.stringify(event.cameraPrompt, null, 2)
      );
      await writeFile(
        path.join(outputDirectory, "camera-prompt.zh.txt"),
        event.cameraPrompt.deterministicPromptZh
      );
      await writeFile(
        path.join(outputDirectory, "camera-prompt.en.txt"),
        event.cameraPrompt.deterministicPromptEn
      );
    }

    if (event.analysis) {
      await writeFile(
        path.join(outputDirectory, "analysis.json"),
        JSON.stringify(event.analysis, null, 2)
      );
    }

    if (event.renderPrompt) {
      await writeFile(
        path.join(
          outputDirectory,
          `render-prompt.${event.promptLanguage === "en" ? "en" : "zh"}.txt`
        ),
        event.renderPrompt
      );
    }
  } else if (event.type === "result") {
    return event.data;
  } else if (event.type === "error") {
    await writeFile(
      path.join(outputDirectory, "error.json"),
      JSON.stringify(event.error, null, 2)
    );
    throw new Error(
      `${event.error.code ?? "SINGLE_VIEW_ERROR"}: ${event.error.message}`
    );
  }

  return currentResult;
}

async function saveResultImage(image, outputDirectory, mimeType) {
  const extension = mimeType === "image/jpeg" ? "jpg" : "png";
  const resultPath = path.join(outputDirectory, `result.${extension}`);

  if (image.startsWith("data:")) {
    const match = /^data:[^;,]+;base64,(.+)$/s.exec(image);

    if (!match) {
      throw new Error("The result image data URL is invalid.");
    }

    await writeFile(resultPath, Buffer.from(match[1], "base64"));
    return resultPath;
  }

  const response = await fetch(image);

  if (!response.ok) {
    throw new Error(`Unable to download result image: HTTP ${response.status}.`);
  }

  await writeFile(resultPath, Buffer.from(await response.arrayBuffer()));
  return resultPath;
}

function toDataURL(bytes, mimeType) {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function summarizeDataURL(value) {
  const comma = value.indexOf(",");
  const payload = comma >= 0 ? value.slice(comma + 1) : value;

  return {
    mediaType: value.slice(5, value.indexOf(";")),
    base64Length: payload.length,
    sha256: createHash("sha256").update(payload).digest("hex")
  };
}

function formatAngle(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}°`;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function slugify(value) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "") || "case"
  );
}
