import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, "..");
const outputDirectory = path.join(
  workspaceRoot,
  "archive",
  "camera-test",
  "ui-qa"
);
fs.mkdirSync(outputDirectory, { recursive: true });
const vertexCount = 1200;
const properties = [
  "x",
  "y",
  "z",
  "f_dc_0",
  "f_dc_1",
  "f_dc_2",
  "opacity",
  "scale_0",
  "scale_1",
  "scale_2",
  "rot_0",
  "rot_1",
  "rot_2",
  "rot_3"
];
const header = [
  "ply",
  "format binary_little_endian 1.0",
  `element vertex ${vertexCount}`,
  ...properties.map((property) => `property float ${property}`),
  "end_header",
  ""
].join("\n");
const rowBytes = properties.length * 4;
const body = Buffer.alloc(vertexCount * rowBytes);
const shCoefficient = 0.28209479177387814;

for (let index = 0; index < vertexCount; index += 1) {
  const ratio = (index + 0.5) / vertexCount;
  const y = 1 - ratio * 2;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = Math.PI * (3 - Math.sqrt(5)) * index;
  let x = Math.cos(theta) * radius;
  let pointY = y;
  let z = Math.sin(theta) * radius;

  if (index < 6) {
    const extrema = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1]
    ];
    [x, pointY, z] = extrema[index];
  }

  const stripe = (Math.atan2(z, x) + Math.PI) / (Math.PI * 2);
  const red = 52 + 185 * stripe;
  const green = 205 - 105 * Math.abs(pointY);
  const blue = 235 - 120 * stripe;
  const values = [
    x,
    pointY,
    z,
    (red / 255 - 0.5) / shCoefficient,
    (green / 255 - 0.5) / shCoefficient,
    (blue / 255 - 0.5) / shCoefficient,
    5.2,
    Math.log(0.055),
    Math.log(0.055),
    Math.log(0.055),
    1,
    0,
    0,
    0
  ];

  values.forEach((value, propertyIndex) => {
    body.writeFloatLE(value, index * rowBytes + propertyIndex * 4);
  });
}

fs.writeFileSync(
  path.join(outputDirectory, "vector3d-test-splat.ply"),
  Buffer.concat([Buffer.from(header), body])
);

const png = new PNG({ width: 960, height: 540 });

for (let y = 0; y < png.height; y += 1) {
  for (let x = 0; x < png.width; x += 1) {
    const offset = (y * png.width + x) * 4;
    const nx = x / png.width;
    const ny = y / png.height;
    const ring = Math.hypot(nx - 0.5, ny - 0.5);
    png.data[offset] = Math.round(22 + nx * 55 + (ring < 0.27 ? 35 : 0));
    png.data[offset + 1] = Math.round(38 + (1 - ny) * 92 + (ring < 0.27 ? 95 : 0));
    png.data[offset + 2] = Math.round(54 + nx * 110 + (ring < 0.27 ? 80 : 0));
    png.data[offset + 3] = 255;
  }
}

fs.writeFileSync(
  path.join(outputDirectory, "vector3d-source-reference.png"),
  PNG.sync.write(png)
);
