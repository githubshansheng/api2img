import { describe, expect, it } from "vitest";
import sharp from "sharp";
import type {
  SingleImageViewpointAnalysis,
  SingleImageViewpointRequest
} from "../../domain";
import {
  assertSingleImageRenderPromptSafety,
  buildSingleImageAnalyzedRenderPrompt,
  buildSingleImageDirectRenderPrompt,
  buildSingleImageEditForm,
  buildSingleImageReasoningRequest,
  parseSingleImageEditResponse,
  parseSingleImageBilingualReasoningResponse,
  parseSingleImageReasoningResponse,
  normalizeSingleImageRenderedImage,
  resolveSingleImageViewpointEndpoints,
  validateSingleImageViewpointRequest
} from "../../../server/single-image-viewpoint/single-image-viewpoint-service";

const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

function imageDataURL() {
  return `data:image/png;base64,${ONE_PIXEL_PNG}`;
}

function createRequest(
  overrides: Partial<SingleImageViewpointRequest> = {}
): SingleImageViewpointRequest {
  return {
    requestId: "single-view-test",
    source_image: imageDataURL(),
    pose_guide_image: imageDataURL(),
    camera_pose_image: imageDataURL(),
    rotation_degrees: {
      x: 25,
      y: 450,
      z: -15
    },
    camera_distance: 6,
    source_width: 1600,
    source_height: 900,
    user_prompt: "延续同一片日落海滩及其光线。",
    background_mode: "preserve_scene",
    api_key: "sk-test",
    reasoning_model: "gpt-5.6-sol",
    image_model: "gpt-image-2",
    output_size: "2048x1152",
    endpoint_override: {
      baseURL: "https://proxy.example/v1/images/generations",
      editURL: "https://images.example/v1/images/edits"
    },
    ...overrides
  };
}

const legacyAnalysis: SingleImageViewpointAnalysis = {
  subjectCategory: "product_object",
  optimizedPrompt: "把相机改成正面。",
  viewDescription: "旧分析",
  sourceViewDescription: "旧源视角",
  targetViewDescription: "旧目标视角",
  relativeCameraMotion: "旧相机描述",
  visibilityConstraints: ["主体右侧表面必须显露。"],
  occlusionConstraints: ["主体左侧表面必须退隐。"],
  identityConstraints: ["Do not change the subject's pose or orientation."],
  hiddenSurfacePlan: ["补全耳朵、下颌和肩部。"],
  scenePlan: ["保留源图背景二维构图。"],
  uncertaintyNotes: ["旧分析不参与正式渲染。"]
};

const analyzedEnglish: SingleImageViewpointAnalysis = {
  subjectCategory: "product_object",
  optimizedPrompt:
    "Preserve the same white tabletop fan, molded plastic, soft daylight, and warm kitchen color palette.",
  viewDescription: "Bilingual visual fact plan.",
  sourceViewDescription: "The source shows the fan grille facing the camera.",
  targetViewDescription: "Server-locked target view.",
  relativeCameraMotion: "Server-locked camera motion.",
  visibilityConstraints: [
    "The front grille and circular rim become visibly narrow while the motor housing depth remains continuous."
  ],
  occlusionConstraints: [
    "The far support is naturally occluded by the nearer housing and grille."
  ],
  identityConstraints: [
    "Keep the same fan model, white molded plastic, base, stem, grille spacing, and control layout."
  ],
  hiddenSurfacePlan: [
    "Complete the newly visible motor housing and rear grille with conservative manufacturing continuity."
  ],
  scenePlan: [
    "Continue the kitchen walls, tabletop, cabinetry, window light, and foreground-to-background depth."
  ],
  uncertaintyNotes: [
    "Use the simplest construction consistent with the visible product."
  ]
};

const analyzedChinese: SingleImageViewpointAnalysis = {
  subjectCategory: "product_object",
  optimizedPrompt:
    "保持同一台白色桌面风扇、注塑塑料、柔和日光和暖色厨房调性。",
  viewDescription: "双语视觉事实计划。",
  sourceViewDescription: "原图中风扇网罩朝向镜头。",
  targetViewDescription: "服务端锁定目标视角。",
  relativeCameraMotion: "服务端锁定相机运动。",
  visibilityConstraints: [
    "前网罩与圆形边框投影明显收窄，同时保持电机外壳的真实纵深。"
  ],
  occlusionConstraints: [
    "远侧支架被近侧外壳和网罩自然遮挡。"
  ],
  identityConstraints: [
    "保持同一风扇型号、白色注塑塑料、底座、立柱、网罩间距和控制布局。"
  ],
  hiddenSurfacePlan: [
    "按制造结构连续性保守补全新显露的电机外壳与后网罩。"
  ],
  scenePlan: [
    "延续厨房墙面、桌面、橱柜、窗户光线与前后空间纵深。"
  ],
  uncertaintyNotes: ["采用与可见产品一致的最简结构。"]
};

