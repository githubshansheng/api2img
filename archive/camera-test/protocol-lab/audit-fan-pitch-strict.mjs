import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const archiveRoot = path.resolve(scriptDirectory, "..");
const apiKey = process.env.CODEX_CUSTOM_API_KEY?.trim();

if (!apiKey) {
  throw new Error("CODEX_CUSTOM_API_KEY is required.");
}

const options = parseArguments(process.argv.slice(2));
const view =
  options.view === "top"
    ? {
        label: "俯视 +75°",
        cameraPosition: "产品正前上方",
        lookDirection: "向下",
        expectedMotorOffset: "后置电机壳应投影到网罩中心上方附近",
        defaultCandidate: path.join(
          archiveRoot,
          "2026-07-16T06-41-16-064Z-fan-top-x75-v40-candidate-k-detail-calibrated",
          "result.png"
        )
      }
    : {
        label: "仰视 -75°",
        cameraPosition: "产品正前下方",
        lookDirection: "向上",
        expectedMotorOffset: "后置电机壳应投影到网罩中心下方附近",
        defaultCandidate: path.join(
          archiveRoot,
          "2026-07-16T18-45-00-fan-bottom-x-minus75-v44-candidate-l-local-assembly-repair",
          "result.png"
        )
      };

const inputs = [
  {
    id: "source",
    label: "原始正前方事实图",
    path: path.join(scriptDirectory, "fan-medium-source-crop.png")
  },
  {
    id: "side",
    label: "严格右侧结构证据",
    path: path.join(
      archiveRoot,
      "2026-07-16-fan-side-right-90-v39",
      "result.png"
    )
  },
  {
    id: "candidate",
    label: `${view.label}候选`,
    path: options.candidate
      ? path.resolve(options.candidate)
      : view.defaultCandidate
  }
];

for (const input of inputs) {
  assertInsideArchive(input.path);

  if (!existsSync(input.path)) {
    throw new Error(`Missing input image: ${input.path}`);
  }
}

const imageContent = await Promise.all(
  inputs.map(async (input) => ({
    type: "input_image",
    image_url: `data:image/png;base64,${(
      await readFile(input.path)
    ).toString("base64")}`,
    detail: "high"
  }))
);

const startedAt = Date.now();
const response = await fetch(
  options.endpoint ?? "https://ai.heigh.vip/v1/responses",
  {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: options.model ?? "gpt-5.6-sol",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildAuditPrompt(view)
            },
            ...imageContent
          ]
        }
      ],
      reasoning: {
        effort: options.reasoning ?? "medium"
      },
      text: {
        format: {
          type: "json_schema",
          name: "fan_pitch_projection_audit",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              view: { type: "string" },
              grille_ratio_estimate: { type: "number" },
              grille_projection_score: scoreSchema(),
              motor_axis_score: scoreSchema(),
              support_connection_score: scoreSchema(),
              camera_parallax_score: scoreSchema(),
              roll_zero_score: scoreSchema(),
              active_head_tilt_detected: { type: "boolean" },
              assembly_break_detected: { type: "boolean" },
              strict_pass: { type: "boolean" },
              visible_evidence: {
                type: "array",
                items: { type: "string" },
                maxItems: 6
              },
              defects: {
                type: "array",
                items: { type: "string" },
                maxItems: 6
              },
              verdict: { type: "string" }
            },
            required: [
              "view",
              "grille_ratio_estimate",
              "grille_projection_score",
              "motor_axis_score",
              "support_connection_score",
              "camera_parallax_score",
              "roll_zero_score",
              "active_head_tilt_detected",
              "assembly_break_detected",
              "strict_pass",
              "visible_evidence",
              "defects",
              "verdict"
            ]
          }
        }
      },
      max_output_tokens: 2600
    })
  }
);

const responseText = await response.text();
const responseBody = parseJSON(responseText);
const outputText = extractOutputText(responseBody);
const audit = outputText ? parseJSON(outputText) : null;
const outputPath = resolveArchivedOutputPath(
  options.output ??
    path.join(
      scriptDirectory,
      `fan-${options.view}-strict-audit-${timestampForPath()}.json`
    )
);

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      model: options.model ?? "gpt-5.6-sol",
      status: response.status,
      durationMs: Date.now() - startedAt,
      view: options.view,
      inputs,
      audit,
      usage: responseBody?.usage ?? null,
      rawResponse: audit ? undefined : responseBody
    },
    null,
    2
  )
);

