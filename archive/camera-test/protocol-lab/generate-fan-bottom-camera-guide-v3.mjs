import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createCanvas } from "canvas";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const archiveRoot = path.resolve(scriptDirectory, "..");
const outputPath = path.join(
  scriptDirectory,
  "fan-bottom-camera-guide-minus75-v3.png"
);

const canvas = createCanvas(1600, 1000);
const ctx = canvas.getContext("2d");

drawBackground();
drawHeader();
drawSideAssemblyPanel();
drawFrontCameraPanel();

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, canvas.toBuffer("image/png"));

const relativeOutput = path.relative(archiveRoot, outputPath);
if (relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput)) {
  throw new Error("Camera guide output escaped the camera-test archive.");
}

console.log(JSON.stringify({ event: "camera-guide-created", outputPath }));

function drawBackground() {
  ctx.fillStyle = "#eef2f6";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  panel(32, 128, 980, 830);
  panel(1040, 128, 528, 830);
}

function drawHeader() {
  ctx.fillStyle = "#16202b";
  ctx.font = '700 38px "Segoe UI", Arial, sans-serif';
  ctx.fillText("CAMERA POSE LOCK", 52, 62);

  ctx.fillStyle = "#137c8b";
  ctx.font = '700 30px "Segoe UI", Arial, sans-serif';
  ctx.fillText("YAW 0 deg   |   PITCH X = -75 deg   |   ROLL 0 deg", 445, 62);

  ctx.fillStyle = "#536475";
  ctx.font = '600 21px "Segoe UI", Arial, sans-serif';
  ctx.fillText(
    "Move the camera below the fixed product. Recompute the final 2D projection from this camera.",
    52,
    102
  );
}

function drawSideAssemblyPanel() {
  const left = 62;
  const top = 160;

  sectionTitle(left, top, "WORLD ASSEMBLY: SIDE ORTHOGRAPHIC");

  ctx.fillStyle = "#607080";
  ctx.font = '600 19px "Segoe UI", Arial, sans-serif';
  ctx.fillText("FRONT", 88, 230);
  ctx.fillText("REAR", 890, 230);

  ctx.strokeStyle = "#b8c4cf";
  ctx.lineWidth = 4;
  line(90, 820, 944, 820);
  ctx.fillStyle = "#607080";
  ctx.fillText("TABLE PLANE", 96, 854);

  ctx.fillStyle = "#dce5ec";
  ctx.strokeStyle = "#43596b";
  ctx.lineWidth = 6;
  roundedRect(474, 752, 250, 68, 28);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#edf2f5";
  roundedRect(568, 498, 62, 270, 20);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "#6f8190";
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.moveTo(600, 518);
  ctx.lineTo(600, 468);
  ctx.lineTo(646, 430);
  ctx.stroke();

  ctx.fillStyle = "#d4dee6";
  ctx.strokeStyle = "#43596b";
  ctx.lineWidth = 6;
  roundedRect(418, 306, 330, 138, 54);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "#ef5b5b";
  ctx.lineWidth = 8;
  arrow(446, 375, 782, 375, "#ef5b5b", 8);
  ctx.fillStyle = "#c53f3f";
  ctx.font = '700 21px "Segoe UI", Arial, sans-serif';
  ctx.fillText("HORIZONTAL MOTOR AXIS", 602, 344);

  ctx.strokeStyle = "#263746";
  ctx.lineWidth = 22;
  line(406, 164, 406, 570);
  ctx.strokeStyle = "#93a4b3";
  ctx.lineWidth = 5;
  line(388, 164, 388, 570);
  line(424, 164, 424, 570);

  ctx.fillStyle = "#263746";
  ctx.font = '700 22px "Segoe UI", Arial, sans-serif';
  ctx.fillText("VERTICAL GRILLE PLANE", 92, 272);
  arrow(296, 282, 390, 316, "#263746", 5);

  ctx.fillStyle = "#137c8b";
  ctx.font = '700 21px "Segoe UI", Arial, sans-serif';
  ctx.fillText("NECK JOINS REAR-LOWER HOUSING", 536, 470);

  drawCamera(316, 760, -75);
  arrow(330, 708, 390, 392, "#10a2b6", 7, true);

  ctx.fillStyle = "#087a8a";
  ctx.font = '700 25px "Segoe UI", Arial, sans-serif';
  ctx.fillText("LOW CAMERA BELOW FRONT", 90, 646);
  ctx.font = '600 21px "Segoe UI", Arial, sans-serif';
  ctx.fillText("Optical axis looks upward about 75 deg", 90, 678);

  ctx.fillStyle = "#2b6f4a";
  ctx.font = '700 23px "Segoe UI", Arial, sans-serif';
  ctx.fillText("PRODUCT WORLD ASSEMBLY STAYS FIXED", 430, 910);
}

