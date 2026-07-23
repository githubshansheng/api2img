import { existsSync, realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createCanvas } from "canvas";
import * as THREE from "three";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const CAMERA_TEST_ARCHIVE_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const outputPath = resolveArchivedOutputPath(
  readArgument("--output") ??
    path.join(SCRIPT_DIRECTORY, "fan-bottom-vertical-camera-guide.png")
);
const elevationDegrees = Number(readArgument("--elevation") ?? "-75");
const azimuthDegrees = Number(readArgument("--azimuth") ?? "0");

if (
  !Number.isFinite(elevationDegrees) ||
  elevationDegrees === 0 ||
  Math.abs(elevationDegrees) >= 90 ||
  !Number.isFinite(azimuthDegrees)
) {
  throw new Error(
    "--elevation must be a finite non-zero angle between -90 and 90 degrees."
  );
}

await mkdir(path.dirname(outputPath), { recursive: true });

const width = 1600;
const height = 1000;
const canvas = createCanvas(width, height);
const context = canvas.getContext("2d");

drawBackground(context, width, height);
drawTargetProjection(context, elevationDegrees, azimuthDegrees);
drawSideDiagram(context, elevationDegrees, azimuthDegrees);

await writeFile(outputPath, canvas.toBuffer("image/png"));
console.log(JSON.stringify({ event: "fan-camera-guide-created", outputPath }));

function drawBackground(ctx, canvasWidth, canvasHeight) {
  ctx.fillStyle = "#f4f6f8";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.fillStyle = "#ffffff";
  roundedRect(ctx, 30, 30, 1110, 940, 18);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  roundedRect(ctx, 1170, 30, 400, 940, 18);
  ctx.fill();

  ctx.strokeStyle = "#d8dee5";
  ctx.lineWidth = 2;
  roundedRect(ctx, 30, 30, 1110, 940, 18);
  ctx.stroke();
  roundedRect(ctx, 1170, 30, 400, 940, 18);
  ctx.stroke();
}

function drawTargetProjection(
  ctx,
  cameraElevationDegrees,
  cameraAzimuthDegrees
) {
  const viewport = { x: 55, y: 120, width: 1060, height: 810 };
  const camera = new THREE.PerspectiveCamera(
    38,
    viewport.width / viewport.height,
    0.1,
    100
  );
  const target = new THREE.Vector3(0, 0.2, 0);
  const distance = 8.2;
  const elevation = THREE.MathUtils.degToRad(cameraElevationDegrees);
  const azimuth = THREE.MathUtils.degToRad(cameraAzimuthDegrees);
  const horizontalDistance = Math.cos(elevation) * distance;

  camera.position.set(
    Math.sin(azimuth) * horizontalDistance,
    target.y + Math.sin(elevation) * distance,
    -Math.cos(azimuth) * horizontalDistance
  );
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  ctx.fillStyle = "#1f2933";
  ctx.font = '700 34px "Microsoft YaHei", "Segoe UI", sans-serif';
  ctx.fillText(
    `目标成像代理：固定竖直风扇，${
      cameraElevationDegrees > 0 ? "高机位" : "低机位"
    }相机`,
    65,
    82
  );

  const project = (point) => {
    const projected = point.clone().project(camera);
    return {
      x: viewport.x + ((projected.x + 1) / 2) * viewport.width,
      y: viewport.y + ((1 - projected.y) / 2) * viewport.height
    };
  };

  drawGroundGrid(ctx, project);
  drawBase(ctx, project);
  drawSupportNeck(ctx, project);
  drawRearHousing(ctx, project);
  drawCage(ctx, project);

  ctx.fillStyle = "#586675";
  ctx.font = '600 24px "Microsoft YaHei", "Segoe UI", sans-serif';
  ctx.fillText("屏幕投影压缩来自相机，不来自机头俯仰", 65, 950);
}

function drawGroundGrid(ctx, project) {
  ctx.save();
  ctx.strokeStyle = "#d5dde5";
  ctx.lineWidth = 1.5;

  for (let x = -4; x <= 4; x += 0.5) {
    drawWorldLine(
      ctx,
      project,
      new THREE.Vector3(x, -1.35, -2.5),
      new THREE.Vector3(x, -1.35, 4.5)
    );
  }

  for (let z = -2.5; z <= 4.5; z += 0.5) {
    drawWorldLine(
      ctx,
      project,
      new THREE.Vector3(-4, -1.35, z),
      new THREE.Vector3(4, -1.35, z)
    );
  }

  ctx.restore();
}

