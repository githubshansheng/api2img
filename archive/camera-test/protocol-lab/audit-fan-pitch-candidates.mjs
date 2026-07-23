import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const archiveRoot = path.resolve(scriptDirectory, "..");
const apiKey = process.env.CODEX_CUSTOM_API_KEY?.trim();

if (!apiKey) {
  throw new Error("CODEX_CUSTOM_API_KEY is required.");
}

const candidates = [
  {
    id: "source",
    label: "原始正前方参考",
    path: path.join(archiveRoot, "protocol-lab", "fan-medium-source-crop.png")
  },
  {
    id: "side",
    label: "严格右侧结构参考",
    path: path.join(
      archiveRoot,
      "2026-07-16-fan-side-right-90-v39",
      "result.png"
    )
  },
  {
    id: "top",
    label: "候选顶视 +75 度",
    path: path.join(
      archiveRoot,
      "2026-07-16T06-41-16-064Z-fan-top-x75-v40-candidate-k-detail-calibrated",
      "result.png"
    )
  },
  {
    id: "g",
    label: "候选仰视 G",
    path: path.join(
      archiveRoot,
      "2026-07-16T16-45-00-fan-bottom-x-minus75-v40-candidate-g-geometry-repair",
      "result.png"
    )
  },
  {
    id: "k",
    label: "候选仰视 K",
    path: path.join(
      archiveRoot,
      "2026-07-16T18-20-00-fan-bottom-x-minus75-v43-candidate-k-camera-only",
      "result.png"
    )
  },
  {
    id: "l",
    label: "候选仰视 L",
    path: path.join(
      archiveRoot,
      "2026-07-16T18-45-00-fan-bottom-x-minus75-v44-candidate-l-local-assembly-repair",
      "result.png"
    )
  }
];

const imageContent = await Promise.all(
  candidates.map(async (candidate) => ({
    type: "input_image",
    image_url: `data:image/png;base64,${(
      await readFile(candidate.path)
    ).toString("base64")}`,
    detail: "original"
  }))
);

const response = await fetch("https://ai.heigh.vip/v1/responses", {
  method: "POST",
  headers: {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: "gpt-5.6-sol",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildAuditPrompt()
          },
          ...imageContent
        ]
      }
    ],
    reasoning: {
      effort: "high"
    },
    text: {
      format: {
        type: "json_schema",
        name: "fan_camera_projection_audit",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            physical_interpretation: { type: "string" },
            expected_projection: { type: "string" },
            top_candidate: {
              $ref: "#/$defs/candidateAudit"
            },
            bottom_g: {
              $ref: "#/$defs/candidateAudit"
            },
            bottom_k: {
              $ref: "#/$defs/candidateAudit"
            },
            bottom_l: {
              $ref: "#/$defs/candidateAudit"
            },
            best_bottom_candidate: {
              type: "string",
              enum: ["g", "k", "l", "none"]
            },
            best_bottom_is_strict_pass: { type: "boolean" },
            best_bottom_reason: { type: "string" },
            top_previous_pass_is_consistent: { type: "boolean" },
            top_consistency_reason: { type: "string" }
          },
          required: [
            "physical_interpretation",
            "expected_projection",
            "top_candidate",
            "bottom_g",
            "bottom_k",
            "bottom_l",
            "best_bottom_candidate",
            "best_bottom_is_strict_pass",
            "best_bottom_reason",
            "top_previous_pass_is_consistent",
            "top_consistency_reason"
          ],
          $defs: {
            candidateAudit: {
              type: "object",
              additionalProperties: false,
              properties: {
                grille_projection_score: {
                  type: "integer",
                  minimum: 0,
                  maximum: 4
                },
                motor_axis_score: {
                  type: "integer",
                  minimum: 0,
                  maximum: 4
                },
                support_connection_score: {
                  type: "integer",
                  minimum: 0,
                  maximum: 4
                },
                camera_parallax_score: {
                  type: "integer",
                  minimum: 0,
                  maximum: 4
                },
                roll_zero_score: {
                  type: "integer",
                  minimum: 0,
                  maximum: 4
                },
                strict_pass: { type: "boolean" },
                evidence: {
                  type: "array",
                  items: { type: "string" }
                },
                defects: {
                  type: "array",
                  items: { type: "string" }
                }
              },
              required: [
                "grille_projection_score",
                "motor_axis_score",
                "support_connection_score",
                "camera_parallax_score",
                "roll_zero_score",
                "strict_pass",
                "evidence",
                "defects"
              ]
            }
          }
        }
      }
    },
    max_output_tokens: 7000
  })
});

const responseText = await response.text();
const responseBody = parseJSON(responseText);
const outputText = extractOutputText(responseBody);
const audit = outputText ? parseJSON(outputText) : null;
const outputPath = path.join(
  scriptDirectory,
  "fan-pitch-candidate-audit-v1.json"
);

await writeFile(
  outputPath,
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      model: "gpt-5.6-sol",
      status: response.status,
      candidates: candidates.map(({ id, label, path: candidatePath }) => ({
        id,
        label,
        path: candidatePath
      })),
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
  throw new Error("Audit response did not contain output text.");
}

console.log(
  JSON.stringify({
    event: "fan-camera-audit-completed",
    outputPath,
    bestBottomCandidate: audit.best_bottom_candidate,
    strictPass: audit.best_bottom_is_strict_pass,
    topConsistent: audit.top_previous_pass_is_consistent
  })
);

function buildAuditPrompt() {
  return [
    "你是严格的三维相机投影验收员。不要根据文件名、候选编号或文字描述猜测结论，只根据像素中的结构证据判断。",
    "六张图按顺序为：1 原始正前方参考；2 严格右侧结构参考；3 顶视 +75 度候选；4 仰视 -75 度候选 G；5 仰视 -75 度候选 K；6 仰视 -75 度候选 L。",
    "世界空间事实：这是直立放在水平桌面的台式风扇。圆形网罩平面近似竖直，网罩法线和电机轴近似水平；电机壳位于网罩后方；支撑颈连接电机壳后下部并向下进入竖直立柱；底座保持水平。",
    "目标相机只沿原始正前方的垂直轨道移动。Yaw 0 度，Roll 0 度。顶视相机 Pitch +75 度，位于产品正前上方并向下看；仰视相机 Pitch -75 度，位于产品正前下方并向上看。产品及其固定部件绝不主动俯仰迎向相机。",
    "严格透视预期：竖直圆盘与相机视线夹角为 75 度时，正交近似下的投影短轴/长轴为 abs(cos 75 度)=0.259；允许透视与网罩厚度造成约 0.20 到 0.35。明显接近正圆或宽椭圆说明机头主动朝向相机，不能通过。",
    "不要因为仰视下的网罩看起来像横向盘状就直接判失败。必须检查它是否仍是竖直圆盘的强压缩投影，以及后置电机沿水平深度轴的投影、支撑连接、底座和背景低机位视差是否共同自洽。",
    "评分 0=完全错误，1=严重错误，2=部分成立，3=基本正确但有可见偏差，4=严格正确。strict_pass 只有在五项均不低于 3，且没有产品主动俯仰、装配断裂或 Roll 错误时才可为 true。",
    "对顶视候选也使用完全相同的物理标准，明确判断此前把它当作通过是否一致。",
    "只输出指定 JSON。所有证据和缺陷必须引用图中可见的具体结构，不使用泛化的‘侧面’或‘表面’描述。"
  ].join("\n\n");
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