function drawFrontCameraPanel() {
  const left = 1070;
  const top = 160;

  sectionTitle(left, top, "FRONT-CENTER CAMERA ALIGNMENT");

  ctx.strokeStyle = "#c2ccd5";
  ctx.lineWidth = 3;
  line(1304, 220, 1304, 850);

  ctx.fillStyle = "#e5edf2";
  ctx.strokeStyle = "#43596b";
  ctx.lineWidth = 7;
  circle(1304, 390, 178);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "#91a1af";
  ctx.lineWidth = 3;
  for (let index = 0; index < 24; index += 1) {
    const angle = (index / 24) * Math.PI * 2;
    line(
      1304 + Math.cos(angle) * 34,
      390 + Math.sin(angle) * 34,
      1304 + Math.cos(angle) * 170,
      390 + Math.sin(angle) * 170
    );
  }

  ctx.fillStyle = "#f7fafb";
  ctx.strokeStyle = "#43596b";
  ctx.lineWidth = 5;
  circle(1304, 390, 38);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#edf2f5";
  roundedRect(1274, 566, 60, 194, 18);
  ctx.fill();
  ctx.stroke();

  roundedRect(1204, 748, 200, 62, 24);
  ctx.fill();
  ctx.stroke();

  drawCamera(1304, 878, -90);
  arrow(1304, 850, 1304, 586, "#10a2b6", 7, true);

  ctx.fillStyle = "#485b6c";
  ctx.font = '600 20px "Segoe UI", Arial, sans-serif';
  ctx.fillText("No yaw offset", 1110, 246);
  ctx.fillText("Roll = 0 deg", 1372, 246);
  ctx.fillText("Horizon remains level", 1160, 948);
}

function sectionTitle(x, y, text) {
  ctx.fillStyle = "#1d2a36";
  ctx.font = '700 28px "Segoe UI", Arial, sans-serif';
  ctx.fillText(text, x, y + 20);
}

function drawCamera(x, y, rotationDegrees) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rotationDegrees * Math.PI) / 180);
  ctx.fillStyle = "#10a2b6";
  ctx.strokeStyle = "#087a8a";
  ctx.lineWidth = 4;
  roundedRect(-42, -26, 84, 52, 12);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(42, -16);
  ctx.lineTo(76, -30);
  ctx.lineTo(76, 30);
  ctx.lineTo(42, 16);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function panel(x, y, width, height) {
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ced7df";
  ctx.lineWidth = 2;
  roundedRect(x, y, width, height, 18);
  ctx.fill();
  ctx.stroke();
}

function roundedRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function circle(x, y, radius) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
}

function line(x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function arrow(x1, y1, x2, y2, color, width, dashed = false) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = 18;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  if (dashed) {
    ctx.setLineDash([16, 12]);
  }
  line(x1, y1, x2, y2);
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - head * Math.cos(angle - Math.PI / 6),
    y2 - head * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    x2 - head * Math.cos(angle + Math.PI / 6),
    y2 - head * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
