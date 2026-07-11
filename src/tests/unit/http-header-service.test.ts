import { describe, expect, it } from "vitest";
import {
  findInvalidHeaderValueCharacter,
  isSafeApiKeyForHeader
} from "../../services/http-header-service";

describe("http header service", () => {
  it("accepts visible ASCII API keys", () => {
    expect(isSafeApiKeyForHeader("sk-test_123-abc.DEF")).toBe(true);
  });

  it("rejects API keys with Chinese text before fetch builds headers", () => {
    const issue = findInvalidHeaderValueCharacter("Bearer sk-使用中文说明");

    expect(isSafeApiKeyForHeader("sk-使用中文说明")).toBe(false);
    expect(issue?.index).toBe(10);
    expect(issue?.charCode).toBe(20351);
  });

  it("rejects whitespace in API keys", () => {
    expect(isSafeApiKeyForHeader("sk-test value")).toBe(false);
    expect(isSafeApiKeyForHeader("sk-test\nvalue")).toBe(false);
  });
});

