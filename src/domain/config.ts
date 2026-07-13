import type { LangCode, NoticeLevel, PageKey } from "./common";
import type { ModelConfig } from "./model";

export type FeatureFlags = {
  enableImageEditingWorkbench: boolean;
  enableBatch: boolean;
  enableCompare: boolean;
  enableHistory: boolean;
  enableAssetTemplates: boolean;
  enableRecognition: boolean;
  enableReasoning: boolean;
  enableLocalArchive: boolean;
  enableCustomStorage: boolean;
  enablePromptOptimize: boolean;
  enableRealKeyInCurl: boolean;
};

export type NavItemConfig = {
  key: PageKey;
  label: string;
  enabled: boolean;
};

export type TopNoticeConfig = {
  id: string;
  level: NoticeLevel;
  title: string;
  content: string;
  modelId?: string;
  linkText?: string;
  linkURL?: string;
  priority: number;
  enabled: boolean;
};

export type BootstrapConfig = {
  appVersion: string;
  lang: LangCode;
  serverTime: string;
  generatedAt: string;
  promptTemplateVersion: string;
  models: ModelConfig[];
  defaultModelId: string;
  featureFlags: FeatureFlags;
  navItems: NavItemConfig[];
  notices: TopNoticeConfig[];
};

export type ClientContext = {
  page?: PageKey;
  lang?: LangCode;
  sessionId?: string;
  userAgent?: string;
  timezone?: string;
  source?: string;
};
