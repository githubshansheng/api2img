import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const require = createRequire(import.meta.url);
const { chromium } = require(
  "C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\e6ff44ce4d342acd\\node_modules\\playwright-core"
);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, "..");
const artifactDirectory = path.join(
  workspaceRoot,
  "archive",
  "camera-test",
  "ui-qa",
  "outpaint-browser"
);
fs.mkdirSync(artifactDirectory, { recursive: true });
const sourcePath = path.join(
  workspaceRoot,
  "archive",
  "camera-test",
  "ui-qa",
  "vector3d-source-reference.png"
);
const edgePath =
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const pageURL = "http://127.0.0.1:8082/?page=outpaint";
const browserErrors = [];

function analyzePng(filename) {
  const image = PNG.sync.read(fs.readFileSync(filename));
  let chromaticPixels = 0;
  let luminanceTotal = 0;
  let luminanceSquaredTotal = 0;
  let sampledPixels = 0;

  for (let y = 0; y < image.height; y += 3) {
    for (let x = 0; x < image.width; x += 3) {
      const offset = (y * image.width + x) * 4;
      const red = image.data[offset];
      const green = image.data[offset + 1];
      const blue = image.data[offset + 2];
      const luminance = (red + green + blue) / 3;
      sampledPixels += 1;
      luminanceTotal += luminance;
      luminanceSquaredTotal += luminance * luminance;

      if (Math.max(red, green, blue) - Math.min(red, green, blue) > 24) {
        chromaticPixels += 1;
      }
    }
  }

  const mean = luminanceTotal / Math.max(1, sampledPixels);
  const variance =
    luminanceSquaredTotal / Math.max(1, sampledPixels) - mean * mean;

  return {
    width: image.width,
    height: image.height,
    chromaticPixels,
    luminanceStdDev: Math.sqrt(Math.max(0, variance))
  };
}

async function setNumericInput(page, label, value) {
  const input = page.getByLabel(label);
  await input.fill(String(value));
  await input.dispatchEvent("change");
}

const browser = await chromium.launch({
  executablePath: edgePath,
  headless: true,
  args: [
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--disable-background-networking"
  ]
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1
});
const page = await context.newPage();

page.on("console", (message) => {
  if (message.type() === "error") {
    browserErrors.push(message.text());
  }
});
page.on("pageerror", (error) => browserErrors.push(error.message));

