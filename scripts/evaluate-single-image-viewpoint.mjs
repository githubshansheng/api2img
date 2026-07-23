import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const args = parseArguments(process.argv.slice(2));
const apiKey = process.env.CODEX_CUSTOM_API_KEY?.trim();

if (!apiKey) {
  throw new Error("CODEX_CUSTOM_API_KEY is required.");
}

const [sourceBytes, resultBytes, cameraBytes] = await Promise.all([
  readFile(args.source),
  readFile(args.result),
  readFile(args.camera)
]);
const [sourceMetadata, resultMetadata] = await Promise.all([
  sharp(sourceBytes).metadata(),
  sharp(resultBytes).metadata()
]);
const dimensions = {
  source: {
    width: sourceMetadata.width,
    height: sourceMetadata.height
  },
  result: {
    width: resultMetadata.width,
    height: resultMetadata.height
  }
};
const aspectRatioPass = calculateAspectRatioPass(dimensions);
const request = buildRequest({
  sourceImage: toDataURL(sourceBytes),
  resultImage: toDataURL(resultBytes),
  cameraImage: toDataURL(cameraBytes),
  dimensions
});
const startedAt = Date.now();
const response = await fetch(args.endpoint, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(request),
  signal: AbortSignal.timeout(10 * 60 * 1000)
});
const body = await response.json();

if (!response.ok) {
  throw new Error(
    `Viewpoint evaluation failed with HTTP ${response.status}: ${JSON.stringify(body)}`
  );
}

const outputText = extractOutputText(body);

if (!outputText) {
  throw new Error("Viewpoint evaluation did not return output text.");
}

const modelEvaluation = JSON.parse(stripJSONFence(outputText));
const failures = aspectRatioPass
  ? modelEvaluation.failures_zh.filter(
      (failure) => !/画幅|宽高比|比例|aspect/iu.test(failure)
    )
  : modelEvaluation.failures_zh;
const evaluation = {
  ...modelEvaluation,
  aspect_ratio_pass: aspectRatioPass,
  evidence_zh: [
    ...modelEvaluation.evidence_zh.filter(
      (evidence) => !/画幅|宽高比|比例|aspect/iu.test(evidence)
    ),
    `文件元数据验收：源图 ${dimensions.source.width}×${dimensions.source.height}，结果图 ${dimensions.result.width}×${dimensions.result.height}，宽高比${aspectRatioPass ? "一致" : "不一致"}。`
  ],
  failures_zh: failures
};
evaluation.overall_pass = [
  evaluation.direction_pass,
  evaluation.yaw_strength_pass,
  evaluation.pitch_pass,
  evaluation.roll_pass,
  evaluation.distance_framing_pass,
  evaluation.depth_of_field_pass,
  evaluation.anti_tracking_pass,
  evaluation.whole_scene_reprojection_pass,
  evaluation.aspect_ratio_pass
].every(Boolean);

if (evaluation.overall_pass) {
  evaluation.correction_prompt_zh =
    "当前结果已通过目标机位、方向、俯仰、Roll、景别、景深、整场景视差、反镜头跟随和文件宽高比验收，无需修正。";
}
const output = {
  ...evaluation,
  dimensions,
  durationMs: Date.now() - startedAt,
  model: args.model,
  source: args.source,
  result: args.result,
  camera: args.camera
};

if (args.output) {
  await writeFile(
    args.output,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );
}

console.log(JSON.stringify(output));

