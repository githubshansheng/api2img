import type { ModelConfig, OpenAIEndpointVariant } from "../domain";

export type ModelEndpointKind = "generation" | "edit";

const OPENAI_GENERATION_PATH = "v1/images/generations";
const OPENAI_EDIT_PATH = "v1/images/edits";
const OPENAI_RESPONSES_PATH = "v1/responses";
export const DEFAULT_OPENAI_ENDPOINT_VARIANT: OpenAIEndpointVariant = "images-generations";
export const OPENAI_ENDPOINT_VARIANT_OPTIONS: Array<{
  value: OpenAIEndpointVariant;
  label: string;
  path: string;
}> = [
  {
    value: "images-generations",
    label: "POST /v1/images/generations",
    path: `/${OPENAI_GENERATION_PATH}`
  },
  {
    value: "responses",
    label: "POST /v1/responses",
    path: `/${OPENAI_RESPONSES_PATH}`
  }
];

export function getModelEndpointPath(
  model: ModelConfig,
  kind: ModelEndpointKind = "generation",
  endpointVariant: OpenAIEndpointVariant = resolveOpenAIEndpointVariant(model)
) {
  if (model.endpointType === "gemini-generate-content") {
    return `v1beta/models/${model.apiModelName}:generateContent`;
  }

  if (kind === "edit") {
    return OPENAI_EDIT_PATH;
  }

  return endpointVariant === "responses" ? OPENAI_RESPONSES_PATH : OPENAI_GENERATION_PATH;
}

export function getModelEndpointPrefix(model: ModelConfig, kind: ModelEndpointKind = "generation") {
  const configuredURL = kind === "edit" ? model.editURL ?? model.baseURL : model.baseURL;

  return stripKnownEndpointSuffix(configuredURL);
}

export function buildModelEndpointURL(
  model: ModelConfig,
  prefixOrURL: string | undefined,
  kind: ModelEndpointKind = "generation",
  endpointVariant?: OpenAIEndpointVariant
) {
  const cleanValue = prefixOrURL?.trim();
  const resolvedVariant = endpointVariant ?? resolveOpenAIEndpointVariant(model);

  if (!cleanValue) {
    return kind === "edit" ? model.editURL ?? model.baseURL : model.baseURL;
  }

  return appendEndpointPath(stripKnownEndpointSuffix(cleanValue), getModelEndpointPath(model, kind, resolvedVariant));
}

export function stripKnownEndpointSuffix(value: string) {
  const cleanValue = value.trim().replace(/\/+$/, "");

  if (!cleanValue) {
    return "";
  }

  try {
    const parsed = new URL(cleanValue);
    parsed.pathname = stripKnownPathSuffix(parsed.pathname);
    parsed.search = "";
    parsed.hash = "";

    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return stripKnownPathSuffix(cleanValue).replace(/\/+$/, "");
  }
}

function stripKnownPathSuffix(path: string) {
  return path
    .replace(/\/v1\/images\/(?:generations|edits)$/i, "")
    .replace(/\/v1\/responses$/i, "")
    .replace(/\/v1beta\/models\/[^/]+:generateContent$/i, "")
    .replace(/\/+$/, "");
}

export function normalizeOpenAIEndpointVariant(value?: string): OpenAIEndpointVariant | undefined {
  if (value === "images-generations" || value === "responses") {
    return value;
  }

  return undefined;
}

export function resolveOpenAIEndpointVariant(model: ModelConfig): OpenAIEndpointVariant {
  return normalizeOpenAIEndpointVariant(model.endpointType) ?? DEFAULT_OPENAI_ENDPOINT_VARIANT;
}

export function isOpenAIResponsesEndpoint(model: ModelConfig, endpointVariant?: OpenAIEndpointVariant) {
  return (endpointVariant ?? resolveOpenAIEndpointVariant(model)) === "responses";
}

function appendEndpointPath(prefix: string, endpointPath: string) {
  const cleanPrefix = prefix.trim().replace(/\/+$/, "");
  const endpointSegments = endpointPath.split("/").filter(Boolean);

  if (!cleanPrefix) {
    return `/${endpointSegments.join("/")}`;
  }

  try {
    const parsed = new URL(cleanPrefix);
    const prefixSegments = parsed.pathname.split("/").filter(Boolean);
    const overlap = countPathSegmentOverlap(prefixSegments, endpointSegments);
    parsed.pathname = `/${[...prefixSegments, ...endpointSegments.slice(overlap)].join("/")}`;
    parsed.search = "";
    parsed.hash = "";

    return parsed.toString();
  } catch {
    const prefixSegments = cleanPrefix.split("/").filter(Boolean);
    const overlap = countPathSegmentOverlap(prefixSegments, endpointSegments);

    return `${prefixSegments.concat(endpointSegments.slice(overlap)).join("/")}`;
  }
}

function countPathSegmentOverlap(prefixSegments: string[], endpointSegments: string[]) {
  const maxOverlap = Math.min(prefixSegments.length, endpointSegments.length);

  for (let length = maxOverlap; length > 0; length -= 1) {
    const prefixTail = prefixSegments.slice(-length).map(normalizeSegment);
    const endpointHead = endpointSegments.slice(0, length).map(normalizeSegment);

    if (prefixTail.every((segment, index) => segment === endpointHead[index])) {
      return length;
    }
  }

  return 0;
}

function normalizeSegment(value: string) {
  return decodeURIComponent(value).toLowerCase();
}
