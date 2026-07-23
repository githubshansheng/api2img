import { existsSync, realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createCanvas } from "canvas";
import * as THREE from "three";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const options = parseArguments(process.argv.slice(2));
const cleanPath = resolveArchivedOutputPath(
  options.clean ??
    path.join(SCRIPT_DIRECTORY, "fan-side-right-90-scene-guide-clean.png")
);
const annotatedPath = resolveArchivedOutputPath(
  options.annotated ??
    path.join(SCRIPT_DIRECTORY, "fan-side-right-90-scene-guide-camera.png")
);

await mkdir(path.dirname(cleanPath), { recursive: true });
await mkdir(path.dirname(annotatedPath), { recursive: true });

const cleanCanvas = createCanvas(1536, 1024);
const cleanContext = cleanCanvas.getContext("2d");
const camera = buildTargetCamera(cleanCanvas.width / cleanCanvas.height);

drawCleanScene(cleanContext, cleanCanvas.width, cleanCanvas.height, camera);

const annotatedCanvas = createCanvas(1800, 1024);
const annotatedContext = annotatedCanvas.getContext("2d");
annotatedContext.fillStyle = "#eef2f5";
annotatedContext.fillRect(0, 0, annotatedCanvas.width, annotatedCanvas.height);
annotatedContext.drawImage(cleanCanvas, 0, 0, 1380, 920);
annotatedContext.save();
annotatedContext.scale(
  1380 / cleanCanvas.width,
  920 / cleanCanvas.height
);
drawProjectionCallouts(annotatedContext, camera, {
  x: 0,
  y: 0,
  width: cleanCanvas.width,
  height: cleanCanvas.height
});
annotatedContext.restore();
drawAnnotationPanel(annotatedContext, 1380, 0, 420, 1024);
drawTopDownMap(annotatedContext, {
  x: 1410,
  y: 410,
  width: 360,
  height: 550
});

await Promise.all([
  writeFile(cleanPath, cleanCanvas.toBuffer("image/png")),
  writeFile(annotatedPath, annotatedCanvas.toBuffer("image/png"))
]);