function drawBase(ctx, project) {
  const top = sampleHorizontalEllipse({
    center: new THREE.Vector3(0, -0.92, 0.18),
    radiusX: 1.65,
    radiusZ: 0.82,
    count: 96
  });
  const bottom = sampleHorizontalEllipse({
    center: new THREE.Vector3(0, -1.3, 0.18),
    radiusX: 1.65,
    radiusZ: 0.82,
    count: 96
  });

  fillProjectedPolygon(ctx, project, bottom, "#aeb9c4");
  fillProjectedPolygon(ctx, project, top, "#dbe2e8");
  strokeProjectedLoop(ctx, project, bottom, "#667788", 4);
  strokeProjectedLoop(ctx, project, top, "#667788", 4);

  for (const index of [8, 28, 52, 76]) {
    drawWorldLine(ctx, project, top[index], bottom[index], "#7f8d99", 3);
  }
}

function drawSupportNeck(ctx, project) {
  const frontZ = 0.72;
  const backZ = 1.14;
  const points = [
    new THREE.Vector3(-0.24, -0.94, frontZ),
    new THREE.Vector3(0.24, -0.94, frontZ),
    new THREE.Vector3(0.24, -0.22, frontZ),
    new THREE.Vector3(-0.24, -0.22, frontZ),
    new THREE.Vector3(-0.24, -0.94, backZ),
    new THREE.Vector3(0.24, -0.94, backZ),
    new THREE.Vector3(0.24, -0.22, backZ),
    new THREE.Vector3(-0.24, -0.22, backZ)
  ];

  fillProjectedPolygon(ctx, project, [points[0], points[1], points[2], points[3]], "#cbd5de");
  fillProjectedPolygon(ctx, project, [points[3], points[2], points[6], points[7]], "#b7c3cd");
  strokeProjectedSegments(
    ctx,
    project,
    [
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
    ],
    points,
    "#667788",
    4
  );
}

function drawRearHousing(ctx, project) {
  const centerY = 0.5;
  const radius = 0.82;
  const near = sampleVerticalCircle({
    centerY,
    radius,
    z: 0.24,
    count: 96
  });
  const far = sampleVerticalCircle({
    centerY,
    radius,
    z: 1.08,
    count: 96
  });

  fillProjectedPolygon(ctx, project, far, "#9eacb8");
  strokeProjectedLoop(ctx, project, far, "#617384", 4);

  const lowerHalf = [];
  for (let index = 48; index <= 96; index += 1) {
    lowerHalf.push(near[index % 96]);
  }
  for (let index = 96; index >= 48; index -= 1) {
    lowerHalf.push(far[index % 96]);
  }
  fillProjectedPolygon(ctx, project, lowerHalf, "#b8c4ce");

  for (const index of [0, 24, 48, 72]) {
    drawWorldLine(ctx, project, near[index], far[index], "#718292", 4);
  }

  strokeProjectedLoop(ctx, project, near, "#617384", 5);

  drawWorldLine(
    ctx,
    project,
    new THREE.Vector3(0, centerY, -0.42),
    new THREE.Vector3(0, centerY, 1.32),
    "#ef5b5b",
    8
  );
}

function drawCage(ctx, project) {
  const centerY = 0.72;
  const radius = 1.65;
  const frontZ = -0.34;
  const backZ = 0.2;
  const front = sampleVerticalCircle({
    centerY,
    radius,
    z: frontZ,
    count: 128
  });
  const back = sampleVerticalCircle({
    centerY,
    radius,
    z: backZ,
    count: 128
  });

  fillProjectedPolygon(ctx, project, back, "#c8d1d9");
  strokeProjectedLoop(ctx, project, back, "#536779", 7);

  for (let index = 0; index < 128; index += 8) {
    drawWorldLine(ctx, project, front[index], back[index], "#728394", 4);
  }

  for (let index = 0; index < 40; index += 1) {
    const angle = (index / 40) * Math.PI * 2;
    const outer = new THREE.Vector3(
      Math.cos(angle) * radius,
      centerY + Math.sin(angle) * radius,
      frontZ
    );
    const inner = new THREE.Vector3(
      Math.cos(angle + 0.18) * 0.35,
      centerY + Math.sin(angle + 0.18) * 0.35,
      frontZ - 0.01
    );
    drawWorldLine(ctx, project, inner, outer, "#8a98a5", 2.4);
  }

  const centerCap = sampleVerticalCircle({
    centerY,
    radius: 0.36,
    z: frontZ - 0.02,
    count: 80
  });
  fillProjectedPolygon(ctx, project, centerCap, "#eef2f5");
  strokeProjectedLoop(ctx, project, centerCap, "#536779", 4);
  strokeProjectedLoop(ctx, project, front, "#43596b", 10);
}

