import type { EndpointOverride } from "./generation";

export const OUTPAINT_CANVAS_SIZE = 800;
export const OUTPAINT_CANVAS_PADDING = 32;
export const OUTPAINT_ROTATION_MIN = -720;
export const OUTPAINT_ROTATION_MAX = 720;

export type CanvasOutpaintStage = "idle" | "analysis" | "rendering" | "success" | "failed";

export type CanvasOutpaintAnalysis = {
  optimizedPrompt: string;
  visualSummary: string;
  extensionPlan: string;
};

export type CanvasOutpaintResult = {
  requestId: string;
  imageDataUrl: string;
  mimeType: string;
  width?: number;
  height?: number;
  analysis: CanvasOutpaintAnalysis;
  timings: {
    analysisMs: number;
    imageGenerationMs: number;
    totalMs: number;
  };
};

export type CanvasOutpaintRequest = {
  original_image: string;
  base_image: string;
  mask_image: string;
  user_prompt: string;
  api_key?: string;
  analysis_model: string;
  image_model: string;
  output_size: string;
  endpoint_override?: Pick<EndpointOverride, "baseURL" | "editURL" | "headers">;
};

export type RotatedBounds = {
  width: number;
  height: number;
};

export function calculateRotatedBounds(
  width: number,
  height: number,
  angleDegrees: number,
  scale = 1
): RotatedBounds {
  const theta = (angleDegrees * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(theta));
  const sine = Math.abs(Math.sin(theta));

  return {
    width: (width * cosine + height * sine) * scale,
    height: (width * sine + height * cosine) * scale
  };
}

export function calculateMaximumFitScale(input: {
  width: number;
  height: number;
  angleDegrees: number;
  canvasWidth?: number;
  canvasHeight?: number;
  padding?: number;
}) {
  const canvasWidth = input.canvasWidth ?? OUTPAINT_CANVAS_SIZE;
  const canvasHeight = input.canvasHeight ?? OUTPAINT_CANVAS_SIZE;
  const padding = input.padding ?? OUTPAINT_CANVAS_PADDING;
  const unscaledBounds = calculateRotatedBounds(
    input.width,
    input.height,
    input.angleDegrees
  );
  const availableWidth = Math.max(1, canvasWidth - padding * 2);
  const availableHeight = Math.max(1, canvasHeight - padding * 2);

  return Math.min(
    availableWidth / Math.max(1, unscaledBounds.width),
    availableHeight / Math.max(1, unscaledBounds.height)
  );
}

export function clampOutpaintRotationAngle(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(
    OUTPAINT_ROTATION_MAX,
    Math.max(OUTPAINT_ROTATION_MIN, value)
  );
}

export function toFabricRotationAngle(value: number) {
  const normalized = ((value % 360) + 360) % 360;

  return Object.is(normalized, -0) ? 0 : normalized;
}

export function calculateShortestRotationDelta(
  previousVisualAngle: number,
  currentVisualAngle: number
) {
  let delta =
    toFabricRotationAngle(currentVisualAngle) -
    toFabricRotationAngle(previousVisualAngle);

  if (delta > 180) {
    delta -= 360;
  } else if (delta < -180) {
    delta += 360;
  }

  return Object.is(delta, -0) ? 0 : delta;
}

export function accumulateOutpaintRotation(
  cumulativeAngle: number,
  previousVisualAngle: number,
  currentVisualAngle: number
) {
  return clampOutpaintRotationAngle(
    cumulativeAngle +
      calculateShortestRotationDelta(previousVisualAngle, currentVisualAngle)
  );
}