console.log(
  JSON.stringify({
    event: "fan-side-scene-guide-created",
    cleanPath,
    annotatedPath
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

  return {
    clean: values.get("clean"),
    annotated: values.get("annotated")
  };
}

function buildTargetCamera(aspect) {
  const camera = new THREE.PerspectiveCamera(43, aspect, 0.1, 100);
  camera.position.set(12.2, 3.25, 0.55);
  camera.lookAt(new THREE.Vector3(1.6, 2.25, -0.35));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function drawCleanScene(context, width, height, camera) {
  const viewport = { x: 0, y: 0, width, height };
  const faces = [];

  context.fillStyle = "#f3f5f7";
  context.fillRect(0, 0, width, height);

  addBox(faces, {
    min: [-6.4, -0.2, -5.4],
    max: [6.3, 0, 3.5],
    color: "#d9dde0",
    name: "floor"
  });
  addBox(faces, {
    min: [-6.4, 0, -5.55],
    max: [6.3, 5.8, -5.35],
    color: "#e8e5df",
    name: "rear-wall"
  });
  addBox(faces, {
    min: [-6.4, 0, -5.35],
    max: [-6.2, 5.8, 3.5],
    color: "#ece9e3",
    name: "left-wall"
  });

  addBox(faces, {
    min: [-6.1, 0.15, -3.85],
    max: [3.15, 1.2, -2.25],
    color: "#c7a679",
    name: "back-cabinets"
  });
  addBox(faces, {
    min: [-6.15, 1.2, -3.95],
    max: [3.25, 1.36, -2.1],
    color: "#ebe8e0",
    name: "back-counter"
  });
  addBox(faces, {
    min: [-5.8, 1.36, -3.7],
    max: [-4.2, 2.2, -2.35],
    color: "#d9d9d4",
    name: "stove"
  });
  addBox(faces, {
    min: [-4.95, 2.8, -5.25],
    max: [-3.35, 3.35, -4.65],
    color: "#b8bec2",
    name: "hood"
  });
  addBox(faces, {
    min: [-3.2, 1.36, -3.55],
    max: [-1.55, 2.35, -2.4],
    color: "#eee9df",
    name: "toaster"
  });
  addBox(faces, {
    min: [-1.15, 1.36, -3.3],
    max: [-0.25, 2.25, -2.5],
    color: "#e5e2da",
    name: "kettle"
  });
  addBox(faces, {
    min: [3.55, 0, -4.55],
    max: [5.45, 4.8, -2.35],
    color: "#e7e7e2",
    name: "fridge"
  });
  addBox(faces, {
    min: [0.2, 2.2, -5.3],
    max: [2.85, 4.75, -5.05],
    color: "#c8e4ec",
    name: "window"
  });
  addBox(faces, {
    min: [-2.6, 3.55, -5.15],
    max: [-0.35, 3.75, -4.65],
    color: "#b88e55",
    name: "shelf"
  });

  addBox(faces, {
    min: [-5.6, 0.15, -0.55],
    max: [5.2, 1.15, 2.45],
    color: "#c79f6b",
    name: "island"
  });
  addBox(faces, {
    min: [-5.8, 1.15, -0.75],
    max: [5.4, 1.34, 2.65],
    color: "#ddbd8f",
    name: "island-top"
  });

  addCylinder(faces, {
    center: [-1.85, 1.48, 0.7],
    radius: 0.75,
    height: 0.18,
    color: "#b69055",
    name: "fruit-bowl"
  });
  addSphere(faces, {
    center: [-1.85, 1.82, 0.7],
    radius: 0.52,
    color: "#92a946",
    name: "fruit"
  });
  addCylinder(faces, {
    center: [0.6, 1.82, 0.65],
    radius: 0.32,
    height: 0.95,
    color: "#afcfda",
    opacity: 0.78,
    name: "glass"
  });
  addBox(faces, {
    min: [3.45, 1.36, 0.15],
    max: [5.0, 1.47, 1.65],
    color: "#e5e2d9",
    name: "magazine"
  });

  addFan(faces);

  faces.sort((left, right) => right.depth(camera) - left.depth(camera));

  for (const face of faces) {
    face.draw(context, camera, viewport);
  }
}

function addFan(faces) {
  addCylinder(faces, {
    center: [2.15, 1.47, 0.62],
    radius: 0.92,
    height: 0.34,
    color: "#e4e7e9",
    name: "fan-base"
  });
  addBox(faces, {
    min: [1.98, 1.52, 0.35],
    max: [2.32, 2.45, 0.89],
    color: "#e9ecee",
    name: "fan-neck"
  });

  const center = new THREE.Vector3(2.15, 3.15, 0.62);
  const frontZ = 0.23;
  const backZ = 1.02;
  const radius = 1.38;
  const front = sampleVerticalCircle(center.x, center.y, frontZ, radius, 96);
  const back = sampleVerticalCircle(center.x, center.y, backZ, radius, 96);

  faces.push(makePolygonFace(back, "#d3d9dd", "fan-back-cage"));

  for (let index = 0; index < front.length; index += 8) {
    faces.push(
      makeLineFace(
        [front[index], back[index]],
        "#8897a3",
        5,
        "fan-cage-depth"
      )
    );
  }

  for (let index = 0; index < 40; index += 1) {
    const angle = (index / 40) * Math.PI * 2;
    const outer = new THREE.Vector3(
      center.x + Math.cos(angle) * radius,
      center.y + Math.sin(angle) * radius,
      frontZ
    );
    const inner = new THREE.Vector3(
      center.x + Math.cos(angle + 0.16) * 0.3,
      center.y + Math.sin(angle + 0.16) * 0.3,
      frontZ - 0.02
    );
    faces.push(
      makeLineFace([inner, outer], "#9aa7b1", 2.4, "fan-spoke")
    );
  }

  const cap = sampleVerticalCircle(
    center.x,
    center.y,
    frontZ - 0.03,
    0.34,
    64
  );
  faces.push(makePolygonFace(cap, "#f2f4f5", "fan-cap"));
  faces.push(makeLoopFace(back, "#697b89", 7, "fan-back-loop"));
  faces.push(makeLoopFace(front, "#536977", 9, "fan-front-loop"));

  const housingFront = sampleVerticalCircle(
    center.x,
    center.y,
    0.72,
    0.72,
    64
  );
  const housingBack = sampleVerticalCircle(
    center.x,
    center.y,
    1.34,
    0.72,
    64
  );
  faces.push(makePolygonFace(housingBack, "#aeb9c1", "fan-motor"));
  faces.push(makeLoopFace(housingFront, "#788995", 5, "fan-housing-front"));
  faces.push(makeLoopFace(housingBack, "#788995", 5, "fan-housing-back"));
}

function addBox(faces, { min, max, color, name }) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const vertices = [
    new THREE.Vector3(x0, y0, z0),
    new THREE.Vector3(x1, y0, z0),
    new THREE.Vector3(x1, y1, z0),
    new THREE.Vector3(x0, y1, z0),
    new THREE.Vector3(x0, y0, z1),
    new THREE.Vector3(x1, y0, z1),
    new THREE.Vector3(x1, y1, z1),
    new THREE.Vector3(x0, y1, z1)
  ];
  const definitions = [
    [0, 1, 2, 3],
    [4, 7, 6, 5],
    [0, 4, 5, 1],
    [3, 2, 6, 7],
    [1, 5, 6, 2],
    [0, 3, 7, 4]
  ];

  definitions.forEach((indices, index) => {
    faces.push(
      makePolygonFace(
        indices.map((vertexIndex) => vertices[vertexIndex]),
        shade(color, 1 - index * 0.045),
        `${name}-${index}`
      )
    );
  });
}

function addCylinder(
  faces,
  { center, radius, height, color, opacity = 1, name }
) {
  const [cx, cy, cz] = center;
  const bottomY = cy - height / 2;
  const topY = cy + height / 2;
  const top = [];
  const bottom = [];

  for (let index = 0; index < 48; index += 1) {
    const angle = (index / 48) * Math.PI * 2;
    const x = cx + Math.cos(angle) * radius;
    const z = cz + Math.sin(angle) * radius;
    top.push(new THREE.Vector3(x, topY, z));
    bottom.push(new THREE.Vector3(x, bottomY, z));
  }

  faces.push(makePolygonFace(top, color, `${name}-top`, opacity));

  for (let index = 0; index < 48; index += 4) {
    const next = (index + 4) % 48;
    faces.push(
      makePolygonFace(
        [bottom[index], bottom[next], top[next], top[index]],
        shade(color, 0.88),
        `${name}-side-${index}`,
        opacity
      )
    );
  }
}

function addSphere(faces, { center, radius, color, name }) {
  const [cx, cy, cz] = center;

  for (let latitude = -2; latitude < 2; latitude += 1) {
    const low = (latitude / 4) * Math.PI;
    const high = ((latitude + 1) / 4) * Math.PI;
    const ring = [];

    for (let index = 0; index < 32; index += 1) {
      const angle = (index / 32) * Math.PI * 2;
      ring.push(
        new THREE.Vector3(
          cx + Math.cos(angle) * Math.cos((low + high) / 2) * radius,
          cy + Math.sin((low + high) / 2) * radius,
          cz + Math.sin(angle) * Math.cos((low + high) / 2) * radius
        )
      );
    }

    faces.push(
      makePolygonFace(
        ring,
        shade(color, 0.94 + (latitude + 2) * 0.025),
        `${name}-${latitude}`
      )
    );
  }
}

function makePolygonFace(points, color, name, opacity = 1) {
  return {
    name,
    depth(camera) {
      return averageDistance(points, camera.position);
    },
    draw(context, camera, viewport) {
      const projected = points.map((point) =>
        project(point, camera, viewport)
      );
      context.save();
      context.globalAlpha = opacity;
      context.fillStyle = color;
      context.strokeStyle = shade(color, 0.72);
      context.lineWidth = 1.5;
      pathPolygon(context, projected);
      context.fill();
      context.stroke();
      context.restore();
    }
  };
}

function makeLineFace(points, color, width, name) {
  return {
    name,
    depth(camera) {
      return averageDistance(points, camera.position);
    },
    draw(context, camera, viewport) {
      const projected = points.map((point) =>
        project(point, camera, viewport)
      );
      context.strokeStyle = color;
      context.lineWidth = width;
      context.beginPath();
      context.moveTo(projected[0].x, projected[0].y);
      for (let index = 1; index < projected.length; index += 1) {
        context.lineTo(projected[index].x, projected[index].y);
      }
      context.stroke();
    }
  };
}

function makeLoopFace(points, color, width, name) {
  return {
    name,
    depth(camera) {
      return averageDistance(points, camera.position) - 0.01;
    },
    draw(context, camera, viewport) {
      const projected = points.map((point) =>
        project(point, camera, viewport)
      );
      context.strokeStyle = color;
      context.lineWidth = width;
      pathPolygon(context, projected);
      context.stroke();
    }
  };
}

function drawProjectionCallouts(context, camera, viewport) {
  const fanCenter = project(
    new THREE.Vector3(2.15, 3.15, 0.62),
    camera,
    viewport
  );
  const tableNear = project(
    new THREE.Vector3(5.4, 1.34, 2.65),
    camera,
    viewport
  );
  const tableFar = project(
    new THREE.Vector3(-5.8, 1.34, -0.75),
    camera,
    viewport
  );

  context.save();
  context.strokeStyle = "rgba(30, 161, 180, 0.72)";
  context.lineWidth = 3;
  context.setLineDash([12, 10]);
  context.beginPath();
  context.moveTo(tableNear.x, tableNear.y);
  context.lineTo(tableFar.x, tableFar.y);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = "#1596aa";
  context.beginPath();
  context.arc(fanCenter.x, fanCenter.y, 8, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawAnnotationPanel(context, x, y, width, height) {
  context.fillStyle = "#101820";
  context.fillRect(x, y, width, height);
  context.strokeStyle = "#2ab0c2";
  context.lineWidth = 3;
  context.strokeRect(x + 18, y + 18, width - 36, height - 36);

  context.fillStyle = "#eaf2f5";
  context.font = '700 31px "Segoe UI", sans-serif';
  context.fillText("FULL XYZ CAMERA", x + 40, y + 66);
  context.fillStyle = "#7ed5df";
  context.font = '700 25px "Consolas", monospace';
  context.fillText("X = +0 deg", x + 40, y + 118);
  context.fillText("Y = +90 deg", x + 40, y + 158);
  context.fillText("Z = +0 deg", x + 40, y + 198);

  context.fillStyle = "#d6e1e5";
  context.font = '600 22px "Segoe UI", sans-serif';
  const lines = [
    "Target: strict camera-right side",
    "Motion: camera orbit only",
    "Fan and kitchen stay fixed",
    "Roll: 0 deg",
    "Distance: medium / 5.0",
    "All depth layers reproject"
  ];
  lines.forEach((line, index) => {
    context.fillText(line, x + 40, y + 250 + index * 34);
  });
}

function drawTopDownMap(context, viewport) {
  const map = (worldX, worldZ) => ({
    x: viewport.x + ((worldX + 7) / 20) * viewport.width,
    y: viewport.y + ((worldZ + 7) / 14) * viewport.height
  });

  context.fillStyle = "#17232d";
  context.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
  context.strokeStyle = "#405360";
  context.lineWidth = 2;

  for (let worldX = -6; worldX <= 12; worldX += 2) {
    const start = map(worldX, -6);
    const end = map(worldX, 6);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  }

  for (let worldZ = -6; worldZ <= 6; worldZ += 2) {
    const start = map(-6, worldZ);
    const end = map(12, worldZ);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  }

  drawMapRect(context, map, [-5.8, -0.75], [5.4, 2.65], "#b99665");
  drawMapRect(context, map, [-6.15, -3.95], [3.25, -2.1], "#aeb9c1");
  drawMapRect(context, map, [3.55, -4.55], [5.45, -2.35], "#e7e7e2");

  const fan = map(2.15, 0.62);
  context.fillStyle = "#f2f4f5";
  context.strokeStyle = "#67c7d3";
  context.lineWidth = 4;
  context.beginPath();
  context.arc(fan.x, fan.y, 16, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  const camera = map(12.2, 0.55);
  context.fillStyle = "#ef6262";
  context.beginPath();
  context.arc(camera.x, camera.y, 13, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "#ef6262";
  context.lineWidth = 5;
  drawArrow(context, camera.x, camera.y, fan.x + 18, fan.y);

  context.fillStyle = "#eaf2f5";
  context.font = '700 20px "Segoe UI", sans-serif';
  context.fillText("TOP-DOWN CAMERA ORBIT", viewport.x + 16, viewport.y + 30);
  context.fillStyle = "#ef8a8a";
  context.fillText("CAMERA +YAW 90", camera.x - 154, camera.y - 22);
  context.fillStyle = "#8bd7e0";
  context.fillText("FIXED FAN", fan.x - 46, fan.y - 24);
}

function drawMapRect(context, map, min, max, color) {
  const topLeft = map(min[0], min[1]);
  const bottomRight = map(max[0], max[1]);
  context.fillStyle = color;
  context.fillRect(
    topLeft.x,
    topLeft.y,
    bottomRight.x - topLeft.x,
    bottomRight.y - topLeft.y
  );
  context.strokeStyle = shade(color, 0.7);
  context.lineWidth = 2;
  context.strokeRect(
    topLeft.x,
    topLeft.y,
    bottomRight.x - topLeft.x,
    bottomRight.y - topLeft.y
  );
}

function sampleVerticalCircle(cx, cy, z, radius, count) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return new THREE.Vector3(
      cx + Math.cos(angle) * radius,
      cy + Math.sin(angle) * radius,
      z
    );
  });
}

function project(point, camera, viewport) {
  const projected = point.clone().project(camera);
  return {
    x: viewport.x + (projected.x * 0.5 + 0.5) * viewport.width,
    y: viewport.y + (-projected.y * 0.5 + 0.5) * viewport.height
  };
}

function averageDistance(points, cameraPosition) {
  return (
    points.reduce(
      (total, point) => total + point.distanceTo(cameraPosition),
      0
    ) / points.length
  );
}

function pathPolygon(context, points) {
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.closePath();
}

function drawArrow(context, startX, startY, endX, endY) {
  const angle = Math.atan2(endY - startY, endX - startX);
  context.beginPath();
  context.moveTo(startX, startY);
  context.lineTo(endX, endY);
  context.stroke();
  context.beginPath();
  context.moveTo(endX, endY);
  context.lineTo(
    endX - Math.cos(angle - Math.PI / 6) * 18,
    endY - Math.sin(angle - Math.PI / 6) * 18
  );
  context.lineTo(
    endX - Math.cos(angle + Math.PI / 6) * 18,
    endY - Math.sin(angle + Math.PI / 6) * 18
  );
  context.closePath();
  context.fill();
}

function shade(hex, factor) {
  const value = hex.replace("#", "");
  const red = Math.max(
    0,
    Math.min(255, Math.round(Number.parseInt(value.slice(0, 2), 16) * factor))
  );
  const green = Math.max(
    0,
    Math.min(255, Math.round(Number.parseInt(value.slice(2, 4), 16) * factor))
  );
  const blue = Math.max(
    0,
    Math.min(255, Math.round(Number.parseInt(value.slice(4, 6), 16) * factor))
  );
  return `#${red.toString(16).padStart(2, "0")}${green
    .toString(16)
    .padStart(2, "0")}${blue.toString(16).padStart(2, "0")}`;
}

function resolveArchivedOutputPath(requestedPath) {
  const outputPath = path.resolve(requestedPath);
  const canonicalArchiveRoot = resolveCanonicalPath(ARCHIVE_ROOT);
  const canonicalOutputPath = resolveCanonicalPath(outputPath);
  const relativePath = path.relative(canonicalArchiveRoot, canonicalOutputPath);

  if (
    relativePath &&
    !relativePath.startsWith(`..${path.sep}`) &&
    relativePath !== ".." &&
    !path.isAbsolute(relativePath)
  ) {
    return outputPath;
  }

  throw new Error(`Camera guide output must stay inside ${ARCHIVE_ROOT}.`);
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