function drawSideDiagram(
  ctx,
  cameraElevationDegrees,
  cameraAzimuthDegrees
) {
  const panelX = 1200;

  ctx.fillStyle = "#1f2933";
  ctx.font = '700 31px "Microsoft YaHei", "Segoe UI", sans-serif';
  ctx.fillText("世界空间侧视", panelX, 82);

  ctx.strokeStyle = "#c8d1da";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(panelX + 20, 825);
  ctx.lineTo(panelX + 340, 825);
  ctx.stroke();

  ctx.strokeStyle = "#43596b";
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(panelX + 220, 225);
  ctx.lineTo(panelX + 220, 520);
  ctx.stroke();

  ctx.strokeStyle = "#7d8c99";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(panelX + 220, 520);
  ctx.lineTo(panelX + 250, 650);
  ctx.lineTo(panelX + 250, 735);
  ctx.stroke();

  ctx.fillStyle = "#dbe2e8";
  ctx.strokeStyle = "#667788";
  ctx.lineWidth = 4;
  roundedRect(ctx, panelX + 175, 725, 150, 70, 25);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "#ef5b5b";
  ctx.lineWidth = 7;
  drawArrow(ctx, panelX + 220, 365, panelX + 330, 365);

  ctx.fillStyle = "#536779";
  ctx.font = '600 21px "Microsoft YaHei", "Segoe UI", sans-serif';
  ctx.fillText("固定竖直网罩", panelX + 32, 195);
  ctx.fillStyle = "#d94848";
  ctx.fillText("水平电机轴 / 送风方向", panelX + 38, 335);

  const cameraX = panelX + 45;
  const cameraY = cameraElevationDegrees > 0 ? 190 : 800;
  ctx.fillStyle = "#16a3b6";
  roundedRect(ctx, cameraX, cameraY - 45, 82, 54, 8);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cameraX + 82, cameraY - 38);
  ctx.lineTo(cameraX + 120, cameraY - 20);
  ctx.lineTo(cameraX + 82, cameraY);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#16a3b6";
  ctx.lineWidth = 5;
  ctx.setLineDash([12, 10]);
  drawArrow(ctx, cameraX + 115, cameraY - 22, panelX + 210, 395);
  ctx.setLineDash([]);

  ctx.fillStyle = "#0c7f91";
  ctx.font = '700 23px "Microsoft YaHei", "Segoe UI", sans-serif';
  ctx.fillText(`相机 X=${cameraElevationDegrees}°`, panelX + 35, 865);
  ctx.fillText(`Y=${cameraAzimuthDegrees}°，只移动相机`, panelX + 35, 910);
}

function drawWorldLine(ctx, project, start, end, color = "#8090a0", width = 2) {
  const a = project(start);
  const b = project(end);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function strokeProjectedLoop(ctx, project, points, color, width) {
  const projected = points.map(project);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.beginPath();
  projected.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.closePath();
  ctx.stroke();
}

function fillProjectedPolygon(ctx, project, points, color) {
  const projected = points.map(project);
  ctx.fillStyle = color;
  ctx.beginPath();
  projected.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.closePath();
  ctx.fill();
}

function strokeProjectedSegments(
  ctx,
  project,
  segments,
  points,
  color,
  width
) {
  for (const [startIndex, endIndex] of segments) {
    drawWorldLine(
      ctx,
      project,
      points[startIndex],
      points[endIndex],
      color,
      width
    );
  }
}

function sampleVerticalCircle({ centerY, radius, z, count }) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return new THREE.Vector3(
      Math.cos(angle) * radius,
      centerY + Math.sin(angle) * radius,
      z
    );
  });
}

function sampleHorizontalEllipse({ center, radiusX, radiusZ, count }) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return new THREE.Vector3(
      center.x + Math.cos(angle) * radiusX,
      center.y,
      center.z + Math.sin(angle) * radiusZ
    );
  });
}

function drawArrow(ctx, startX, startY, endX, endY) {
  const angle = Math.atan2(endY - startY, endX - startX);
  const headLength = 18;

  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  ctx.fillStyle = ctx.strokeStyle;
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(
    endX - headLength * Math.cos(angle - Math.PI / 6),
    endY - headLength * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    endX - headLength * Math.cos(angle + Math.PI / 6),
    endY - headLength * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function readArgument(name) {
  const index = process.argv.indexOf(name);

  if (index < 0 || !process.argv[index + 1]) {
    return undefined;
  }

  return process.argv[index + 1];
}

function resolveArchivedOutputPath(requestedPath) {
  const output = path.resolve(requestedPath);
  const canonicalArchiveRoot = resolveCanonicalPath(CAMERA_TEST_ARCHIVE_ROOT);
  const canonicalOutput = resolveCanonicalPath(output);
  const relative = path.relative(canonicalArchiveRoot, canonicalOutput);

  if (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  ) {
    return output;
  }

  throw new Error(
    `Camera guide output must stay inside ${CAMERA_TEST_ARCHIVE_ROOT}.`
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