const analyzedPersonChinese: SingleImageViewpointAnalysis = {
  subjectCategory: "person",
  optimizedPrompt: "保持同一位年轻女性、白色上衣与窗侧柔光。",
  viewDescription: "人物视觉事实计划。",
  sourceViewDescription:
    "源图屏幕右侧即人物自身左耳清晰可见，屏幕左侧即人物自身右耳被头发遮住。",
  targetViewDescription: "服务端锁定目标视角。",
  relativeCameraMotion: "服务端锁定相机运动。",
  visibilityConstraints: ["人物自身右耳与右颊应自然显露。"],
  occlusionConstraints: ["人物自身左耳与左颊应自然退隐。"],
  identityConstraints: ["保持同一人物身份、发型、服装与光线。"],
  hiddenSurfacePlan: ["保守补全人物自身右耳与右侧发际。"],
  scenePlan: ["延续窗框、墙面、木质家具和室内纵深。"],
  uncertaintyNotes: ["不可确认细节采用自然、保守的人体结构。"]
};

describe("single-image viewpoint service", () => {
  it("validates cumulative angles and recomputes the equivalent pose", () => {
    const request = validateSingleImageViewpointRequest(createRequest());

    expect(request.pose.normalizedDegrees).toEqual({
      x: 25,
      y: 90,
      z: -15
    });
    expect(request.camera_distance).toBe(6);
    expect(request.cameraPrompt.distanceKey).toBe("close-up");
    expect(request.api_key).toBe("sk-test");

    expect(() =>
      validateSingleImageViewpointRequest(
        createRequest({
          rotation_degrees: { x: 0, y: 721, z: 0 }
        })
      )
    ).toThrowError(
      expect.objectContaining({
        code: "SINGLE_VIEW_ROTATION_INVALID",
        statusCode: 400
      })
    );

    const defaults = validateSingleImageViewpointRequest(
      createRequest({
        camera_distance: undefined,
        reasoning_model: "",
        image_model: ""
      })
    );

    expect(defaults.camera_distance).toBe(5);
    expect(defaults.prompt_language).toBe("en");
    expect(defaults.reasoning_model).toBe("gpt-5.6-sol");
    expect(defaults.image_model).toBe("gpt-image-2");

    const square = validateSingleImageViewpointRequest(
      createRequest({
        source_width: 1254,
        source_height: 1254,
        output_size: "2048x1152"
      })
    );
    expect(square.output_size).toBe("2048x2048");
    expect(square.cameraPrompt.sourceAspectRatioLabel).toBe("1:1");
    expect(square.cameraPrompt.outputSize).toBe("2048x2048");
  });

  it("builds a deterministic whole-scene recapture prompt without category assumptions", () => {
    const request = validateSingleImageViewpointRequest(createRequest());
    const prompt = buildSingleImageDirectRenderPrompt(
      request.pose,
      request.user_prompt,
      request.camera_distance,
      "zh",
      {
        sourceWidth: request.source_width,
        sourceHeight: request.source_height,
        outputSize: request.output_size
      }
    );

    expect(prompt).toContain(
      "相机直绘版本：10.6｜画面侧主指令、反镜头跟随与整场景新视锥重拍"
    );
    expect(prompt).toContain(
      "【唯一最高优先级任务｜相机新视角重拍】"
    );
    expect(prompt).toContain(
      "通过新视锥重拍完整且固定的三维场景"
    );
    expect(prompt).toContain(
      "核心口令：将镜头转向中心人物/物品的左侧，自动补全原图不可见的部分，包括背景、人物的镜像、物品的镜像"
    );
    expect(prompt).toContain(
      "“人物的镜像、物品的镜像”专指依据真实类别和原图证据进行三维对侧补全"
    );
    expect(prompt).toContain(
      "特写"
    );
    expect(prompt).toContain(
      "沿该侧轨道环绕 90.00°"
    );
    expect(prompt).toContain(
      "镜头位于原图画面左侧"
    );
    expect(prompt).toContain(
      "画面随镜头转动并重新成像"
    );
    expect(prompt).toContain(
      "前景、中心对象、环境、背景、地面和画面边缘必须一起更新透视、视差、尺度、遮挡和构图"
    );
    expect(prompt).toContain(
      "不是只让人物或物品转身"
    );
    expect(prompt).toContain(
      "补全目标机位可见、但图像 1 未拍到或被遮挡的全部范围"
    );
    expect(prompt).toContain(
      "不是整图水平翻转、镜面倒影、复制对象或复制原图像素"
    );
    expect(prompt).toContain(
      "若结果仍接近原图正面、背景仍冻结在原构图"
    );
    expect(prompt).toContain(
      "第一张图是画面元素与完整环境的事实参考；第二张图是干净的旋转目标投影图"
    );
    expect(prompt).toContain(
      "第三张图是完整 XYZ 机位图"
    );
    expect(prompt).toContain(
      "不要照抄引导图中的卡片、坐标轴、旋转环、边框、底色、标签或预览外观"
    );
    expect(prompt).toContain(
      "看回同一场景中心"
    );
    expect(prompt).toContain(
      "保持图像 1 的 16:9 宽高比，最终输出 2048x1152"
    );
    expect(prompt).toContain("延续同一片日落海滩及其光线");
    expect(prompt).not.toMatch(
      /主体(?:右|左)侧表面|耳朵|下颌|肩部|风扇|网罩|人体器官/
    );
    expect(prompt).not.toContain("禁止改变姿态");
    expect(prompt).not.toContain("禁止改变朝向");
  });

  it("builds one bilingual reasoning request with the source, clean guide, and full camera view", () => {
    const request = buildSingleImageReasoningRequest(createRequest()) as {
      input: Array<{ content: Array<Record<string, unknown>> }>;
      model: string;
      text: {
        format: {
          schema: {
            properties: Record<string, unknown>;
            required: string[];
          };
        };
      };
    };
    const content = request.input[0]!.content;
    const instruction = String(content[0]?.text);

    expect(request.model).toBe("gpt-5.6-sol");
    expect(instruction).toContain(
      "图像3是完整 XYZ 机位图，用于核对坐标轴、旋转环、Roll 和机位方向"
    );
    expect(instruction).toContain(
      "zh 与 en 表达完全相同的事实"
    );
    expect(instruction).toContain(
      "服务端只读机位参数"
    );
    expect(instruction).toContain(
      "hidden_surface_plan 必须列出因目标偏航、俯仰、Roll 或景别变化而首次可见"
    );
    expect(instruction).toContain(
      "scene_plan 必须明确补全因新视锥、新景别或新构图而进入画面"
    );
    expect(instruction).toContain(
      "\"cumulativeXYZ\":{\"x\":25,\"y\":450,\"z\":-15}"
    );
    expect(instruction).not.toContain(createRequest().user_prompt);
    expect(content.slice(1)).toEqual([
      {
        type: "input_image",
        image_url: createRequest().source_image,
        detail: "high"
      },
      {
        type: "input_image",
        image_url: createRequest().pose_guide_image,
        detail: "low"
      },
      {
        type: "input_image",
        image_url: createRequest().camera_pose_image,
        detail: "high"
      }
    ]);
    expect(request.text.format.schema.required).toEqual([
      "subject_category",
      "zh",
      "en"
    ]);
    expect(request.text.format.schema.properties).toHaveProperty("zh");
    expect(request.text.format.schema.properties).toHaveProperty("en");
  });

  it("adds the selected language facts without letting analysis redefine the camera", () => {
    const request = validateSingleImageViewpointRequest(createRequest());
    const englishPrompt = buildSingleImageAnalyzedRenderPrompt(
      analyzedEnglish,
      request.pose,
      "Continue the same kitchen.",
      request.camera_distance,
      "en",
      {
        sourceWidth: request.source_width,
        sourceHeight: request.source_height,
        outputSize: request.output_size
      }
    );
    const chinesePrompt = buildSingleImageAnalyzedRenderPrompt(
      analyzedChinese,
      request.pose,
      "延续同一厨房。",
      request.camera_distance,
      "zh",
      {
        sourceWidth: request.source_width,
        sourceHeight: request.source_height,
        outputSize: request.output_size
      }
    );

    expect(englishPrompt).toContain(
      "[gpt-5.6-sol category gate | no free camera wording]"
    );
    expect(englishPrompt).toContain(
      request.cameraPrompt.deterministicPromptEn
    );
    expect(englishPrompt).toContain(
      "Detected category: product or object."
    );
    expect(englishPrompt).toContain(
      "turn the camera toward the LEFT side of the central person or object"
    );
    expect(chinesePrompt).toContain(
      "【gpt-5.6-sol 类别闸门｜不输出自由机位描述】"
    );
    expect(chinesePrompt).toContain(
      request.cameraPrompt.deterministicPromptZh
    );
    expect(chinesePrompt).toContain(
      "识别类别：产品或物体。"
    );
    expect(englishPrompt).not.toContain(
      analyzedEnglish.identityConstraints[0]
    );
    expect(chinesePrompt).not.toContain(
      analyzedChinese.identityConstraints[0]
    );
    expect(chinesePrompt).toContain(
      "核心口令：将镜头转向中心人物/物品的左侧"
    );
    expect(englishPrompt).not.toContain(
      analyzedEnglish.targetViewDescription
    );
    expect(chinesePrompt).not.toContain(
      analyzedChinese.targetViewDescription
    );
    expect(() =>
      assertSingleImageRenderPromptSafety(englishPrompt)
    ).not.toThrow();
    expect(() =>
      assertSingleImageRenderPromptSafety(chinesePrompt)
    ).not.toThrow();
  });

  it("adds a person-only final-screen discriminator without leaking anatomy into product prompts", () => {
    const request = validateSingleImageViewpointRequest(
      createRequest({
        rotation_degrees: { x: 7.1, y: 56.2, z: -362 },
        camera_distance: 1.5,
        source_width: 1254,
        source_height: 1254,
        output_size: "2048x2048"
      })
    );
    const personPrompt = buildSingleImageAnalyzedRenderPrompt(
      analyzedPersonChinese,
      request.pose,
      "延续同一室内场景。",
      request.camera_distance,
      "zh",
      {
        sourceWidth: request.source_width,
        sourceHeight: request.source_height,
        outputSize: request.output_size
      }
    );
    const productPrompt = buildSingleImageAnalyzedRenderPrompt(
      analyzedChinese,
      request.pose,
      "延续同一厨房。",
      request.camera_distance,
      "zh",
      {
        sourceWidth: request.source_width,
        sourceHeight: request.source_height,
        outputSize: request.output_size
      }
    );

    expect(personPrompt).toContain("【人物专用最终屏幕方向判据】");
    expect(personPrompt).toContain(
      "人物自身右耳、右侧发际和右颊属于近侧，必须构成最终画面左侧轮廓"
    );
    expect(personPrompt).toContain(
      "鼻尖和面部前向轴必须指向最终画面右边"
    );
    expect(personPrompt).toContain(
      "若最终图仍像图像 1 一样在画面右侧清楚显示人物自身左耳"
    );
    expect(productPrompt).not.toContain("人物专用最终屏幕方向判据");
    expect(productPrompt).not.toMatch(/右耳|左耳|鼻尖|面部前向轴/);
  });

  it("builds one unmasked Image 2 edit with the source, pose guide, and full camera view", async () => {
    const request = validateSingleImageViewpointRequest(createRequest());
    const sourceBytes = new Uint8Array([1, 2, 3]);
    const guideBytes = new Uint8Array([4, 5, 6]);
    const cameraBytes = new Uint8Array([7, 8, 9]);
    const form = buildSingleImageEditForm({
      request,
      sourceImage: {
        mimeType: "image/jpeg",
        bytes: sourceBytes
      },
      poseGuideImage: {
        mimeType: "image/png",
        bytes: guideBytes
      },
      cameraPoseImage: {
        mimeType: "image/png",
        bytes: cameraBytes
      }
    });
    const images = form.getAll("image[]") as File[];
    const prompt = String(form.get("prompt"));

    expect(form.get("model")).toBe("gpt-image-2");
    expect(form.get("size")).toBe("2048x1152");
    expect(form.get("quality")).toBe("high");
    expect(form.get("input_fidelity")).toBe("high");
    expect(form.has("mask")).toBe(false);
    expect(images).toHaveLength(3);
    expect(images[0]).toMatchObject({
      name: "source.jpg",
      type: "image/jpeg"
    });
    expect(images[1]).toMatchObject({
      name: "pose-guide.png",
      type: "image/png"
    });
    expect(images[2]).toMatchObject({
      name: "camera-pose.png",
      type: "image/png"
    });
    expect(new Uint8Array(await images[0]!.arrayBuffer())).toEqual(sourceBytes);
    expect(new Uint8Array(await images[1]!.arrayBuffer())).toEqual(guideBytes);
    expect(new Uint8Array(await images[2]!.arrayBuffer())).toEqual(cameraBytes);
    expect(prompt).toContain(
      "[Single highest-priority task | camera viewpoint recapture]"
    );
    expect(prompt).toContain(
      "recapture the complete fixed 3D scene through the new view frustum"
    );
    expect(prompt).toContain(
      "a frozen source background"
    );
    expect(prompt).not.toContain(legacyAnalysis.optimizedPrompt);
    expect(prompt).not.toContain(legacyAnalysis.visibilityConstraints[0]!);
    expect(prompt).not.toMatch(/耳朵|下颌|肩部/);
  });

  it("normalizes an upstream landscape image to the locked square output", async () => {
    const landscape = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: { r: 80, g: 120, b: 160 }
      }
    })
      .png()
      .toBuffer();
    const normalized = await normalizeSingleImageRenderedImage(
      {
        image: `data:image/png;base64,${landscape.toString("base64")}`,
        mimeType: "image/png"
      },
      "1024x1024"
    );
    const metadata = await sharp(
      Buffer.from(normalized.image.split(",")[1]!, "base64")
    ).metadata();

    expect(normalized.mimeType).toBe("image/png");
    expect(metadata.width).toBe(1024);
    expect(metadata.height).toBe(1024);
  });

  it("blocks legacy surface templates and source-projection locks", () => {
    expect(() =>
      assertSingleImageRenderPromptSafety("主体右侧表面必须显露。")
    ).toThrowError(
      expect.objectContaining({
        code: "SINGLE_VIEW_RENDER_PROMPT_CONFLICT"
      })
    );
    expect(() =>
      assertSingleImageRenderPromptSafety(
        "Do not change the subject's pose or orientation."
      )
    ).toThrowError(
      expect.objectContaining({
        code: "SINGLE_VIEW_RENDER_PROMPT_CONFLICT"
      })
    );
    expect(() =>
      assertSingleImageRenderPromptSafety(
        "目标新视锥决定整幅场景的透视、视差、遮挡和构图。"
      )
    ).not.toThrow();
  });

  it("parses bilingual reasoning and keeps the legacy parser compatible", () => {
    expect(
      parseSingleImageBilingualReasoningResponse({
        output_text: JSON.stringify({
          subject_category: "product_object",
          zh: localizedReasoningPayload(analyzedChinese),
          en: localizedReasoningPayload(analyzedEnglish)
        })
      })
    ).toMatchObject({
      subjectCategory: "product_object",
      zh: {
        optimizedPrompt: analyzedChinese.optimizedPrompt,
        identityConstraints: analyzedChinese.identityConstraints
      },
      en: {
        optimizedPrompt: analyzedEnglish.optimizedPrompt,
        identityConstraints: analyzedEnglish.identityConstraints
      }
    });

    expect(
      parseSingleImageReasoningResponse({
        output_text: JSON.stringify({
          subject_category: legacyAnalysis.subjectCategory,
          optimized_prompt: legacyAnalysis.optimizedPrompt,
          view_description: legacyAnalysis.viewDescription,
          source_view_description: legacyAnalysis.sourceViewDescription,
          target_view_description: legacyAnalysis.targetViewDescription,
          relative_camera_motion: legacyAnalysis.relativeCameraMotion,
          visibility_constraints: legacyAnalysis.visibilityConstraints,
          occlusion_constraints: legacyAnalysis.occlusionConstraints,
          identity_constraints: legacyAnalysis.identityConstraints,
          hidden_surface_plan: legacyAnalysis.hiddenSurfacePlan,
          scene_plan: legacyAnalysis.scenePlan,
          uncertainty_notes: legacyAnalysis.uncertaintyNotes
        })
      })
    ).toEqual(legacyAnalysis);

    expect(
      parseSingleImageEditResponse({
        data: [{ b64_json: "rendered" }]
      })
    ).toEqual({
      image: "data:image/png;base64,rendered",
      mimeType: "image/png"
    });
  });

  it("resolves the Responses and image-edit endpoints", () => {
    expect(
      resolveSingleImageViewpointEndpoints(createRequest().endpoint_override)
    ).toEqual({
      responses: "https://proxy.example/v1/responses",
      imageEdits: "https://images.example/v1/images/edits"
    });
  });
});

function localizedReasoningPayload(
  analysis: SingleImageViewpointAnalysis
) {
  return {
    optimized_prompt: analysis.optimizedPrompt,
    source_view_description: analysis.sourceViewDescription,
    visibility_constraints: analysis.visibilityConstraints,
    occlusion_constraints: analysis.occlusionConstraints,
    identity_constraints: analysis.identityConstraints,
    hidden_surface_plan: analysis.hiddenSurfacePlan,
    scene_plan: analysis.scenePlan,
    uncertainty_notes: analysis.uncertaintyNotes
  };
}
