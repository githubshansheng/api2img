import { describe, expect, it } from "vitest";
import { getModelById } from "../../config/models";
import { createDefaultGenerationParams, resolveModelCapabilities } from "../../domain";

describe("model capability resolution", () => {
  it("applies temporary restrictions from model config", () => {
    const baseModel = getModelById("gpt-image-2");
    const model = baseModel
      ? {
          ...baseModel,
          id: "restricted-openai-image",
          temporaryRestrictions: [
            {
              id: "size-disabled-test",
              enabled: true,
              type: "size_disabled" as const,
              title: "尺寸参数暂不可用",
              description: "测试临时限制",
              affectedFields: ["ratio", "resolution"],
              forcedValues: { ratio: "auto" as const, resolution: "1K" as const },
              disabledOptions: ["1:1", "16:9", "9:16", "2K", "4K"],
              priority: 100
            }
          ]
        }
      : undefined;

    expect(model).toBeDefined();

    const resolved = resolveModelCapabilities(model!);
    const defaultParams = createDefaultGenerationParams(model!);

    expect(resolved.activeRestrictions).toHaveLength(1);
    expect(resolved.disabledFields).toEqual(expect.arrayContaining(["ratio", "resolution"]));
    expect(defaultParams.ratio).toBe("auto");
    expect(defaultParams.resolution).toBe("1K");
    expect(resolved.resolutions.find((option) => option.key === "2K")?.enabled).toBe(false);
    expect(resolved.resolutions.find((option) => option.key === "4K")?.enabled).toBe(false);
  });

  it("keeps unrestricted model options selectable", () => {
    const model = getModelById("nano-banana-pro");

    expect(model).toBeDefined();

    const resolved = resolveModelCapabilities(model!);

    expect(resolved.activeRestrictions).toHaveLength(0);
    expect(resolved.disabledFields).toHaveLength(0);
    expect(resolved.ratios.filter((option) => option.enabled).length).toBeGreaterThan(1);
  });

  it("uses model output limits when creating default params", () => {
    const model = getModelById("gpt-image-1-5");
    const gptImage2 = getModelById("gpt-image-2");

    expect(model).toBeDefined();
    expect(gptImage2).toBeDefined();

    const defaultParams = createDefaultGenerationParams(model!);

    expect(model!.capabilities.maxOutputs).toBe(4);
    expect(gptImage2!.capabilities.maxOutputs).toBe(10);
    expect(defaultParams.count).toBe(1);
    expect(defaultParams.responseFormat).toBe("b64_json");
  });

  it("disables gpt-image-2 ratios outside the supported 3:1 range", () => {
    const model = getModelById("gpt-image-2")!;
    const resolved = resolveModelCapabilities(model);

    expect(resolved.ratios.find((option) => option.key === "16:9")?.enabled).toBe(true);
    expect(resolved.ratios.find((option) => option.key === "21:9")?.enabled).toBe(true);
    expect(resolved.ratios.find((option) => option.key === "4:1")?.enabled).toBe(false);
    expect(resolved.ratios.find((option) => option.key === "1:4")?.enabled).toBe(false);
    expect(resolved.ratios.find((option) => option.key === "8:1")?.enabled).toBe(false);
    expect(resolved.ratios.find((option) => option.key === "1:8")?.enabled).toBe(false);
  });
});
