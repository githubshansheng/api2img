import { describe, expect, it } from "vitest";
import { getModelById } from "../../config/models";
import type { GenerationParams, ModelConfig } from "../../domain";
import { planCompareGenerationSlots, type CompareSlotInput } from "../../services/compare-service";

const baseParams: GenerationParams = {
  ratio: "1:1",
  resolution: "1K",
  quality: "high",
  count: 1
};

function slot(slotName: "left" | "right", model: ModelConfig): CompareSlotInput<GenerationParams> {
  return {
    slot: slotName,
    model,
    params: baseParams
  };
}

describe("compare service", () => {
  it("skips a model already running in the main generation queue", () => {
    const image2 = getModelById("gpt-image-2")!;
    const gemini = getModelById("nano-banana-pro")!;

    const plan = planCompareGenerationSlots(
      [slot("left", image2), slot("right", gemini)],
      [image2.id],
      []
    );

    expect(plan.pendingSlots.map((item) => item.model.id)).toEqual([gemini.id]);
    expect(plan.skippedModelNames).toEqual([image2.displayName]);
  });

  it("skips a model already running in model comparison", () => {
    const image2 = getModelById("gpt-image-2")!;
    const gemini = getModelById("nano-banana-pro")!;

    const plan = planCompareGenerationSlots(
      [slot("left", image2), slot("right", gemini)],
      [],
      [gemini.id]
    );

    expect(plan.pendingSlots.map((item) => item.model.id)).toEqual([image2.id]);
    expect(plan.skippedModelNames).toEqual([gemini.displayName]);
  });

  it("does not launch duplicate requests when both comparison slots use the same model", () => {
    const image2 = getModelById("gpt-image-2")!;

    const plan = planCompareGenerationSlots(
      [slot("left", image2), slot("right", image2)],
      [],
      []
    );

    expect(plan.pendingSlots.map((item) => item.slot)).toEqual(["left"]);
    expect(plan.skippedModelNames).toEqual([image2.displayName]);
  });
});
