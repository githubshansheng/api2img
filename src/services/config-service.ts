import type { ApiResponse, BootstrapConfig } from "../domain";
import { DEFAULT_MODEL_ID, getEnabledModels } from "../config/models";
import { readApiResponse } from "./api-response-service";

export const fallbackBootstrapConfig: BootstrapConfig = {
  appVersion: "0.1.0",
  lang: "zh-CN",
  serverTime: new Date().toISOString(),
  generatedAt: new Date().toISOString(),
  promptTemplateVersion: "local-dev",
  models: getEnabledModels(),
  defaultModelId: DEFAULT_MODEL_ID,
  featureFlags: {
    enableImageEditingWorkbench: true,
    enableBatch: true,
    enableCompare: true,
    enableHistory: true,
    enableAssetTemplates: true,
    enableRecognition: true,
    enableReasoning: true,
    enableLocalArchive: true,
    enableCustomStorage: true,
    enablePromptOptimize: false,
    enableRealKeyInCurl: true
  },
  navItems: [
    { key: "studio", label: "GPT Studio", enabled: true },
    { key: "editing", label: "修图工作台", enabled: true },
    { key: "generation", label: "生成图片", enabled: true },
    { key: "compare", label: "模型对比", enabled: true },
    { key: "history", label: "历史记录", enabled: true },
    { key: "assets", label: "素材模板", enabled: true },
    { key: "recognition", label: "识别图片", enabled: true },
    { key: "reasoning", label: "推理测试", enabled: true },
    { key: "settings", label: "设置", enabled: true }
  ],
  notices: [
    {
      id: "fallback",
      level: "info",
      title: "本地配置已启用",
      content: "后端暂不可用时，前端会使用本地兜底配置。",
      priority: 1,
      enabled: true
    }
  ]
};

export async function fetchBootstrapConfig(): Promise<BootstrapConfig> {
  try {
    const response = await fetch("/api/config/bootstrap");
    const payload = await readApiResponse<BootstrapConfig>(response, {
      requestLabel: "读取启动配置"
    });

    if (!response.ok || !payload.success || !payload.data) {
      return fallbackBootstrapConfig;
    }

    return payload.data;
  } catch {
    return fallbackBootstrapConfig;
  }
}
