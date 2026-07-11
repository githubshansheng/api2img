import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("compare preview drag protection", () => {
  it("prevents native browser image dragging in model comparison previews", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const match = css.match(/\.compare-preview img\s*\{(?<rules>[^}]+)\}/);

    expect(match?.groups?.rules).toContain("-webkit-user-drag: none");
    expect(match?.groups?.rules).toContain("pointer-events: none");
    expect(match?.groups?.rules).toContain("user-select: none");
  });
});
