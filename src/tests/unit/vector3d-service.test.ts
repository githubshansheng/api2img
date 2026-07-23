import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GenerateVector3DViewRequest,
  Vector3DRepairAnalysis
} from "../../domain";
import { VECTOR3D_VIEW_LIMITS } from "../../domain";
import {
  buildImageEditForm,
  buildSpatialReasoningRequest,
  generateVector3DView as generateVector3DViewOnServer,
  parseImageEditResponse,
  parseSpatialReasoningResponse,
  resolveVector3DEndpoints,
  validateGenerateVector3DViewRequest,
  Vector3DServiceError
} from "../../../server/vector3d/vector3d-service";
import {
  generateVector3DView as generateVector3DViewInBrowser,
  Vector3DViewpointApiError
} from "../../services/vector3d-viewpoint-service";

const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

function imageDataURL(base64 = ONE_PIXEL_PNG) {
  return `data:image/png;base64,${base64}`;
}

function createRequest(
  overrides: Partial<GenerateVector3DViewRequest> = {}
): GenerateVector3DViewRequest {
  return {
    requestId: "vector3d-test",
    source_image: imageDataURL(),
    draft_image: imageDataURL(),
    camera_parameters: {
      yaw: -42.5,
      pitch: 16.25,
      distance: 4.75,
      position: { x: 2.1, y: 1.3, z: -3.9 },
      rotation: { x: 0.28, y: -0.74, z: 0 },
      viewport: { width: 1280, height: 720 }
    },
    reasoning_model: "gpt-5.5",
    image_model: "gpt-image-2",
    endpoint_override: {
      baseURL: "https://proxy.example/v1/images/generations",
      editURL: "https://images.example/v1/images/edits",
      apiKey: "sk-test"
    },
    ...overrides
  };
}

