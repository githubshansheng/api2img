import { chromium } from "file:///C:/Users/Administrator/AppData/Local/OpenAI/Codex/runtimes/cua_node/03b1cdac8af3a530/bin/node_modules/playwright/index.mjs";

const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--enable-unsafe-swiftshader"]
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 }
});
const browserErrors = [];

page.setDefaultTimeout(20_000);
page.on("pageerror", (error) => browserErrors.push(error.message));

async function chooseFile(button, file) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    button.click()
  ]);
  await chooser.setFiles(file);
}

try {
  await page.goto("http://127.0.0.1:8082/?page=viewpoint", {
    waitUntil: "networkidle"
  });

  const sourcePath =
    "L:/AIProject/api2Image/archive/camera-test/ui-qa/vector3d-source-reference.png";
  const sourceButton = page.getByTitle("导入用于构建 Gaussian 代理的图片");
  const sourceInput = page.locator('input[accept*="image/png"]');

  await chooseFile(sourceButton, sourcePath);
  await page
    .getByText("图片高斯代理已就绪：vector3d-source-reference.png", {
      exact: true
    })
    .waitFor();
  const firstInputValue = await sourceInput.inputValue();

  await chooseFile(sourceButton, sourcePath);
  await page
    .getByText("图片高斯代理已就绪：vector3d-source-reference.png", {
      exact: true
    })
    .waitFor();
  const secondInputValue = await sourceInput.inputValue();
  const sourceMetadata = await page
    .getByText("960 × 540 · 6.1 KB", { exact: true })
    .innerText();

  await page.getByText(/IMAGE-DRIVEN SPLATS$/).waitFor();
  await page.getByRole("button", { name: "捕获当前镜头" }).click();
  await page
    .getByRole("img", { name: "当前视角结构骨架" })
    .waitFor();

  await page
    .getByRole("button", { name: "生成电影级新视角" })
    .click();
  const errorAlert = page.getByRole("alert");
  await errorAlert.waitFor();
  const alertText = await errorAlert.innerText();
  const openSettingsVisible = await page
    .getByRole("button", { name: "打开设置" })
    .isVisible();

  if (
    firstInputValue !== "" ||
    secondInputValue !== "" ||
    !alertText.includes("API Key 未配置") ||
    !openSettingsVisible ||
    browserErrors.length > 0
  ) {
    throw new Error(
      `Upload interaction verification failed: ${JSON.stringify({
        firstInputValue,
        secondInputValue,
        sourceMetadata,
        alertText,
        openSettingsVisible,
        browserErrors
      })}`
    );
  }

  console.log(
    JSON.stringify(
      {
        firstInputValue,
        secondInputValue,
        sourceMetadata,
        alertText,
        openSettingsVisible,
        browserErrors
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
}
