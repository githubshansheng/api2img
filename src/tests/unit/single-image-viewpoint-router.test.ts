import express from "express";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  SingleImageViewpointRequest,
  SingleImageViewpointStreamEvent
} from "../../domain";
import { createSingleImageViewpointRouter } from "../../../server/single-image-viewpoint/single-image-viewpoint-router";
import { clearSingleImageReasoningCacheForTests } from "../../../server/single-image-viewpoint/single-image-viewpoint-service";

const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const IMAGE_DATA_URL = `data:image/png;base64,${ONE_PIXEL_PNG}`;
const servers: Server[] = [];
const BILINGUAL_REASONING_PAYLOAD = {
  subject_category: "product_object",
  zh: {
    optimized_prompt:
      "保持同一台白色桌面风扇、注塑塑料、柔和窗光和暖色厨房环境。",
    source_view_description: "原图中风扇网罩朝向镜头。",
    visibility_constraints: [
      "前网罩与圆形边框投影明显收窄，同时保持电机外壳的真实纵深。"
    ],
    occlusion_constraints: [
      "远侧支架被近侧外壳和网罩自然遮挡。"
    ],
    identity_constraints: [
      "保持同一风扇型号、白色注塑塑料、底座、立柱、网罩间距和控制布局。"
    ],
    hidden_surface_plan: [
      "按制造结构连续性保守补全新显露的电机外壳与后网罩。"
    ],
    scene_plan: [
      "延续厨房墙面、桌面、橱柜、窗户光线与前后空间纵深。"
    ],
    uncertainty_notes: ["采用与可见产品一致的最简结构。"]
  },
  en: {
    optimized_prompt:
      "Preserve the same white tabletop fan, molded plastic, soft window light, and warm kitchen environment.",
    source_view_description: "The source shows the fan grille facing the lens.",
    visibility_constraints: [
      "The front grille and circular rim become visibly narrow while the motor housing depth remains continuous."
    ],
    occlusion_constraints: [
      "The far support is naturally occluded by the nearer housing and grille."
    ],
    identity_constraints: [
      "Keep the same fan model, white molded plastic, base, stem, grille spacing, and control layout."
    ],
    hidden_surface_plan: [
      "Complete the newly visible motor housing and rear grille with conservative manufacturing continuity."
    ],
    scene_plan: [
      "Continue the kitchen walls, tabletop, cabinetry, window light, and foreground-to-background depth."
    ],
    uncertainty_notes: [
      "Use the simplest construction consistent with the visible product."
    ]
  }
} as const;

afterEach(async () => {
  clearSingleImageReasoningCacheForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();

  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        })
    )
  );
});

