import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const edgePath =
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, "..");
const artifactDirectory = path.join(
  workspaceRoot,
  "archive",
  "camera-test",
  "ui-qa"
);
fs.mkdirSync(artifactDirectory, { recursive: true });
const port = 9333;
const profileDirectory = path.join(
  os.tmpdir(),
  `edge-vector3d-${Date.now()}`
);
const pageURL = "http://127.0.0.1:8082/?page=viewpoint";
const sourcePath =
  process.env.VECTOR3D_SOURCE_PATH ||
  path.join(artifactDirectory, "vector3d-source-reference.png");
const deviceScaleFactor = Math.min(
  3,
  Math.max(1, Number(process.env.VECTOR3D_DPR) || 1)
);
const artifactSuffix =
  deviceScaleFactor === 1
    ? ""
    : `-dpr${String(deviceScaleFactor).replace(".", "_")}`;
const renderCheckFilename = `vector3d-render-check${artifactSuffix}.png`;
const desktopFilename = `vector3d-desktop${artifactSuffix}.png`;
const mobileFilename = `vector3d-mobile${artifactSuffix}.png`;
const browserProcess = spawn(
  edgePath,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDirectory}`,
    "--no-first-run",
    "--disable-extensions",
    "--disable-background-networking",
    "--enable-unsafe-swiftshader",
    "about:blank"
  ],
  {
    stdio: "ignore",
    windowsHide: true
  }
);

const sleep = (duration) =>
  new Promise((resolve) => setTimeout(resolve, duration));

async function waitForDebuggingEndpoint() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/json/version`
      );

      if (response.ok) {
        return;
      }
    } catch {
      // Edge is still starting.
    }

    await sleep(250);
  }

  throw new Error("Edge remote debugging endpoint did not start.");
}

await waitForDebuggingEndpoint();

const targetResponse = await fetch(
  `http://127.0.0.1:${port}/json/new?${encodeURIComponent(pageURL)}`,
  { method: "PUT" }
);
const target = await targetResponse.json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const browserErrors = [];
let commandId = 0;

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener(
    "error",
    () => reject(new Error("Could not connect to Edge DevTools.")),
    { once: true }
  );
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));

  if (message.id) {
    const handler = pending.get(message.id);

    if (!handler) {
      return;
    }

    pending.delete(message.id);

    if (message.error) {
      handler.reject(new Error(message.error.message));
    } else {
      handler.resolve(message.result);
    }

    return;
  }

  if (message.method === "Runtime.exceptionThrown") {
    browserErrors.push(
      message.params?.exceptionDetails?.text ?? "Uncaught browser exception"
    );
  }

  if (
    message.method === "Log.entryAdded" &&
    message.params?.entry?.level === "error"
  ) {
    browserErrors.push(message.params.entry.text);
  }
});

function call(method, params = {}) {
  commandId += 1;

  return new Promise((resolve, reject) => {
    pending.set(commandId, { resolve, reject });
    socket.send(
      JSON.stringify({
        id: commandId,
        method,
        params
      })
    );
  });
}

async function evaluate(expression) {
  const response = await call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });

  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text
    );
  }

  return response.result?.value;
}

async function waitFor(expression, timeoutMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(expression)) {
      return;
    }

    await sleep(200);
  }

  throw new Error(`Timed out waiting for: ${expression}`);
}

async function setViewport(width, height, mobile = false) {
  await call("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor,
    mobile
  });
  await sleep(400);
}

