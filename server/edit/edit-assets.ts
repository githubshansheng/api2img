import type {
  EditAsset,
  EditAssetKind,
  EditImageInput,
  GeneratedImage,
  GenerationReferenceInput
} from "../../src/domain";
import {
  GenerationSuiteAssetStore,
  type GenerationSuiteAssetStoreOptions
} from "../suite/suite-assets";

export class EditAssetStore {
  readonly rootDirectory: string;
  readonly publicBaseURL: string;
  private readonly assets: GenerationSuiteAssetStore;

  constructor(
    rootDirectory: string,
    publicBaseURL = "/api/edit-sessions/assets",
    options: GenerationSuiteAssetStoreOptions = {}
  ) {
    this.assets = new GenerationSuiteAssetStore(
      rootDirectory,
      publicBaseURL,
      options
    );
    this.rootDirectory = this.assets.rootDirectory;
    this.publicBaseURL = this.assets.publicBaseURL;
  }

  async persistInput(input: {
    sessionId: string;
    assetId?: string;
    kind: EditAssetKind;
    image: EditImageInput;
  }): Promise<EditAsset> {
    const assetId = input.assetId ?? crypto.randomUUID();
    const reference = await this.assets.persistReference(input.sessionId, {
      ...input.image,
      id: assetId,
      role: "subject"
    });

    if (!reference.assetURL && !reference.remoteURL) {
      throw new Error("EDIT_ASSET_DATA_EMPTY");
    }

    return {
      id: assetId,
      sessionId: input.sessionId,
      kind: input.kind,
      sourceType: reference.assetURL ? "asset" : "url",
      url: reference.assetURL ?? reference.remoteURL ?? "",
      name: reference.name,
      mimeType: reference.mimeType,
      format: reference.format,
      sizeBytes: reference.sizeBytes,
      width: reference.width,
      height: reference.height,
      createdAt: reference.createdAt
    };
  }

  async persistGenerated(input: {
    sessionId: string;
    turnId: string;
    jobId: string;
    candidateIndex: number;
    image: GeneratedImage;
    signal?: AbortSignal;
  }): Promise<EditAsset> {
    const image = await this.assets.persistGeneratedImage({
      suiteId: input.sessionId,
      slotId: input.turnId,
      attemptId: input.jobId,
      candidateIndex: input.candidateIndex,
      image: input.image,
      signal: input.signal
    });

    if (!image.url) {
      throw new Error("EDIT_RESULT_DATA_EMPTY");
    }

    return {
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      kind: "result",
      sourceType: image.sourceType,
      url: image.url,
      name: `edit-result-${input.candidateIndex + 1}.${image.format ?? "png"}`,
      mimeType: image.mimeType ?? "image/png",
      format: image.format ?? "png",
      width: image.width,
      height: image.height,
      createdAt: image.createdAt
    };
  }

  async materialize(asset: EditAsset, order = 0): Promise<GenerationReferenceInput> {
    return this.assets.materializeSuiteImage(
      {
        id: asset.id,
        slotId: "edit",
        attemptId: "materialize",
        candidateIndex: order,
        sourceType: asset.sourceType,
        url: asset.url,
        mimeType: asset.mimeType,
        format:
          asset.format === "jpeg" || asset.format === "jpg"
            ? "jpeg"
            : asset.format === "gif"
              ? "png"
              : asset.format,
        width: asset.width,
        height: asset.height,
        selected: false,
        createdAt: asset.createdAt
      },
      order
    );
  }

  async deleteAssets(sessionId: string, assets: EditAsset[]) {
    await this.assets.deleteGeneratedImages(
      sessionId,
      assets.map((asset, index) => ({
        id: asset.id,
        slotId: "edit",
        attemptId: "rollback",
        candidateIndex: index,
        sourceType: asset.sourceType,
        url: asset.url,
        mimeType: asset.mimeType,
        format:
          asset.format === "jpeg"
            ? "jpg"
            : asset.format === "gif"
              ? "png"
              : asset.format,
        width: asset.width,
        height: asset.height,
        selected: false,
        createdAt: asset.createdAt
      }))
    );
  }

  deleteSessionAssets(sessionId: string) {
    return this.assets.deleteSuiteAssets(sessionId);
  }
}
