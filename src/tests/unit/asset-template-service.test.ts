import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAssetTemplate,
  deleteAssetTemplate,
  loadAssetTemplates,
  saveAssetTemplate
} from "../../services/asset-template-service";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    })
  };
}

describe("asset template service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes and saves local asset templates", () => {
    vi.stubGlobal("window", {
      localStorage: createMemoryStorage()
    });

    const template = createAssetTemplate({
      name: "  商品主图模板  ",
      prompt: "  白底商品主图，柔和阴影  ",
      tags: ["电商,主图", " 主图 ", "白底"],
      referenceCount: 20
    });
    const saved = saveAssetTemplate(template);

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      name: "商品主图模板",
      prompt: "白底商品主图，柔和阴影",
      tags: ["电商", "主图", "白底"],
      referenceCount: 12,
      syncStatus: "local"
    });
    expect(loadAssetTemplates()[0]?.id).toBe(template.id);
  });

  it("updates existing templates and deletes the last one", () => {
    vi.stubGlobal("window", {
      localStorage: createMemoryStorage()
    });

    const first = createAssetTemplate({
      name: "旧模板",
      prompt: "旧提示词"
    });
    const updated = createAssetTemplate(
      {
        name: "新模板",
        prompt: "新提示词",
        referenceCount: 2
      },
      first
    );

    saveAssetTemplate(first);
    saveAssetTemplate(updated);

    expect(loadAssetTemplates()).toHaveLength(1);
    expect(loadAssetTemplates()[0]).toMatchObject({
      id: first.id,
      name: "新模板",
      prompt: "新提示词",
      referenceCount: 2
    });

    expect(deleteAssetTemplate(first.id)).toEqual([]);
    expect(loadAssetTemplates()).toEqual([]);
  });
});