describe("single-image viewpoint router", () => {
  it("streams reasoning and rendering while sending all three images to gpt-5.6-sol", async () => {
    const upstreamCalls: Array<{
      body: RequestInit["body"];
      url: string;
    }> = [];
    const upstreamFetch = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        upstreamCalls.push({ url, body: init?.body });

        if (url === "https://reasoning.example/v1/responses") {
          return jsonResponse({
            output_text: JSON.stringify(BILINGUAL_REASONING_PAYLOAD)
          });
        }

        if (url === "https://images.example/v1/images/edits") {
          return jsonResponse({
            data: [{ b64_json: "route-rendered-image" }]
          });
        }

        throw new Error(`Unexpected upstream URL: ${url}`);
      }
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const app = express();
    app.use(express.json({ limit: "5mb" }));
    app.use(
      "/api/single-image-viewpoint",
      createSingleImageViewpointRouter()
    );
    const server = http.createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const address = server.address() as AddressInfo;
    const request = createRequest();
    const response = await postNDJSON(
      address.port,
      "/api/single-image-viewpoint?stream=1",
      request
    );

    expect(response.statusCode).toBe(200);
    expect(response.contentType).toContain("application/x-ndjson");

    const reasoningEvent = response.events.find(
      (event) =>
        event.type === "stage" && event.stage === "reasoning"
    );
    const renderingEvent = response.events.find(
      (event) =>
        event.type === "stage" && event.stage === "rendering"
    );
    const resultEvent = response.events.find(
      (event) => event.type === "result"
    );

    expect(reasoningEvent).toMatchObject({
      type: "stage",
      stage: "reasoning",
      message:
        "gpt-5.6-sol 正在分析原图、目标投影与完整 XYZ 机位图",
      promptLanguage: "en",
      cameraPrompt: {
        azimuthKey: "right-front",
        elevationKey: "low-angle",
        distanceKey: "wide"
      }
    });
    expect(renderingEvent).toMatchObject({
      type: "stage",
      stage: "rendering",
      message: "gpt-image-2 正在使用英文提示词从目标新机位重新拍摄整个场景",
      cameraPrompt: {
        azimuthKey: "right-front",
        elevationKey: "low-angle",
        distanceKey: "wide"
      },
      renderPrompt: expect.stringContaining(
        "[Single highest-priority task | camera viewpoint recapture]"
      )
    });
    expect(resultEvent).toMatchObject({
      type: "result",
      data: {
        image: "data:image/png;base64,route-rendered-image",
        subjectCategory: "product_object",
        viewDescription:
          BILINGUAL_REASONING_PAYLOAD.en.optimized_prompt,
        cameraPrompt: {
          azimuthKey: "right-front",
          elevationKey: "low-angle",
          distanceKey: "wide"
        },
        renderPrompt: expect.stringContaining(
          "[Single highest-priority task | camera viewpoint recapture]"
        ),
        promptLanguage: "en",
        reasoningModel: "gpt-5.6-sol",
        reasoningDurationMs: expect.any(Number)
      }
    });
    expect(response.events.map((event) => event.type)).toEqual([
      "stage",
      "stage",
      "result"
    ]);
    expect(upstreamFetch).toHaveBeenCalledTimes(2);

    if (
      !renderingEvent ||
      renderingEvent.type !== "stage" ||
      !resultEvent ||
      resultEvent.type !== "result"
    ) {
      throw new Error("Expected rendering and result stream events.");
    }

    const reasoningCall = upstreamCalls.find(
      (call) => call.url === "https://reasoning.example/v1/responses"
    )!;
    const reasoningBody = JSON.parse(String(reasoningCall.body)) as {
      input: Array<{ content: Array<Record<string, unknown>> }>;
      model: string;
    };
    expect(reasoningBody.model).toBe("gpt-5.6-sol");
    expect(reasoningBody.input[0]!.content.slice(1)).toEqual([
      {
        type: "input_image",
        image_url: request.source_image,
        detail: "high"
      },
      {
        type: "input_image",
        image_url: request.pose_guide_image,
        detail: "low"
      },
      {
        type: "input_image",
        image_url: request.camera_pose_image,
        detail: "high"
      }
    ]);

    const editCall = upstreamCalls.find(
      (call) => call.url === "https://images.example/v1/images/edits"
    )!;
    expect(editCall.url).toBe("https://images.example/v1/images/edits");
    expect(editCall.body).toBeInstanceOf(FormData);
    const form = editCall.body as FormData;
    const images = form.getAll("image[]") as File[];
    const editPrompt = String(form.get("prompt"));

    expect(images).toHaveLength(3);
    expect(images[0]).toMatchObject({
      name: "source.png",
      type: "image/png"
    });
    expect(images[1]).toMatchObject({
      name: "pose-guide.png",
      type: "image/png"
    });
    expect(images[2]).toMatchObject({
      name: "camera-pose.png",
      type: "image/png"
    });
    expect(form.has("mask")).toBe(false);
    expect(renderingEvent.renderPrompt).toBe(editPrompt);
    expect(resultEvent.data.renderPrompt).toBe(editPrompt);
    expect(resultEvent.data.cameraPrompt).toEqual(
      renderingEvent.cameraPrompt
    );
    expect(editPrompt).toContain(
      "wide shot"
    );
    expect(editPrompt).toContain(
      "turn the camera toward the LEFT side of the central person or object"
    );
    expect(editPrompt).toContain(
      "places the camera on the element's own RIGHT"
    );
    expect(editPrompt).toContain(
      "lower the camera 35.00° and look upward toward the center"
    );
    expect(editPrompt).toContain(
      "Orbit along that side by 65.00°"
    );
    expect(editPrompt).toContain("roll +0.00°");
    expect(editPrompt).toContain(
      "recapture the complete fixed 3D scene through the new view frustum"
    );
    expect(editPrompt).toContain(
      "foreground, central element, environment, background, ground, and frame edges"
    );
    expect(editPrompt).toContain(
      "everything visible from the target camera but absent or occluded in image 1"
    );
    expect(editPrompt).toContain(
      "a frozen source background"
    );
    expect(editPrompt).toContain(
      "update perspective, parallax, scale, occlusion, and composition together"
    );
    expect(editPrompt).toContain(
      "Image 2 is the clean rotated target projection"
    );
    expect(editPrompt).toContain(
      "Image 3 is the complete XYZ camera-position diagram"
    );
    expect(editPrompt).toContain(
      "[gpt-5.6-sol category gate | no free camera wording]"
    );
    expect(editPrompt).not.toContain(
      BILINGUAL_REASONING_PAYLOAD.en.identity_constraints[0]!
    );
    expect(editPrompt).not.toContain(request.camera_pose_image);
    expect(editPrompt).not.toContain("主体右侧表面");
    expect(editPrompt).not.toContain("主体左侧表面");
    expect(editPrompt).not.toContain("禁止让主体主动改变姿态、朝向");
    expect(editPrompt).not.toMatch(/人体|解剖|脸颊|耳朵|下颌|肩部|鼻孔/);
  });

  it("reuses one bilingual reasoning call for concurrent Chinese and English renders", async () => {
    const upstreamCalls: Array<{
      body: RequestInit["body"];
      url: string;
    }> = [];
    let editIndex = 0;
    const upstreamFetch = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        upstreamCalls.push({ url, body: init?.body });

        if (url === "https://reasoning.example/v1/responses") {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return jsonResponse({
            output_text: JSON.stringify(BILINGUAL_REASONING_PAYLOAD)
          });
        }

        if (url === "https://images.example/v1/images/edits") {
          editIndex += 1;
          return jsonResponse({
            data: [{ b64_json: `bilingual-render-${editIndex}` }]
          });
        }

        throw new Error(`Unexpected upstream URL: ${url}`);
      }
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const app = express();
    app.use(express.json({ limit: "5mb" }));
    app.use(
      "/api/single-image-viewpoint",
      createSingleImageViewpointRouter()
    );
    const server = http.createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const address = server.address() as AddressInfo;
    const baseRequest = createRequest();
    const [englishResponse, chineseResponse] = await Promise.all([
      postNDJSON(
        address.port,
        "/api/single-image-viewpoint?stream=1",
        {
          ...baseRequest,
          requestId: "single-view-router-en",
          prompt_language: "en",
          user_prompt: "Continue the same studio."
        }
      ),
      postNDJSON(
        address.port,
        "/api/single-image-viewpoint?stream=1",
        {
          ...baseRequest,
          requestId: "single-view-router-zh",
          prompt_language: "zh",
          user_prompt: "延续同一摄影棚。"
        }
      )
    ]);

    const reasoningCalls = upstreamCalls.filter(
      (call) => call.url === "https://reasoning.example/v1/responses"
    );
    const editCalls = upstreamCalls.filter(
      (call) => call.url === "https://images.example/v1/images/edits"
    );

    expect(reasoningCalls).toHaveLength(1);
    expect(editCalls).toHaveLength(2);
    expect(englishResponse.events.at(-1)).toMatchObject({
      type: "result",
      data: {
        promptLanguage: "en",
        reasoningModel: "gpt-5.6-sol",
        subjectCategory: "product_object"
      }
    });
    expect(chineseResponse.events.at(-1)).toMatchObject({
      type: "result",
      data: {
        promptLanguage: "zh",
        reasoningModel: "gpt-5.6-sol",
        subjectCategory: "product_object"
      }
    });
    expect(englishResponse.events.map((event) => event.type)).toEqual([
      "stage",
      "stage",
      "result"
    ]);
    expect(chineseResponse.events.map((event) => event.type)).toEqual([
      "stage",
      "stage",
      "result"
    ]);

    const renderPrompts = editCalls.map((call) =>
      String((call.body as FormData).get("prompt"))
    );
    expect(renderPrompts).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "[Single highest-priority task | camera viewpoint recapture]"
        ),
        expect.stringContaining(
          "【唯一最高优先级任务｜相机新视角重拍】"
        )
      ])
    );
    expect(renderPrompts.join("\n")).not.toContain(
      BILINGUAL_REASONING_PAYLOAD.en.identity_constraints[0]!
    );
    expect(renderPrompts.join("\n")).not.toContain(
      BILINGUAL_REASONING_PAYLOAD.zh.identity_constraints[0]!
    );
    expect(renderPrompts.join("\n")).toContain(
      "Detected category: product or object."
    );
    expect(renderPrompts.join("\n")).toContain(
      "识别类别：产品或物体。"
    );
  });
});

