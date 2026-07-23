import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";

const chromePath =
  process.env.CHROME_PATH ??
  "C:\\Users\\Administrator\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const outputDir = path.join(
  projectRoot,
  "archive",
  "camera-test",
  "ui-qa",
  "image-editing-qa",
  "2026-07-14"
);
const profileDir = path.join(
  import.meta.dirname,
  `.chrome-profile-${process.pid}`
);
const port = 9337;
const targetURL = "http://127.0.0.1:5173/?page=editing";
const apiBaseURL = "http://127.0.0.1:8787/api/edit-sessions";
const viewports = [
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "desktop-1366x720", width: 1366, height: 720 },
  { name: "tablet-768x1024", width: 768, height: 1024 },
  { name: "mobile-390x844", width: 390, height: 844 }
];
const sessionTitle = `Image editing QA ${Date.now()}`;

const seededSession = await createQASession();
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await rm(profileDir, { recursive: true, force: true });
await mkdir(profileDir, { recursive: true });

const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    targetURL
  ],
  { cwd: projectRoot, stdio: "ignore", windowsHide: true }
);

let cdp;
let suppressConsoleErrors = false;

try {
  const pageTarget = await waitForPageTarget();
  cdp = await createCDPClient(pageTarget.webSocketDebuggerUrl);
  const consoleErrors = [];

  cdp.on("Runtime.consoleAPICalled", (params) => {
    if (params.type === "error" && !suppressConsoleErrors) {
      consoleErrors.push(
        params.args
          .map((item) => item.value ?? item.description ?? "")
          .filter(Boolean)
          .join(" ")
      );
    }
  });
  cdp.on("Runtime.exceptionThrown", (params) => {
    if (!suppressConsoleErrors) {
      consoleErrors.push(
        params.exceptionDetails?.exception?.description ??
          params.exceptionDetails?.text ??
          "Uncaught browser exception"
      );
    }
  });

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await waitForWorkbench(cdp);
  await waitForText(cdp, sessionTitle);
  await waitForStreamState(cdp, "connected");

  const report = {
    targetURL,
    sessionId: seededSession.id,
    checkedAt: new Date().toISOString(),
    viewports: [],
    interactions: {},
    consoleErrors
  };

  report.interactions.archiveRestore = await verifyArchiveRestore(cdp);
  report.interactions.sseReconnect = await verifySSEReconnect(cdp);

  for (const viewport of viewports) {
    await setViewport(cdp, viewport);
    await resetScroll(cdp);
    const metrics = await collectLayoutMetrics(cdp);
    const screenshot = await captureScreenshot(
      cdp,
      path.join(outputDir, `${viewport.name}.png`)
    );

    assert.equal(
      metrics.horizontalOverflow,
      false,
      `${viewport.name} has document-level horizontal overflow`
    );
    assert.deepEqual(
      metrics.overlaps,
      [],
      `${viewport.name} has incoherent panel overlap`
    );

    report.viewports.push({
      ...viewport,
      metrics,
      screenshot: path.relative(projectRoot, screenshot)
    });
  }

  report.interactions.touchZoomSubmit =
    await verifyTouchZoomAndSubmit(cdp);
  report.interactions.refreshPersistence =
    await verifyRefreshPersistence(cdp);

  assert.equal(
    consoleErrors.length,
    0,
    `Browser console reported errors: ${consoleErrors.join(" | ")}`
  );

  const reportPath = path.join(outputDir, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  try {
    await cdp?.send("Browser.close");
  } catch {
    // Fall back to terminating the process tree below.
  }
  cdp?.close();
  await Promise.race([
    new Promise((resolve) => chrome.once("exit", resolve)),
    sleep(2000)
  ]);
  if (chrome.exitCode === null) {
    try {
      execFileSync("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], {
        timeout: 5000,
        stdio: "ignore",
        windowsHide: true
      });
    } catch {
      chrome.kill("SIGKILL");
    }
  }
  await deleteQASession(seededSession.id);
  await sleep(150);
  await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
}

