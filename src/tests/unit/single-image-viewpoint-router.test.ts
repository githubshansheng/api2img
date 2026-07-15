import express from "express";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  SingleImageViewpointRequest,
  SingleImageViewpointStreamEvent
} from "../../domain";
import { createSingleImageViewpointRouter } from "../../../server/single-image-viewpoint/single-image-viewpoint-router";

const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const IMAGE_DATA_URL = `data:image/png;base64,${ONE_PIXEL_PNG}`;
const servers: Server[] = [];

afterEach(async () => {
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
  it("streams authoritative prompts with three analysis images and two edit images", async () => {
    const upstreamCalls: Array<{
      body: RequestInit["body"];
      url: string;
    }> = [];
    const analysis = {
      subject_category: "product_object",
      optimized_prompt:
        "冲突指令：将相机改成正面平视，并保持原始投影。",
      view_description: "错误的正面平视结果",
      source_view_description:
        "原图主要显示主体左前三分之四区域。",
      target_view_description:
        "错误目标：正面平视远景。",
      relative_camera_motion:
        "错误相机动作：向主体左侧环绕。",
      visibility_constraints: [
        "前网罩在屏幕水平方向投影明显收窄，电机壳厚度清晰可见。",
        "主体右侧表面必须显示。"
      ],
      occlusion_constraints: [
        "远侧支架被近侧支架和罩体合理遮挡。",
        "主体左侧表面必须退隐。"
      ],
      identity_constraints: [
        "保持同一主体的类别、身份、结构和材质。",
        "错误人物模板：补全脸颊、耳朵、下颌线和肩部。"
      ],
      hidden_surface_plan: [
        "依据已识别类别和结构规律保守补全不可见表面。"
      ],
      scene_plan: ["保持同一摄影棚、灯光与背景材质。"],
      uncertainty_notes: ["远侧细节在原图中不可确认。"]
    };
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
          return new Response(
            JSON.stringify({
              output_text: JSON.stringify(analysis)
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          );
        }

        if (url === "https://images.example/v1/images/edits") {
          return new Response(
            JSON.stringify({
              data: [{ b64_json: "route-rendered-image" }]
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          );
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
      cameraPrompt: {
        azimuthKey: "right-front",
        elevationKey: "low-angle",
        distanceKey: "wide"
      }
    });
    expect(renderingEvent).toMatchObject({
      type: "stage",
      stage: "rendering",
      analysis: {
        viewDescription: "错误的正面平视结果"
      },
      cameraPrompt: {
        azimuthKey: "right-front",
        elevationKey: "low-angle",
        distanceKey: "wide"
      },
      renderPrompt: expect.stringContaining(
        "【锁定相机协议｜服务端确定性生成，禁止改写】"
      )
    });
    expect(resultEvent).toMatchObject({
      type: "result",
      data: {
        image: "data:image/png;base64,route-rendered-image",
        viewDescription: "错误的正面平视结果",
        cameraPrompt: {
          azimuthKey: "right-front",
          elevationKey: "low-angle",
          distanceKey: "wide"
        },
        renderPrompt: expect.stringContaining(
          "【锁定相机协议｜服务端确定性生成，禁止改写】"
        )
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

    const reasoningCall = upstreamCalls[0]!;
    expect(reasoningCall.url).toBe(
      "https://reasoning.example/v1/responses"
    );
    expect(typeof reasoningCall.body).toBe("string");
    const reasoningBody = JSON.parse(String(reasoningCall.body)) as {
      input: Array<{
        content: Array<Record<string, unknown>>;
      }>;
      text: {
        format: {
          type: string;
          strict: boolean;
        };
      };
    };
    const reasoningContent = reasoningBody.input[0]!.content;
    const reasoningInstructions = String(reasoningContent[0]?.text);

    expect(reasoningContent[1]).toMatchObject({
      type: "input_image",
      image_url: request.source_image
    });
    expect(reasoningContent[2]).toMatchObject({
      type: "input_image",
      image_url: request.pose_guide_image
    });
    expect(reasoningContent[3]).toMatchObject({
      type: "input_image",
      image_url: request.camera_pose_image
    });
    expect(reasoningBody.text.format).toMatchObject({
      type: "json_schema",
      strict: true
    });
    expect(reasoningInstructions).toContain(
      "【锁定相机协议｜服务端确定性生成，禁止改写】"
    );
    expect(reasoningInstructions).toContain(
      "离散目标视角：基准右前方机位 + 低机位仰拍 + 远景"
    );
    expect(reasoningInstructions).toContain("先判定主体类别");
    expect(reasoningInstructions).toContain(
      "禁止把人体器官、服装或解剖术语套用到非人物主体"
    );
    expect(reasoningInstructions).toContain(
      "optimized_prompt 必须使用中文"
    );
    expect(reasoningInstructions).toContain(
      "世界坐标中的同一动作事件、关节相对关系、装配状态和场景拓扑只作为三维连续基准，不是原图屏幕姿态或朝向锁"
    );
    expect(reasoningInstructions).toContain(
      "屏幕坐标中的主体朝向、轮廓、投影宽度、近远侧结构、遮挡顺序和背景视差必须由目标相机重新投影"
    );

    const editCall = upstreamCalls[1]!;
    expect(editCall.url).toBe("https://images.example/v1/images/edits");
    expect(editCall.body).toBeInstanceOf(FormData);
    const form = editCall.body as FormData;
    const images = form.getAll("image[]") as File[];
    const editPrompt = String(form.get("prompt"));

    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({
      name: "source.png",
      type: "image/png"
    });
    expect(images[1]).toMatchObject({
      name: "pose-guide.png",
      type: "image/png"
    });
    expect(form.has("mask")).toBe(false);
    expect(renderingEvent.renderPrompt).toBe(editPrompt);
    expect(resultEvent.data.renderPrompt).toBe(editPrompt);
    expect(resultEvent.data.cameraPrompt).toEqual(
      renderingEvent.cameraPrompt
    );
    expect(editPrompt).toContain(
      "离散目标视角：基准右前方机位 + 低机位仰拍 + 远景"
    );
    expect(editPrompt).toContain("方位角 +65.00°");
    expect(editPrompt).toContain("俯仰角 -35.00°");
    expect(editPrompt).toContain(
      "前网罩在屏幕水平方向投影明显收窄"
    );
    expect(editPrompt).toContain(
      "远侧支架被近侧支架和罩体合理遮挡"
    );
    expect(editPrompt).not.toContain("主体右侧表面");
    expect(editPrompt).not.toContain("主体左侧表面");
    expect(editPrompt).not.toContain("禁止让主体主动改变姿态、朝向");
    expect(editPrompt).toContain("从下方真实可见");
    expect(editPrompt).toContain("低机位向上观察透视");
    expect(editPrompt).toContain("保持同一主体的类别、身份、结构和材质");
    expect(editPrompt).not.toContain(analysis.optimized_prompt);
    expect(editPrompt).not.toContain(analysis.target_view_description);
    expect(editPrompt).not.toContain(analysis.relative_camera_motion);
    expect(editPrompt).toContain("图像 2 只提供目标相机投影");
    expect(editPrompt).not.toContain("图像 3");
    expect(editPrompt).not.toMatch(/人体|解剖|脸颊|耳朵|下颌|肩部|鼻孔/);
    expect(editPrompt).not.toMatch(/禁止人物主动转身|禁止物体主动旋转自身|人物模板/);
    expect(editPrompt).not.toContain("主体主动配合转身");
    expect(editPrompt).toContain(
      "把物体的零件装配与工作状态作为三维连续参考"
    );
    expect(editPrompt).toContain(
      "整体相对屏幕的朝向、轮廓、可见部件与遮挡必须按目标机位重建"
    );
    expect(editPrompt).toContain(
      "原图正向投影可变为侧向或后向投影"
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