try {
  await page.goto(pageURL, { waitUntil: "networkidle" });
  const outpaintIsolation = await page.evaluate(() => ({
    heading: document.querySelector(".page-heading h1")?.textContent?.trim(),
    singleImageWorkbenches: document.querySelectorAll(
      ".single-view-workbench"
    ).length,
    vector3DWorkbenches: document.querySelectorAll(
      ".vector3d-workbench"
    ).length
  }));

  if (
    outpaintIsolation.heading !== "单图 AI 新视角" ||
    outpaintIsolation.singleImageWorkbenches !== 1 ||
    outpaintIsolation.vector3DWorkbenches !== 0
  ) {
    throw new Error(
      `Single-image and 3DGS pages are not isolated: ${JSON.stringify(
        outpaintIsolation
      )}`
    );
  }

  await page.locator(
    'input[accept="image/png,image/jpeg,image/webp"]'
  ).setInputFiles(sourcePath);
  await page.getByText("vector3d-source-reference.png").waitFor();
  await page.locator(".single-view-viewport-empty.is-loading").waitFor({
    state: "detached",
    timeout: 20000
  });
  await page.locator('img[alt="姿态推理引导"]').waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector('img[alt="姿态推理引导"]')
      ?.getAttribute("src")
      ?.startsWith("data:image/png;base64,")
  );

  const canvas = page.locator(".single-view-pose-canvas");
  const canvasBox = await canvas.boundingBox();

  if (!canvasBox || canvasBox.width < 400 || canvasBox.height < 200) {
    throw new Error(
      `Desktop pose canvas has invalid dimensions: ${JSON.stringify(canvasBox)}`
    );
  }

  const canvasPath = path.join(artifactDirectory, "outpaint-canvas.png");
  await canvas.screenshot({ path: canvasPath });
  const canvasPixels = analyzePng(canvasPath);

  if (
    canvasPixels.chromaticPixels < 1000 ||
    canvasPixels.luminanceStdDev < 8
  ) {
    throw new Error(
      `Pose canvas appears blank: ${JSON.stringify(canvasPixels)}`
    );
  }

  const initialGuide = await page
    .locator('img[alt="姿态推理引导"]')
    .evaluate(async (image) => {
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      ).data;
      let brightPrimaryMarginPixels = 0;
      let opaqueSamples = 0;

      for (let y = 0; y < canvas.height; y += 4) {
        for (let x = 0; x < canvas.width; x += 4) {
          const isMargin =
            x < canvas.width * 0.08 ||
            x > canvas.width * 0.92 ||
            y < canvas.height * 0.14 ||
            y > canvas.height * 0.86;

          if (!isMargin) {
            continue;
          }

          const offset = (y * canvas.width + x) * 4;
          const red = pixels[offset];
          const green = pixels[offset + 1];
          const blue = pixels[offset + 2];

          if (pixels[offset + 3] > 0) {
            opaqueSamples += 1;
          }

          if (
            Math.max(red, green, blue) > 150 &&
            Math.max(red, green, blue) - Math.min(red, green, blue) > 90
          ) {
            brightPrimaryMarginPixels += 1;
          }
        }
      }

      return {
        width: canvas.width,
        height: canvas.height,
        brightPrimaryMarginPixels,
        opaqueSamples
      };
    });

  if (
    initialGuide.width !== 1536 ||
    initialGuide.height !== 864 ||
    initialGuide.opaqueSamples < 1000 ||
    initialGuide.brightPrimaryMarginPixels > 150
  ) {
    throw new Error(
      `Pose guide contains helper artifacts or invalid pixels: ${JSON.stringify(initialGuide)}`
    );
  }

  await setNumericInput(page, "X 轴角度数值", 720);
  await setNumericInput(page, "Y 轴角度数值", -450);
  await setNumericInput(page, "Z 轴角度数值", 45);

  const cumulative = {
    x: await page.getByLabel("X 轴角度数值").inputValue(),
    y: await page.getByLabel("Y 轴角度数值").inputValue(),
    z: await page.getByLabel("Z 轴角度数值").inputValue()
  };
  const axisText = await page
    .locator(".single-view-axis-console")
    .allTextContents();

  if (
    cumulative.x !== "720" ||
    cumulative.y !== "-450" ||
    cumulative.z !== "45" ||
    !axisText.join(" ").includes("等效 0°") ||
    !axisText.join(" ").includes("等效 -90°") ||
    !axisText.join(" ").includes("等效 45°")
  ) {
    throw new Error(
      `Cumulative XYZ controls failed: ${JSON.stringify({ cumulative, axisText })}`
    );
  }

  await page.getByRole("button", { name: "右前 45°" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Y 轴角度数值"]')?.value === "45"
  );

  const beforeDrag = {
    x: Number(await page.getByLabel("X 轴角度数值").inputValue()),
    y: Number(await page.getByLabel("Y 轴角度数值").inputValue())
  };
  const dragBox = await canvas.boundingBox();
  await page.mouse.move(
    dragBox.x + dragBox.width * 0.5,
    dragBox.y + dragBox.height * 0.5
  );
  await page.mouse.down();
  await page.mouse.move(
    dragBox.x + dragBox.width * 0.65,
    dragBox.y + dragBox.height * 0.42,
    { steps: 8 }
  );
  await page.mouse.up();
  const afterDrag = {
    x: Number(await page.getByLabel("X 轴角度数值").inputValue()),
    y: Number(await page.getByLabel("Y 轴角度数值").inputValue())
  };

  if (afterDrag.x === beforeDrag.x && afterDrag.y === beforeDrag.y) {
    throw new Error(
      `Pose drag did not update X/Y: ${JSON.stringify({ beforeDrag, afterDrag })}`
    );
  }

  await setNumericInput(page, "Y 轴角度数值", 720);
  const boundaryDragBox = await canvas.boundingBox();
  const boundaryStartX =
    boundaryDragBox.x + boundaryDragBox.width * 0.5;
  const boundaryStartY =
    boundaryDragBox.y + boundaryDragBox.height * 0.5;
  await page.mouse.move(boundaryStartX, boundaryStartY);
  await page.mouse.down();
  await page.mouse.move(boundaryStartX + 80, boundaryStartY, { steps: 4 });
  const clampedBoundary = Number(
    await page.getByLabel("Y 轴角度数值").inputValue()
  );
  await page.mouse.move(boundaryStartX + 70, boundaryStartY);
  const reversedBoundary = Number(
    await page.getByLabel("Y 轴角度数值").inputValue()
  );
  await page.mouse.up();

  if (clampedBoundary !== 720 || reversedBoundary >= 720) {
    throw new Error(
      `Boundary drag did not reverse immediately: ${JSON.stringify({
        clampedBoundary,
        reversedBoundary
      })}`
    );
  }

  await page.getByRole("button", { name: "重置 XYZ 姿态" }).click();
  await page.waitForFunction(() =>
    ["X", "Y", "Z"].every(
      (axis) =>
        document.querySelector(`[aria-label="${axis} 轴角度数值"]`)?.value ===
        "0"
    )
  );
  await setNumericInput(page, "Y 轴角度数值", 45);

  const desktopLayout = await page.evaluate(() => {
    const workbench = document.querySelector(".single-view-workbench");
    const mainGrid = document.querySelector(".single-view-main-grid");
    const canvas = document.querySelector(".single-view-pose-canvas");
    const canvasRect = canvas.getBoundingClientRect();

    return {
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      workbenchWidth: workbench.getBoundingClientRect().width,
      gridColumns: getComputedStyle(mainGrid).gridTemplateColumns,
      canvas: {
        width: canvasRect.width,
        height: canvasRect.height
      }
    };
  });

  if (
    desktopLayout.horizontalOverflow > 2 ||
    desktopLayout.workbenchWidth > 1600 ||
    desktopLayout.gridColumns.split(" ").length < 2
  ) {
    throw new Error(
      `Desktop layout failed: ${JSON.stringify(desktopLayout)}`
    );
  }

  const desktopPath = path.join(
    artifactDirectory,
    "outpaint-desktop.png"
  );
  await page.screenshot({ path: desktopPath, fullPage: false });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const mobileLayout = await page.evaluate(() => {
    const workbench = document.querySelector(".single-view-workbench");
    const mainGrid = document.querySelector(".single-view-main-grid");
    const canvas = document.querySelector(".single-view-pose-canvas");
    const slider = document.querySelector(
      '[aria-label="X 轴累计角度"]'
    );
    const canvasRect = canvas.getBoundingClientRect();
    const sliderRect = slider.getBoundingClientRect();

    return {
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      viewportWidth: innerWidth,
      workbenchWidth: workbench.getBoundingClientRect().width,
      gridColumns: getComputedStyle(mainGrid).gridTemplateColumns,
      canvas: {
        width: canvasRect.width,
        height: canvasRect.height
      },
      slider: {
        left: sliderRect.left,
        right: sliderRect.right,
        width: sliderRect.width
      }
    };
  });

  if (
    mobileLayout.horizontalOverflow > 2 ||
    mobileLayout.workbenchWidth > mobileLayout.viewportWidth ||
    mobileLayout.gridColumns.split(" ").length !== 1 ||
    mobileLayout.canvas.width < 300 ||
    mobileLayout.canvas.height < 160 ||
    mobileLayout.slider.left < 0 ||
    mobileLayout.slider.right > mobileLayout.viewportWidth
  ) {
    throw new Error(
      `Mobile layout failed: ${JSON.stringify(mobileLayout)}`
    );
  }

  const mobilePath = path.join(artifactDirectory, "outpaint-mobile.png");
  await page.screenshot({ path: mobilePath, fullPage: true });

  const viewpointPage = await context.newPage();
  await viewpointPage.goto(
    "http://127.0.0.1:8082/?page=viewpoint",
    { waitUntil: "networkidle" }
  );
  const viewpointIsolation = await viewpointPage.evaluate(() => ({
    heading: document.querySelector(".page-heading h1")?.textContent?.trim(),
    singleImageWorkbenches: document.querySelectorAll(
      ".single-view-workbench"
    ).length,
    vector3DWorkbenches: document.querySelectorAll(
      ".vector3d-workbench"
    ).length
  }));
  await viewpointPage.close();

  if (
    viewpointIsolation.heading !== "3D 视角重塑" ||
    viewpointIsolation.singleImageWorkbenches !== 0 ||
    viewpointIsolation.vector3DWorkbenches !== 1
  ) {
    throw new Error(
      `3DGS and single-image pages are not isolated: ${JSON.stringify(
        viewpointIsolation
      )}`
    );
  }

  if (browserErrors.length > 0) {
    throw new Error(`Browser errors detected: ${browserErrors.join(" | ")}`);
  }

  console.log(
    JSON.stringify(
      {
        outpaintIsolation,
        viewpointIsolation,
        canvasPixels,
        initialGuide,
        cumulative,
        beforeDrag,
        afterDrag,
        boundaryDrag: {
          clamped: clampedBoundary,
          reversed: reversedBoundary
        },
        desktopLayout,
        mobileLayout,
        screenshots: [canvasPath, desktopPath, mobilePath],
        browserErrors
      },
      null,
      2
    )
  );
} finally {
  await context.close();
  await browser.close();
}

process.exitCode = 0;