async function verifySessionDeleted(id) {
  const response = await fetch(
    `${apiBaseURL}/${encodeURIComponent(id)}`
  );

  return response.status === 404;
}

async function deleteQASession(id) {
  let lastError;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(`${apiBaseURL}/${encodeURIComponent(id)}`, {
        method: "DELETE"
      });

      if (
        (response.ok || response.status === 404) &&
        (await verifySessionDeleted(id))
      ) {
        return;
      }

      lastError = new Error(
        `QA session cleanup failed with HTTP ${response.status}`
      );
    } catch (error) {
      lastError = error;
    }

    await sleep(250);
  }

  throw lastError ?? new Error("QA session cleanup did not complete");
}

async function verifyArchiveRestore(cdp) {
  const archived = await evaluate(cdp, `(() => {
    const button = document.querySelector(
      ".edit-session-item.is-active .edit-session-action:not(.is-danger)"
    );
    button?.click();
    return Boolean(button);
  })()`);
  assert.equal(archived, true, "Archive action was not available");

  await waitFor(async () => {
    const session = await getQASession();
    return session.status === "archived";
  }, "session archive");

  await waitFor(async () => {
    return evaluate(cdp, `(() => {
      const tab = document.querySelector(
        ".edit-session-filter button:nth-child(2)"
      );
      if (!tab?.classList.contains("is-active")) {
        tab?.click();
      }
      return Boolean(
        tab?.classList.contains("is-active") &&
        document.querySelector(".edit-session-item.is-archived")
      );
    })()`);
  }, "archived session list");
  await waitForSelector(
    cdp,
    ".edit-session-item.is-archived .edit-session-action:not(.is-danger):not(:disabled)"
  );
  await evaluate(cdp, `document.querySelector(
    ".edit-session-item.is-archived .edit-session-open"
  )?.click()`);
  await waitForSelector(cdp, ".edit-session-status");
  const editingLocked = await evaluate(cdp, `(() => ({
    composerDisabled: Boolean(
      document.querySelector(".edit-composer textarea")?.disabled
    ),
    modeControlsDisabled: [...document.querySelectorAll(
      ".edit-mode-segment button"
    )].every((button) => button.disabled)
  }))()`);
  assert.equal(editingLocked.composerDisabled, true);
  assert.equal(editingLocked.modeControlsDisabled, true);

  const restored = await evaluate(cdp, `(() => {
    const button = document.querySelector(
      ".edit-session-item.is-archived .edit-session-action:not(.is-danger)"
    );
    button?.click();
    return Boolean(button);
  })()`);
  assert.equal(restored, true, "Restore action was not available");

  await waitFor(async () => {
    const session = await getQASession();
    return session.status === "active";
  }, "session restore");
  await waitForText(cdp, sessionTitle);
  await waitForStreamState(cdp, "connected");

  const session = await getQASession();
  const statusChanges = session.auditLog
    .filter(
      (event) =>
        event.action === "session.updated" &&
        Array.isArray(event.metadata?.changes)
    )
    .map((event) => event.metadata.changes)
    .filter((changes) =>
      changes.some((change) => ["archived", "restored"].includes(change))
    );

  assert.deepEqual(statusChanges, [["archived"], ["restored"]]);

  return {
    archivedListable: true,
    editingLocked,
    restoredStatus: session.status,
    auditChanges: statusChanges
  };
}

async function verifySSEReconnect(cdp) {
  suppressConsoleErrors = true;
  let failedRequest = false;
  const unsubscribe = cdp.on("Fetch.requestPaused", (params) => {
    if (failedRequest) {
      void cdp.send("Fetch.continueRequest", {
        requestId: params.requestId
      });
      return;
    }

    failedRequest = true;
    void cdp
      .send("Fetch.failRequest", {
        requestId: params.requestId,
        errorReason: "ConnectionClosed"
      })
      .then(() => cdp.send("Fetch.disable"));
  });
  await cdp.send("Fetch.enable", {
    patterns: [{
      urlPattern: "*api/edit-sessions/*/events*",
      requestStage: "Request"
    }]
  });
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitForWorkbench(cdp);
  await waitForText(cdp, sessionTitle);
  await waitForStreamState(cdp, "reconnecting");
  await waitForStreamState(cdp, "connected", 15000);
  unsubscribe();
  suppressConsoleErrors = false;

  return {
    failedHandshake: failedRequest,
    sawReconnecting: true,
    recoveredConnected: true
  };
}