async function saveScreenshot(filename) {
  const screenshot = await call("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  });
  fs.writeFileSync(
    path.join(artifactDirectory, filename),
    Buffer.from(screenshot.data, "base64")
  );
}

function analyzeScreenshotRegion(filename, rect) {
  const image = PNG.sync.read(
    fs.readFileSync(path.join(artifactDirectory, filename))
  );
  const startX = Math.max(0, Math.floor(rect.x));
  const startY = Math.max(0, Math.floor(rect.y));
  const endX = Math.min(image.width, Math.ceil(rect.x + rect.width));
  const endY = Math.min(image.height, Math.ceil(rect.y + rect.height));
  let chromaticPixels = 0;
  let sampledPixels = 0;
  let luminanceTotal = 0;
  let luminanceSquaredTotal = 0;

  for (let y = startY; y < endY; y += 4) {
    for (let x = startX; x < endX; x += 4) {
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
    chromaticPixels,
    sampledPixels,
    luminanceStdDev: Math.sqrt(Math.max(0, variance))
  };
}

async function setInputFile(selector, filePath) {
  const documentNode = await call("DOM.getDocument", {
    depth: -1,
    pierce: true
  });
  const input = await call("DOM.querySelector", {
    nodeId: documentNode.root.nodeId,
    selector
  });

  if (!input.nodeId) {
    throw new Error(`Input not found: ${selector}`);
  }

  await call("DOM.setFileInputFiles", {
    nodeId: input.nodeId,
    files: [filePath]
  });
}

try {
  await call("Page.enable");
  await call("Runtime.enable");
  await call("DOM.enable");
  await call("Log.enable");
  await setViewport(1600, 1000);
  await call("Page.navigate", { url: pageURL });
  await waitFor(
    "document.readyState === 'complete' && Boolean(document.querySelector('.vector3d-workbench'))"
  );

  await setInputFile(
    'input[accept="image/png,image/jpeg,image/webp"]',
    sourcePath
  );
  await waitFor(
    "!document.querySelector('.vector3d-viewport-overlay') && document.querySelector('.vector3d-scene-facts')?.textContent.includes('IMAGE-DRIVEN SPLATS')",
    20000
  );

  const beforeDrag = await evaluate(`
    (() => {
      const canvas = document.querySelector('.vector3d-canvas');
      const rect = canvas.getBoundingClientRect();
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      const fiberKey = Object.keys(canvas).find((key) => key.startsWith('__reactFiber$'));
      let fiber = fiberKey ? canvas[fiberKey] : null;
      while (fiber && !fiber.memoizedState) fiber = fiber.return;
      let rendererState;
      let hook = fiber?.memoizedState;
      while (hook) {
        const value = hook.memoizedState;
        const current = value && typeof value === 'object' && 'current' in value
          ? value.current
          : value;
        if (current?.renderProgram) {
          rendererState = {
            renderVertexCount: current.renderProgram.renderData?.vertexCount,
            renderUpdating: current.renderProgram.renderData?.updating,
            depthIndexLength: current.renderProgram.depthIndex?.length
          };
        }
        hook = hook.next;
      }
      return {
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        devicePixelRatio: window.devicePixelRatio,
        legacyPlyInputPresent: Boolean(document.querySelector('input[accept=".ply"]')),
        pointCount: Number(
          document.querySelector('.vector3d-scene-facts span')?.textContent
            ?.replace(/[^0-9]/g, '') || 0
        ),
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        },
        glError: gl.getError(),
        renderer: gl.getParameter(gl.RENDERER),
        rendererState,
        browserErrors: ${JSON.stringify(browserErrors)},
        yaw: document.querySelector('.vector3d-camera-axis strong')?.textContent,
        horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
        workbenchHeight: document.querySelector('.vector3d-workbench')?.getBoundingClientRect().height
      };
    })()
  `);
  await saveScreenshot(renderCheckFilename);
  const renderedPixels = analyzeScreenshotRegion(
    renderCheckFilename,
    beforeDrag.rect
  );
  const expectedBackingScale = Math.min(2, deviceScaleFactor);
  const backingScaleX = beforeDrag.canvasWidth / beforeDrag.rect.width;
  const backingScaleY = beforeDrag.canvasHeight / beforeDrag.rect.height;

  if (
    beforeDrag.canvasWidth < 300 ||
    beforeDrag.canvasHeight < 240 ||
    Math.abs(beforeDrag.canvasWidth / beforeDrag.canvasHeight - 16 / 9) > 0.02 ||
    Math.abs(backingScaleX - expectedBackingScale) > 0.08 ||
    Math.abs(backingScaleY - expectedBackingScale) > 0.08 ||
    beforeDrag.legacyPlyInputPresent ||
    beforeDrag.pointCount < 1000 ||
    beforeDrag.rendererState?.renderVertexCount !== beforeDrag.pointCount ||
    renderedPixels.chromaticPixels < 500 ||
    renderedPixels.luminanceStdDev < 8 ||
    beforeDrag.horizontalOverflow > 2
  ) {
    throw new Error(
      `Desktop canvas verification failed: ${JSON.stringify({
        ...beforeDrag,
        backingScaleX,
        backingScaleY,
        expectedBackingScale,
        renderedPixels
      })}`
    );
  }

  const startX = beforeDrag.rect.x + beforeDrag.rect.width * 0.5;
  const startY = beforeDrag.rect.y + beforeDrag.rect.height * 0.5;
  await call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: startX,
    y: startY,
    button: "left",
    buttons: 1,
    clickCount: 1
  });
  await call("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: startX + 130,
    y: startY + 25,
    button: "left",
    buttons: 1
  });
  await call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: startX + 130,
    y: startY + 25,
    button: "left",
    buttons: 0,
    clickCount: 1
  });
  await sleep(500);

  const afterDragYaw = await evaluate(
    "document.querySelector('.vector3d-camera-axis strong')?.textContent"
  );

  if (!afterDragYaw || afterDragYaw === beforeDrag.yaw) {
    throw new Error(
      `Orbit drag did not update yaw: ${beforeDrag.yaw} -> ${afterDragYaw}`
    );
  }

  await evaluate(
    "document.querySelector('.vector3d-capture-button')?.click()"
  );
  await waitFor(
    "document.querySelector('.vector3d-output-panel img')?.src.startsWith('data:image/png;base64,') && document.querySelector('.vector3d-output-panel img')?.complete"
  );
  const capturedPixels = await evaluate(`
    (() => {
      const image = document.querySelector('.vector3d-output-panel img');
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let opaquePixels = 0;
      let chromaticPixels = 0;
      for (let index = 0; index < pixels.length; index += 64) {
        if (pixels[index + 3] > 0) opaquePixels += 1;
        if (
          Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) -
            Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) >
          24
        ) {
          chromaticPixels += 1;
        }
      }
      return {
        width: canvas.width,
        height: canvas.height,
        opaquePixels,
        chromaticPixels
      };
    })()
  `);

  if (
    capturedPixels.width < 300 ||
    capturedPixels.height < 240 ||
    capturedPixels.width > 2048 ||
    capturedPixels.height > 1152 ||
    Math.abs(capturedPixels.width / capturedPixels.height - 16 / 9) > 0.02 ||
    capturedPixels.opaquePixels < 1000 ||
    capturedPixels.chromaticPixels < 500
  ) {
    throw new Error(
      `Captured draft verification failed: ${JSON.stringify(capturedPixels)}`
    );
  }
  await saveScreenshot(desktopFilename);

  await setViewport(390, 844, true);
  await sleep(800);
  const mobile = await evaluate(`
    (() => {
      const canvas = document.querySelector('.vector3d-canvas');
      const panel = document.querySelector('.vector3d-viewport-panel');
      const rect = canvas.getBoundingClientRect();
      return {
        viewport: { width: innerWidth, height: innerHeight },
        canvas: { width: rect.width, height: rect.height },
        panelWidth: panel.getBoundingClientRect().width,
        horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
        outputColumns: getComputedStyle(document.querySelector('.vector3d-output-stack')).gridTemplateColumns,
        captureButtonWidth: document.querySelector('.vector3d-capture-button').getBoundingClientRect().width
      };
    })()
  `);

  if (
    mobile.horizontalOverflow > 2 ||
    mobile.canvas.width < 300 ||
    mobile.canvas.height < 160 ||
    Math.abs(mobile.canvas.width / mobile.canvas.height - 16 / 9) > 0.02 ||
    mobile.panelWidth > mobile.viewport.width ||
    mobile.outputColumns.split(" ").length !== 1
  ) {
    throw new Error(
      `Mobile layout verification failed: ${JSON.stringify(mobile)}`
    );
  }

  await saveScreenshot(mobileFilename);

  if (browserErrors.length > 0) {
    throw new Error(
      `Browser errors detected: ${browserErrors.join(" | ")}`
    );
  }

  console.log(
    JSON.stringify(
      {
        desktop: {
          ...beforeDrag,
          backingScaleX,
          backingScaleY,
          expectedBackingScale,
          afterDragYaw,
          renderedPixels,
          capturedPixels
        },
        mobile,
        screenshots: [
          path.join(artifactDirectory, desktopFilename),
          path.join(artifactDirectory, mobileFilename)
        ],
        browserErrors
      },
      null,
      2
    )
  );
} finally {
  socket.close();
  browserProcess.kill();
}
