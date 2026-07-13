import {
  Activity,
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Brush,
  Check,
  Columns2,
  Download,
  Eraser,
  FileDown,
  GitBranch,
  GitCompareArrows,
  GitMerge,
  ImagePlus,
  LassoSelect,
  LoaderCircle,
  MessageSquare,
  Pencil,
  Plus,
  RectangleHorizontal,
  RefreshCw,
  RotateCcw,
  Scan,
  Send,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Upload,
  WandSparkles,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import type {
  EditAsset,
  EditImageInput,
  EditInstructionTemplate,
  EditInstructionAnalysis,
  EditJob,
  EditMaskCombination,
  EditMode,
  EditPlatformSnapshot,
  EditProtectedPreset,
  EditSelectionMethod,
  EditSession,
  EditSessionSummary,
  EditSharePermission,
  EditTurn,
  EndpointOverride,
  GenerationParams,
  ImageVersion,
  ModelConfig,
  ModelRequestOverride,
  ReferenceImage
} from "../../domain";
import { IMAGE_EDIT_LIMITS } from "../../domain";
import {
  createLocalEditInstructionAnalysis,
  type AnalyzeEditInstructionInput
} from "../../services/edit-instruction-service";
import {
  answerEditClarification,
  cancelEditTurn,
  cleanupEditVersions,
  checkoutEditVersion,
  createEditApproval,
  createEditBranch,
  createEditBrandAsset,
  createEditComment,
  createEditInstructionTemplate,
  createEditSession,
  createEditShareLink,
  createEditTurn,
  deleteEditSession,
  exportEditSessionManifest,
  getEditPlatformSnapshot,
  getEditSession,
  getSharedEditSession,
  listEditSessions,
  mergeEditVersionRegion,
  previewEditTurnCost,
  retryEditJob,
  subscribeEditSessionEvents,
  updateEditComment,
  updateEditBranch,
  updateEditSession,
  updateEditVersion,
  updateEditWorkflow
} from "../../services/edit-session-api-service";
import {
  alphaMaskToDataURL,
  alphaMaskToRGBA,
  approximateSubjectSelect,
  combineAlphaMasks,
  composeMaskLayers,
  invertAlphaMask,
  loadAlphaMaskFromURL,
  magicWandSelect,
  rasterizePolygon,
  rasterizeRectangle,
  readAlphaMaskFromCanvas,
  readSourceImageData,
  resizeAlphaMask,
  transformAlphaMask,
  writeAlphaMaskToCanvas,
  type AlphaMask,
  type MaskPoint
} from "../../services/edit-mask-service";
import {
  evaluateEditQuality,
  imagePixelsToDataURL,
  loadComparableImagePixels
} from "../../services/edit-quality-service";
import {
  createReferenceImageWithBase64,
  validateReferenceImageFiles
} from "../../services/upload-service";

type ImageEditingWorkbenchProps = {
  models: ModelConfig[];
  selectedModel?: ModelConfig;
  selectedModelId: string;
  params: GenerationParams;
  endpointOverride?: EndpointOverride;
  modelOverride?: ModelRequestOverride;
  onSelectModel: (modelId: string) => void;
  onParamsChange: (params: GenerationParams) => void;
  onAnalyzeInstruction: (
    input: AnalyzeEditInstructionInput
  ) => Promise<EditInstructionAnalysis>;
};

type RegionDraft = {
  id: string;
  label: string;
  color: string;
  instruction: string;
  maskDataURL?: string;
  selectionMethod: EditSelectionMethod;
  combinationMode: EditMaskCombination;
  priority: number;
  featherRadius: number;
  expansionPixels: number;
  inverted: boolean;
  semanticTarget: string;
};

type Feedback = {
  kind: "success" | "error" | "info";
  message: string;
};

type CanvasTool = EditSelectionMethod | "erase";

type CompareMode = "off" | "side-by-side" | "slider" | "difference" | "blink";
type SessionListMode = "active" | "archived";

const REGION_COLORS = [
  "#ff5c5c",
  "#35c98b",
  "#3e8cff",
  "#f2b84b",
  "#b16cff",
  "#18b8c9",
  "#ff7eb6",
  "#7d8b99"
];

const LIVE_TURN_STATUSES = new Set<EditTurn["status"]>([
  "analyzing",
  "queued",
  "running",
  "persisting"
]);

const PROTECTED_PRESET_OPTIONS: Array<{
  key: EditProtectedPreset;
  label: string;
}> = [
  { key: "identity", label: "人物身份" },
  { key: "text", label: "文字" },
  { key: "logo", label: "Logo" },
  { key: "composition", label: "构图" },
  { key: "product", label: "产品结构" },
  { key: "color", label: "品牌色" }
];

export function ImageEditingWorkbench({
  models,
  selectedModel,
  selectedModelId,
  params,
  endpointOverride,
  modelOverride,
  onSelectModel,
  onParamsChange,
  onAnalyzeInstruction
}: ImageEditingWorkbenchProps) {
  const sourceFileInputRef = useRef<HTMLInputElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const shapeStartRef = useRef<MaskPoint | undefined>(undefined);
  const lassoPointsRef = useRef<MaskPoint[]>([]);
  const shareToken = useMemo(
    () =>
      new URLSearchParams(window.location.search).get("share")?.trim() ||
      undefined,
    []
  );
  const [sessions, setSessions] = useState<EditSessionSummary[]>([]);
  const [sessionListMode, setSessionListMode] =
    useState<SessionListMode>("active");
  const [activeSessionId, setActiveSessionId] = useState<string>();
  const [activeSession, setActiveSession] = useState<EditSession>();
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string>();
  const [feedback, setFeedback] = useState<Feedback>();
  const [streamState, setStreamState] = useState<
    "idle" | "connected" | "reconnecting"
  >("idle");
  const [mode, setMode] = useState<EditMode>("whole");
  const [instruction, setInstruction] = useState("");
  const [analysis, setAnalysis] = useState<EditInstructionAnalysis>();
  const [candidateCount, setCandidateCount] = useState<number>(
    IMAGE_EDIT_LIMITS.defaultCandidates
  );
  const [mergeVersionId, setMergeVersionId] = useState("");
  const [regions, setRegions] = useState<RegionDraft[]>(() => [
    createRegionDraft(0)
  ]);
  const [activeRegionId, setActiveRegionId] = useState(regions[0]?.id ?? "");
  const [canvasTool, setCanvasTool] = useState<CanvasTool>("brush");
  const [brushSize, setBrushSize] = useState(32);
  const [zoom, setZoom] = useState(100);
  const [compareMode, setCompareMode] = useState<CompareMode>("off");
  const [compareVersionId, setCompareVersionId] = useState("");
  const [comparePosition, setComparePosition] = useState(50);
  const [blinkPrimaryVisible, setBlinkPrimaryVisible] = useState(true);
  const [protectedPresets, setProtectedPresets] = useState<
    EditProtectedPreset[]
  >([]);
  const [platformSnapshot, setPlatformSnapshot] =
    useState<EditPlatformSnapshot>();
  const [costPreview, setCostPreview] =
    useState<Awaited<ReturnType<typeof previewEditTurnCost>>>();
  const [inspectorTab, setInspectorTab] = useState<
    "conversation" | "version" | "collaboration" | "operations"
  >("conversation");
  const [commentDraft, setCommentDraft] = useState("");
  const [clarificationAnswers, setClarificationAnswers] = useState<
    Record<string, string>
  >({});
  const [previewCandidate, setPreviewCandidate] = useState<{
    asset: EditAsset;
    version: ImageVersion;
    candidateIndex: number;
  }>();
  const [candidatePreviewZoom, setCandidatePreviewZoom] = useState(100);
  const [sharedPermission, setSharedPermission] =
    useState<EditSharePermission>();
  const isSharedSession = Boolean(shareToken);
  const hasEditPermission = !isSharedSession || sharedPermission === "edit";
  const canEdit =
    hasEditPermission && activeSession?.status !== "archived";
  const canComment =
    !isSharedSession ||
    sharedPermission === "comment" ||
    sharedPermission === "edit";
  const canManage = !isSharedSession;
  const visibleSessions = useMemo(
    () =>
      isSharedSession
        ? sessions
        : sessions.filter((session) =>
            sessionListMode === "archived"
              ? isArchivedSession(session)
              : !isArchivedSession(session)
          ),
    [isSharedSession, sessionListMode, sessions]
  );
  const activeSessionCount = sessions.filter(
    (session) => !isArchivedSession(session)
  ).length;
  const archivedSessionCount = sessions.length - activeSessionCount;

  const editModels = useMemo(
    () =>
      models.filter(
        (model) =>
          model.enabled &&
          model.capabilities.supportsImageToImage &&
          model.editCapabilities.supportsWholeImageEdit &&
          model.capabilities.maxReferenceImages > 0
      ),
    [models]
  );
  const effectiveModel =
    editModels.find((model) => model.id === selectedModelId) ??
    editModels.find((model) => model.id === selectedModel?.id) ??
    editModels[0];
  const maxCandidateCount = Math.max(
    IMAGE_EDIT_LIMITS.minCandidates,
    Math.min(
      IMAGE_EDIT_LIMITS.maxCandidates,
      effectiveModel?.editCapabilities.maxCandidates ??
        IMAGE_EDIT_LIMITS.minCandidates
    )
  );
  const candidateOptions = Array.from(
    { length: maxCandidateCount },
    (_, index) => index + 1
  );
  const localRegionLimit = Math.max(
    0,
    Math.min(
      IMAGE_EDIT_LIMITS.maxRegions,
      (effectiveModel?.capabilities.maxReferenceImages ?? 0) - 1
    )
  );
  const supportsLocalEditing =
    Boolean(effectiveModel) &&
    effectiveModel!.editCapabilities.localMode !== "none" &&
    localRegionLimit > 0;
  const supportsMergeEditing =
    Boolean(effectiveModel) &&
    effectiveModel!.editCapabilities.supportsBranchMerge &&
    effectiveModel!.capabilities.maxReferenceImages >= 2;
  const currentVersion = activeSession?.versions.find(
    (version) => version.id === activeSession.currentVersionId
  );
  const currentAsset = resolveVersionAsset(activeSession, currentVersion);
  const currentBranch = activeSession?.branches.find(
    (branch) => branch.id === activeSession.currentBranchId
  );
  const activeRegion = regions.find((region) => region.id === activeRegionId);
  const latestTurn = activeSession?.turns.at(-1);
  const latestTurnJobs = latestTurn
    ? latestTurn.jobIds.flatMap((jobId) => {
        const job = activeSession?.jobs.find((item) => item.id === jobId);
        return job ? [job] : [];
      })
    : [];
  const waitingTurn = activeSession?.turns.find(
    (turn) => turn.status === "awaiting_clarification"
  );
  const liveTurn = activeSession?.turns.find((turn) =>
    LIVE_TURN_STATUSES.has(turn.status)
  );
  const mergeVersions =
    activeSession?.versions.filter(
      (version) => version.id !== activeSession.currentVersionId
    ) ?? [];
  const compareVersions =
    activeSession?.versions.filter(
      (version) => version.id !== activeSession.currentVersionId
    ) ?? [];
  const compareVersion = activeSession?.versions.find(
    (version) => version.id === compareVersionId
  );
  const compareAsset = resolveVersionAsset(activeSession, compareVersion);

  useEffect(() => {
    if (effectiveModel && effectiveModel.id !== selectedModelId) {
      onSelectModel(effectiveModel.id);
    }
  }, [effectiveModel?.id, onSelectModel, selectedModelId]);

  useEffect(() => {
    setCandidateCount((current) =>
      Math.min(
        maxCandidateCount,
        Math.max(IMAGE_EDIT_LIMITS.minCandidates, current)
      )
    );

    if (
      (mode === "local" && !supportsLocalEditing) ||
      (mode === "merge" && !supportsMergeEditing)
    ) {
      setMode("whole");
    }
  }, [
    effectiveModel?.id,
    maxCandidateCount,
    mode,
    supportsLocalEditing,
    supportsMergeEditing
  ]);

  useEffect(() => {
    let mounted = true;

    const loadInitialSession = async () => {
      if (shareToken) {
        const shared = await getSharedEditSession(shareToken);
        return {
          items: [summarizeSession(shared.session)],
          listMode: isArchivedSession(shared.session)
            ? ("archived" as const)
            : ("active" as const),
          permission: shared.permission,
          session: shared.session
        };
      }

      const items = await listEditSessions(60);
      const first = items.find((item) => !isArchivedSession(item)) ?? items[0];
      return {
        items,
        listMode: first && isArchivedSession(first)
          ? ("archived" as const)
          : ("active" as const),
        permission: undefined,
        session: first ? await getEditSession(first.id) : undefined
      };
    };

    loadInitialSession()
      .then(async (items) => {
        if (!mounted) {
          return;
        }

        setSessions(items.items);
        setSessionListMode(items.listMode);
        setSharedPermission(items.permission);

        if (items.session && mounted) {
          syncSession(items.session);
        }
      })
      .catch((error) => {
        if (mounted) {
          setFeedback({
            kind: "error",
            message:
              error instanceof Error ? error.message : "修图服务暂时不可用。"
          });
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [shareToken]);

  useEffect(() => {
    if (!activeSessionId) {
      setStreamState("idle");
      return;
    }

    setStreamState("reconnecting");
    const unsubscribe = subscribeEditSessionEvents(activeSessionId, {
      onOpen: () => setStreamState("connected"),
      onEvent: (event) => {
        setStreamState("connected");

        if (event.type === "session.deleted") {
          setSessions((current) =>
            current.filter((item) => item.id !== event.sessionId)
          );
          setActiveSession(undefined);
          setActiveSessionId(undefined);
          return;
        }

        if (event.session) {
          syncSession(event.session);
        }
      },
      onError: () => setStreamState("reconnecting")
    });

    return unsubscribe;
  }, [activeSessionId]);

  useEffect(() => {
    if (!feedback) {
      return;
    }

    const timer = window.setTimeout(() => setFeedback(undefined), 4200);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    setAnalysis(undefined);
  }, [instruction, mode, regions]);

  useEffect(() => {
    if (mode === "merge" && !mergeVersionId) {
      setMergeVersionId(mergeVersions[0]?.id ?? "");
    }
  }, [mergeVersionId, mergeVersions, mode]);

  useEffect(() => {
    if (mode === "local") {
      setCompareMode("off");
    }
  }, [mode]);

  useEffect(() => {
    if (!compareVersionId || !compareVersions.some((item) => item.id === compareVersionId)) {
      setCompareVersionId(compareVersions[0]?.id ?? "");
    }
  }, [activeSession?.id, activeSession?.currentVersionId, compareVersionId]);

  useEffect(() => {
    if (compareMode !== "blink") {
      setBlinkPrimaryVisible(true);
      return;
    }

    const timer = window.setInterval(
      () => setBlinkPrimaryVisible((current) => !current),
      650
    );
    return () => window.clearInterval(timer);
  }, [compareMode]);

  useEffect(() => {
    if (!previewCandidate) {
      return;
    }

    setCandidatePreviewZoom(100);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewCandidate(undefined);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewCandidate]);

  useEffect(() => {
    setProtectedPresets(activeSession?.protectedPresets ?? []);
  }, [activeSession?.id]);

  useEffect(() => {
    if (isSharedSession) {
      setPlatformSnapshot(undefined);
      return;
    }

    getEditPlatformSnapshot()
      .then(setPlatformSnapshot)
      .catch(() => undefined);
  }, [isSharedSession]);

  useEffect(() => {
    if (!effectiveModel || !canEdit || !canManage) {
      setCostPreview(undefined);
      return;
    }

    const timer = window.setTimeout(() => {
      previewEditTurnCost({
        modelId: effectiveModel.id,
        params: {
          ...params,
          count: 1
        },
        candidateCount,
        modelOverride
      })
        .then(setCostPreview)
        .catch(() => setCostPreview(undefined));
    }, 240);

    return () => window.clearTimeout(timer);
  }, [
    candidateCount,
    canEdit,
    canManage,
    effectiveModel?.id,
    modelOverride,
    params.outputFormat,
    params.quality,
    params.ratio,
    params.resolution
  ]);

  useEffect(() => {
    renderActiveRegionMask();
  }, [activeRegionId, currentAsset?.url]);

  function syncSession(session: EditSession) {
    setActiveSession(session);
    setActiveSessionId(session.id);
    setSessions((current) => {
      const summary = summarizeSession(session);
      return [
        summary,
        ...current.filter((item) => item.id !== summary.id)
      ].slice(0, 60);
    });
  }

  async function runAction(
    key: string,
    work: () => Promise<void>,
    successMessage?: string
  ) {
    if (busyAction) {
      return;
    }

    setBusyAction(key);
    setFeedback(undefined);

    try {
      await work();

      if (successMessage) {
        setFeedback({ kind: "success", message: successMessage });
      }
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "操作失败，请稍后重试。"
      });
    } finally {
      setBusyAction(undefined);
    }
  }

  async function openSession(id: string) {
    if (id === activeSessionId && activeSession) {
      return;
    }

    await runAction(`session:${id}`, async () => {
      const session = await getEditSession(id);
      syncSession(session);
      resetRegionDrafts();
    });
  }

  async function handleSourceFile(file?: File) {
    if (!file || !effectiveModel || !canManage) {
      return;
    }

    const validation = validateReferenceImageFiles(
      [file],
      effectiveModel.capabilities
    );

    if (validation.issues.length > 0) {
      setFeedback({
        kind: "error",
        message: validation.issues.map((issue) => issue.message).join("；")
      });
      return;
    }

    await runAction("create-session", async () => {
      const reference = await createReferenceImageWithBase64(file, 0);

      try {
        const session = await createEditSession({
          title: stripExtension(file.name),
          modelId: effectiveModel.id,
          source: toEditImageInput(reference)
        });
        syncSession(session);
        resetRegionDrafts();
      } finally {
        revokePreviewURL(reference.previewURL);
      }
    }, "源图已保存，可以开始连续修图。");
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();

    if (canManage) {
      void handleSourceFile(event.dataTransfer.files[0]);
    }
  }

  async function handleSessionArchiveChange(
    session: EditSessionSummary,
    archived: boolean
  ) {
    if (!canManage) {
      return;
    }

    await runAction(
      `${archived ? "archive" : "restore"}:${session.id}`,
      async () => {
        const updated = await updateEditSession(session.id, { archived });
        const summary = summarizeSession(updated);
        const nextSessions = [
          summary,
          ...sessions.filter((item) => item.id !== summary.id)
        ];
        setSessions(nextSessions);

        if (!archived) {
          setSessionListMode("active");
          syncSession(updated);
          resetRegionDrafts();
          return;
        }

        setSessionListMode("active");

        if (activeSessionId === session.id) {
          const next = nextSessions.find(
            (item) => item.id !== session.id && !isArchivedSession(item)
          );
          setActiveSession(undefined);
          setActiveSessionId(undefined);

          if (next) {
            syncSession(await getEditSession(next.id));
            resetRegionDrafts();
          }
        }
      },
      archived ? "会话已归档。" : "会话已恢复。"
    );
  }

  async function handleDeleteSession(session: EditSessionSummary) {
    if (!canManage) {
      return;
    }

    if (!window.confirm(`确认删除“${session.title}”及其全部版本和本地素材？`)) {
      return;
    }

    await runAction(`delete:${session.id}`, async () => {
      await deleteEditSession(session.id);
      const remaining = sessions.filter((item) => item.id !== session.id);
      setSessions(remaining);

      if (activeSessionId === session.id) {
        const next = remaining.find((item) =>
          sessionListMode === "archived"
            ? isArchivedSession(item)
            : !isArchivedSession(item)
        );
        setActiveSession(undefined);
        setActiveSessionId(undefined);

        if (next) {
          const loaded = await getEditSession(next.id);
          syncSession(loaded);
        }
      }
    });
  }

  async function handleRenameSession() {
    if (!activeSession || !canManage) {
      return;
    }

    const title = window.prompt("会话名称", activeSession.title)?.trim();

    if (!title || title === activeSession.title) {
      return;
    }

    await runAction("rename-session", async () => {
      syncSession(await updateEditSession(activeSession.id, { title }));
    }, "会话已重命名。");
  }

  async function analyzeCurrentInstruction() {
    const input = buildAnalysisInput(instruction, mode, regions);

    try {
      return await onAnalyzeInstruction(input);
    } catch {
      const fallback = createLocalEditInstructionAnalysis(input);
      setFeedback({
        kind: "info",
        message: "AI 润色暂不可用，已使用本地规则整理指令。"
      });
      return fallback;
    }
  }

  async function handlePolishInstruction() {
    if (!instruction.trim()) {
      setFeedback({ kind: "error", message: "请先输入修图指令。" });
      return;
    }

    await runAction("polish", async () => {
      const nextAnalysis = await analyzeCurrentInstruction();
      setAnalysis(nextAnalysis);
    }, "指令分析完成。");
  }

  async function handleSubmitTurn() {
    if (!canEdit) {
      setFeedback({
        kind: "error",
        message: "当前分享权限不允许提交修图。"
      });
      return;
    }

    if (!activeSession || !effectiveModel || !instruction.trim()) {
      setFeedback({
        kind: "error",
        message: activeSession ? "请先输入修图指令。" : "请先上传源图。"
      });
      return;
    }

    const submittedRegions = regions.filter((region) => region.maskDataURL);

    if (mode === "local" && submittedRegions.length === 0) {
      setFeedback({
        kind: "error",
        message: "局部编辑至少需要绘制一个蒙版区域。"
      });
      return;
    }

    if (mode === "local" && submittedRegions.length > localRegionLimit) {
      setFeedback({
        kind: "error",
        message: `当前模型本轮最多支持 ${localRegionLimit} 个蒙版区域。`
      });
      return;
    }

    if (mode === "merge" && !mergeVersionId) {
      setFeedback({
        kind: "error",
        message: "合并编辑需要选择另一个版本作为合并来源。"
      });
      return;
    }

    await runAction("submit-turn", async () => {
      const nextAnalysis =
        analysis?.originalInstruction === instruction.trim()
          ? analysis
          : await analyzeCurrentInstruction();
      const preparedRegions =
        mode === "local"
          ? await prepareRegionSubmissions(submittedRegions)
          : [];
      const sourceVersionIds =
        mode === "merge"
          ? [activeSession.currentVersionId, mergeVersionId]
          : [activeSession.currentVersionId];
      const session = await createEditTurn(activeSession.id, {
        clientTurnId: crypto.randomUUID(),
        branchId: activeSession.currentBranchId,
        sourceVersionIds,
        mode,
        modelId: effectiveModel.id,
        modelDisplayName: effectiveModel.displayName,
        endpointOverride,
        modelOverride,
        params: {
          ...params,
          count: 1
        },
        candidateCount,
        originalInstruction: instruction.trim(),
        protectedPresets,
        analysis: nextAnalysis,
        regions:
          mode === "local"
            ? preparedRegions.map((region, index) => ({
                id: region.id,
                label: region.label,
                color: region.color,
                instruction: region.instruction,
                mask: maskDataURLToEditInput(
                  region.preparedMaskDataURL,
                  region.label,
                  index
                ),
                selectionMethod: region.selectionMethod,
                combinationMode: region.combinationMode,
                maskSemantics: "selection-alpha",
                priority: region.priority,
                featherRadius: region.featherRadius,
                expansionPixels: region.expansionPixels,
                inverted: region.inverted,
                semanticTarget: region.semanticTarget || undefined
              }))
            : []
      });
      syncSession(session);
      setInstruction("");
      setAnalysis(undefined);
      resetRegionDrafts();
    });
  }

  async function handleAnswerClarification(turn: EditTurn) {
    if (!activeSession || !canEdit) {
      return;
    }

    const answer = clarificationAnswers[turn.id]?.trim();

    if (!answer) {
      setFeedback({ kind: "error", message: "请填写补充说明。" });
      return;
    }

    await runAction(`clarify:${turn.id}`, async () => {
      const combinedInstruction = `${turn.originalInstruction}\n补充说明：${answer}`;
      const regionInputs = turn.regions.map((region) => ({
        label: region.label,
        instruction: region.instruction
      }));
      let nextAnalysis: EditInstructionAnalysis;

      try {
        nextAnalysis = await onAnalyzeInstruction({
          instruction: combinedInstruction,
          mode: turn.mode,
          regions: regionInputs
        });
      } catch {
        nextAnalysis = createLocalEditInstructionAnalysis({
          instruction: combinedInstruction,
          mode: turn.mode,
          regions: regionInputs
        });
      }

      syncSession(
        await answerEditClarification(activeSession.id, turn.id, {
          answer,
          analysis: nextAnalysis,
          endpointOverride,
          modelOverride
        })
      );
      setClarificationAnswers((current) => ({
        ...current,
        [turn.id]: ""
      }));
    });
  }

  async function handleCancelTurn(turn: EditTurn) {
    if (!activeSession || !canEdit) {
      return;
    }

    await runAction(`cancel:${turn.id}`, async () => {
      syncSession(await cancelEditTurn(activeSession.id, turn.id));
    });
  }

  async function handleRetryJob(job: EditJob) {
    if (!activeSession || !canEdit) {
      return;
    }

    await runAction(`retry:${job.id}`, async () => {
      syncSession(
        await retryEditJob(activeSession.id, job.id, {
          endpointOverride,
          modelOverride
        })
      );
    });
  }

  async function handleCheckoutVersion(version: ImageVersion) {
    if (!activeSession || !canEdit) {
      return;
    }

    await runAction(`checkout:${version.id}`, async () => {
      syncSession(
        await checkoutEditVersion(activeSession.id, version.id, {
          branchId: activeSession.currentBranchId
        })
      );
      resetRegionDrafts();
    }, "当前分支已切换到所选版本。");
  }

  async function handleBranchChange(branchId: string) {
    if (!activeSession || !canEdit) {
      return;
    }

    const branch = activeSession.branches.find(
      (item) => item.id === branchId && !item.archivedAt
    );

    if (!branch) {
      return;
    }

    await runAction(`branch:${branch.id}`, async () => {
      syncSession(
        await checkoutEditVersion(activeSession.id, branch.headVersionId, {
          branchId: branch.id
        })
      );
      resetRegionDrafts();
    });
  }

  async function handleCreateBranch() {
    if (!activeSession || !canEdit) {
      return;
    }

    const name = window.prompt(
      "新分支名称",
      `方案 ${activeSession.branches.length + 1}`
    )?.trim();

    if (!name) {
      return;
    }

    await runAction("create-branch", async () => {
      syncSession(
        await createEditBranch(activeSession.id, {
          fromVersionId: activeSession.currentVersionId,
          name
        })
      );
    }, "新分支已创建。");
  }

  async function handleRenameBranch() {
    if (!activeSession || !currentBranch || !canEdit) {
      return;
    }

    const name = window.prompt("分支名称", currentBranch.name)?.trim();

    if (!name || name === currentBranch.name) {
      return;
    }

    await runAction("rename-branch", async () => {
      syncSession(
        await updateEditBranch(activeSession.id, currentBranch.id, { name })
      );
    }, "分支已重命名。");
  }

  async function handleLocalVersionMerge(sourceVersionId: string) {
    if (!activeSession || !currentAsset || !currentVersion || !canEdit) {
      return;
    }

    const sourceVersion = activeSession.versions.find(
      (version) => version.id === sourceVersionId
    );
    const sourceAsset = resolveVersionAsset(activeSession, sourceVersion);
    const maskCanvas = maskCanvasRef.current;

    if (!sourceVersion || !sourceAsset || !maskCanvas) {
      setFeedback({
        kind: "error",
        message: "请选择一个可用版本，并先在局部模式绘制合并区域。"
      });
      return;
    }

    const selection = readAlphaMaskFromCanvas(maskCanvas);

    if (!selection.data.some((value) => value > 0)) {
      setFeedback({
        kind: "error",
        message: "当前蒙版为空，请先绘制要从另一版本取回的区域。"
      });
      return;
    }

    await runAction("local-version-merge", async () => {
      const [baseImage, sourceImage] = await Promise.all([
        loadBrowserImage(currentAsset.url),
        loadBrowserImage(sourceAsset.url)
      ]);
      const canvas = document.createElement("canvas");
      canvas.width = baseImage.naturalWidth;
      canvas.height = baseImage.naturalHeight;
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("无法创建局部合并画布。");
      }

      context.drawImage(baseImage, 0, 0, canvas.width, canvas.height);
      const overlay = document.createElement("canvas");
      overlay.width = canvas.width;
      overlay.height = canvas.height;
      const overlayContext = overlay.getContext("2d");

      if (!overlayContext) {
        throw new Error("无法创建局部合并图层。");
      }

      overlayContext.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
      const normalizedMask =
        selection.width === canvas.width && selection.height === canvas.height
          ? selection
          : readScaledMask(maskCanvas, canvas.width, canvas.height);
      const rgba = alphaMaskToRGBA(normalizedMask);
      const maskImage = new ImageData(rgba.data, rgba.width, rgba.height);
      const maskLayer = document.createElement("canvas");
      maskLayer.width = canvas.width;
      maskLayer.height = canvas.height;
      maskLayer.getContext("2d")?.putImageData(maskImage, 0, 0);
      overlayContext.globalCompositeOperation = "destination-in";
      overlayContext.drawImage(maskLayer, 0, 0);
      context.drawImage(overlay, 0, 0);
      const result = canvas.toDataURL("image/png");

      syncSession(
        await mergeEditVersionRegion(activeSession.id, {
          sourceVersionIds: [currentVersion.id, sourceVersion.id],
          result: maskDataURLToEditInput(result, "局部版本合并", 0),
          label: `${currentVersion.label} + ${sourceVersion.label}`,
          note: "使用浏览器端蒙版进行局部像素合并。"
        })
      );
    }, "已创建局部合并版本。");
  }

  function resetRegionDrafts() {
    const first = createRegionDraft(0);
    setRegions([first]);
    setActiveRegionId(first.id);
    clearMaskCanvas();
  }

  function addRegion() {
    if (!canEdit || regions.length >= localRegionLimit) {
      return;
    }

    const next = createRegionDraft(regions.length);
    setRegions((current) => [...current, next]);
    setActiveRegionId(next.id);
  }

  function removeRegion(id: string) {
    if (!canEdit) {
      return;
    }

    if (regions.length === 1) {
      clearActiveRegion();
      return;
    }

    const index = regions.findIndex((region) => region.id === id);
    const nextRegions = regions.filter((region) => region.id !== id);
    setRegions(nextRegions);

    if (id === activeRegionId) {
      setActiveRegionId(
        nextRegions[Math.max(0, index - 1)]?.id ?? nextRegions[0]?.id ?? ""
      );
    }
  }

  function updateRegion(id: string, patch: Partial<RegionDraft>) {
    if (!canEdit) {
      return;
    }

    setRegions((current) =>
      current.map((region) => (region.id === id ? { ...region, ...patch } : region))
    );
  }

  function clearActiveRegion() {
    if (!activeRegion || !canEdit) {
      return;
    }

    updateRegion(activeRegion.id, { maskDataURL: undefined });
    clearMaskCanvas();
  }

  function initializeMaskCanvas() {
    const image = imageRef.current;
    const canvas = maskCanvasRef.current;

    if (!image || !canvas || image.naturalWidth < 1 || image.naturalHeight < 1) {
      return;
    }

    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    renderActiveRegionMask();
  }

  function renderActiveRegionMask() {
    const canvas = maskCanvasRef.current;

    if (!canvas || canvas.width < 1 || canvas.height < 1) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);

    if (!activeRegion?.maskDataURL) {
      return;
    }

    const image = new Image();
    image.onload = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = activeRegion.maskDataURL;
  }

  function clearMaskCanvas() {
    const canvas = maskCanvasRef.current;
    const context = canvas?.getContext("2d");

    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function handleCanvasPointerDown(
    event: ReactPointerEvent<HTMLCanvasElement>
  ) {
    if (mode !== "local" || !activeRegion || !canEdit) {
      return;
    }

    const point = canvasPoint(event);

    if (!point) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);

    if (canvasTool === "magic" || canvasTool === "semantic") {
      void applyAutomaticSelection(canvasTool, point);

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }

    drawingRef.current = true;
    lastPointRef.current = point;
    shapeStartRef.current = point;
    lassoPointsRef.current = canvasTool === "lasso" ? [point] : [];

    if (canvasTool === "brush" || canvasTool === "erase") {
      drawCanvasStroke(point, point);
    }
  }

  function handleCanvasPointerMove(
    event: ReactPointerEvent<HTMLCanvasElement>
  ) {
    if (!drawingRef.current) {
      return;
    }

    const point = canvasPoint(event);
    const previous = lastPointRef.current;

    if (!point || !previous) {
      return;
    }

    if (canvasTool === "brush" || canvasTool === "erase") {
      drawCanvasStroke(previous, point);
    } else if (canvasTool === "lasso") {
      lassoPointsRef.current.push(point);
    }

    lastPointRef.current = point;
  }

  function handleCanvasPointerUp(
    event: ReactPointerEvent<HTMLCanvasElement>
  ) {
    if (!drawingRef.current) {
      return;
    }

    const endPoint = canvasPoint(event) ?? lastPointRef.current;
    const startPoint = shapeStartRef.current;
    const completedTool = canvasTool;
    drawingRef.current = false;
    lastPointRef.current = undefined;
    shapeStartRef.current = undefined;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const canvas = maskCanvasRef.current;

    if (canvas && activeRegion) {
      if (completedTool === "rectangle" && startPoint && endPoint) {
        applySelectionToCanvas(
          rasterizeRectangle(
            canvas.width,
            canvas.height,
            startPoint,
            endPoint
          )
        );
      } else if (
        completedTool === "lasso" &&
        lassoPointsRef.current.length >= 3
      ) {
        applySelectionToCanvas(
          rasterizePolygon(
            canvas.width,
            canvas.height,
            lassoPointsRef.current
          )
        );
      }

      lassoPointsRef.current = [];
      updateRegion(activeRegion.id, {
        maskDataURL: canvas.toDataURL("image/png")
      });
    }
  }

  function canvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = maskCanvasRef.current;

    if (!canvas) {
      return undefined;
    }

    const rect = canvas.getBoundingClientRect();

    if (rect.width < 1 || rect.height < 1) {
      return undefined;
    }

    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height
    };
  }

  function drawCanvasStroke(
    from: { x: number; y: number },
    to: { x: number; y: number }
  ) {
    const canvas = maskCanvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context || !activeRegion) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const scale = rect.width > 0 ? canvas.width / rect.width : 1;
    context.save();
    context.globalCompositeOperation =
      canvasTool === "erase" ? "destination-out" : "source-over";
    context.strokeStyle = colorWithAlpha(activeRegion.color, 0.68);
    context.lineWidth = Math.max(2, brushSize * scale);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    context.restore();
  }

  function applySelectionToCanvas(
    selection: AlphaMask,
    operation: EditMaskCombination = "add"
  ) {
    const canvas = maskCanvasRef.current;

    if (!canvas || !activeRegion) {
      return;
    }

    const current = readAlphaMaskFromCanvas(canvas);
    const combined = combineAlphaMasks(current, selection, operation);
    writeAlphaMaskToCanvas(canvas, combined, {
      color: hexToRGB(activeRegion.color)
    });
  }

  async function applyAutomaticSelection(
    tool: "magic" | "semantic",
    point: MaskPoint
  ) {
    const image = imageRef.current;
    const canvas = maskCanvasRef.current;

    if (!image || !canvas || !activeRegion) {
      return;
    }

    try {
      const imageData = readSourceImageData(image);

      if (!imageData) {
        throw new Error("无法读取当前图片像素。");
      }

      const selection =
        tool === "magic"
          ? magicWandSelect(imageData, point, 38)
          : approximateSubjectSelect(imageData, 36);
      applySelectionToCanvas(selection);
      updateRegion(activeRegion.id, {
        maskDataURL: canvas.toDataURL("image/png"),
        selectionMethod: tool
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "自动选区失败，请改用画笔或套索。"
      });
    }
  }

  return (
    <section className="edit-workbench" aria-label="AI 修图工作台">
      <aside className="edit-session-panel">
        <div className="edit-panel-heading">
          <div>
            <span>{canManage ? "本地项目" : "共享访问"}</span>
            <strong>修图会话</strong>
          </div>
          <button
            className="icon-button"
            disabled={!canManage || !effectiveModel || Boolean(busyAction)}
            onClick={() => sourceFileInputRef.current?.click()}
            title="上传源图创建会话"
            type="button"
          >
            <ImagePlus size={18} />
          </button>
        </div>
        <input
          accept="image/jpeg,image/png"
          className="visually-hidden"
          disabled={!canManage}
          onChange={(event) => {
            void handleSourceFile(event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
          ref={sourceFileInputRef}
          type="file"
        />

        <div
          aria-disabled={!canManage}
          className={`edit-source-dropzone${canManage ? "" : " is-disabled"}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          role="button"
          tabIndex={canManage ? 0 : -1}
          onClick={() => canManage && sourceFileInputRef.current?.click()}
          onKeyDown={(event) => {
            if (
              canManage &&
              (event.key === "Enter" || event.key === " ")
            ) {
              sourceFileInputRef.current?.click();
            }
          }}
        >
          <Upload size={20} />
          <strong>{canManage ? "上传源图" : "分享会话"}</strong>
          <span>
            {canManage
              ? "JPG / PNG，创建后原图与版本会保存在本地"
              : "分享模式下不能创建或删除本地会话"}
          </span>
        </div>

        {canManage && (
          <div className="edit-session-filter" role="tablist" aria-label="会话状态">
            <button
              aria-selected={sessionListMode === "active"}
              className={sessionListMode === "active" ? "is-active" : undefined}
              onClick={() => setSessionListMode("active")}
              role="tab"
              title="查看正在进行的修图会话"
              type="button"
            >
              进行中
              <span>{activeSessionCount}</span>
            </button>
            <button
              aria-selected={sessionListMode === "archived"}
              className={sessionListMode === "archived" ? "is-active" : undefined}
              onClick={() => setSessionListMode("archived")}
              role="tab"
              title="查看已归档的修图会话"
              type="button"
            >
              已归档
              <span>{archivedSessionCount}</span>
            </button>
          </div>
        )}

        <div className="edit-session-list">
          {loading ? (
            <div className="edit-empty-state">
              <LoaderCircle className="spin" size={22} />
              <span>正在读取会话</span>
            </div>
          ) : visibleSessions.length === 0 ? (
            <div className="edit-empty-state">
              {sessionListMode === "archived" ? (
                <Archive size={24} />
              ) : (
                <ImagePlus size={24} />
              )}
              <span>
                {sessionListMode === "archived"
                  ? "还没有已归档会话"
                  : "还没有进行中的修图会话"}
              </span>
            </div>
          ) : (
            visibleSessions.map((session) => (
              <div
                className={`edit-session-item${
                  session.id === activeSessionId ? " is-active" : ""
                }${isArchivedSession(session) ? " is-archived" : ""}`}
                key={session.id}
              >
                <button
                  className="edit-session-open"
                  onClick={() => void openSession(session.id)}
                  title={`打开修图会话：${session.title}`}
                  type="button"
                >
                  <span className="edit-session-thumb">
                    {session.thumbnailURL ? (
                      <img alt="" src={session.thumbnailURL} />
                    ) : (
                      <ImagePlus size={18} />
                    )}
                  </span>
                  <span className="edit-session-copy">
                    <strong>{session.title}</strong>
                    <small>
                      {session.versionCount} 个版本 · {session.turnCount} 轮
                      {isArchivedSession(session) ? " · 已归档" : ""}
                    </small>
                  </span>
                </button>
                <div className="edit-session-actions">
                  <button
                    aria-label={`${isArchivedSession(session) ? "恢复" : "归档"}会话：${session.title}`}
                    className="edit-session-action"
                    disabled={!canManage || Boolean(busyAction)}
                    onClick={() =>
                      void handleSessionArchiveChange(
                        session,
                        !isArchivedSession(session)
                      )
                    }
                    title={isArchivedSession(session) ? "恢复会话" : "归档会话"}
                    type="button"
                  >
                    {isArchivedSession(session) ? (
                      <ArchiveRestore size={15} />
                    ) : (
                      <Archive size={15} />
                    )}
                  </button>
                  <button
                    aria-label={`删除会话：${session.title}`}
                    className="edit-session-action is-danger"
                    disabled={!canManage || Boolean(busyAction)}
                    onClick={() => void handleDeleteSession(session)}
                    title="删除会话"
                    type="button"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      <section className="edit-canvas-panel">
        {activeSession && currentAsset ? (
          <>
            <div className="edit-canvas-toolbar">
              <div className="edit-session-title">
                <strong>{activeSession.title}</strong>
                {activeSession.status === "archived" && (
                  <span className="edit-session-status">已归档</span>
                )}
                <button
                  className="icon-button subtle"
                  disabled={!canManage}
                  onClick={() => void handleRenameSession()}
                  title="重命名会话"
                  type="button"
                >
                  <Pencil size={14} />
                </button>
              </div>
              <div className="edit-branch-controls">
                <GitBranch size={15} />
                <select
                  aria-label="当前分支"
                  disabled={!canEdit}
                  onChange={(event) => void handleBranchChange(event.target.value)}
                  value={activeSession.currentBranchId}
                >
                  {activeSession.branches
                    .filter((branch) => !branch.archivedAt)
                    .map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                </select>
                <button
                  className="icon-button subtle"
                  disabled={!canEdit}
                  onClick={() => void handleCreateBranch()}
                  title="从当前版本创建分支"
                  type="button"
                >
                  <Plus size={15} />
                </button>
                <button
                  className="icon-button subtle"
                  disabled={!canEdit}
                  onClick={() => void handleRenameBranch()}
                  title="重命名当前分支"
                  type="button"
                >
                  <Pencil size={14} />
                </button>
              </div>
              <div className="edit-zoom-controls">
                <button
                  className="icon-button subtle"
                  disabled={zoom <= 50}
                  onClick={() => setZoom((current) => Math.max(50, current - 25))}
                  title="缩小"
                  type="button"
                >
                  <ZoomOut size={16} />
                </button>
                <span>{zoom}%</span>
                <button
                  className="icon-button subtle"
                  disabled={zoom >= 200}
                  onClick={() => setZoom((current) => Math.min(200, current + 25))}
                  title="放大"
                  type="button"
                >
                  <ZoomIn size={16} />
                </button>
              </div>
            </div>

            <div className="edit-canvas-stage">
              {compareMode !== "off" && compareAsset ? (
                <VersionComparison
                  compareAsset={compareAsset}
                  compareLabel={compareVersion?.label ?? "对比版本"}
                  currentAsset={currentAsset}
                  currentLabel={currentVersion?.label ?? "当前版本"}
                  mode={compareMode}
                  position={comparePosition}
                  primaryVisible={blinkPrimaryVisible}
                  zoom={zoom}
                />
              ) : (
                <div
                  className="edit-canvas-viewport"
                  style={{ width: `${zoom}%` }}
                >
                  <img
                    alt={`当前版本：${currentVersion?.label ?? "图片"}`}
                    onLoad={initializeMaskCanvas}
                    ref={imageRef}
                    src={currentAsset.url}
                  />
                  <canvas
                    aria-label="局部编辑蒙版"
                    className={`edit-mask-canvas${
                      mode === "local" && canEdit ? " is-enabled" : ""
                    }`}
                    onPointerCancel={handleCanvasPointerUp}
                    onPointerDown={handleCanvasPointerDown}
                    onPointerMove={handleCanvasPointerMove}
                    onPointerUp={handleCanvasPointerUp}
                    ref={maskCanvasRef}
                  />
                </div>
              )}
            </div>

            {mode === "local" && (
              <div className="edit-mask-toolbar">
                <div className="edit-tool-segment" aria-label="蒙版工具">
                  <button
                    className={canvasTool === "brush" ? "is-active" : undefined}
                    disabled={!canEdit}
                    onClick={() => {
                      setCanvasTool("brush");
                      if (activeRegion) {
                        updateRegion(activeRegion.id, {
                          selectionMethod: "brush"
                        });
                      }
                    }}
                    title="画笔"
                    type="button"
                  >
                    <Brush size={16} />
                  </button>
                  <button
                    className={canvasTool === "erase" ? "is-active" : undefined}
                    disabled={!canEdit}
                    onClick={() => setCanvasTool("erase")}
                    title="橡皮擦"
                    type="button"
                  >
                    <Eraser size={16} />
                  </button>
                  <button
                    className={
                      canvasTool === "rectangle" ? "is-active" : undefined
                    }
                    disabled={!canEdit}
                    onClick={() => {
                      setCanvasTool("rectangle");
                      if (activeRegion) {
                        updateRegion(activeRegion.id, {
                          selectionMethod: "rectangle"
                        });
                      }
                    }}
                    title="矩形选区"
                    type="button"
                  >
                    <RectangleHorizontal size={16} />
                  </button>
                  <button
                    className={canvasTool === "lasso" ? "is-active" : undefined}
                    disabled={!canEdit}
                    onClick={() => {
                      setCanvasTool("lasso");
                      if (activeRegion) {
                        updateRegion(activeRegion.id, {
                          selectionMethod: "lasso"
                        });
                      }
                    }}
                    title="套索选区"
                    type="button"
                  >
                    <LassoSelect size={16} />
                  </button>
                  <button
                    className={canvasTool === "magic" ? "is-active" : undefined}
                    disabled={!canEdit}
                    onClick={() => {
                      setCanvasTool("magic");
                      if (activeRegion) {
                        updateRegion(activeRegion.id, {
                          selectionMethod: "magic"
                        });
                      }
                    }}
                    title="魔棒：点击相近颜色区域"
                    type="button"
                  >
                    <WandSparkles size={16} />
                  </button>
                  <button
                    className={
                      canvasTool === "semantic" ? "is-active" : undefined
                    }
                    disabled={!canEdit}
                    onClick={() => {
                      setCanvasTool("semantic");
                      if (activeRegion) {
                        updateRegion(activeRegion.id, {
                          selectionMethod: "semantic"
                        });
                      }
                    }}
                    title="近似主体选择"
                    type="button"
                  >
                    <Scan size={16} />
                  </button>
                </div>
                {(canvasTool === "brush" || canvasTool === "erase") && (
                  <label className="edit-brush-size">
                    <span>笔刷</span>
                    <input
                      aria-label="笔刷大小"
                      disabled={!canEdit}
                      max={120}
                      min={8}
                      onChange={(event) =>
                        setBrushSize(Number(event.target.value))
                      }
                      type="range"
                      value={brushSize}
                    />
                    <output>{brushSize}</output>
                  </label>
                )}
                <button
                  className="secondary-action compact-action"
                  disabled={!canEdit}
                  onClick={clearActiveRegion}
                  title="清除当前区域的蒙版选区，不会删除区域设置"
                  type="button"
                >
                  <RotateCcw size={15} />
                  清空当前区域
                </button>
              </div>
            )}

            <div className="edit-version-strip">
              <div className="edit-version-strip-head">
                <span>版本轨迹</span>
                {compareVersions.length > 0 && mode !== "local" && (
                  <div className="edit-compare-controls">
                    <GitCompareArrows size={13} />
                    <select
                      aria-label="对比版本"
                      onChange={(event) => {
                        setCompareVersionId(event.target.value);
                        setCompareMode((current) =>
                          current === "off" ? "slider" : current
                        );
                      }}
                      title="选择要与当前版本比较的历史版本"
                      value={compareVersionId}
                    >
                      {compareVersions.map((version) => (
                        <option key={version.id} value={version.id}>
                          {version.label}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="对比方式"
                      onChange={(event) =>
                        setCompareMode(event.target.value as CompareMode)
                      }
                      title="切换并排、滑杆、差异或闪烁对比"
                      value={compareMode}
                    >
                      <option value="off">关闭对比</option>
                      <option value="side-by-side">并排</option>
                      <option value="slider">滑杆</option>
                      <option value="difference">差异</option>
                      <option value="blink">闪烁</option>
                    </select>
                    {compareMode === "slider" && (
                      <input
                        aria-label="对比滑杆位置"
                        max={100}
                        min={0}
                        onChange={(event) =>
                          setComparePosition(Number(event.target.value))
                        }
                        title="拖动分隔线查看两个版本的细节差异"
                        type="range"
                        value={comparePosition}
                      />
                    )}
                  </div>
                )}
                <strong>
                  {activeSession.versions.length} 个版本 · 当前{" "}
                  {currentVersion?.label}
                </strong>
              </div>
              <div className="edit-version-list">
                {activeSession.versions.map((version) => {
                  const asset = resolveVersionAsset(activeSession, version);
                  const isCurrent = version.id === activeSession.currentVersionId;

                  return (
                    <button
                      className={`edit-version-item${
                        isCurrent ? " is-current" : ""
                      }`}
                      disabled={!canEdit}
                      key={version.id}
                      onClick={() => void handleCheckoutVersion(version)}
                      title={
                        version.parentVersionIds.length === 2
                          ? "双父版本合并结果"
                          : "检出此版本"
                      }
                      type="button"
                    >
                      {asset && <img alt="" src={asset.url} />}
                      <span>{version.label}</span>
                      {version.favorite && <Star fill="currentColor" size={12} />}
                      {version.parentVersionIds.length === 2 && (
                        <GitMerge size={13} />
                      )}
                      {isCurrent && <Check size={13} />}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="edit-canvas-empty">
            <ImagePlus size={42} />
            <strong>从一张源图开始</strong>
            <span>上传后可连续对话修图、绘制多个局部区域并管理版本分支。</span>
            <button
              className="primary-action"
              disabled={!canManage || !effectiveModel || Boolean(busyAction)}
              onClick={() => sourceFileInputRef.current?.click()}
              title="选择一张 JPG 或 PNG 作为修图源图"
              type="button"
            >
              <Upload size={17} />
              选择源图
            </button>
          </div>
        )}
      </section>

      <aside className="edit-conversation-panel">
        <div className="edit-runtime-row">
          <span
            className={`edit-stream-dot ${
              streamState === "connected" ? "is-connected" : ""
            }`}
          />
          <span>
            {streamState === "connected"
              ? "实时同步"
              : streamState === "reconnecting"
                ? "正在重连"
                : "等待会话"}
          </span>
          {latestTurn?.continuationStrategy && (
            <span
              className={`edit-continuation-badge is-${latestTurn.continuationStrategy}`}
              title="本轮上下文延续方式"
            >
              {formatContinuationStrategy(latestTurn.continuationStrategy)}
            </span>
          )}
          {costPreview && (
            <span className="edit-cost-badge" title={costPreview.riskText}>
              {costPreview.estimatedCostText}
            </span>
          )}
          {sharedPermission && (
            <span
              className={`edit-share-permission is-${sharedPermission}`}
              title="当前分享链接权限"
            >
              分享：{formatSharePermission(sharedPermission)}
            </span>
          )}
          {liveTurn && (
            <button
              className="secondary-action compact-action danger-action"
              disabled={!canEdit}
              onClick={() => void handleCancelTurn(liveTurn)}
              title="停止当前正在生成的修图任务"
              type="button"
            >
              <X size={14} />
              取消本轮
            </button>
          )}
        </div>

        <div
          className={`edit-inspector-tabs${canManage ? "" : " is-shared"}`}
          aria-label="修图侧栏"
        >
          <button
            className={inspectorTab === "conversation" ? "is-active" : undefined}
            onClick={() => setInspectorTab("conversation")}
            title="输入修图要求并查看多轮对话与候选图"
            type="button"
          >
            <MessageSquare size={14} />
            对话
          </button>
          <button
            className={inspectorTab === "version" ? "is-active" : undefined}
            onClick={() => setInspectorTab("version")}
            title="管理当前版本、质量检查和版本合并"
            type="button"
          >
            <GitBranch size={14} />
            版本
          </button>
          <button
            className={
              inspectorTab === "collaboration" ? "is-active" : undefined
            }
            onClick={() => setInspectorTab("collaboration")}
            title="处理审核、评论和分享权限"
            type="button"
          >
            <Share2 size={14} />
            协作
          </button>
          {canManage && (
            <button
              className={inspectorTab === "operations" ? "is-active" : undefined}
              onClick={() => setInspectorTab("operations")}
              title="查看成本指标并管理常用模板与品牌素材"
              type="button"
            >
              <Activity size={14} />
              运营
            </button>
          )}
        </div>

        {inspectorTab === "conversation" && (
          <>
        <div className="edit-model-row">
          <label>
            <span>修图模型</span>
            <select
              aria-label="修图模型"
              disabled={!canEdit}
              onChange={(event) => onSelectModel(event.target.value)}
              value={effectiveModel?.id ?? ""}
            >
              {editModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>候选</span>
            <select
              aria-label="候选数量"
              disabled={!canEdit}
              onChange={(event) => setCandidateCount(Number(event.target.value))}
              value={candidateCount}
            >
              {candidateOptions.map((count) => (
                <option key={count} value={count}>
                  {count} 张
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="edit-parameter-row">
          <label>
            <span>比例</span>
            <select
              disabled={!canEdit}
              onChange={(event) =>
                onParamsChange({
                  ...params,
                  ratio: event.target.value as GenerationParams["ratio"]
                })
              }
              value={params.ratio}
            >
              {(effectiveModel?.capabilities.ratios ?? []).map((option) => (
                <option
                  disabled={!option.enabled}
                  key={option.key}
                  value={option.key}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>清晰度</span>
            <select
              disabled={!canEdit}
              onChange={(event) =>
                onParamsChange({
                  ...params,
                  resolution: event.target.value as GenerationParams["resolution"]
                })
              }
              value={params.resolution}
            >
              {(effectiveModel?.capabilities.resolutions ?? []).map((option) => (
                <option
                  disabled={!option.enabled}
                  key={option.key}
                  value={option.key}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="edit-mode-segment" aria-label="修图模式">
          <button
            className={mode === "whole" ? "is-active" : undefined}
            disabled={!canEdit}
            onClick={() => setMode("whole")}
            title="整图编辑：根据指令调整整个画面"
            type="button"
          >
            整图
          </button>
          <button
            className={mode === "local" ? "is-active" : undefined}
            disabled={!canEdit || !supportsLocalEditing}
            onClick={() => setMode("local")}
            title={
              supportsLocalEditing
                ? "局部编辑：先在画布上绘制蒙版，再描述区域要求"
                : "当前模型没有可用于蒙版的参考图额度"
            }
            type="button"
          >
            <Brush size={14} />
            局部
          </button>
          <button
            className={mode === "merge" ? "is-active" : undefined}
            disabled={
              !canEdit || !supportsMergeEditing || mergeVersions.length === 0
            }
            onClick={() => setMode("merge")}
            title={
              supportsMergeEditing
                ? "版本合并：以当前版本为基础融合另一个版本"
                : "当前模型不支持双版本合并"
            }
            type="button"
          >
            <GitMerge size={14} />
            合并
          </button>
        </div>

        <div className="edit-protection-presets">
          <span>
            <ShieldCheck size={13} />
            锁定
          </span>
          {PROTECTED_PRESET_OPTIONS.map((preset) => {
            const checked = protectedPresets.includes(preset.key);

            return (
              <label
                key={preset.key}
                title={`锁定${preset.label}，提示 AI 在修图时尽量保持不变`}
              >
                <input
                  aria-label={`锁定${preset.label}`}
                  checked={checked}
                  disabled={!canEdit}
                  onChange={() =>
                    setProtectedPresets((current) =>
                      checked
                        ? current.filter((item) => item !== preset.key)
                        : [...current, preset.key]
                    )
                  }
                  type="checkbox"
                />
                {preset.label}
              </label>
            );
          })}
        </div>

        {mode === "merge" && (
          <label className="edit-merge-source">
            <span>合并来源</span>
            <select
              disabled={!canEdit}
              onChange={(event) => setMergeVersionId(event.target.value)}
              value={mergeVersionId}
            >
              {mergeVersions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.label} · {formatShortTime(version.createdAt)}
                </option>
              ))}
            </select>
          </label>
        )}

        {mode === "local" && (
          <section className="edit-region-editor">
            <div className="edit-region-tabs">
              {regions.map((region) => (
                <button
                  className={region.id === activeRegionId ? "is-active" : undefined}
                  key={region.id}
                  onClick={() => setActiveRegionId(region.id)}
                  style={{ "--region-color": region.color } as React.CSSProperties}
                  title={`切换到${region.label}并编辑对应蒙版`}
                  type="button"
                >
                  <span />
                  {region.label}
                </button>
              ))}
              <button
                className="edit-add-region"
                disabled={!canEdit || regions.length >= localRegionLimit}
                onClick={addRegion}
                title={`添加区域（最多 ${localRegionLimit} 个）`}
                type="button"
              >
                <Plus size={14} />
              </button>
            </div>
            {activeRegion && (
              <div className="edit-region-fields-wrap">
                <div className="edit-region-fields">
                  <label>
                    <span>区域名称</span>
                    <input
                      disabled={!canEdit}
                      onChange={(event) =>
                        updateRegion(activeRegion.id, {
                          label: event.target.value
                        })
                      }
                      value={activeRegion.label}
                    />
                  </label>
                  <label>
                    <span>区域要求</span>
                    <input
                      disabled={!canEdit}
                      onChange={(event) =>
                        updateRegion(activeRegion.id, {
                          instruction: event.target.value
                        })
                      }
                      placeholder="例如：将外套改为深绿色羊毛材质"
                      value={activeRegion.instruction}
                    />
                  </label>
                  <button
                    className="icon-button subtle danger-action"
                    disabled={!canEdit}
                    onClick={() => removeRegion(activeRegion.id)}
                    title="删除当前区域"
                    type="button"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="edit-region-options">
                  <label>
                    <span>组合</span>
                    <select
                      disabled={!canEdit}
                      onChange={(event) =>
                        updateRegion(activeRegion.id, {
                          combinationMode: event.target
                            .value as EditMaskCombination
                        })
                      }
                      value={activeRegion.combinationMode}
                    >
                      <option value="add">添加</option>
                      <option value="subtract">减去</option>
                      <option value="intersect">相交</option>
                    </select>
                  </label>
                  <label>
                    <span>羽化</span>
                    <input
                      disabled={!canEdit}
                      max={48}
                      min={0}
                      onChange={(event) =>
                        updateRegion(activeRegion.id, {
                          featherRadius: Number(event.target.value)
                        })
                      }
                      type="number"
                      value={activeRegion.featherRadius}
                    />
                  </label>
                  <label>
                    <span>扩缩</span>
                    <input
                      disabled={!canEdit}
                      max={64}
                      min={-64}
                      onChange={(event) =>
                        updateRegion(activeRegion.id, {
                          expansionPixels: Number(event.target.value)
                        })
                      }
                      type="number"
                      value={activeRegion.expansionPixels}
                    />
                  </label>
                  <label>
                    <span>优先级</span>
                    <input
                      disabled={!canEdit}
                      max={99}
                      min={0}
                      onChange={(event) =>
                        updateRegion(activeRegion.id, {
                          priority: Number(event.target.value)
                        })
                      }
                      type="number"
                      value={activeRegion.priority}
                    />
                  </label>
                  <label className="edit-region-invert">
                    <input
                      checked={activeRegion.inverted}
                      disabled={!canEdit}
                      onChange={(event) =>
                        updateRegion(activeRegion.id, {
                          inverted: event.target.checked
                        })
                      }
                      type="checkbox"
                    />
                    反选
                  </label>
                  {activeRegion.selectionMethod === "semantic" && (
                    <label className="edit-semantic-target">
                      <span>语义目标</span>
                      <input
                        disabled={!canEdit}
                        onChange={(event) =>
                          updateRegion(activeRegion.id, {
                            semanticTarget: event.target.value
                          })
                        }
                        placeholder="人物、商品、天空"
                        value={activeRegion.semanticTarget}
                      />
                    </label>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        <div className="edit-message-list">
          {activeSession?.messages.map((message) => (
            <article
              className={`edit-message is-${message.role} kind-${message.kind}`}
              key={message.id}
            >
              <div>
                <strong>
                  {message.role === "user"
                    ? "你"
                    : message.role === "assistant"
                      ? "AI 修图"
                      : "系统"}
                </strong>
                <time>{formatShortTime(message.createdAt)}</time>
              </div>
              <p>{message.text}</p>
              {message.polishedText &&
                message.polishedText !== message.originalText && (
                  <details>
                    <summary>查看 AI 润色指令</summary>
                    <p>{message.polishedText}</p>
                  </details>
                )}
            </article>
          ))}

          {waitingTurn && (
            <div className="edit-clarification-box">
              <AlertTriangle size={17} />
              <textarea
                onChange={(event) =>
                  setClarificationAnswers((current) => ({
                    ...current,
                    [waitingTurn.id]: event.target.value
                  }))
                }
                placeholder="补充修改位置、目标效果或保留约束"
                rows={3}
                value={clarificationAnswers[waitingTurn.id] ?? ""}
              />
              <button
                className="primary-action compact-action"
                disabled={!canEdit || Boolean(busyAction)}
                onClick={() => void handleAnswerClarification(waitingTurn)}
                title="提交补充说明，AI 将据此继续本轮修图"
                type="button"
              >
                <Send size={15} />
                提交补充
              </button>
            </div>
          )}

          {latestTurnJobs.length > 0 && (
            <div className="edit-candidate-grid">
              {latestTurnJobs.map((job) => (
                <CandidateCard
                  activeSession={activeSession}
                  busy={Boolean(busyAction)}
                  editable={canEdit}
                  job={job}
                  key={job.id}
                  onCheckout={handleCheckoutVersion}
                  onPreview={(asset, version, candidateIndex) =>
                    setPreviewCandidate({ asset, version, candidateIndex })
                  }
                  onRetry={handleRetryJob}
                />
              ))}
            </div>
          )}
        </div>

        <div className="edit-composer">
          <textarea
            disabled={!canEdit || !activeSession || Boolean(waitingTurn)}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder={
              waitingTurn
                ? "请先回答上方澄清问题"
                : "描述要修改什么，并说明哪些内容必须保持不变"
            }
            rows={4}
            value={instruction}
          />
          {analysis && (
            <div
              className={`edit-analysis-preview is-${analysis.action}`}
            >
              <div>
                <Sparkles size={15} />
                <strong>
                  {analysis.action === "execute"
                    ? "可直接执行"
                    : "需要补充说明"}
                </strong>
                <span>{Math.round(analysis.confidence * 100)}%</span>
              </div>
              <p>
                {analysis.action === "execute"
                  ? analysis.polishedInstruction
                  : analysis.clarificationQuestion}
              </p>
            </div>
          )}
          <div className="edit-composer-actions">
            <button
              className="secondary-action"
              disabled={
                !instruction.trim() ||
                !canEdit ||
                !activeSession ||
                Boolean(busyAction) ||
                Boolean(waitingTurn)
              }
              onClick={() => void handlePolishInstruction()}
              title="先让 AI 补全表达、保留约束和修图细节，不会立即生成"
              type="button"
            >
              {busyAction === "polish" ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Sparkles size={16} />
              )}
              AI 润色
            </button>
            <button
              className="primary-action"
              disabled={
                !instruction.trim() ||
                !canEdit ||
                !activeSession ||
                Boolean(busyAction) ||
                Boolean(waitingTurn)
              }
              onClick={() => void handleSubmitTurn()}
              title="分析当前指令并开始生成候选图；信息不足时会先提问"
              type="button"
            >
              {busyAction === "submit-turn" ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Send size={16} />
              )}
              分析并执行
            </button>
          </div>
        </div>
          </>
        )}

        {inspectorTab === "version" && activeSession && currentVersion && (
          <VersionInspector
            activeSession={activeSession}
            busy={Boolean(busyAction)}
            editable={canEdit}
            manageable={canManage}
            currentAsset={currentAsset}
            currentVersion={currentVersion}
            models={models}
            onFeedback={setFeedback}
            onLocalMerge={handleLocalVersionMerge}
            onRunAction={runAction}
            onSessionChange={syncSession}
          />
        )}

        {inspectorTab === "collaboration" && activeSession && currentVersion && (
          <CollaborationInspector
            activeSession={activeSession}
            busy={Boolean(busyAction)}
            canComment={canComment}
            editable={canEdit}
            manageable={canManage}
            commentDraft={commentDraft}
            currentVersion={currentVersion}
            onCommentDraftChange={setCommentDraft}
            onFeedback={setFeedback}
            onRunAction={runAction}
            onSessionChange={syncSession}
          />
        )}

        {inspectorTab === "operations" && canManage && (
          <OperationsInspector
            activeSession={activeSession}
            costPreview={costPreview}
            currentAsset={currentAsset}
            currentVersion={currentVersion}
            onApplyTemplate={(template) => {
              setInstruction(template.instruction);
              setMode(template.mode ?? "whole");
              setProtectedPresets(template.protectedPresets);
              setInspectorTab("conversation");
            }}
            onPlatformChange={setPlatformSnapshot}
            onRunAction={runAction}
            platformSnapshot={platformSnapshot}
          />
        )}

        {feedback && (
          <div className={`edit-feedback is-${feedback.kind}`} role="status">
            {feedback.kind === "error" ? (
              <AlertTriangle size={15} />
            ) : feedback.kind === "success" ? (
              <Check size={15} />
            ) : (
              <RefreshCw size={15} />
            )}
            <span>{feedback.message}</span>
          </div>
        )}
      </aside>

      {previewCandidate && (
        <div
          className="modal-backdrop edit-candidate-preview-backdrop"
          onClick={() => setPreviewCandidate(undefined)}
          role="presentation"
        >
          <section
            aria-labelledby="edit-candidate-preview-title"
            aria-modal="true"
            className="edit-candidate-preview-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="dialog-header">
              <div>
                <span>候选大图预览</span>
                <h2 id="edit-candidate-preview-title">
                  {previewCandidate.version.label ||
                    `候选 ${previewCandidate.candidateIndex + 1}`}
                </h2>
              </div>
              <button
                aria-label="关闭候选图片预览"
                className="icon-button"
                onClick={() => setPreviewCandidate(undefined)}
                title="关闭预览（Esc）"
                type="button"
              >
                <X size={18} />
              </button>
            </header>

            <div className="edit-candidate-preview-toolbar">
              <div
                aria-label="候选图片缩放"
                className="edit-preview-zoom-controls"
                role="group"
              >
                <button
                  aria-label="缩小候选图片"
                  className="icon-button subtle"
                  disabled={candidatePreviewZoom <= 50}
                  onClick={() =>
                    setCandidatePreviewZoom((current) =>
                      Math.max(50, current - 25)
                    )
                  }
                  title="缩小预览"
                  type="button"
                >
                  <ZoomOut size={16} />
                </button>
                <button
                  className="edit-preview-zoom-reset"
                  disabled={candidatePreviewZoom === 100}
                  onClick={() => setCandidatePreviewZoom(100)}
                  title="恢复为 100%"
                  type="button"
                >
                  {candidatePreviewZoom}%
                </button>
                <button
                  aria-label="放大候选图片"
                  className="icon-button subtle"
                  disabled={candidatePreviewZoom >= 200}
                  onClick={() =>
                    setCandidatePreviewZoom((current) =>
                      Math.min(200, current + 25)
                    )
                  }
                  title="放大预览"
                  type="button"
                >
                  <ZoomIn size={16} />
                </button>
              </div>
              <div className="edit-candidate-preview-actions">
                <a
                  className="secondary-action compact-action"
                  download
                  href={previewCandidate.asset.url}
                  title="下载当前候选图片"
                >
                  <Download size={15} />
                  下载
                </a>
                <button
                  className="primary-action compact-action"
                  disabled={Boolean(busyAction) || !canEdit}
                  onClick={() => {
                    const { version } = previewCandidate;
                    setPreviewCandidate(undefined);
                    void handleCheckoutVersion(version);
                  }}
                  title="将此候选设为当前版本并继续修图"
                  type="button"
                >
                  <Check size={15} />
                  检出并继续
                </button>
              </div>
            </div>

            <div className="edit-candidate-preview-stage">
              <div
                className="edit-candidate-preview-canvas"
                style={{ width: `${candidatePreviewZoom}%` }}
              >
                <img
                  alt={`候选 ${previewCandidate.candidateIndex + 1} 大图预览`}
                  src={previewCandidate.asset.url}
                />
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

type InspectorRunAction = (
  key: string,
  work: () => Promise<void>,
  successMessage?: string
) => Promise<void>;

function VersionComparison({
  currentAsset,
  compareAsset,
  currentLabel,
  compareLabel,
  mode,
  position,
  primaryVisible,
  zoom
}: {
  currentAsset: EditAsset;
  compareAsset: EditAsset;
  currentLabel: string;
  compareLabel: string;
  mode: Exclude<CompareMode, "off">;
  position: number;
  primaryVisible: boolean;
  zoom: number;
}) {
  if (mode === "side-by-side") {
    return (
      <div
        className="edit-comparison is-side-by-side"
        style={{ width: `${zoom}%` }}
      >
        <figure>
          <img alt={currentLabel} src={currentAsset.url} />
          <figcaption>{currentLabel}</figcaption>
        </figure>
        <figure>
          <img alt={compareLabel} src={compareAsset.url} />
          <figcaption>{compareLabel}</figcaption>
        </figure>
      </div>
    );
  }

  return (
    <div
      className={`edit-comparison is-${mode}`}
      style={{ width: `${zoom}%` }}
    >
      <img
        alt={compareLabel}
        className="edit-comparison-base"
        src={compareAsset.url}
      />
      <img
        alt={currentLabel}
        className="edit-comparison-current"
        src={currentAsset.url}
        style={
          mode === "slider"
            ? { clipPath: `inset(0 ${100 - position}% 0 0)` }
            : mode === "blink"
              ? { opacity: primaryVisible ? 1 : 0 }
              : undefined
        }
      />
      {mode === "slider" && (
        <span
          className="edit-comparison-divider"
          style={{ left: `${position}%` }}
        />
      )}
      <div className="edit-comparison-labels">
        <span>{currentLabel}</span>
        <span>{compareLabel}</span>
      </div>
    </div>
  );
}

function VersionInspector({
  activeSession,
  currentVersion,
  currentAsset,
  busy,
  editable,
  manageable,
  models,
  onRunAction,
  onSessionChange,
  onFeedback,
  onLocalMerge
}: {
  activeSession: EditSession;
  currentVersion: ImageVersion;
  currentAsset?: EditAsset;
  busy: boolean;
  editable: boolean;
  manageable: boolean;
  models: ModelConfig[];
  onRunAction: InspectorRunAction;
  onSessionChange: (session: EditSession) => void;
  onFeedback: (feedback: Feedback) => void;
  onLocalMerge: (versionId: string) => Promise<void>;
}) {
  const [mergeSourceId, setMergeSourceId] = useState(
    activeSession.versions.find((item) => item.id !== currentVersion.id)?.id ?? ""
  );
  const [qualityHeatmap, setQualityHeatmap] = useState<{
    versionId: string;
    url: string;
  }>();
  const qualityAssessment = currentVersion.qualityAssessment;
  const qualitySourceVersion = activeSession.versions.find(
    (version) => version.id === currentVersion.parentVersionIds[0]
  );
  const qualitySourceAsset = resolveVersionAsset(
    activeSession,
    qualitySourceVersion
  );

  useEffect(() => {
    if (
      !mergeSourceId ||
      mergeSourceId === currentVersion.id ||
      !activeSession.versions.some((item) => item.id === mergeSourceId)
    ) {
      setMergeSourceId(
        activeSession.versions.find((item) => item.id !== currentVersion.id)?.id ??
          ""
      );
    }
  }, [activeSession.versions, currentVersion.id, mergeSourceId]);

  useEffect(() => {
    setQualityHeatmap(undefined);
  }, [currentVersion.id]);

  async function patchVersion(
    patch: Parameters<typeof updateEditVersion>[2],
    successMessage: string
  ) {
    await onRunAction(`version:${currentVersion.id}`, async () => {
      onSessionChange(
        await updateEditVersion(activeSession.id, currentVersion.id, patch)
      );
    }, successMessage);
  }

  async function editMetadata() {
    const label = window.prompt("版本名称", currentVersion.label);

    if (label === null) {
      return;
    }

    const tags = window.prompt(
      "标签（使用逗号分隔）",
      (currentVersion.tags ?? []).join(", ")
    );

    if (tags === null) {
      return;
    }

    const note = window.prompt("版本备注", currentVersion.note ?? "");

    if (note === null) {
      return;
    }

    await patchVersion(
      {
        label: label.trim() || currentVersion.label,
        tags: tags
          .split(/[,，]/)
          .map((item) => item.trim())
          .filter(Boolean),
        note: note.trim()
      },
      "版本信息已更新。"
    );
  }

  async function exportManifest() {
    await onRunAction("export-manifest", async () => {
      const manifest = await exportEditSessionManifest(activeSession.id);
      downloadJSON(`${activeSession.title}-manifest.json`, manifest);
    }, "修图清单已导出。");
  }

  async function cleanupDetachedVersions() {
    const branchHeads = new Set(
      activeSession.branches.map((branch) => branch.headVersionId)
    );
    const candidates = activeSession.versions.filter(
      (version) =>
        version.id !== activeSession.currentVersionId &&
        !branchHeads.has(version.id) &&
        !version.favorite &&
        version.reviewState !== "approved" &&
        version.reviewState !== "published"
    );

    if (candidates.length === 0) {
      onFeedback({ kind: "info", message: "当前没有可清理的游离版本。" });
      return;
    }

    if (!window.confirm(`确认尝试清理 ${candidates.length} 个游离版本？受保护版本会自动跳过。`)) {
      return;
    }

    await onRunAction("cleanup-versions", async () => {
      onSessionChange(
        await cleanupEditVersions(activeSession.id, {
          versionIds: candidates.map((version) => version.id)
        })
      );
    }, "游离版本清理完成。");
  }

  async function runQualityAssessment() {
    if (!currentAsset || !qualitySourceVersion || !qualitySourceAsset) {
      onFeedback({
        kind: "error",
        message: "当前版本缺少可用的直接父版本，无法执行技术质量检查。"
      });
      return;
    }

    await onRunAction(`quality:${currentVersion.id}`, async () => {
      const comparable = await loadComparableImagePixels(
        qualitySourceAsset.url,
        currentAsset.url
      );
      const selectionMask = await resolveQualitySelectionMask(
        activeSession,
        currentVersion,
        models,
        comparable.source.width,
        comparable.source.height
      );
      const result = evaluateEditQuality({
        ...comparable,
        sourceVersionId: qualitySourceVersion.id,
        selectionMask
      });
      const heatmapURL = imagePixelsToDataURL(result.difference);
      const session = await updateEditVersion(
        activeSession.id,
        currentVersion.id,
        {
          qualityAssessment: result.assessment
        }
      );

      setQualityHeatmap({
        versionId: currentVersion.id,
        url: heatmapURL
      });
      onSessionChange(session);
    }, "技术质量检查已完成。");
  }

  return (
    <div className="edit-inspector-scroll">
      <section className="edit-inspector-section">
        <div className="edit-inspector-section-head">
          <div>
            <span>当前版本</span>
            <strong>{currentVersion.label}</strong>
          </div>
          <button
            className={`icon-button subtle${
              currentVersion.favorite ? " is-favorite" : ""
            }`}
            disabled={busy || !editable}
            onClick={() =>
              void patchVersion(
                { favorite: !currentVersion.favorite },
                currentVersion.favorite ? "已取消收藏。" : "已收藏当前版本。"
              )
            }
            title={currentVersion.favorite ? "取消收藏" : "收藏版本"}
            type="button"
          >
            <Star
              fill={currentVersion.favorite ? "currentColor" : "none"}
              size={16}
            />
          </button>
        </div>
        {currentAsset && (
          <img
            alt={currentVersion.label}
            className="edit-inspector-preview"
            src={currentAsset.url}
          />
        )}
        <div className="edit-version-metadata">
          <span>状态：{formatReviewState(currentVersion.reviewState)}</span>
          <span>
            标签：
            {currentVersion.tags?.length
              ? currentVersion.tags.join("、")
              : "未设置"}
          </span>
          {currentVersion.note && <p>{currentVersion.note}</p>}
        </div>
        <div className="edit-inspector-actions">
          <button
            className="secondary-action compact-action"
            disabled={busy || !editable}
            onClick={() => void editMetadata()}
            title="修改当前版本的名称、标签和备注"
            type="button"
          >
            <SlidersHorizontal size={14} />
            编辑信息
          </button>
          <button
            className="secondary-action compact-action"
            disabled={busy || !manageable}
            onClick={() => void exportManifest()}
            title="导出包含会话、版本和操作记录的 JSON 清单"
            type="button"
          >
            <FileDown size={14} />
            导出清单
          </button>
          <button
            className="secondary-action compact-action danger-action"
            disabled={busy || !manageable}
            onClick={() => void cleanupDetachedVersions()}
            title="清理未被分支、收藏或审核状态保护的游离版本"
            type="button"
          >
            <Trash2 size={14} />
            清理游离版本
          </button>
        </div>
      </section>

      <section className="edit-inspector-section">
        <div className="edit-inspector-section-head">
          <div>
            <span>技术质量检查</span>
            <strong>
              {qualityAssessment?.technicalScore !== undefined
                ? `技术分 ${qualityAssessment.technicalScore}`
                : qualityAssessment
                  ? "像素差异已评估"
                  : "尚未检查"}
            </strong>
          </div>
          <Activity size={17} />
        </div>
        {qualitySourceVersion ? (
          <p>对比基线：{qualitySourceVersion.label}</p>
        ) : (
          <p>源图版本没有直接父版本，无需执行差异检查。</p>
        )}
        {qualityAssessment && (
          <>
            <div className="edit-quality-grid">
              {qualityAssessment.technicalScore !== undefined && (
                <span>
                  技术分
                  <strong>{qualityAssessment.technicalScore}/100</strong>
                </span>
              )}
              <span>
                变化像素
                <strong>{formatPercent(qualityAssessment.changedPixelRatio)}</strong>
              </span>
              {qualityAssessment.selectionCoverage !== undefined && (
                <span>
                  选区覆盖
                  <strong>
                    {formatPercent(qualityAssessment.selectionCoverage)}
                  </strong>
                </span>
              )}
              {qualityAssessment.outsideDriftRate !== undefined && (
                <span>
                  选区外漂移
                  <strong>
                    {formatPercent(qualityAssessment.outsideDriftRate)}
                  </strong>
                </span>
              )}
              {qualityAssessment.protectedConsistencyScore !== undefined && (
                <span>
                  保护区一致
                  <strong>
                    {formatPercent(
                      qualityAssessment.protectedConsistencyScore
                    )}
                  </strong>
                </span>
              )}
              {qualityAssessment.edgeBlendScore !== undefined && (
                <span>
                  边缘融合
                  <strong>
                    {formatPercent(qualityAssessment.edgeBlendScore)}
                  </strong>
                </span>
              )}
            </div>
            {qualityAssessment.warnings.length > 0 && (
              <ul className="edit-quality-warnings">
                {qualityAssessment.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </>
        )}
        {qualityHeatmap?.versionId === currentVersion.id && (
          <figure className="edit-quality-heatmap">
            <img alt="当前版本差异热图" src={qualityHeatmap.url} />
            <figcaption>亮色区域表示与直接父版本的像素差异更大。</figcaption>
          </figure>
        )}
        <p className="edit-quality-note">
          像素差异是技术代理指标，不评价审美、创意或语义指令遵循。
        </p>
        <button
          className="secondary-action compact-action"
          disabled={
            busy ||
            !editable ||
            !currentAsset ||
            !qualitySourceVersion ||
            !qualitySourceAsset
          }
          onClick={() => void runQualityAssessment()}
          title="与直接父版本进行像素差异检查，并生成差异热图"
          type="button"
        >
          <Scan size={14} />
          {qualityAssessment ? "重新检查" : "运行技术检查"}
        </button>
      </section>

      <section className="edit-inspector-section">
        <div className="edit-inspector-section-head">
          <div>
            <span>像素级合并</span>
            <strong>按当前蒙版取回另一版本</strong>
          </div>
        </div>
        <select
          disabled={!editable}
          onChange={(event) => setMergeSourceId(event.target.value)}
          value={mergeSourceId}
        >
          {activeSession.versions
            .filter((version) => version.id !== currentVersion.id)
            .map((version) => (
              <option key={version.id} value={version.id}>
                {version.label}
              </option>
            ))}
        </select>
        <button
          className="primary-action compact-action"
          disabled={busy || !editable || !mergeSourceId}
          onClick={() => void onLocalMerge(mergeSourceId)}
          title="按当前版本的蒙版，从所选版本取回对应区域"
          type="button"
        >
          <Columns2 size={14} />
          创建局部合并版本
        </button>
      </section>

      <section className="edit-inspector-section">
        <div className="edit-inspector-section-head">
          <div>
            <span>版本关系</span>
            <strong>{activeSession.versions.length} 个节点</strong>
          </div>
        </div>
        <div className="edit-version-graph">
          {activeSession.versions.map((version) => (
            <div
              className={
                version.id === currentVersion.id ? "is-current" : undefined
              }
              key={version.id}
            >
              <span />
              <strong>{version.label}</strong>
              <small>
                {version.parentVersionIds.length
                  ? `来自 ${version.parentVersionIds
                      .map(
                        (id) =>
                          activeSession.versions.find((item) => item.id === id)
                            ?.label ?? "已删除版本"
                      )
                      .join(" + ")}`
                  : "源图"}
              </small>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function CollaborationInspector({
  activeSession,
  currentVersion,
  busy,
  canComment,
  editable,
  manageable,
  commentDraft,
  onCommentDraftChange,
  onRunAction,
  onSessionChange,
  onFeedback
}: {
  activeSession: EditSession;
  currentVersion: ImageVersion;
  busy: boolean;
  canComment: boolean;
  editable: boolean;
  manageable: boolean;
  commentDraft: string;
  onCommentDraftChange: (value: string) => void;
  onRunAction: InspectorRunAction;
  onSessionChange: (session: EditSession) => void;
  onFeedback: (feedback: Feedback) => void;
}) {
  const workflow = activeSession.workflow ?? { state: "draft" as const };

  async function submitComment() {
    if (!commentDraft.trim()) {
      return;
    }

    await onRunAction("comment", async () => {
      onSessionChange(
        await createEditComment(activeSession.id, {
          versionId: currentVersion.id,
          body: commentDraft.trim()
        })
      );
      onCommentDraftChange("");
    }, "评论已添加。");
  }

  async function runWorkflow(
    action: Parameters<typeof updateEditWorkflow>[1]["action"],
    successMessage: string
  ) {
    await onRunAction(`workflow:${action}`, async () => {
      onSessionChange(
        await updateEditWorkflow(activeSession.id, {
          action,
          versionId: currentVersion.id
        })
      );
    }, successMessage);
  }

  async function createShare(permission: "view" | "comment" | "edit") {
    await onRunAction(`share:${permission}`, async () => {
      const result = await createEditShareLink(activeSession.id, {
        permission
      });
      onSessionChange(result.session);
      const shareURL = new URL(window.location.href);
      shareURL.searchParams.set("page", "editing");
      shareURL.searchParams.set("share", result.link.token);
      await copyText(shareURL.toString());
      onFeedback({
        kind: "success",
        message: "分享链接已创建并复制。"
      });
    });
  }

  async function decide(decision: "approved" | "changes_requested") {
    await onRunAction(`approval:${decision}`, async () => {
      onSessionChange(
        await createEditApproval(activeSession.id, {
          versionId: currentVersion.id,
          decision
        })
      );
    }, decision === "approved" ? "已批准当前版本。" : "已请求修改。");
  }

  return (
    <div className="edit-inspector-scroll">
      <section className="edit-inspector-section">
        <div className="edit-inspector-section-head">
          <div>
            <span>发布流程</span>
            <strong>{formatWorkflowState(workflow.state)}</strong>
          </div>
          <ShieldCheck size={17} />
        </div>
        <div className="edit-workflow-actions">
          {workflow.state === "draft" || workflow.state === "changes_requested" ? (
            <button
              className="primary-action compact-action"
              disabled={busy || !manageable}
              onClick={() =>
                void runWorkflow("request_review", "已提交审核。")
              }
              title="将当前版本提交到审核流程"
              type="button"
            >
              提交审核
            </button>
          ) : null}
          {workflow.state === "in_review" && (
            <>
              <button
                className="primary-action compact-action"
                disabled={busy || !manageable}
                onClick={() => void runWorkflow("approve", "审核已通过。")}
                title="通过当前版本的流程审核"
                type="button"
              >
                批准
              </button>
              <button
                className="secondary-action compact-action"
                disabled={busy || !manageable}
                onClick={() =>
                  void runWorkflow("return_changes", "已退回修改。")
                }
                title="退回当前版本并要求继续修改"
                type="button"
              >
                退回
              </button>
            </>
          )}
          {workflow.state === "approved" && (
            <button
              className="primary-action compact-action"
              disabled={busy || !manageable}
              onClick={() => void runWorkflow("publish", "版本已发布。")}
              title="发布已经通过审核的当前版本"
              type="button"
            >
              发布
            </button>
          )}
          {workflow.state === "published" && (
            <button
              className="secondary-action compact-action"
              disabled={busy || !manageable}
              onClick={() => void runWorkflow("reopen", "版本已重新打开。")}
              title="将已发布版本重新打开为可处理状态"
              type="button"
            >
              重新打开
            </button>
          )}
          <button
            className="secondary-action compact-action"
            disabled={busy || !manageable}
            onClick={() => void decide("approved")}
            title="单独记录一条对当前版本的批准意见"
            type="button"
          >
            记录批准
          </button>
          <button
            className="secondary-action compact-action"
            disabled={busy || !manageable}
            onClick={() => void decide("changes_requested")}
            title="单独记录一条需要修改的审核意见"
            type="button"
          >
            记录修改意见
          </button>
        </div>
      </section>

      <section className="edit-inspector-section">
        <div className="edit-inspector-section-head">
          <div>
            <span>评论</span>
            <strong>{activeSession.comments?.length ?? 0} 条</strong>
          </div>
        </div>
        <textarea
          disabled={!canComment}
          onChange={(event) => onCommentDraftChange(event.target.value)}
          placeholder="给当前版本添加评论"
          rows={3}
          value={commentDraft}
        />
        <button
          className="primary-action compact-action"
          disabled={busy || !canComment || !commentDraft.trim()}
          onClick={() => void submitComment()}
          title="把评论关联到当前版本，便于协作跟进"
          type="button"
        >
          <MessageSquare size={14} />
          添加评论
        </button>
        <div className="edit-comment-list">
          {(activeSession.comments ?? [])
            .slice()
            .reverse()
            .map((comment) => (
              <article
                className={comment.resolvedAt ? "is-resolved" : undefined}
                key={comment.id}
              >
                <div>
                  <strong>{comment.authorName}</strong>
                  <time>{formatShortTime(comment.createdAt)}</time>
                </div>
                <p>{comment.body}</p>
                {!comment.resolvedAt && (
                  <button
                    disabled={busy || !editable}
                    onClick={() =>
                      void onRunAction(`resolve:${comment.id}`, async () => {
                        onSessionChange(
                          await updateEditComment(
                            activeSession.id,
                            comment.id,
                            { resolved: true }
                          )
                        );
                      }, "评论已解决。")
                    }
                    title="将这条评论标记为已经处理"
                    type="button"
                  >
                    标记已解决
                  </button>
                )}
              </article>
            ))}
        </div>
      </section>

      <section className="edit-inspector-section">
        <div className="edit-inspector-section-head">
          <div>
            <span>分享</span>
            <strong>
              {activeSession.shareLinks?.filter((link) => !link.revokedAt)
                .length ?? 0}{" "}
              个有效链接
            </strong>
          </div>
        </div>
        <div className="edit-inspector-actions">
          <button
            className="secondary-action compact-action"
            disabled={busy || !manageable}
            onClick={() => void createShare("view")}
            title="创建仅可查看会话的分享链接并复制"
            type="button"
          >
            仅查看
          </button>
          <button
            className="secondary-action compact-action"
            disabled={busy || !manageable}
            onClick={() => void createShare("comment")}
            title="创建可查看和评论的分享链接并复制"
            type="button"
          >
            可评论
          </button>
          <button
            className="secondary-action compact-action"
            disabled={busy || !manageable}
            onClick={() => void createShare("edit")}
            title="创建允许继续修图的分享链接并复制"
            type="button"
          >
            可编辑
          </button>
        </div>
      </section>

      <section className="edit-inspector-section">
        <div className="edit-inspector-section-head">
          <div>
            <span>审计记录</span>
            <strong>{activeSession.auditLog?.length ?? 0} 条</strong>
          </div>
        </div>
        <div className="edit-audit-list">
          {(activeSession.auditLog ?? [])
            .slice(-20)
            .reverse()
            .map((event) => (
              <div key={event.id}>
                <span>{event.summary}</span>
                <time>{formatShortTime(event.createdAt)}</time>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}

function OperationsInspector({
  activeSession,
  currentVersion,
  currentAsset,
  costPreview,
  platformSnapshot,
  onApplyTemplate,
  onPlatformChange,
  onRunAction
}: {
  activeSession?: EditSession;
  currentVersion?: ImageVersion;
  currentAsset?: EditAsset;
  costPreview?: Awaited<ReturnType<typeof previewEditTurnCost>>;
  platformSnapshot?: EditPlatformSnapshot;
  onApplyTemplate: (template: EditInstructionTemplate) => void;
  onPlatformChange: (snapshot: EditPlatformSnapshot) => void;
  onRunAction: InspectorRunAction;
}) {
  const [templateId, setTemplateId] = useState("");
  const metrics = platformSnapshot?.metrics;
  const workspace = platformSnapshot?.workspace;
  const selectedTemplate = workspace?.templates.find(
    (template) => template.id === templateId
  );

  useEffect(() => {
    if (!templateId || !workspace?.templates.some((item) => item.id === templateId)) {
      setTemplateId(workspace?.templates[0]?.id ?? "");
    }
  }, [templateId, workspace?.templates]);

  async function refreshPlatform() {
    await onRunAction("platform-refresh", async () => {
      onPlatformChange(await getEditPlatformSnapshot());
    }, "运营数据已刷新。");
  }

  async function saveTemplate() {
    const name = window.prompt("模板名称")?.trim();

    if (!name) {
      return;
    }

    const instruction = window.prompt("模板修图指令")?.trim();

    if (!instruction) {
      return;
    }

    await onRunAction("template-create", async () => {
      const updated = await createEditInstructionTemplate({
        name,
        instruction,
        mode: "whole",
        protectedPresets: activeSession?.protectedPresets ?? []
      });
      onPlatformChange({
        workspace: updated,
        metrics:
          platformSnapshot?.metrics ??
          (await getEditPlatformSnapshot()).metrics
      });
    }, "常用模板已保存。");
  }

  async function saveBrandAsset() {
    if (!activeSession || !currentVersion || !currentAsset) {
      return;
    }

    const name = window.prompt("品牌素材名称", currentVersion.label)?.trim();

    if (!name) {
      return;
    }

    await onRunAction("brand-create", async () => {
      const updated = await createEditBrandAsset({
        name,
        kind: "reference",
        sessionId: activeSession.id,
        versionId: currentVersion.id,
        assetURL: currentAsset.url
      });
      onPlatformChange({
        workspace: updated,
        metrics:
          platformSnapshot?.metrics ??
          (await getEditPlatformSnapshot()).metrics
      });
    }, "当前版本已加入品牌素材库。");
  }

  return (
    <div className="edit-inspector-scroll">
      <section className="edit-inspector-section">
        <div className="edit-inspector-section-head">
          <div>
            <span>本轮预估</span>
            <strong>{costPreview?.estimatedCostText ?? "暂不可计算"}</strong>
          </div>
          <button
            className="icon-button subtle"
            onClick={() => void refreshPlatform()}
            title="刷新运营数据"
            type="button"
          >
            <RefreshCw size={15} />
          </button>
        </div>
        <div className="edit-cost-grid">
          <span>单价<strong>{costPreview?.unitPriceText ?? "未知"}</strong></span>
          <span>最坏情况<strong>{costPreview?.worstCaseCostText ?? "未知"}</strong></span>
          <span>候选数<strong>{costPreview?.candidateCount ?? 0}</strong></span>
        </div>
        {costPreview?.riskText && <p>{costPreview.riskText}</p>}
      </section>

      {metrics && (
        <section className="edit-inspector-section">
          <div className="edit-inspector-section-head">
            <div>
              <span>工作区指标</span>
              <strong>{workspace?.name ?? "本地工作区"}</strong>
            </div>
          </div>
          <div className="edit-metrics-grid">
            <span>成功率<strong>{formatPercent(metrics.successRate)}</strong></span>
            <span>重试率<strong>{formatPercent(metrics.retryRate)}</strong></span>
            <span>检出率<strong>{formatPercent(metrics.checkoutRate)}</strong></span>
            <span>平均耗时<strong>{formatDuration(metrics.averageDurationMs)}</strong></span>
            <span>今日候选<strong>{metrics.dailyCandidatesUsed}/{metrics.quota.dailyCandidateLimit}</strong></span>
            <span>存储<strong>{formatBytes(metrics.storageBytes)}</strong></span>
          </div>
          <div className="edit-provider-health">
            {metrics.providerHealth.map((provider) => (
              <div key={provider.provider}>
                <span
                  className={`is-${provider.state}`}
                  title={`成功 ${provider.successes} / 失败 ${provider.failures}`}
                />
                <strong>{provider.provider}</strong>
                <small>{formatProviderState(provider.state)}</small>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="edit-inspector-section">
        <div className="edit-inspector-section-head">
          <div>
            <span>常用模板</span>
            <strong>{workspace?.templates.length ?? 0} 个</strong>
          </div>
        </div>
        <select
          onChange={(event) => setTemplateId(event.target.value)}
          value={templateId}
        >
          {(workspace?.templates ?? []).map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
        {selectedTemplate && <p>{selectedTemplate.instruction}</p>}
        <div className="edit-inspector-actions">
          <button
            className="primary-action compact-action"
            disabled={!selectedTemplate}
            onClick={() => selectedTemplate && onApplyTemplate(selectedTemplate)}
            title="将所选模板填入修图指令和保护设置"
            type="button"
          >
            <Sparkles size={14} />
            套用模板
          </button>
          <button
            className="secondary-action compact-action"
            onClick={() => void saveTemplate()}
            title="保存一条可重复使用的修图指令模板"
            type="button"
          >
            <Plus size={14} />
            新建模板
          </button>
        </div>
      </section>

      <section className="edit-inspector-section">
        <div className="edit-inspector-section-head">
          <div>
            <span>品牌素材</span>
            <strong>{workspace?.brandAssets.length ?? 0} 个</strong>
          </div>
        </div>
        <div className="edit-brand-assets">
          {(workspace?.brandAssets ?? []).slice(-8).map((asset) => (
            <article key={asset.id}>
              <img alt="" src={asset.assetURL} />
              <span>{asset.name}</span>
            </article>
          ))}
        </div>
        <button
          className="secondary-action compact-action"
          disabled={!currentAsset}
          onClick={() => void saveBrandAsset()}
          title="把当前版本保存为后续可复用的品牌参考素材"
          type="button"
        >
          <ImagePlus size={14} />
          保存当前版本
        </button>
      </section>

      {!platformSnapshot && (
        <button
          className="secondary-action"
          onClick={() => void refreshPlatform()}
          title="加载成本、成功率、模板和品牌素材数据"
          type="button"
        >
          <Activity size={15} />
          读取运营数据
        </button>
      )}
    </div>
  );
}

function CandidateCard({
  activeSession,
  job,
  busy,
  editable,
  onCheckout,
  onPreview,
  onRetry
}: {
  activeSession?: EditSession;
  job: EditJob;
  busy: boolean;
  editable: boolean;
  onCheckout: (version: ImageVersion) => Promise<void>;
  onPreview: (
    asset: EditAsset,
    version: ImageVersion,
    candidateIndex: number
  ) => void;
  onRetry: (job: EditJob) => Promise<void>;
}) {
  const version = activeSession?.versions.find(
    (item) => item.id === job.resultVersionId
  );
  const asset = resolveVersionAsset(activeSession, version);
  const retryable = ["failed", "interrupted", "canceled"].includes(job.status);

  return (
    <article className={`edit-candidate-card is-${job.status}`}>
      <div className="edit-candidate-media">
        {asset && version ? (
          <button
            aria-label={`放大预览候选 ${job.candidateIndex + 1}`}
            className="edit-candidate-preview-trigger"
            onClick={() => onPreview(asset, version, job.candidateIndex)}
            title="点击放大预览候选图片"
            type="button"
          >
            <img alt={`候选 ${job.candidateIndex + 1}`} src={asset.url} />
            <span aria-hidden="true" className="edit-candidate-preview-icon">
              <ZoomIn size={16} />
            </span>
          </button>
        ) : job.status === "running" || job.status === "persisting" ? (
          <LoaderCircle className="spin" size={24} />
        ) : (
          <AlertTriangle size={23} />
        )}
        <span>候选 {job.candidateIndex + 1}</span>
      </div>
      <div className="edit-candidate-actions">
        <span>{formatJobStatus(job.status)}</span>
        {version && (
          <>
            <a
              className="icon-button subtle"
              download
              href={asset?.url}
              title="下载候选"
            >
              <Download size={15} />
            </a>
            <button
              className="secondary-action compact-action"
              disabled={busy || !editable}
              onClick={() => void onCheckout(version)}
              title="将此候选设为当前版本并继续修图"
              type="button"
            >
              <Check size={14} />
              检出
            </button>
          </>
        )}
        {retryable && (
          <button
            className="secondary-action compact-action"
            disabled={busy || !editable}
            onClick={() => void onRetry(job)}
            title="重新生成这个失败或中断的候选"
            type="button"
          >
            <RefreshCw size={14} />
            重试
          </button>
        )}
      </div>
      {job.error && <p>{job.error.message}</p>}
    </article>
  );
}

function createRegionDraft(index: number): RegionDraft {
  return {
    id: crypto.randomUUID(),
    label: `区域 ${index + 1}`,
    color: REGION_COLORS[index % REGION_COLORS.length] ?? "#ff5c5c",
    instruction: "",
    selectionMethod: "brush",
    combinationMode: "add",
    priority: index,
    featherRadius: 4,
    expansionPixels: 0,
    inverted: false,
    semanticTarget: ""
  };
}

async function prepareRegionSubmissions(regions: RegionDraft[]) {
  const sorted = regions
    .slice()
    .sort((left, right) => left.priority - right.priority);
  const loaded = await Promise.all(
    sorted.map(async (region) => {
      const mask = await loadAlphaMaskFromURL(region.maskDataURL!);
      const transformed = transformAlphaMask(mask, {
        expansionPixels: region.expansionPixels,
        featherRadius: region.featherRadius
      });

      return {
        region,
        transformed,
        displayMask: transformAlphaMask(transformed, {
          inverted: region.inverted
        })
      };
    })
  );

  return loaded.map(({ region, displayMask }) => ({
    ...region,
    preparedMaskDataURL: alphaMaskToDataURL(displayMask, {
      color: hexToRGB(region.color)
    })
  }));
}

async function resolveQualitySelectionMask(
  session: EditSession,
  version: ImageVersion,
  models: ModelConfig[],
  width: number,
  height: number
) {
  const turn = session.turns.find((item) => item.id === version.turnId);

  if (!turn || turn.mode !== "local") {
    return undefined;
  }

  const regions = turn.regions
    .slice()
    .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0));

  if (regions.length === 0) {
    throw new Error("局部编辑轮次缺少蒙版，无法计算选区质量指标。");
  }

  const model = models.find((item) => item.id === turn.modelId);
  const nativeMask = model?.editCapabilities.localMode === "native-mask";
  const canonicalSelectionMasks = regions.every(
    (region) => region.maskSemantics === "selection-alpha"
  );

  if (nativeMask && !canonicalSelectionMasks) {
    const maskAsset = session.assets.find(
      (asset) => asset.id === regions[0]?.maskAssetId
    );

    if (!maskAsset) {
      throw new Error("局部编辑的原生蒙版资产不存在。");
    }

    const transparentSelectionMask = await loadAlphaMaskFromURL(maskAsset.url);
    return resizeAlphaMask(
      invertAlphaMask(transparentSelectionMask),
      width,
      height
    );
  }

  const layers = await Promise.all(
    regions.map(async (region) => {
      const maskAsset = session.assets.find(
        (asset) => asset.id === region.maskAssetId
      );

      if (!maskAsset) {
        throw new Error(`区域「${region.label}」的蒙版资产不存在。`);
      }

      return {
        mask: resizeAlphaMask(
          await loadAlphaMaskFromURL(maskAsset.url),
          width,
          height
        ),
        mode: region.combinationMode,
        // Canonical masks are persisted after inversion and edge transforms.
        inverted: false
      };
    })
  );
  const selectionMask = composeMaskLayers(layers);

  if (!selectionMask) {
    throw new Error("无法复原局部编辑的有效选区。");
  }

  return selectionMask;
}

function buildAnalysisInput(
  instruction: string,
  mode: EditMode,
  regions: RegionDraft[]
): AnalyzeEditInstructionInput {
  return {
    instruction: instruction.trim(),
    mode,
    regions:
      mode === "local"
        ? regions
            .filter((region) => region.maskDataURL)
            .map((region) => ({
              label: region.label,
              instruction: region.instruction
            }))
        : []
  };
}

function toEditImageInput(reference: ReferenceImage): EditImageInput {
  return {
    id: reference.id,
    name: reference.name,
    mimeType: reference.mimeType,
    format: reference.format,
    sizeBytes: reference.sizeBytes,
    width: reference.width,
    height: reference.height,
    base64: reference.base64,
    remoteURL: reference.remoteURL,
    objectKey: reference.objectKey,
    order: reference.order
  };
}

function maskDataURLToEditInput(
  base64: string,
  label: string,
  order: number
): EditImageInput {
  return {
    id: crypto.randomUUID(),
    name: `${label || `region-${order + 1}`}.png`,
    mimeType: "image/png",
    format: "png",
    base64,
    order
  };
}

function resolveVersionAsset(
  session?: EditSession,
  version?: ImageVersion
): EditAsset | undefined {
  return session?.assets.find((asset) => asset.id === version?.assetId);
}

function summarizeSession(session: EditSession): EditSessionSummary {
  const version = session.versions.find(
    (item) => item.id === session.currentVersionId
  );
  const asset = resolveVersionAsset(session, version);

  return {
    id: session.id,
    title: session.title,
    status: session.status,
    defaultModelId: session.defaultModelId,
    currentVersionId: session.currentVersionId,
    currentBranchId: session.currentBranchId,
    thumbnailURL: asset?.url,
    versionCount: session.versions.length,
    turnCount: session.turns.length,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    archivedAt: session.archivedAt
  };
}

function isArchivedSession(
  session: Pick<EditSession, "status" | "archivedAt">
) {
  return session.status === "archived" || Boolean(session.archivedAt);
}

function colorWithAlpha(color: string, alpha: number) {
  const normalized = color.replace("#", "");

  if (!/^[\da-f]{6}$/i.test(normalized)) {
    return `rgba(255, 92, 92, ${alpha})`;
  }

  const value = Number.parseInt(normalized, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function hexToRGB(color: string): [number, number, number] {
  const normalized = color.replace("#", "");

  if (!/^[\da-f]{6}$/i.test(normalized)) {
    return [255, 92, 92];
  }

  const value = Number.parseInt(normalized, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function readScaledMask(
  source: HTMLCanvasElement,
  width: number,
  height: number
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("无法缩放局部合并蒙版。");
  }

  context.drawImage(source, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  return {
    width,
    height,
    data: Uint8ClampedArray.from(
      { length: width * height },
      (_, index) => imageData.data[index * 4 + 3] ?? 0
    )
  };
}

function loadBrowserImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法读取版本图片。"));
    image.src = url;
  });
}

function downloadJSON(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function stripExtension(value: string) {
  return value.replace(/\.[^.]+$/, "").trim();
}

function revokePreviewURL(value: string) {
  if (value.startsWith("blob:")) {
    URL.revokeObjectURL(value);
  }
}

function formatShortTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).format(date);
}

function formatJobStatus(status: EditJob["status"]) {
  const labels: Record<EditJob["status"], string> = {
    queued: "排队中",
    running: "生成中",
    persisting: "保存中",
    succeeded: "可检出",
    failed: "失败",
    canceled: "已取消",
    interrupted: "已中断"
  };

  return labels[status];
}

function formatContinuationStrategy(
  strategy: NonNullable<EditTurn["continuationStrategy"]>
) {
  const labels: Record<
    NonNullable<EditTurn["continuationStrategy"]>,
    string
  > = {
    "openai-response": "原生续聊",
    "gemini-context": "上下文续聊",
    reference: "参考图续聊",
    "annotated-reference": "标注参考"
  };
  return labels[strategy];
}

function formatSharePermission(permission: EditSharePermission) {
  return {
    view: "仅查看",
    comment: "可评论",
    edit: "可编辑"
  }[permission];
}

function formatReviewState(state?: ImageVersion["reviewState"]) {
  const labels: Record<NonNullable<ImageVersion["reviewState"]>, string> = {
    draft: "草稿",
    in_review: "审核中",
    approved: "已批准",
    changes_requested: "需修改",
    published: "已发布"
  };
  return state ? labels[state] : "草稿";
}

function formatWorkflowState(
  state: NonNullable<EditSession["workflow"]>["state"]
) {
  const labels: Record<typeof state, string> = {
    draft: "草稿",
    in_review: "审核中",
    changes_requested: "需修改",
    approved: "已批准",
    published: "已发布"
  };
  return labels[state];
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatDuration(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 秒";
  }

  return value >= 1000
    ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} 秒`
    : `${Math.round(value)} 毫秒`;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(value) / Math.log(1024))
  );
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatProviderState(
  state: EditPlatformSnapshot["metrics"]["providerHealth"][number]["state"]
) {
  return state === "closed"
    ? "正常"
    : state === "half_open"
      ? "试探恢复"
      : "熔断";
}
