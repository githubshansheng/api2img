import { describe, expect, it } from "vitest";
import {
  GPT_STUDIO_BASE_URL,
  GPT_STUDIO_FEATURE_ROUTES,
  GPT_STUDIO_REQUIRED_ROUTES
} from "../../config/gpt-studio-routes";

const REQUIRED_ROUTES = [
  "#studio",
  "#style-transfer",
  "#reference-analysis",
  "#image-decomposition",
  "#image-edit",
  "#quick-blend",
  "#image-compress",
  "#creation",
  "#portrait",
  "#article-illustration",
  "#ppt",
  "#gallery",
  "#article-record",
  "#creation-record",
  "#portrait-record",
  "#ppt-record"
] as const;

describe("GPT Studio route integration", () => {
  it("keeps the vendored GPT Studio service as the iframe base URL", () => {
    expect(GPT_STUDIO_BASE_URL).toBe("http://127.0.0.1:3600/");
  });

  it("exposes every GPT-Image2-Studio route documented by the reference project", () => {
    expect(GPT_STUDIO_FEATURE_ROUTES).toHaveLength(REQUIRED_ROUTES.length);
    expect(GPT_STUDIO_FEATURE_ROUTES.map((feature) => feature.route)).toEqual(REQUIRED_ROUTES);
    expect(GPT_STUDIO_REQUIRED_ROUTES).toEqual(REQUIRED_ROUTES);
  });

  it("keeps route metadata unique and usable for the menu", () => {
    const ids = new Set(GPT_STUDIO_FEATURE_ROUTES.map((feature) => feature.id));
    const routes = new Set(GPT_STUDIO_FEATURE_ROUTES.map((feature) => feature.route));

    expect(ids.size).toBe(GPT_STUDIO_FEATURE_ROUTES.length);
    expect(routes.size).toBe(GPT_STUDIO_FEATURE_ROUTES.length);

    GPT_STUDIO_FEATURE_ROUTES.forEach((feature) => {
      expect(feature.id).toBeTruthy();
      expect(feature.label.trim()).not.toBe("");
      expect(feature.note.trim()).not.toBe("");
      expect(["create", "tools", "assets", "records"]).toContain(feature.group);
      expect(feature.route).toMatch(/^#[a-z0-9-]+$/);
    });
  });
});
