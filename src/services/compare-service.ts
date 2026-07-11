import type { ModelConfig } from "../domain";

export type CompareSlotKey = "left" | "right";

export type CompareSlotInput<TParams> = {
  slot: CompareSlotKey;
  model: ModelConfig;
  params: TParams;
};

export type CompareSlotPlan<TParams> = {
  pendingSlots: Array<CompareSlotInput<TParams>>;
  skippedModelNames: string[];
};

export function planCompareGenerationSlots<TParams>(
  slotInputs: Array<CompareSlotInput<TParams>>,
  runningGenerationModelIds: Iterable<string>,
  runningCompareModelIds: Iterable<string>
): CompareSlotPlan<TParams> {
  const plannedModelIds = new Set([...runningGenerationModelIds, ...runningCompareModelIds]);
  const skippedModelNames: string[] = [];
  const pendingSlots: Array<CompareSlotInput<TParams>> = [];

  slotInputs.forEach((slotInput) => {
    if (plannedModelIds.has(slotInput.model.id)) {
      skippedModelNames.push(slotInput.model.displayName);
      return;
    }

    plannedModelIds.add(slotInput.model.id);
    pendingSlots.push(slotInput);
  });

  return {
    pendingSlots,
    skippedModelNames
  };
}
