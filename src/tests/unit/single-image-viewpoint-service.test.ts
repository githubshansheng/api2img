import { describe, expect, it } from "vitest";
import type {
  SingleImageViewpointAnalysis,
  SingleImageViewpointRequest
} from "../../domain";
import {
  buildSingleImageEditForm,
  buildSingleImageReasoningRequest,
  parseSingleImageEditResponse,
  parseSingleImageReasoningResponse,
  resolveSingleImageViewpointEndpoints,
  sanitizeProjectionAcceptanceCriteria,
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
    user_prompt: "保持同一片日落海滩。",
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

const analysis: SingleImageViewpointAnalysis = {
  subjectCategory: "product_object",
  optimizedPrompt: "冲突指令：把相机改成正面平视远景。",
  viewDescription: "冲突的正面平视视图",
  sourceViewDescription: "原图左前三分之四视角",
  targetViewDescription: "错误目标：正面平视",
  relativeCameraMotion: "错误相机动作：向左环绕九十度。",
  visibilityConstraints: [
    "前网罩在屏幕水平方向的投影显著收窄，罩体和电机壳厚度清晰可见。",
    "主体右侧表面必须显露。",
    "将相机改成左侧面 90°。"
  ],
  occlusionConstraints: [
    "远侧支架被前网罩和近侧支架合理遮挡。",
    "主体左侧表面必须退隐。"
  ],
  identityConstraints: [
    "保持同一主体的类别、身份、结构、材质和标记。",
    "禁止让主体主动改变姿态、朝向、构型或场景布局来伪装相机运动。",
    "Do not change the subject's pose or orientation.",
    "错误人物模板：补全脸颊、耳朵和肩部。"
  ],
  hiddenSurfacePlan: [
    "依据已识别类别和结构规律保守补全不可见表面。",
    "主体右侧表面需要按类别补全。",
    "右侧表面需要补全。",
    "错误解剖模板：重建下颌线和鼻孔。"
  ],
  scenePlan: ["保持日落海滩、光源方向与色彩调性。"],
  uncertaintyNotes: ["远侧细节在原图中不可确认。"]
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
    expect(defaults.reasoning_model).toBe("gpt-5.6-sol");
    expect(defaults.image_model).toBe("gpt-image-2");

    expect(() =>
      validateSingleImageViewpointRequest(
        createRequest({ camera_distance: 10.1 })
      )
    ).toThrowError(
      expect.objectContaining({
        code: "SINGLE_VIEW_CAMERA_DISTANCE_INVALID",
        statusCode: 400
      })
    );
  });

  it("builds structured spatial reasoning with explicit guide limitations", () => {
    const request = buildSingleImageReasoningRequest(createRequest()) as {
      model: string;
      input: Array<{ content: Array<Record<string, unknown>> }>;
      text: {
        format: {
          strict: boolean;
          schema: { required: string[] };
        };
      };
    };
    const content = request.input[0]!.content;

    expect(request.model).toBe("gpt-5.6-sol");
    expect(content[0]?.text).toContain(
      "【锁定相机协议｜服务端确定性生成，禁止改写】"
    );
    expect(content[0]?.text).toContain(
      "离散目标视角：基准右侧机位 + 高角度观察 + 特写"
    );
    expect(content[0]?.text).toContain("Y=+450.00°");
    expect(content[0]?.text).toContain(
      "最终生图模型会同时接收图像 1 和图像 2"
    );
    expect(content[0]?.text).toContain(
      "最终生图模型不会接收图像 3"
    );
    expect(content[0]?.text).toContain(
      "optimized_prompt 必须使用中文"
    );
    expect(content[0]?.text).toContain(
      "必须是按主体类别生成、可从最终像素客观验收的投影条件"
    );
    expect(content[0]?.text).toContain(
      "禁止输出“主体右侧表面”“主体左侧表面”"
    );
    expect(content[0]?.text).toContain(
      "世界坐标中的同一动作事件、关节相对关系、装配状态和场景拓扑只作为三维连续基准，不是原图屏幕姿态或朝向锁"
    );
    expect(content[0]?.text).toContain(
      "屏幕坐标中的主体朝向、轮廓、投影宽度、近远侧结构、遮挡顺序和背景视差必须由目标相机重新投影"
    );
    expect(content[0]?.text).toContain(
      "人物、动物或物体在屏幕中的朝向、轮廓和可见结构必须随目标机位变化"
    );
    expect(content[0]?.text).toContain(
      "不得修改、纠正、近似、重述或重新定义"
    );
    expect(content[1]).toMatchObject({
      type: "input_image",
      image_url: createRequest().source_image
    });
    expect(content[2]).toMatchObject({
      type: "input_image",
      image_url: createRequest().pose_guide_image
    });
    expect(content[3]).toMatchObject({
      type: "input_image",
      image_url: createRequest().camera_pose_image
    });
    expect(request.text.format.strict).toBe(true);
    expect(request.text.format.schema.required).toContain(
      "hidden_surface_plan"
    );
    expect(request.text.format.schema.required).toContain(
      "source_view_description"
    );
    expect(request.text.format.schema.required).toContain(
      "visibility_constraints"
    );
  });

  it("builds an unmasked full-image edit using the source and clean pose guide", async () => {
    const request = validateSingleImageViewpointRequest(createRequest());
    const sourceBytes = new Uint8Array([1, 2, 3]);
    const guideBytes = new Uint8Array([4, 5, 6]);
    const form = buildSingleImageEditForm({
      request,
      analysis,
      sourceImage: {
        mimeType: "image/jpeg",
        bytes: sourceBytes
      },
      poseGuideImage: {
        mimeType: "image/png",
        bytes: guideBytes
      }
    });
    const images = form.getAll("image[]") as File[];

    expect(form.get("model")).toBe("gpt-image-2");
    expect(form.get("size")).toBe("2048x1152");
    expect(form.get("quality")).toBe("high");
    expect(form.has("mask")).toBe(false);
    const prompt = String(form.get("prompt"));
    expect(prompt).toContain(
      "【锁定相机协议｜服务端确定性生成，禁止改写】"
    );
    expect(prompt).toContain(
      "离散目标视角：基准右侧机位 + 高角度观察 + 特写"
    );
    expect(prompt).toContain(
      "前网罩在屏幕水平方向的投影显著收窄"
    );
    expect(prompt).toContain(
      "远侧支架被前网罩和近侧支架合理遮挡"
    );
    expect(prompt).not.toContain("主体右侧表面");
    expect(prompt).not.toContain("主体左侧表面");
    expect(prompt).not.toContain("右侧表面需要补全");
    expect(prompt).not.toContain("将相机改成左侧面 90°");
    expect(prompt).toContain("高机位向下观察透视");
    expect(prompt).toContain("逆时针滚转");
    expect(prompt).toContain("保持同一主体的类别、身份、结构、材质和标记");
    expect(prompt).toContain("保持同一片日落海滩");
    expect(prompt).not.toContain(analysis.optimizedPrompt);
    expect(prompt).not.toContain(analysis.targetViewDescription);
    expect(prompt).not.toContain(analysis.relativeCameraMotion);
    expect(prompt).not.toContain(analysis.visibilityConstraints[1]!);
    expect(prompt).not.toContain(analysis.visibilityConstraints[2]!);
    expect(prompt).toContain("图像 2 只提供目标相机投影");
    expect(prompt).not.toContain("图像 3");
    expect(prompt).not.toMatch(/人体|解剖|脸颊|耳朵|下颌|肩部|鼻孔/);
    expect(prompt).not.toMatch(/禁止人物主动转身|禁止物体主动旋转自身|人物模板/);
    expect(prompt).not.toContain("主体主动配合转身");
    expect(prompt).not.toContain("禁止让主体主动改变姿态、朝向");
    expect(prompt).not.toContain(
      "Do not change the subject's pose or orientation."
    );
    expect(prompt).toContain(
      "把物体的零件装配与工作状态作为三维连续参考"
    );
    expect(prompt).toContain(
      "整体相对屏幕的朝向、轮廓、可见部件与遮挡必须按目标机位重建"
    );
    expect(prompt).toContain(
      "原图正向投影可变为侧向或后向投影"
    );
    expect(prompt).not.toContain(analysis.hiddenSurfacePlan[1]!);
    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({
      name: "source.jpg",
      type: "image/jpeg"
    });
    expect(images[1]).toMatchObject({
      name: "pose-guide.png",
      type: "image/png"
    });
    expect(new Uint8Array(await images[0]!.arrayBuffer())).toEqual(sourceBytes);
    expect(new Uint8Array(await images[1]!.arrayBuffer())).toEqual(guideBytes);
  });

  it("keeps category-specific projection criteria and drops camera redefinitions", () => {
    expect(
      sanitizeProjectionAcceptanceCriteria(
        [
          "前网罩投影宽度显著收窄，电机壳厚度清晰可见。",
          "主体右侧表面必须显示。",
          "相机改成左侧面 90°。",
          "补全人物耳朵和下颌线。"
        ],
        "product_object"
      )
    ).toEqual([
      "前网罩投影宽度显著收窄，电机壳厚度清晰可见。"
    ]);

    expect(
      sanitizeProjectionAcceptanceCriteria(
        [
          "只清楚显示一只眼睛，远侧眼睛被鼻梁遮挡，鼻唇下巴形成侧向剪影。",
          "把视角改成正面。"
        ],
        "person"
      )
    ).toEqual([
      "只清楚显示一只眼睛，远侧眼睛被鼻梁遮挡，鼻唇下巴形成侧向剪影。"
    ]);
  });

  it("parses structured analysis and supported image response shapes", () => {
    expect(
      parseSingleImageReasoningResponse({
        output_text: JSON.stringify({
          subject_category: analysis.subjectCategory,
          optimized_prompt: analysis.optimizedPrompt,
          view_description: analysis.viewDescription,
          source_view_description: analysis.sourceViewDescription,
          target_view_description: analysis.targetViewDescription,
          relative_camera_motion: analysis.relativeCameraMotion,
          visibility_constraints: analysis.visibilityConstraints,
          occlusion_constraints: analysis.occlusionConstraints,
          identity_constraints: analysis.identityConstraints,
          hidden_surface_plan: analysis.hiddenSurfacePlan,
          scene_plan: analysis.scenePlan,
          uncertainty_notes: analysis.uncertaintyNotes
        })
      })
    ).toEqual(analysis);

    expect(
      parseSingleImageEditResponse({
        data: [{ b64_json: "rendered" }]
      })
    ).toEqual({
      image: "data:image/png;base64,rendered",
      mimeType: "image/png"
    });
  });

  it("resolves Responses and image edit endpoints", () => {
    expect(
      resolveSingleImageViewpointEndpoints(createRequest().endpoint_override)
    ).toEqual({
      responses: "https://proxy.example/v1/responses",
      imageEdits: "https://images.example/v1/images/edits"
    });
  });
});