async function verifyTouchZoomAndSubmit(cdp) {
  await setViewport(cdp, viewports.at(-1));
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 5
  });

  const localModeEnabled = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll(".edit-mode-segment button")]
      .find((item) => item.textContent?.trim().includes("局部"));
    button?.click();
    return Boolean(button && !button.disabled);
  })()`);
  assert.equal(localModeEnabled, true, "Local editing mode is unavailable");
  await waitForSelector(cdp, ".edit-mask-canvas.is-enabled");
  await waitFor(async () => {
    return evaluate(
      cdp,
      `document.querySelector(".edit-mask-canvas")?.width > 0`
    );
  }, "mask canvas initialization");

  const rect = await evaluate(cdp, `(() => {
    const canvas = document.querySelector(".edit-mask-canvas");
    canvas?.scrollIntoView({ block: "center", inline: "center" });
    const value = canvas?.getBoundingClientRect();
    return value
      ? { left: value.left, top: value.top, width: value.width, height: value.height }
      : null;
  })()`);
  assert.ok(rect, "Mask canvas is missing");

  const points = Array.from({ length: 8 }, (_, index) => ({
    x: Math.round(rect.left + rect.width * (0.25 + index * 0.055)),
    y: Math.round(rect.top + rect.height * (0.38 + index * 0.035))
  }));
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...points[0], id: 1, force: 1 }]
  });
  for (const point of points.slice(1)) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ ...point, id: 1, force: 1 }]
    });
    await sleep(20);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: []
  });
  await sleep(150);

  const selectedPixels = await evaluate(cdp, `(() => {
    const canvas = document.querySelector(".edit-mask-canvas");
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return 0;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] > 0) count += 1;
    }
    return count;
  })()`);
  assert.ok(selectedPixels > 0, "Touch gesture did not paint the selection mask");

  const zoom = await evaluate(cdp, `(() => {
    const label = document.querySelector(".edit-zoom-controls span");
    const before = label?.textContent?.trim();
    document.querySelector('button[title="放大"]')?.click();
    return { before };
  })()`);
  await waitFor(async () => {
    return evaluate(
      cdp,
      `document.querySelector(".edit-zoom-controls span")?.textContent?.trim() === "125%"`
    );
  }, "canvas zoom");
  zoom.after = "125%";

  const composerReady = await evaluate(cdp, `(() => {
    const textarea = document.querySelector(".edit-composer textarea");
    if (!textarea || textarea.disabled) return false;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    setter?.call(textarea, "调整一下");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  assert.equal(composerReady, true, "Edit composer is unavailable");

  await waitFor(async () => {
    return evaluate(cdp, `(() => {
      const button = [...document.querySelectorAll(".edit-composer-actions button")]
        .find((item) => item.textContent?.includes("分析并执行"));
      return Boolean(button && !button.disabled);
    })()`);
  }, "submit button readiness");
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll(".edit-composer-actions button")]
      .find((item) => item.textContent?.includes("分析并执行"));
    button?.click();
  })()`);

  await waitForSelector(cdp, ".edit-clarification-box", 15000);
  await waitFor(async () => {
    const session = await getQASession();
    return session.turns.some(
      (turn) => turn.status === "awaiting_clarification"
    );
  }, "local edit submission", 15000);
  const modalOpen = await evaluate(
    cdp,
    `Boolean(document.querySelector(".settings-dialog"))`
  );
  assert.equal(
    modalOpen,
    false,
    "Local fallback opened the global settings dialog"
  );

  const interactionScreenshot = await captureScreenshot(
    cdp,
    path.join(outputDir, "mobile-390x844-touch-submit.png")
  );
  const session = await getQASession();
  const submittedTurn = session.turns.at(-1);
  assert.equal(submittedTurn?.mode, "local");
  assert.equal(submittedTurn?.regions.length, 1);
  assert.equal(submittedTurn?.regions[0]?.maskSemantics, "selection-alpha");

  return {
    pointerType: "touch",
    selectedPixels,
    zoom,
    turnStatus: submittedTurn?.status,
    persistedMaskSemantics: submittedTurn?.regions[0]?.maskSemantics,
    screenshot: path.relative(projectRoot, interactionScreenshot)
  };
}

async function verifyRefreshPersistence(cdp) {
  const before = await getQASession();
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitForWorkbench(cdp);
  await waitForText(cdp, sessionTitle);
  await waitForSelector(cdp, ".edit-clarification-box");
  await waitForStreamState(cdp, "connected");
  const after = await getQASession();

  assert.equal(after.id, before.id);
  assert.equal(after.turns.length, before.turns.length);
  assert.equal(after.turns.at(-1)?.status, "awaiting_clarification");
  assert.equal(after.turns.at(-1)?.regions.length, 1);

  return {
    sessionIdPreserved: after.id === before.id,
    turnCountBefore: before.turns.length,
    turnCountAfter: after.turns.length,
    latestTurnStatus: after.turns.at(-1)?.status,
    sseConnectedAfterReload: true
  };
}

async function collectLayoutMetrics(cdp) {
  return evaluate(cdp, `(() => {
    const root = document.documentElement;
    const selectors = {
      session: ".edit-session-panel",
      canvas: ".edit-canvas-panel",
      inspector: ".edit-conversation-panel"
    };
    const rectangles = Object.fromEntries(
      Object.entries(selectors).map(([key, selector]) => {
        const node = document.querySelector(selector);
        const rect = node?.getBoundingClientRect();
        return [key, rect ? {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        } : null];
      })
    );
    const names = Object.keys(rectangles);
    const overlaps = [];
    for (let leftIndex = 0; leftIndex < names.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < names.length; rightIndex += 1) {
        const leftName = names[leftIndex];
        const rightName = names[rightIndex];
        const left = rectangles[leftName];
        const right = rectangles[rightName];
        if (
          left &&
          right &&
          Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1 &&
          Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1
        ) {
          overlaps.push(leftName + ":" + rightName);
        }
      }
    }
    return {
      title: document.title,
      sessionVisible: document.body.innerText.includes(${JSON.stringify(sessionTitle)}),
      documentScrollWidth: root.scrollWidth,
      viewportWidth: root.clientWidth,
      horizontalOverflow: root.scrollWidth > root.clientWidth + 1,
      rectangles,
      overlaps,
      visibleTabs: [...document.querySelectorAll(".edit-inspector-tabs button")].map(
        (node) => ({
          text: node.textContent?.trim(),
          width: Math.round(node.getBoundingClientRect().width),
          visible: node.getBoundingClientRect().width > 0
        })
      )
    };
  })()`);
}

async function setViewport(cdp, viewport) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.width <= 480
  });
  await sleep(300);
}

async function resetScroll(cdp) {
  await evaluate(cdp, `(() => {
    window.scrollTo(0, 0);
    document.querySelector(".edit-inspector-scroll")?.scrollTo(0, 0);
    document.querySelector(".edit-session-list")?.scrollTo(0, 0);
  })()`);
}

async function captureScreenshot(cdp, outputPath) {
  const screenshot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    fromSurface: true
  });
  await writeFile(outputPath, Buffer.from(screenshot.data, "base64"));
  return outputPath;
}

async function waitForWorkbench(cdp) {
  await waitFor(async () => {
    return evaluate(cdp, `Boolean(document.querySelector(".edit-workbench"))`);
  }, "image editing workbench", 20000);
}

async function waitForText(cdp, text, timeout = 10000) {
  await waitFor(async () => {
    return evaluate(
      cdp,
      `document.body.innerText.includes(${JSON.stringify(text)})`
    );
  }, `text ${text}`, timeout);
}

async function waitForSelector(cdp, selector, timeout = 10000) {
  await waitFor(async () => {
    return evaluate(
      cdp,
      `Boolean(document.querySelector(${JSON.stringify(selector)}))`
    );
  }, `selector ${selector}`, timeout);
}

async function waitForStreamState(cdp, state, timeout = 10000) {
  const expectedText =
    state === "connected"
      ? "实时同步"
      : state === "reconnecting"
        ? "正在重连"
        : "等待会话";
  await waitFor(async () => {
    return evaluate(cdp, `(() => {
      const row = document.querySelector(".edit-runtime-row");
      return row?.textContent?.includes(${JSON.stringify(expectedText)}) ?? false;
    })()`);
  }, `SSE state ${state}`, timeout);
}

async function waitFor(check, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let lastError;

  while (Date.now() < deadline) {
    try {
      if (await check()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }

  throw new Error(
    `Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`
  );
}

async function waitForPageTarget() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const pageTarget = targets.find(
        (target) =>
          target.type === "page" &&
          target.url.startsWith("http://127.0.0.1:5173/")
      );
      if (pageTarget) {
        return pageTarget;
      }
    } catch {
      // Chrome is still starting.
    }
    await sleep(200);
  }
  throw new Error("Timed out waiting for Chrome DevTools.");
}

async function createCDPClient(webSocketURL) {
  const socket = new WebSocket(webSocketURL);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    if (!message.id) {
      listeners.get(message.method)?.forEach((handler) => {
        handler(message.params ?? {});
      });
      return;
    }

    const request = pending.get(message.id);
    if (!request) {
      return;
    }
    pending.delete(message.id);
    if (message.error) {
      request.reject(new Error(message.error.message));
    } else {
      request.resolve(message.result ?? {});
    }
  });

  return {
    send(method, params = {}) {
      const id = nextId++;
      const response = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      socket.send(JSON.stringify({ id, method, params }));
      return response;
    },
    on(method, handler) {
      const handlers = listeners.get(method) ?? new Set();
      handlers.add(handler);
      listeners.set(method, handlers);
      return () => handlers.delete(handler);
    },
    close() {
      socket.close();
    }
  };
}

async function evaluate(cdp, expression) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        "Browser evaluation failed."
    );
  }
  return response.result?.value;
}

async function createQASession() {
  const png = createSourcePNG();
  const response = await fetch(apiBaseURL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      title: sessionTitle,
      modelId: "gpt-image-2",
      source: {
        id: crypto.randomUUID(),
        name: "image-editing-qa.png",
        mimeType: "image/png",
        format: "png",
        sizeBytes: png.byteLength,
        width: 640,
        height: 420,
        base64: png.toString("base64"),
        order: 0
      }
    })
  });
  const body = await response.json();

  if (!response.ok || !body.success || !body.data) {
    throw new Error(
      body.error?.message ?? `Failed to seed QA session (${response.status})`
    );
  }

  return body.data;
}

async function getQASession() {
  const response = await fetch(
    `${apiBaseURL}/${encodeURIComponent(seededSession.id)}`
  );
  const body = await response.json();

  if (!response.ok || !body.success || !body.data) {
    throw new Error(
      body.error?.message ?? `Failed to read QA session (${response.status})`
    );
  }

  return body.data;
}

function createSourcePNG() {
  const width = 640;
  const height = 420;
  const png = new PNG({ width, height });

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const inSubject =
        x > width * 0.28 &&
        x < width * 0.72 &&
        y > height * 0.18 &&
        y < height * 0.82;
      png.data[offset] = inSubject
        ? 244
        : Math.round(28 + (x / width) * 58);
      png.data[offset + 1] = inSubject
        ? Math.round(120 + (y / height) * 70)
        : Math.round(78 + (y / height) * 72);
      png.data[offset + 2] = inSubject
        ? 74
        : Math.round(118 + (x / width) * 78);
      png.data[offset + 3] = 255;
    }
  }

  return PNG.sync.write(png);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