function createRequest(): SingleImageViewpointRequest {
  return {
    requestId: "single-view-router-test",
    source_image: IMAGE_DATA_URL,
    pose_guide_image: IMAGE_DATA_URL,
    camera_pose_image: IMAGE_DATA_URL,
    rotation_degrees: { x: -35, y: 65, z: 0 },
    camera_distance: 1,
    user_prompt: "保持坐姿和原始摄影棚。",
    background_mode: "preserve_scene",
    api_key: "sk-test",
    reasoning_model: "gpt-5.6-sol",
    image_model: "gpt-image-2",
    output_size: "2048x2048",
    endpoint_override: {
      baseURL: "https://reasoning.example",
      editURL: "https://images.example/v1/images/edits"
    }
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function postNDJSON(
  port: number,
  path: string,
  body: unknown
): Promise<{
  statusCode: number;
  contentType: string;
  events: SingleImageViewpointStreamEvent[];
}> {
  const payload = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        );
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            statusCode: response.statusCode ?? 0,
            contentType: String(response.headers["content-type"] ?? ""),
            events: text
              .split(/\r?\n/)
              .filter((line) => line.trim())
              .map(
                (line) =>
                  JSON.parse(line) as SingleImageViewpointStreamEvent
              )
          });
        });
      }
    );

    request.once("error", reject);
    request.end(payload);
  });
}