function buildRequest({
  sourceImage,
  resultImage,
  cameraImage,
  dimensions
}) {
  return {
    model: args.model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "你是单图相机环绕结果的严格视觉验收器，只判断是否真的改变了相机机位，不评价美感。",
              "图像1是零度原图；图像2是待验收结果；图像3是完整目标机位图。",
              `文件元数据：图像1为 ${dimensions.source.width}×${dimensions.source.height}；图像2为 ${dimensions.result.width}×${dimensions.result.height}。宽高比验收以这些像素尺寸为准，不得根据构图观感猜测。`,
              "目标参数：Pitch +7.1°，Yaw +56.2°，Roll 等效 -2°，距离控制值 1.5/10，1:1 方形画幅。",
              "Yaw +56.2° 的唯一方向定义：从原图观看者角度，相机沿原图画面左侧轨道环绕，来到大致正对原相机的对象自身右前方。若对象为人物，鼻尖与面部前向轴应投向最终画面右侧，人物自身右侧是近侧，远侧左眼、左颊和左耳应明显收窄或退隐。",
              "反镜头跟随：人物、动物、可动部件或物品不得追随相机转动并继续正对新镜头。若人物脸部仍近似正面、双眼宽度接近、鼻部没有明显横向投影，即使身体或背景改变，也判定相机环绕强度不足。",
              "整场景验收：前景、对象、中景、背景、地面、墙面、家具、窗户和画面边界应共同出现与同一相机轨道一致的透视、视差、遮挡和构图变化。只转人物/物品或只扩图不算通过。",
              "估算结果相对零度原图的水平相机偏航绝对值。目标 56.2°，40° 到 72° 可判为强度通过；低于 40° 判为不足。",
              "Pitch +7.1° 是轻微高机位和轻微向下观察，不应夸大成明显俯拍，也不得完全变成低机位。estimated_pitch_degrees 使用正值表示高机位、负值表示低机位；0° 到 15° 可判为 pitch_pass。",
              "Roll 等效 -2° 是轻微逆时针画框滚转。estimated_roll_degrees 使用顺时针为正、逆时针为负；-6° 到 +2° 可判为 roll_pass。",
              "距离控制值 1.5/10 对应远景：与零度原图相比，人物/中心对象应占画面更小比例，更多环境进入画幅，不得只是裁切放大。符合则 distance_framing_pass=true。",
              "景深以原图自然浅景深为基准：主体焦点清晰，背景保持自然虚化且空间层次可读，符合则 depth_of_field_pass=true。",
              "overall_pass 只有在 direction_pass、yaw_strength_pass、pitch_pass、roll_pass、distance_framing_pass、depth_of_field_pass、anti_tracking_pass、whole_scene_reprojection_pass、aspect_ratio_pass 全部为 true 时才为 true。",
              "correction_prompt_zh 必须针对观察到的具体失败，使用可观察的最终画面判据，不得改变目标参数。",
              "严格输出 schema JSON。"
            ].join("\n\n")
          },
          {
            type: "input_image",
            image_url: sourceImage,
            detail: "high"
          },
          {
            type: "input_image",
            image_url: resultImage,
            detail: "high"
          },
          {
            type: "input_image",
            image_url: cameraImage,
            detail: "high"
          }
        ]
      }
    ],
    reasoning: {
      effort: "low"
    },
    text: {
      format: {
        type: "json_schema",
        name: "single_image_viewpoint_evaluation",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            camera_side: {
              type: "string",
              enum: [
                "source_frame_left",
                "source_frame_right",
                "front",
                "uncertain"
              ]
            },
            estimated_yaw_degrees: {
              type: "number",
              minimum: 0,
              maximum: 180
            },
            direction_pass: {
              type: "boolean"
            },
            yaw_strength_pass: {
              type: "boolean"
            },
            estimated_pitch_degrees: {
              type: "number",
              minimum: -90,
              maximum: 90
            },
            pitch_pass: {
              type: "boolean"
            },
            estimated_roll_degrees: {
              type: "number",
              minimum: -180,
              maximum: 180
            },
            roll_pass: {
              type: "boolean"
            },
            distance_framing_pass: {
              type: "boolean"
            },
            depth_of_field_pass: {
              type: "boolean"
            },
            anti_tracking_pass: {
              type: "boolean"
            },
            whole_scene_reprojection_pass: {
              type: "boolean"
            },
            aspect_ratio_pass: {
              type: "boolean"
            },
            overall_pass: {
              type: "boolean"
            },
            evidence_zh: {
              type: "array",
              items: {
                type: "string"
              },
              minItems: 1,
              maxItems: 8
            },
            failures_zh: {
              type: "array",
              items: {
                type: "string"
              },
              maxItems: 8
            },
            correction_prompt_zh: {
              type: "string"
            }
          },
          required: [
            "camera_side",
            "estimated_yaw_degrees",
            "direction_pass",
            "yaw_strength_pass",
            "estimated_pitch_degrees",
            "pitch_pass",
            "estimated_roll_degrees",
            "roll_pass",
            "distance_framing_pass",
            "depth_of_field_pass",
            "anti_tracking_pass",
            "whole_scene_reprojection_pass",
            "aspect_ratio_pass",
            "overall_pass",
            "evidence_zh",
            "failures_zh",
            "correction_prompt_zh"
          ]
        }
      }
    },
    max_output_tokens: 1800
  };
}

function parseArguments(values) {
  const args = new Map();

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];

    if (!value?.startsWith("--")) {
      continue;
    }

    const [name, inlineValue] = value.slice(2).split("=", 2);
    const nextValue =
      inlineValue ??
      (values[index + 1] && !values[index + 1].startsWith("--")
        ? values[++index]
        : "true");
    args.set(name, nextValue);
  }

  const source = args.get("source");
  const result = args.get("result");
  const camera = args.get("camera");

  if (!source || !result || !camera) {
    throw new Error(
      "Usage: node scripts/evaluate-single-image-viewpoint.mjs --source <path> --result <path> --camera <path> [--output <path>]"
    );
  }

  return {
    source: path.resolve(source),
    result: path.resolve(result),
    camera: path.resolve(camera),
    output: args.get("output")
      ? path.resolve(args.get("output"))
      : undefined,
    endpoint:
      args.get("endpoint") ?? "https://ai.heigh.vip/v1/responses",
    model: args.get("model") ?? "gpt-5.6-sol"
  };
}

function extractOutputText(body) {
  if (typeof body?.output_text === "string" && body.output_text.trim()) {
    return body.output_text;
  }

  if (!Array.isArray(body?.output)) {
    return undefined;
  }

  return body.output
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((item) => item?.text)
    .filter((text) => typeof text === "string")
    .join("\n")
    .trim();
}

function stripJSONFence(value) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

function toDataURL(bytes) {
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function calculateAspectRatioPass(dimensions) {
  const sourceWidth = dimensions.source.width;
  const sourceHeight = dimensions.source.height;
  const resultWidth = dimensions.result.width;
  const resultHeight = dimensions.result.height;

  if (
    !sourceWidth ||
    !sourceHeight ||
    !resultWidth ||
    !resultHeight
  ) {
    return false;
  }

  const sourceRatio = sourceWidth / sourceHeight;
  const resultRatio = resultWidth / resultHeight;

  return Math.abs(sourceRatio - resultRatio) <= 0.01;
}
