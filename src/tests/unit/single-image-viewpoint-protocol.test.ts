import { describe, expect, it } from "vitest";
import { buildSingleImageCameraPrompt } from "../../domain/single-image-viewpoint";

describe("single-image viewpoint camera protocol", () => {
  it("publishes protocol 2.4 as target-camera reprojection without actor-turn language", () => {
    const prompt = buildSingleImageCameraPrompt({
      x: -35,
      y: 135,
      z: 15
    }).deterministicPromptZh;

    expect(prompt).toContain("相机协议版本：2.4");
    expect(prompt).toContain("目标相机重新投影");
    expect(prompt).not.toContain("主体主动配合转身");
  });
});
