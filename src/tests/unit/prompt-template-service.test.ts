import { describe, expect, it } from "vitest";
import {
  getPromptTemplateById,
  getPromptTemplateCategories,
  getPromptTemplateCount,
  searchPromptTemplates
} from "../../services/prompt-template-service";

describe("prompt template service", () => {
  it("provides eight categories and ninety-six templates", () => {
    const categories = getPromptTemplateCategories();

    expect(categories).toHaveLength(8);
    expect(getPromptTemplateCount()).toBe(96);
    expect(categories.every((category) => category.templates.length === 12)).toBe(true);
  });

  it("supports lookup by id", () => {
    const template = getPromptTemplateById("popular-01");

    expect(template).toMatchObject({
      id: "popular-01",
      categoryId: "popular",
      title: "阳光宠物"
    });
  });

  it("searches by keyword and category", () => {
    const allResults = searchPromptTemplates("海边");
    const posterResults = searchPromptTemplates("海边", "poster");
    const ecommerceResults = searchPromptTemplates("", "ecommerce");

    expect(allResults.some((template) => template.id === "popular-01")).toBe(true);
    expect(posterResults).toEqual([]);
    expect(ecommerceResults).toHaveLength(12);
  });
});
