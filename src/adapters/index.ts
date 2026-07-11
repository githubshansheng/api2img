import type { ImageAdapter, ModelConfig } from "../domain";
import { geminiImageAdapter } from "./gemini-image-adapter";
import { genericImageAdapter } from "./generic-image-adapter";
import { openAIImageAdapter } from "./openai-image-adapter";

export const imageAdapters: ImageAdapter[] = [openAIImageAdapter, geminiImageAdapter, genericImageAdapter];

export function selectImageAdapter(model: ModelConfig): ImageAdapter | undefined {
  return imageAdapters.find((adapter) => adapter.supports(model));
}

export { geminiImageAdapter, genericImageAdapter, openAIImageAdapter };
export * from "./adapter-utils";
