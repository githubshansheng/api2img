import { describe, expect, it } from "vitest";
import {
  calculateGenerationSuiteProgress,
  compileSuiteNegativePrompt,
  compileSuiteSlotPrompt,
  sortSuiteReferences,
  validateGenerationSuite
} from "../../services/suite-generation-service";
import {
  createGenerationSet,
  createSuiteImage,
  createSuiteReference,
  createSuiteSlot
} from "../helpers/generation-suite";

describe("suite generation domain service", () => {
  it("compiles shared visual rules and slot-specific instructions into one prompt", () => {
    const slot = createSuiteSlot("scene", {
      scenePrompt: "把产品放到安静的夜间书房中。",
      negativePrompt: "暖黄色偏色"
    });
    const suite = createGenerationSet({
      references: [
        createSuiteReference(0, "subject"),
        createSuiteReference(1, "style")
      ],
      slots: [createSuiteSlot("anchor"), slot]
    });

    const prompt = compileSuiteSlotPrompt(suite, slot);

    expect(prompt).toContain("银色桌面音箱");
    expect(prompt).toContain("把产品放到安静的夜间书房中");
    expect(prompt).toContain("现代商业产品摄影");
    expect(prompt).toContain("产品结构、材质和接口位置保持一致");
    expect(prompt).toContain("主体参考 1 张");
    expect(prompt).toContain("风格参考 1 张");
    expect(prompt).toContain("主视觉锚点");
    expect(compileSuiteNegativePrompt(suite, slot)).toBe(
      "变形，错误文字，水印，暖黄色偏色"
    );
  });

  it("orders references by semantic role and stable user order", () => {
    const references = [
      createSuiteReference(4, "background"),
      createSuiteReference(2, "style"),
      createSuiteReference(1, "subject"),
      createSuiteReference(3, "logo"),
      createSuiteReference(0, "subject")
    ];

    expect(sortSuiteReferences(references).map((reference) => reference.id)).toEqual([
      "reference-0",
      "reference-1",
      "reference-2",
      "reference-3",
      "reference-4"
    ]);
  });

  it("rejects missing subjects and candidate totals above the suite limit", () => {
    const suite = createGenerationSet({
      sharedSpec: {
        ...createGenerationSet().sharedSpec,
        subject: ""
      },
      references: [],
      slots: [
        createSuiteSlot("anchor", { candidateCount: 4, order: 0 }),
        ...Array.from({ length: 6 }, (_, index) =>
          createSuiteSlot("scene", {
            id: `scene-${index}`,
            order: index + 1,
            candidateCount: 4
          })
        )
      ]
    });

    const validation = validateGenerationSuite(suite, 12);

    expect(validation.isValid).toBe(false);
    expect(validation.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "SUITE_SUBJECT_REQUIRED",
        "SUITE_TOTAL_CANDIDATES_EXCEEDED"
      ])
    );
  });

  it("caps completed candidate progress at each slot's configured target", () => {
    const slot = createSuiteSlot("scene", {
      candidateCount: 1,
      images: [
        createSuiteImage("scene-slot"),
        createSuiteImage("scene-slot", {
          id: "extra-image",
          attemptId: "attempt-extra",
          candidateIndex: 1
        })
      ]
    });

    expect(calculateGenerationSuiteProgress([slot])).toMatchObject({
      totalCandidates: 1,
      completedCandidates: 1
    });
  });
});
