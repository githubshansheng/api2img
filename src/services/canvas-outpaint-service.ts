import type {
  CanvasOutpaintRequest,
  CanvasOutpaintResult
} from "../domain/canvas-outpaint";
import { readApiResponse } from "./api-response-service";
import { GenerationApiError } from "./generation-api-service";

type CanvasOutpaintApiResult = {
  requestId: string;
  status: "success";
  image: {
    dataUrl: string;
    mimeType: string;
    width?: number;
    height?: number;
  };
  analysis: {
    optimizedPrompt: string;
    visualSummary: string;
    extensionPlan: string;
  };
  timings: CanvasOutpaintResult["timings"];
};

export async function createCanvasOutpaint(
  payload: CanvasOutpaintRequest,
  signal?: AbortSignal
): Promise<CanvasOutpaintResult> {
  const response = await fetch("/api/canvas-outpaint", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal
  });
  const body = await readApiResponse<CanvasOutpaintApiResult>(response, {
    requestLabel: "画布扩图"
  });

  if (!response.ok || !body.success || !body.data) {
    throw new GenerationApiError(body.error?.message ?? "画布扩图失败", body.error);
  }

  return {
    requestId: body.data.requestId,
    imageDataUrl: body.data.image.dataUrl,
    mimeType: body.data.image.mimeType,
    width: body.data.image.width,
    height: body.data.image.height,
    analysis: body.data.analysis,
    timings: body.data.timings
  };
}
