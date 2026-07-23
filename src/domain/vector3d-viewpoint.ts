import type { EndpointOverride } from "./generation";

export type Vector3DPoint = {
  x: number;
  y: number;
  z: number;
};

export type Vector3DViewportSize = {
  width: number;
  height: number;
};

export type Vector3DCameraParameters = {
  yaw: number;
  pitch: number;
  distance: number;
  position: Vector3DPoint;
  rotation: Vector3DPoint;
  viewport: Vector3DViewportSize;
};

export type GenerateVector3DViewRequest = {
  requestId: string;
  source_image: string;
  draft_image: string;
  camera_parameters: Vector3DCameraParameters;
  reasoning_model: string;
  image_model: string;
  endpoint_override?: EndpointOverride;
};

export type Vector3DRepairAnalysis = {
  optimizedPrompt: string;
  viewDescription: string;
  repairNotes: string[];
};

export type GenerateVector3DViewResult = Vector3DRepairAnalysis & {
  requestId: string;
  image: string;
  imageMimeType: string;
  reasoningModel: string;
  imageModel: string;
  reasoningDurationMs: number;
  renderingDurationMs: number;
  totalDurationMs: number;
};

export type Vector3DGenerationStage = "reasoning" | "rendering";

export type Vector3DStreamEvent =
  | {
      type: "stage";
      stage: Vector3DGenerationStage;
      message: string;
      analysis?: Vector3DRepairAnalysis;
    }
  | {
      type: "result";
      data: GenerateVector3DViewResult;
    }
  | {
      type: "error";
      error: {
        code: string;
        message: string;
        requestId?: string;
        retryable: boolean;
      };
    };

export const VECTOR3D_VIEW_LIMITS = {
  sourceImageBytes: 20 * 1024 * 1024,
  draftImageBytes: 20 * 1024 * 1024,
  combinedImageBytes: 32 * 1024 * 1024
} as const;
