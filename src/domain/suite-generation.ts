import type { OutputFormat } from "./common";
import type { GenerationError } from "./error";
import type {
  EndpointOverride,
  GenerationParams,
  GenerationReferenceInput,
  ModelRequestOverride,
  ValidationIssue
} from "./generation";

export const SUITE_GENERATION_LIMITS = {
  minSlots: 2,
  maxSlots: 12,
  minCandidatesPerSlot: 1,
  maxCandidatesPerSlot: 4,
  maxTotalCandidates: 24,
  defaultAnchorCandidates: 2,
  defaultPerSuiteConcurrency: 2,
  maxPerSuiteConcurrency: 4,
  maxReferences: 12
} as const;

export type GenerationSuiteTemplateId = "consistent-subject-4" | "ecommerce-product-5";

export type GenerationSuiteStatus =
  | "draft"
  | "queued"
  | "generating_anchor"
  | "awaiting_anchor"
  | "generating_scenes"
  | "completed"
  | "partial_success"
  | "failed"
  | "cancelled"
  | "interrupted";

export type GenerationSlotStatus =
  | "pending"
  | "queued"
  | "running"
  | "awaiting_selection"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type GenerationAttemptStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type SuiteReferenceRole =
  | "subject"
  | "style"
  | "logo"
  | "composition"
  | "background";

export type GenerationSlotKind = "anchor" | "scene";

const SUITE_REFERENCE_ROLE_VALUES: readonly SuiteReferenceRole[] = [
  "subject",
  "style",
  "logo",
  "composition",
  "background"
];

const GENERATION_SLOT_KIND_VALUES: readonly GenerationSlotKind[] = ["anchor", "scene"];

export function isSuiteReferenceRole(value: unknown): value is SuiteReferenceRole {
  return (
    typeof value === "string" &&
    SUITE_REFERENCE_ROLE_VALUES.includes(value as SuiteReferenceRole)
  );
}

export function isGenerationSlotKind(value: unknown): value is GenerationSlotKind {
  return (
    typeof value === "string" &&
    GENERATION_SLOT_KIND_VALUES.includes(value as GenerationSlotKind)
  );
}

export type SharedVisualSpec = {
  subject: string;
  style: string;
  palette: string;
  lighting: string;
  camera: string;
  composition: string;
  continuityRules: string[];
  negativePrompt?: string;
};

export type SuiteReferenceInput = GenerationReferenceInput & {
  role: SuiteReferenceRole;
};

export type SuiteReference = Omit<SuiteReferenceInput, "base64" | "objectKey"> & {
  assetURL?: string;
  createdAt: string;
};

export type SuiteImage = {
  id: string;
  slotId: string;
  attemptId: string;
  candidateIndex: number;
  sourceType: "url" | "asset";
  url: string;
  mimeType?: string;
  format?: OutputFormat;
  width?: number;
  height?: number;
  selected: boolean;
  createdAt: string;
};

export type GenerationAttempt = {
  id: string;
  attemptNumber: number;
  status: GenerationAttemptStatus;
  prompt: string;
  referenceIds: string[];
  requestedCandidateCount: number;
  requestIds: string[];
  imageIds: string[];
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: GenerationError;
};

export type GenerationSlot = {
  id: string;
  kind: GenerationSlotKind;
  title: string;
  description: string;
  scenePrompt: string;
  negativePrompt?: string;
  candidateCount: number;
  order: number;
  status: GenerationSlotStatus;
  selectedImageId?: string;
  images: SuiteImage[];
  attempts: GenerationAttempt[];
};

export type GenerationSuiteProgress = {
  totalSlots: number;
  completedSlots: number;
  failedSlots: number;
  runningSlots: number;
  queuedSlots: number;
  totalCandidates: number;
  completedCandidates: number;
  percent: number;
};

export type GenerationSuiteOptions = {
  requireAnchorConfirmation: boolean;
  autoSelectFirstAnchor: boolean;
  perSuiteConcurrency: number;
};

export type GenerationSuiteEndpointOverride = Pick<
  EndpointOverride,
  "baseURL" | "editURL" | "endpointVariant"
>;

export type GenerationSet = {
  schemaVersion: 1;
  id: string;
  name: string;
  templateId: GenerationSuiteTemplateId;
  status: GenerationSuiteStatus;
  modelId: string;
  modelDisplayName: string;
  modelOverride?: ModelRequestOverride;
  endpointOverride?: GenerationSuiteEndpointOverride;
  params: GenerationParams;
  sharedSpec: SharedVisualSpec;
  references: SuiteReference[];
  slots: GenerationSlot[];
  anchorSlotId: string;
  selectedAnchorImageId?: string;
  options: GenerationSuiteOptions;
  progress: GenerationSuiteProgress;
  lastError?: GenerationError;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
};

export type GenerationSuiteSlotDefinition = {
  key: string;
  kind: GenerationSlotKind;
  title: string;
  description: string;
  scenePrompt: string;
  defaultCandidateCount: number;
};

export type GenerationSuiteTemplate = {
  id: GenerationSuiteTemplateId;
  name: string;
  description: string;
  recommendedFor: string;
  defaultSpec: SharedVisualSpec;
  slots: GenerationSuiteSlotDefinition[];
};

export type CreateGenerationSuiteRequest = {
  name?: string;
  templateId: GenerationSuiteTemplateId;
  modelId: string;
  modelDisplayName?: string;
  modelOverride?: ModelRequestOverride;
  endpointOverride?: EndpointOverride;
  params: GenerationParams;
  sharedSpec: SharedVisualSpec;
  referenceImages: SuiteReferenceInput[];
  options?: Partial<GenerationSuiteOptions>;
  slots?: Array<{
    kind?: GenerationSlotKind;
    title?: string;
    description?: string;
    scenePrompt?: string;
    negativePrompt?: string;
    candidateCount?: number;
  }>;
};

export type StartGenerationSuiteRequest = {
  endpointOverride?: EndpointOverride;
  modelOverride?: ModelRequestOverride;
};

export type SelectSuiteAnchorRequest = {
  imageId: string;
  endpointOverride?: EndpointOverride;
  modelOverride?: ModelRequestOverride;
};

export type RetryGenerationSuiteSlotRequest = {
  endpointOverride?: EndpointOverride;
  modelOverride?: ModelRequestOverride;
};

export type UpdateGenerationSuiteRequest = {
  name?: string;
  sharedSpec?: Partial<SharedVisualSpec>;
  options?: Partial<GenerationSuiteOptions>;
  slots?: Array<{
    id: string;
    title?: string;
    description?: string;
    scenePrompt?: string;
    negativePrompt?: string;
    candidateCount?: number;
  }>;
};

export type GenerationSuiteValidation = {
  isValid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

export type GenerationSuiteEventType =
  | "suite.snapshot"
  | "suite.updated"
  | "suite.started"
  | "suite.cancelled"
  | "suite.completed"
  | "suite.deleted"
  | "slot.queued"
  | "slot.started"
  | "slot.completed"
  | "slot.failed"
  | "anchor.awaiting_selection"
  | "anchor.selected"
  | "heartbeat";

export type GenerationSuiteEvent = {
  id: string;
  suiteId: string;
  type: GenerationSuiteEventType;
  occurredAt: string;
  slotId?: string;
  suite?: GenerationSet;
  message?: string;
};
