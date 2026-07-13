import type {
  CreateEditTurnRequest,
  EditImageInput,
  EditSession,
  GenerationParams
} from "../../domain";
import { TINY_PNG_BASE64 } from "./generation-suite";

export function createEditImageInput(
  id: string = crypto.randomUUID(),
  order = 0
): EditImageInput {
  return {
    id,
    name: `${id}.png`,
    mimeType: "image/png",
    format: "png",
    width: 1,
    height: 1,
    base64: TINY_PNG_BASE64,
    order
  };
}

export function createEditParams(): GenerationParams {
  return {
    ratio: "1:1",
    resolution: "1K",
    quality: "high",
    count: 1,
    outputFormat: "png",
    responseFormat: "b64_json"
  };
}

export function createEditTurnRequest(
  session: EditSession,
  overrides: Partial<CreateEditTurnRequest> = {}
): CreateEditTurnRequest {
  return {
    clientTurnId: crypto.randomUUID(),
    branchId: session.currentBranchId,
    sourceVersionIds: [session.currentVersionId],
    mode: "whole",
    modelId: "gpt-image-2",
    modelDisplayName: "GPT Image 2",
    endpointOverride: {
      apiKey: "edit-runtime-secret"
    },
    params: createEditParams(),
    candidateCount: 2,
    originalInstruction: "将背景改为干净的浅灰色，并保持主体和文字不变。",
    regions: [],
    ...overrides
  };
}

export function createEditSessionFixture(): EditSession {
  const sessionId = "edit-session-test";
  const assetId = "edit-asset-root";
  const versionId = "edit-version-root";
  const branchId = "edit-branch-main";
  const now = "2026-07-13T00:00:00.000Z";

  return {
    schemaVersion: 1,
    id: sessionId,
    title: "修图测试",
    status: "active",
    defaultModelId: "gpt-image-2",
    currentVersionId: versionId,
    currentBranchId: branchId,
    branches: [
      {
        id: branchId,
        sessionId,
        name: "主分支",
        headVersionId: versionId,
        baseVersionId: versionId,
        createdAt: now,
        updatedAt: now
      }
    ],
    turns: [],
    messages: [],
    versions: [
      {
        id: versionId,
        sessionId,
        assetId,
        parentVersionIds: [],
        candidateIndex: 0,
        label: "原始图片",
        modelId: "gpt-image-2",
        width: 1,
        height: 1,
        createdAt: now
      }
    ],
    jobs: [],
    assets: [
      {
        id: assetId,
        sessionId,
        kind: "source",
        sourceType: "asset",
        url: "/api/edit-sessions/assets/edit-session-test-root.png",
        name: "source.png",
        mimeType: "image/png",
        format: "png",
        width: 1,
        height: 1,
        createdAt: now
      }
    ],
    continuations: [],
    createdAt: now,
    updatedAt: now
  };
}
