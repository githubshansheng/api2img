import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..", "..");
const CAMERA_TEST_ARCHIVE_ROOT = path.join(
  WORKSPACE_ROOT,
  "archive",
  "camera-test"
);

const options = parseArguments(process.argv.slice(2));
const apiKey = process.env.CODEX_CUSTOM_API_KEY?.trim();

if (!apiKey) {
  throw new Error("CODEX_CUSTOM_API_KEY is required.");
}

const outputDirectory = resolveArchivedOutputDirectory(options.output);
await mkdir(outputDirectory, { recursive: true });

const [sourceBytes, detailBytes, guideBytes, prompt] = await Promise.all([
  readFile(path.resolve(options.source)),
  options.detail ? readFile(path.resolve(options.detail)) : undefined,
  readFile(path.resolve(options.guide)),
  readFile(path.resolve(options.prompt), "utf8")
]);

const form = new FormData();
form.append("model", options.model);
form.append("prompt", prompt);
form.append("image[]", new Blob([sourceBytes], { type: "image/png" }), "source.png");
if (detailBytes) {
  form.append(
    "image[]",
    new Blob([detailBytes], { type: "image/png" }),
    "subject-detail.png"
  );
}
form.append(
  "image[]",
  new Blob([guideBytes], { type: "image/png" }),
  "camera-pose.png"
);
form.append("quality", "high");
form.append("size", options.size);
form.append("output_format", "png");
form.append("n", "1");

const startedAt = Date.now();
const response = await fetch(options.endpoint, {
  method: "POST",
  headers: {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`
  },
  body: form
});
const responseText = await response.text();
const responseBody = parseResponse(responseText);

await Promise.all([
  writeFile(path.join(outputDirectory, "prompt.zh.txt"), prompt),
  writeFile(path.join(outputDirectory, "source.png"), sourceBytes),
  detailBytes
    ? writeFile(path.join(outputDirectory, "subject-detail.png"), detailBytes)
    : Promise.resolve(),
  writeFile(path.join(outputDirectory, "camera-pose.png"), guideBytes),
  writeFile(
    path.join(outputDirectory, "response.json"),
    JSON.stringify(
      {
        status: response.status,
        durationMs: Date.now() - startedAt,
        body: summarizeResponse(responseBody)
      },
      null,
      2
    )
  )
]);

if (!response.ok) {
  throw new Error(
    `Image edit failed with HTTP ${response.status}: ${responseText.slice(0, 500)}`
  );
}

const renderedImage = await resolveRenderedImage(responseBody);
const resultPath = path.join(outputDirectory, "result.png");
await writeFile(resultPath, renderedImage);

console.log(
  JSON.stringify({
    event: "direct-image-edit-completed",
    outputDirectory,
    resultPath,
    durationMs: Date.now() - startedAt
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

  for (const required of ["source", "guide", "prompt", "output"]) {
    if (!values.get(required)) {
      throw new Error(`Missing --${required}.`);
    }
  }

  return {
    source: values.get("source"),
    detail: values.get("detail"),
    guide: values.get("guide"),
    prompt: values.get("prompt"),
    output: values.get("output"),
    model: values.get("model") || "gpt-image-2",
    size: values.get("size") || "1024x1024",
    endpoint:
      values.get("endpoint") || "https://ai.heigh.vip/v1/images/edits"
  };
}

function parseResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function resolveArchivedOutputDirectory(requestedPath) {
  const outputDirectory = path.resolve(requestedPath);
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

function summarizeResponse(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return body;
  }

  const data = Array.isArray(body.data)
    ? body.data.map((item) => {
        if (!item || typeof item !== "object") {
          return item;
        }

        return {
          ...item,
          b64_json:
            typeof item.b64_json === "string"
              ? `[base64:${item.b64_json.length}]`
              : item.b64_json
        };
      })
    : body.data;

  return {
    ...body,
    data
  };
}

async function resolveRenderedImage(body) {
  const first = Array.isArray(body?.data) ? body.data[0] : undefined;

  if (typeof first?.b64_json === "string" && first.b64_json.trim()) {
    return Buffer.from(first.b64_json.trim(), "base64");
  }

  if (typeof first?.url === "string" && first.url.trim()) {
    const response = await fetch(first.url.trim());

    if (!response.ok) {
      throw new Error(`Result download failed with HTTP ${response.status}.`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  for (const item of Array.isArray(body?.output) ? body.output : []) {
    const result = item?.result ?? item?.b64_json;

    if (typeof result === "string" && result.trim()) {
      const payload = result.startsWith("data:")
        ? result.slice(result.indexOf(",") + 1)
        : result;
      return Buffer.from(payload, "base64");
    }
  }

  throw new Error("The response did not contain a rendered image.");
}
