import type { GenerationParams } from "./generation";
import type { ModelCapabilities, ModelConfig, TemporaryRestriction } from "./model";

export type ResolvedModelCapabilities = ModelCapabilities & {
  activeRestrictions: TemporaryRestriction[];
  disabledFields: string[];
  restrictionTips: string[];
  forcedParams: Partial<GenerationParams>;
};

function cloneCapabilities(capabilities: ModelCapabilities): ModelCapabilities {
  return {
    ...capabilities,
    ratios: capabilities.ratios.map((option) => ({ ...option })),
    resolutions: capabilities.resolutions.map((option) => ({ ...option })),
    qualities: capabilities.qualities.map((option) => ({ ...option })),
    outputFormats: [...capabilities.outputFormats],
    responseFormats: [...capabilities.responseFormats],
    supportedReferenceFormats: [...capabilities.supportedReferenceFormats]
  };
}

function applyDisabledOptions(capabilities: ModelCapabilities, restriction: TemporaryRestriction) {
  const disabledOptions = new Set(restriction.disabledOptions ?? []);

  if (disabledOptions.size === 0) {
    return;
  }

  const disabledReason = restriction.description || restriction.title;

  capabilities.ratios = capabilities.ratios.map((option) =>
    disabledOptions.has(option.key) ? { ...option, enabled: false, disabledReason } : option
  );
  capabilities.resolutions = capabilities.resolutions.map((option) =>
    disabledOptions.has(option.key) ? { ...option, enabled: false, disabledReason } : option
  );
  capabilities.qualities = capabilities.qualities.map((option) =>
    disabledOptions.has(option.key) ? { ...option, enabled: false, disabledReason } : option
  );
}

function ensureForcedOptionsRemainEnabled(capabilities: ModelCapabilities, forcedParams: Partial<GenerationParams>) {
  if (forcedParams.ratio) {
    capabilities.ratios = capabilities.ratios.map((option) =>
      option.key === forcedParams.ratio ? { ...option, enabled: true, disabledReason: undefined } : option
    );
  }

  if (forcedParams.resolution) {
    capabilities.resolutions = capabilities.resolutions.map((option) =>
      option.key === forcedParams.resolution ? { ...option, enabled: true, disabledReason: undefined } : option
    );
  }

  if (forcedParams.quality) {
    capabilities.qualities = capabilities.qualities.map((option) =>
      option.key === forcedParams.quality ? { ...option, enabled: true, disabledReason: undefined } : option
    );
  }
}

export function resolveModelCapabilities(model: ModelConfig): ResolvedModelCapabilities {
  const capabilities = cloneCapabilities(model.capabilities);
  const activeRestrictions = model.temporaryRestrictions
    .filter((restriction) => restriction.enabled)
    .sort((a, b) => b.priority - a.priority);
  const disabledFields = new Set<string>();
  const forcedParams: Partial<GenerationParams> = {};
  const restrictionTips: string[] = [];

  for (const restriction of activeRestrictions) {
    restriction.affectedFields.forEach((field) => disabledFields.add(field));
    restrictionTips.push(`${restriction.title}：${restriction.description}`);
    applyDisabledOptions(capabilities, restriction);
    Object.assign(forcedParams, restriction.forcedValues);
  }

  ensureForcedOptionsRemainEnabled(capabilities, forcedParams);

  return {
    ...capabilities,
    activeRestrictions,
    disabledFields: [...disabledFields],
    restrictionTips,
    forcedParams
  };
}

export function createDefaultGenerationParams(model: ModelConfig): GenerationParams {
  const resolved = resolveModelCapabilities(model);
  const ratio = resolved.ratios.find((option) => option.enabled)?.key ?? "auto";
  const resolution = resolved.resolutions.find((option) => option.enabled)?.key ?? "1K";
  const quality = resolved.qualities.find((option) => option.enabled)?.key ?? "auto";
  const count = Math.min(Math.max(model.capabilities.defaultOutputCount, 1), model.capabilities.maxOutputs);

  return {
    ratio,
    resolution,
    quality,
    count,
    outputFormat: model.capabilities.outputFormats[0],
    background: "auto",
    moderation: "auto",
    responseFormat: model.capabilities.responseFormats[0],
    customParams: {},
    ...resolved.forcedParams
  };
}
