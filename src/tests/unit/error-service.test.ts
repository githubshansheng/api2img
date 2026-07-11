import { describe, expect, it } from "vitest";
import { getModelById } from "../../config/models";
import { maskApiKey, normalizeGenerationError, sanitizeErrorText } from "../../services/error-service";

describe("error service", () => {
  it("maps validation, auth and permission status codes", () => {
    const validation = normalizeGenerationError({
      statusCode: 400,
      upstreamCode: "invalid_request_error",
      upstreamMessage: "size is invalid"
    });
    const auth = normalizeGenerationError({
      statusCode: 401,
      upstreamCode: "invalid_api_key",
      upstreamMessage: "Incorrect API key"
    });
    const permission = normalizeGenerationError({
      statusCode: 403,
      upstreamCode: "model_not_allowed"
    });

    expect(validation.type).toBe("validation");
    expect(validation.title).toBe("请求参数错误");
    expect(validation.retryable).toBe(false);
    expect(auth.type).toBe("auth");
    expect(auth.title).toBe("API Key 认证失败");
    expect(auth.mayHaveCharged).toBe(false);
    expect(permission.type).toBe("permission");
    expect(permission.mayHaveCharged).toBe(true);
  });

  it("uses generic rate limit guidance for the default gpt-image-2 model", () => {
    const error = normalizeGenerationError({
      statusCode: 429,
      upstreamCode: "rate_limit_exceeded",
      model: getModelById("gpt-image-2")
    });

    expect(error.type).toBe("rate_limit");
    expect(error.title).toBe("请求过于频繁");
    expect(error.retryable).toBe(true);
    expect(error.suggestion).not.toContain("image2Enterprise");
  });

  it("reports the actual request model name in safe details", () => {
    const baseModel = getModelById("gpt-image-2")!;
    const error = normalizeGenerationError({
      statusCode: 400,
      upstreamCode: "invalid_request_error",
      upstreamMessage: "n currently supports 1 only",
      model: {
        ...baseModel,
        apiModelName: "gpt-image-2-image2-true4k-4k"
      }
    });

    expect(error.safeDetails).toContain("model=gpt-image-2-image2-true4k-4k");
    expect(error.safeDetails).toContain("modelId=gpt-image-2");
  });

  it("keeps enterprise group guidance behind explicit model configuration", () => {
    const baseModel = getModelById("gpt-image-2")!;
    const error = normalizeGenerationError({
      statusCode: 429,
      upstreamCode: "rate_limit_exceeded",
      model: {
        ...baseModel,
        id: "enterprise-group-model",
        featureFlags: {
          ...baseModel.featureFlags,
          requiresEnterpriseGroupOnRateLimit: true
        }
      }
    });

    expect(error.type).toBe("rate_limit");
    expect(error.title).toBe("出图失败异常");
    expect(error.suggestion).toContain("image2Enterprise");
  });

  it("separates network and temporary upstream failures", () => {
    const network = normalizeGenerationError({
      statusCode: 502,
      upstreamCode: "UPSTREAM_REQUEST_FAILED",
      upstreamMessage: "fetch failed"
    });
    const unavailable = normalizeGenerationError({
      statusCode: 503,
      upstreamCode: "service_unavailable"
    });
    const diagnosedNetwork = normalizeGenerationError({
      statusCode: 502,
      upstreamCode: "UPSTREAM_REQUEST_FAILED",
      upstreamMessage: "fetch failed",
      rawBody: {
        error: {
          code: "UPSTREAM_REQUEST_FAILED",
          message: "fetch failed",
          details: "source=bff; target=ai.heigh.vip/v1/images/generations; cause.code=ECONNRESET"
        }
      }
    });

    expect(network.type).toBe("network");
    expect(network.title).toBe("连接中断");
    expect(network.retryable).toBe(true);
    expect(network.mayHaveCharged).toBe(false);
    expect(unavailable.type).toBe("upstream");
    expect(unavailable.title).toBe("服务暂时不可用");
    expect(diagnosedNetwork.rawExcerpt).toContain("error.details=source=bff");
    expect(diagnosedNetwork.rawExcerpt).toContain("cause.code=ECONNRESET");
  });

  it("maps finish reasons and masks sensitive details", () => {
    const safety = normalizeGenerationError({
      statusCode: 200,
      upstreamCode: "SAFETY",
      finishReason: "SAFETY"
    });
    const masked = sanitizeErrorText("Authorization: Bearer sk-demo-key");

    expect(safety.type).toBe("safety");
    expect(safety.title).toBe("安全过滤");
    expect(safety.mayHaveCharged).toBe(true);
    expect(maskApiKey("sk-demo-key")).toBe("sk-d...-key");
    expect(masked).not.toContain("sk-demo-key");
  });
});
