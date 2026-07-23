export type ClientPlatform = "macos" | "other";

export interface ClientPlatformSignals {
  maxTouchPoints?: number;
  platform?: string;
  userAgent?: string;
  userAgentData?: {
    platform?: string;
  };
}

export function detectClientPlatform(signals: ClientPlatformSignals): ClientPlatform {
  const declaredPlatform = signals.userAgentData?.platform ?? signals.platform ?? "";
  const userAgent = signals.userAgent ?? "";
  const looksLikeMacOS =
    /mac/i.test(declaredPlatform) || /Macintosh|Mac OS X/i.test(userAgent);
  const looksLikeIPad =
    looksLikeMacOS &&
    (signals.maxTouchPoints ?? 0) > 1 &&
    (/MacIntel/i.test(declaredPlatform) || /Mobile/i.test(userAgent));

  return looksLikeMacOS && !looksLikeIPad ? "macos" : "other";
}