if (!response.ok) {
  throw new Error(
    `Audit failed with HTTP ${response.status}: ${responseText.slice(0, 1000)}`
  );
}

if (!audit) {
  throw new Error("Audit response did not contain valid structured output.");
}

console.log(
  JSON.stringify({
    event: "fan-pitch-strict-audit-completed",
    outputPath,
    view: options.view,
    strictPass: audit.strict_pass,
    grilleRatio: audit.grille_ratio_estimate,
    scores: {
      grille: audit.grille_projection_score,
      motor: audit.motor_axis_score,
      support: audit.support_connection_score,
      parallax: audit.camera_parallax_score,
      roll: audit.roll_zero_score
    }
  })
);

function buildAuditPrompt(targetView) {
  return [
    "你是严格的三维相机投影验收员。只根据像素中的结构证据判断，不根据文件名或候选标签猜测。",
    "三张图依次为：1 原始正前方事实图；2 严格右侧结构证据；3 待验收候选图。",
    "世界装配事实：这是直立放在水平桌面的台式风扇。圆形网罩平面近似竖直，网罩法线与电机轴近似水平；电机壳位于网罩后方；支撑颈连接电机壳后下部并向下进入竖直立柱；底座保持水平。",
    `目标相机：Yaw 0°、Pitch ${targetView.label.includes("+") ? "+75°" : "-75°"}、Roll 0°。相机位于${targetView.cameraPosition}并${targetView.lookDirection}观察。产品及固定部件不得主动俯仰迎向相机。`,
    "正交近似下，竖直圆形网罩与相机视线夹角为 75° 时，屏幕投影短轴/长轴应接近 abs(cos 75°)=0.259。考虑透视、网罩厚度和测量误差，严格可接受区间为 0.20 到 0.35。明显更接近正圆或宽椭圆，说明机头主动转向相机。",
    `${targetView.expectedMotorOffset}；支撑必须仍从后壳下部连续进入竖直立柱。底座水平、桌面与背景应呈现符合${targetView.cameraPosition}的高低机位视差。`,
    "网罩呈横向窄盘并不等于产品被放平。必须联合检查网罩压缩比、后置电机沿水平深度轴的投影、支撑连接、底座、背景视差和 Roll。",
    "评分：0=完全错误，1=严重错误，2=部分成立，3=基本正确但有可见偏差，4=严格正确。",
    "strict_pass 只有在五项评分均不低于 3，网罩比例位于 0.20 到 0.35，且没有主动机头俯仰、装配断裂或 Roll 错误时才可为 true。",
    "证据与缺陷必须引用图中可见的具体部件，不使用泛化的‘侧面’或‘表面’描述。只输出指定 JSON。"
  ].join("\n\n");
}

function scoreSchema() {
  return {
    type: "integer",
    minimum: 0,
    maximum: 4
  };
}

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

  const viewValue = values.get("view");

  if (viewValue !== "top" && viewValue !== "bottom") {
    throw new Error("--view must be either top or bottom.");
  }

  return {
    view: viewValue,
    candidate: values.get("candidate"),
    output: values.get("output"),
    model: values.get("model"),
    reasoning: values.get("reasoning"),
    endpoint: values.get("endpoint")
  };
}

function extractOutputText(body) {
  if (typeof body?.output_text === "string" && body.output_text.trim()) {
    return body.output_text;
  }

  if (!Array.isArray(body?.output)) {
    return "";
  }

  return body.output
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((item) =>
      typeof item?.text === "string"
        ? item.text
        : typeof item?.output_text === "string"
          ? item.output_text
          : ""
    )
    .filter(Boolean)
    .join("\n");
}

function parseJSON(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function timestampForPath() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function resolveArchivedOutputPath(requestedPath) {
  const output = path.resolve(requestedPath);
  assertInsideArchive(output);
  return output;
}

function assertInsideArchive(requestedPath) {
  const canonicalArchiveRoot = resolveCanonicalPath(archiveRoot);
  const canonicalRequestedPath = resolveCanonicalPath(path.resolve(requestedPath));
  const relative = path.relative(canonicalArchiveRoot, canonicalRequestedPath);

  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  ) {
    return;
  }

  throw new Error(`Camera test path must stay inside ${archiveRoot}.`);
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
