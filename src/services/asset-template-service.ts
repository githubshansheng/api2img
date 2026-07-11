export type AssetTemplate = {
  id: string;
  name: string;
  prompt: string;
  tags: string[];
  referenceCount: number;
  syncStatus: "local" | "synced" | "failed";
  createdAt: string;
  updatedAt: string;
};

export type AssetTemplateInput = {
  name: string;
  prompt: string;
  tags?: string[];
  referenceCount?: number;
};

const ASSET_TEMPLATE_STORAGE_KEY = "api2image:asset-templates:v1";
const MAX_ASSET_TEMPLATES = 100;

function canUseLocalStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function createTemplateId() {
  return globalThis.crypto?.randomUUID?.() ?? `asset-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeTags(tags?: string[]) {
  return Array.from(
    new Set(
      (tags ?? [])
        .flatMap((tag) => tag.split(/[,，\s]+/))
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  ).slice(0, 8);
}

function sanitizeTemplate(template: AssetTemplate): AssetTemplate {
  return {
    ...template,
    name: template.name.trim().slice(0, 60) || "未命名模板",
    prompt: template.prompt.trim().slice(0, 2000),
    tags: normalizeTags(template.tags),
    referenceCount: Math.max(0, Math.min(12, Math.floor(template.referenceCount || 0))),
    syncStatus: template.syncStatus ?? "local"
  };
}

function sanitizeTemplates(templates: AssetTemplate[]) {
  return templates
    .filter((template) => template?.id && template?.prompt)
    .map(sanitizeTemplate)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, MAX_ASSET_TEMPLATES);
}

export function createAssetTemplate(input: AssetTemplateInput, existing?: AssetTemplate): AssetTemplate {
  const now = new Date().toISOString();

  return sanitizeTemplate({
    id: existing?.id ?? createTemplateId(),
    name: input.name,
    prompt: input.prompt,
    tags: normalizeTags(input.tags),
    referenceCount: input.referenceCount ?? existing?.referenceCount ?? 0,
    syncStatus: existing?.syncStatus ?? "local",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  });
}

export function loadAssetTemplates(): AssetTemplate[] {
  if (!canUseLocalStorage()) {
    return [];
  }

  const raw = window.localStorage.getItem(ASSET_TEMPLATE_STORAGE_KEY);

  if (!raw) {
    return [];
  }

  try {
    const templates = JSON.parse(raw) as AssetTemplate[];
    return Array.isArray(templates) ? sanitizeTemplates(templates) : [];
  } catch {
    return [];
  }
}

export function saveAssetTemplate(template: AssetTemplate): AssetTemplate[] {
  const nextTemplates = sanitizeTemplates([template, ...loadAssetTemplates().filter((item) => item.id !== template.id)]);

  if (canUseLocalStorage()) {
    window.localStorage.setItem(ASSET_TEMPLATE_STORAGE_KEY, JSON.stringify(nextTemplates));
  }

  return nextTemplates;
}

export function deleteAssetTemplate(templateId: string): AssetTemplate[] {
  const nextTemplates = loadAssetTemplates().filter((template) => template.id !== templateId);

  if (canUseLocalStorage()) {
    if (nextTemplates.length > 0) {
      window.localStorage.setItem(ASSET_TEMPLATE_STORAGE_KEY, JSON.stringify(nextTemplates));
    } else {
      window.localStorage.removeItem(ASSET_TEMPLATE_STORAGE_KEY);
    }
  }

  return nextTemplates;
}
