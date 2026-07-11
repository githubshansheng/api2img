export interface DesignTokens {
  color: ColorTokens;
  typography: TypographyTokens;
  spacing: SpacingTokens;
  radius: RadiusTokens;
  shadow: ShadowTokens;
  motion: MotionTokens;
  layout: LayoutTokens;
}

export interface ColorTokens {
  bgApp: string;
  bgPanel: string;
  bgPanelElevated: string;
  bgInput: string;
  bgHover: string;
  borderSubtle: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accentCyan: string;
  accentViolet: string;
  accentEmerald: string;
  accentAmber: string;
  danger: string;
  warning: string;
  success: string;
  focusRing: string;
  overlay: string;
}

export interface TypographyTokens {
  fontFamily: string;
  monoFontFamily: string;
  pageTitle: TextStyleToken;
  sectionTitle: TextStyleToken;
  body: TextStyleToken;
  small: TextStyleToken;
  code: TextStyleToken;
}

export interface TextStyleToken {
  fontSize: number;
  lineHeight: number;
  fontWeight: number;
}

export interface SpacingTokens {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
}

export interface RadiusTokens {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  pill: number;
}

export interface ShadowTokens {
  panel: string;
  popover: string;
  glowCyan: string;
  glowViolet: string;
}

export interface MotionTokens {
  fastMs: number;
  normalMs: number;
  slowMs: number;
  easing: string;
}

export interface LayoutTokens {
  sidebarWidth: number;
  topNoticeHeight: number;
  inputPanelMinWidth: number;
  inputPanelMaxWidth: number;
  resultPanelMinWidth: number;
  contentMaxWidth: number;
}

export const designTokens: DesignTokens = {
  color: {
    bgApp: "#090D14",
    bgPanel: "#101722",
    bgPanelElevated: "#151F2E",
    bgInput: "#0C121B",
    bgHover: "#1A2636",
    borderSubtle: "rgba(148, 163, 184, 0.18)",
    borderStrong: "rgba(125, 211, 252, 0.42)",
    textPrimary: "#F8FAFC",
    textSecondary: "#CBD5E1",
    textMuted: "#7B8AA0",
    accentCyan: "#22D3EE",
    accentViolet: "#8B5CF6",
    accentEmerald: "#34D399",
    accentAmber: "#FBBF24",
    danger: "#FB7185",
    warning: "#F59E0B",
    success: "#22C55E",
    focusRing: "rgba(34, 211, 238, 0.32)",
    overlay: "rgba(3, 6, 12, 0.72)"
  },
  typography: {
    fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif',
    monoFontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace',
    pageTitle: { fontSize: 44, lineHeight: 1.08, fontWeight: 800 },
    sectionTitle: { fontSize: 18, lineHeight: 1.25, fontWeight: 800 },
    body: { fontSize: 14, lineHeight: 1.6, fontWeight: 400 },
    small: { fontSize: 12, lineHeight: 1.45, fontWeight: 600 },
    code: { fontSize: 12, lineHeight: 1.55, fontWeight: 600 }
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32
  },
  radius: {
    xs: 4,
    sm: 6,
    md: 8,
    lg: 8,
    pill: 999
  },
  shadow: {
    panel: "0 16px 40px rgba(0, 0, 0, 0.28)",
    popover: "0 24px 60px rgba(0, 0, 0, 0.38)",
    glowCyan: "0 0 24px rgba(34, 211, 238, 0.18)",
    glowViolet: "0 0 24px rgba(139, 92, 246, 0.18)"
  },
  motion: {
    fastMs: 120,
    normalMs: 180,
    slowMs: 260,
    easing: "cubic-bezier(0.2, 0.8, 0.2, 1)"
  },
  layout: {
    sidebarWidth: 260,
    topNoticeHeight: 48,
    inputPanelMinWidth: 300,
    inputPanelMaxWidth: 480,
    resultPanelMinWidth: 520,
    contentMaxWidth: 1680
  }
};