const analysis: Vector3DRepairAnalysis = {
  optimizedPrompt: "Repair the rear housing while preserving the exact camera.",
  viewDescription: "left rear three-quarter view",
  repairNotes: ["Close splat holes", "Restore brushed aluminum"]
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Vector3D viewpoint service", () => {
  it("validates camera ranges, image types, API keys, and image size limits", () => {
    const valid = validateGenerateVector3DViewRequest(
      createRequest({
        endpoint_override: {
          apiKey: "  sk-trimmed  ",
          headers: {
            " X-Trace ": "trace-1",
            Ignored: 123 as unknown as string
          }
        }
      })
    );

    expect(valid.endpoint_override.apiKey).toBe("sk-trimmed");
    expect(valid.endpoint_override.headers).toEqual({
      "X-Trace": "trace-1"
    });

    expect(() =>
      validateGenerateVector3DViewRequest(
        createRequest({
          camera_parameters: {
            ...createRequest().camera_parameters,
            pitch: 91
          }
        })
      )
    ).toThrowError(
      expect.objectContaining({
        code: "VECTOR3D_PITCH_INVALID",
        statusCode: 400
      })
    );

    expect(() =>
      validateGenerateVector3DViewRequest(
        createRequest({
          source_image: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yw="
        })
      )
    ).toThrowError(
      expect.objectContaining({
        code: "VECTOR3D_IMAGE_TYPE_UNSUPPORTED"
      })
    );

    expect(() =>
      validateGenerateVector3DViewRequest(
        createRequest({
          endpoint_override: {
            apiKey: " "
          }
        })
      )
    ).toThrowError(
      expect.objectContaining({
        code: "API_KEY_REQUIRED"
      })
    );

    const oversized = Buffer.alloc(
      VECTOR3D_VIEW_LIMITS.sourceImageBytes + 1
    ).toString("base64");

    expect(() =>
      validateGenerateVector3DViewRequest(
        createRequest({
          source_image: imageDataURL(oversized)
        })
      )
    ).toThrowError(
      expect.objectContaining({
        code: "VECTOR3D_SOURCE_TOO_LARGE",
        statusCode: 413
      })
    );
  });

  it("resolves Responses and image-edit endpoints from prefixes or full URLs", () => {
    expect(
      resolveVector3DEndpoints({
        baseURL: "https://proxy.example/v1/images/generations",
        editURL: "https://images.example/custom/v1/images/edits",
        apiKey: "sk-test"
      })
    ).toEqual({
      responses: "https://proxy.example/v1/responses",
      imageEdits: "https://images.example/custom/v1/images/edits"
    });

    expect(resolveVector3DEndpoints(undefined)).toEqual({
      responses: "https://api.openai.com/v1/responses",
      imageEdits: "https://api.openai.com/v1/images/edits"
    });
  });

  it("builds a structured Responses request with source and draft image order", () => {
    const request = buildSpatialReasoningRequest(createRequest()) as {
      model: string;
      input: Array<{
        content: Array<Record<string, unknown>>;
      }>;
      reasoning: { effort: string };
      text: {
        format: {
          type: string;
          strict: boolean;
          schema: { required: string[] };
        };
      };
      max_output_tokens: number;
    };
    const content = request.input[0]!.content;

    expect(request.model).toBe("gpt-5.5");
    expect(request.reasoning.effort).toBe("high");
    expect(request.text.format).toMatchObject({
      type: "json_schema",
      strict: true
    });
    expect(request.text.format.schema.required).toEqual([
      "optimized_prompt",
      "view_description",
      "repair_notes"
    ]);
    expect(request.max_output_tokens).toBe(5000);
    expect(content[0]?.text).toContain("yaw=-42.50 degrees");
    expect(content[0]?.text).toContain("pitch=16.25 degrees");
    expect(content[0]?.text).toContain("image-derived Gaussian proxy");
    expect(content[0]?.text).toContain("not authoritative photogrammetry");
    expect(content[0]?.text).toContain(
      "Infer occluded and hidden surfaces conservatively"
    );
    expect(content[1]).toMatchObject({
      type: "input_image",
      image_url: createRequest().source_image,
      detail: "original"
    });
    expect(content[2]).toMatchObject({
      type: "input_image",
      image_url: createRequest().draft_image,
      detail: "original"
    });
  });

  it("builds multipart image edits with the draft first and supported fields only", async () => {
    const request = validateGenerateVector3DViewRequest(createRequest());
    const draftBytes = new Uint8Array([1, 2, 3, 4]);
    const sourceBytes = new Uint8Array([5, 6, 7]);
    const form = buildImageEditForm({
      request,
      analysis,
      draftImage: {
        mimeType: "image/png",
        bytes: draftBytes
      },
      sourceImage: {
        mimeType: "image/jpeg",
        bytes: sourceBytes
      }
    });
    const images = form.getAll("image[]") as File[];

    expect(form.get("model")).toBe("gpt-image-2");
    expect(form.get("quality")).toBe("high");
    expect(form.get("size")).toBe("2048x1152");
    expect(form.get("output_format")).toBe("png");
    expect(form.has("strength")).toBe(false);
    expect(form.has("input_urls")).toBe(false);
    expect(String(form.get("prompt"))).toContain("approximately 0.45");
    expect(String(form.get("prompt"))).toContain("yaw -42.50 degrees");
    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({
      name: "draft.png",
      type: "image/png"
    });
    expect(images[1]).toMatchObject({
      name: "source.jpg",
      type: "image/jpeg"
    });
    expect(new Uint8Array(await images[0]!.arrayBuffer())).toEqual(draftBytes);
    expect(new Uint8Array(await images[1]!.arrayBuffer())).toEqual(sourceBytes);
  });

  it("parses structured reasoning and supported image response shapes", () => {
    const reasoning = parseSpatialReasoningResponse({
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                optimized_prompt: analysis.optimizedPrompt,
                view_description: analysis.viewDescription,
                repair_notes: analysis.repairNotes
              })
            }
          ]
        }
      ]
    });

    expect(reasoning).toEqual(analysis);
    expect(
      parseImageEditResponse({
        data: [{ b64_json: "rendered-base64" }]
      })
    ).toEqual({
      image: "data:image/png;base64,rendered-base64",
      mimeType: "image/png"
    });
    expect(
      parseImageEditResponse({
        output: [{ result: "alternate-base64" }]
      })
    ).toEqual({
      image: "data:image/png;base64,alternate-base64",
      mimeType: "image/png"
    });
  });

  it("marks upstream failures retryable by default", () => {
    expect(new Vector3DServiceError(502, "UPSTREAM", "failed").retryable).toBe(
      true
    );
    expect(
      new Vector3DServiceError(400, "VALIDATION", "failed").retryable
    ).toBe(false);
    expect(() => parseImageEditResponse({ data: [] })).toThrowError(
      expect.objectContaining({
        code: "VECTOR3D_IMAGE_EMPTY",
        retryable: true
      })
    );
  });

  it("propagates an external abort and never starts the image-edit phase", async () => {
    const controller = new AbortController();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            optimized_prompt: analysis.optimizedPrompt,
            view_description: analysis.viewDescription,
            repair_notes: analysis.repairNotes
          })
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );

    const pending = generateVector3DViewOnServer(
      createRequest(),
      (stage) => {
        if (stage.stage === "rendering") {
          controller.abort();
        }
      },
      controller.signal
    );

    await expect(pending).rejects.toMatchObject({
      code: "VECTOR3D_REQUEST_ABORTED",
      retryable: false,
      statusCode: 499
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes the signal to both upstream phases and preserves the request ID", async () => {
    const controller = new AbortController();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              optimized_prompt: analysis.optimizedPrompt,
              view_description: analysis.viewDescription,
              repair_notes: analysis.repairNotes
            })
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json"
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ b64_json: "rendered-base64" }]
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json"
            }
          }
        )
      );

    const result = await generateVector3DViewOnServer(
      createRequest({ requestId: "request-throughout" }),
      undefined,
      controller.signal
    );

    expect(result.requestId).toBe("request-throughout");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects cancellation that arrives as the image-edit response completes", async () => {
    const controller = new AbortController();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              optimized_prompt: analysis.optimizedPrompt,
              view_description: analysis.viewDescription,
              repair_notes: analysis.repairNotes
            })
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json"
            }
          }
        )
      )
      .mockImplementationOnce(async () => {
        controller.abort();
        return new Response(
          JSON.stringify({
            data: [{ b64_json: "rendered-base64" }]
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      });

    await expect(
      generateVector3DViewOnServer(
        createRequest(),
        undefined,
        controller.signal
      )
    ).rejects.toMatchObject({
      code: "VECTOR3D_REQUEST_ABORTED",
      retryable: false,
      statusCode: 499
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("carries stream error request IDs into browser diagnostics", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        `${JSON.stringify({
          type: "error",
          error: {
            code: "VECTOR3D_IMAGE_UPSTREAM_503",
            message: "图像上游暂时不可用",
            requestId: "request-stream-error",
            retryable: true
          }
        })}\n`,
        {
          status: 200,
          headers: {
            "Content-Type": "application/x-ndjson"
          }
        }
      )
    );

    await expect(
      generateVector3DViewInBrowser(createRequest())
    ).rejects.toEqual(
      expect.objectContaining({
        code: "VECTOR3D_IMAGE_UPSTREAM_503",
        message: "图像上游暂时不可用",
        requestId: "request-stream-error",
        retryable: true
      })
    );
  });
});
