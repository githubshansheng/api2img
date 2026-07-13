import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const componentSource = readFileSync(
  resolve(
    process.cwd(),
    "src/components/image-editing/ImageEditingWorkbench.tsx"
  ),
  "utf8"
);
const stylesSource = readFileSync(
  resolve(process.cwd(), "src/styles.css"),
  "utf8"
);

describe("image editing workbench UI affordances", () => {
  it("keeps candidate images clickable with an accessible enlarged preview", () => {
    expect(componentSource).toContain(
      'className="edit-candidate-preview-trigger"'
    );
    expect(componentSource).toContain(
      "aria-label={`放大预览候选 ${job.candidateIndex + 1}`}"
    );
    expect(componentSource).toContain(
      'className="modal-backdrop edit-candidate-preview-backdrop"'
    );
    expect(componentSource).toContain('if (event.key === "Escape")');
    expect(componentSource).toContain("Math.max(50, current - 25)");
    expect(componentSource).toContain("Math.min(200, current + 25)");
    expect(stylesSource).toContain(".edit-candidate-preview-dialog");
    expect(stylesSource).toContain(".edit-candidate-preview-stage");
  });

  it("keeps beginner tips on the main editing workflow actions", () => {
    [
      "整图编辑：根据指令调整整个画面",
      "清除当前区域的蒙版选区，不会删除区域设置",
      "先让 AI 补全表达、保留约束和修图细节，不会立即生成",
      "分析当前指令并开始生成候选图；信息不足时会先提问",
      "将此候选设为当前版本并继续修图",
      "与直接父版本进行像素差异检查，并生成差异热图"
    ].forEach((tip) => expect(componentSource).toContain(`title="${tip}"`));
  });
});
