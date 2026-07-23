import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "canvas";
import * as THREE from "three";
import {
  buildImageGaussianSplat,
  calculateProxySampleSize
} from "../src/components/vector3d/image-gaussian-proxy";
import {
  buildSingleImageCameraPose,
  clampSingleImageCameraDistance
} from "../src/domain/single-image-viewpoint";

const args = parseArguments(process.argv.slice(2));
const sourceBytes = await readFile(args.image);
const sourceImage = await loadImage(sourceBytes);
const sampleSize = calculateProxySampleSize(
  sourceImage.width,
  sourceImage.height,
  args.maxPoints
);
const sampleCanvas = createCanvas(sampleSize.width, sampleSize.height);
const sampleContext = sampleCanvas.getContext("2d");
sampleContext.drawImage(
  sourceImage,
  0,
  0,
  sampleSize.width,
  sampleSize.height
);
const sampledImage = sampleContext.getImageData(
  0,
  0,
  sampleSize.width,
  sampleSize.height
);
const proxy = buildImageGaussianSplat(
  {
    data: sampledImage.data,
    width: sampleSize.width,
    height: sampleSize.height
  },
  {
    maxPoints: args.maxPoints
  }
);
const output = renderDepthGuide({
  cameraDistance: args.distance,
  height: args.height,
  proxy,
  rotation: args.rotation,
  width: args.width
});

await writeFile(args.output, output);

console.log(
  JSON.stringify({
    event: "single-image-depth-guide-generated",
    output: args.output,
    outputSize: `${args.width}x${args.height}`,
    pointCount: proxy.vertexCount,
    rotation: args.rotation,
    sampleSize
  })
);

function renderDepthGuide(input: {
  cameraDistance: number;
  height: number;
  proxy: ReturnType<typeof buildImageGaussianSplat>;
  rotation: { x: number; y: number; z: number };
  width: number;
}) {
  const canvas = createCanvas(input.width, input.height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#081019";
  context.fillRect(0, 0, input.width, input.height);

  const camera = new THREE.PerspectiveCamera(
    34,
    input.width / input.height,
    0.1,
    100
  );
  const pose = buildSingleImageCameraPose(input.rotation);
  const quaternion = new THREE.Quaternion(
    pose.quaternion.x,
    pose.quaternion.y,
    pose.quaternion.z,
    pose.quaternion.w
  );
  const distance =
    8.4 - (clampSingleImageCameraDistance(input.cameraDistance) / 10) * 3.7;
  camera.position
    .set(0, 0, -distance)
    .applyQuaternion(quaternion);
  camera.up.set(0, 1, 0).applyQuaternion(quaternion);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  const focalScale =
    input.height /
    (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  const points: Array<{
    alpha: number;
    blue: number;
    depth: number;
    green: number;
    radius: number;
    red: number;
    x: number;
    y: number;
  }> = [];

  for (let index = 0; index < input.proxy.vertexCount; index += 1) {
    const positionOffset = index * 3;
    const colorOffset = index * 4;
    const world = new THREE.Vector3(
      -(input.proxy.positions[positionOffset] ?? 0),
      -(input.proxy.positions[positionOffset + 1] ?? 0),
      -(input.proxy.positions[positionOffset + 2] ?? 0)
    );
    const cameraSpace = world
      .clone()
      .applyMatrix4(camera.matrixWorldInverse);
    const depth = -cameraSpace.z;

    if (!Number.isFinite(depth) || depth <= camera.near) {
      continue;
    }

    const projected = world.clone().project(camera);

    if (
      projected.z < -1 ||
      projected.z > 1 ||
      projected.x < -1.2 ||
      projected.x > 1.2 ||
      projected.y < -1.2 ||
      projected.y > 1.2
    ) {
      continue;
    }

    const sourceRadius =
      ((input.proxy.scales[positionOffset] ?? 0.01) +
        (input.proxy.scales[positionOffset + 1] ?? 0.01)) /
      2;
    const radius = clamp((sourceRadius * focalScale * 3.4) / depth, 0.7, 7);

    points.push({
      alpha: (input.proxy.colors[colorOffset + 3] ?? 255) / 255,
      blue: input.proxy.colors[colorOffset + 2] ?? 0,
      depth,
      green: input.proxy.colors[colorOffset + 1] ?? 0,
      radius,
      red: input.proxy.colors[colorOffset] ?? 0,
      x: ((projected.x + 1) / 2) * input.width,
      y: ((1 - projected.y) / 2) * input.height
    });
  }

  points.sort((left, right) => right.depth - left.depth);

  for (const point of points) {
    context.globalAlpha = clamp(point.alpha * 0.88, 0.08, 1);
    context.fillStyle = `rgb(${point.red}, ${point.green}, ${point.blue})`;
    context.beginPath();
    context.ellipse(
      point.x,
      point.y,
      point.radius * 1.18,
      point.radius,
      0,
      0,
      Math.PI * 2
    );
    context.fill();
  }

  context.globalAlpha = 1;
  return canvas.toBuffer("image/png");
}

function parseArguments(args: string[]) {
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (!argument?.startsWith("--")) {
      continue;
    }

    const [name, inlineValue] = argument.slice(2).split("=", 2);
    const value =
      inlineValue ??
      (args[index + 1] && !args[index + 1]!.startsWith("--")
        ? args[++index]!
        : "true");
    values.set(name!, value);
  }

  const image = values.get("image");
  const output = values.get("output");

  if (!image || !output) {
    throw new Error(
      "Usage: npx tsx scripts/generate-single-image-depth-guide.ts --image <path> --output <path> [--x 0 --y 0 --z 0 --distance 5]"
    );
  }

  return {
    distance: readNumber(values.get("distance"), 5),
    height: Math.max(256, Math.round(readNumber(values.get("height"), 1536))),
    image: path.resolve(image),
    maxPoints: Math.max(
      4_000,
      Math.round(readNumber(values.get("max-points"), 72_000))
    ),
    output: path.resolve(output),
    rotation: {
      x: readNumber(values.get("x"), 0),
      y: readNumber(values.get("y"), 0),
      z: readNumber(values.get("z"), 0)
    },
    width: Math.max(256, Math.round(readNumber(values.get("width"), 1536)))
  };
}

function readNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
