import {
  AlertTriangle,
  Check,
  Download,
  History,
  Images,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
  WandSparkles
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  EndpointOverride,
  GenerationParams,
  GenerationSet,
  GenerationSlotKind,
  GenerationSuiteOptions,
  GenerationSuiteStatus,
  GenerationSuiteTemplate,
  GenerationSuiteTemplateId,
  ModelConfig,
  ModelRequestOverride,
  SharedVisualSpec,
  SuiteReferenceInput,
  SuiteReferenceRole
} from "../../domain";
import { SUITE_GENERATION_LIMITS } from "../../domain";
import {
  GENERATION_SUITE_TEMPLATES
} from "../../services/suite-generation-service";
import {
  cancelGenerationSuite,
  createGenerationSuite,
  deleteGenerationSuite,
  GenerationSuiteApiError,
  getGenerationSuite,
  listGenerationSuites,
  listGenerationSuiteTemplates,
  retryGenerationSuiteSlot,
  selectGenerationSuiteAnchor,
  startGenerationSuite,
  subscribeGenerationSuiteEvents
} from "../../services/suite-generation-api-service";
import {
  createReferenceImageWithBase64,
  formatFileSize,
  validateReferenceImageFiles
} from "../../services/upload-service";

type GenerationSuiteWorkbenchProps = {
  models: ModelConfig[];
  selectedModel?: ModelConfig;
  selectedModelId: string;
  params: GenerationParams;
  endpointOverride?: EndpointOverride;
  modelOverride?: ModelRequestOverride;
  onSelectModel: (modelId: string) => void;
  onParamsChange: (params: GenerationParams) => void;
};

type SuiteFormSlot = {
  key: string;
  kind: GenerationSlotKind;
  title: string;
  description: string;
  scenePrompt: string;
  negativePrompt?: string;
  candidateCount: number;
};

type SuiteReferenceDraft = SuiteReferenceInput & {
  previewURL: string;
};

type SuiteFeedback = {
  kind: "success" | "error" | "info";
  message: string;
};

const REFERENCE_ROLE_OPTIONS: Array<{
  value: SuiteReferenceRole;
  label: string;
}> = [
  { value: "subject", label: "主体" },
  { value: "style", label: "风格" },
  { value: "logo", label: "Logo" },
  { value: "composition", label: "构图" },
  { value: "background", label: "背景" }
];

const DEFAULT_SUITE_OPTIONS: GenerationSuiteOptions = {
  requireAnchorConfirmation: true,
  autoSelectFirstAnchor: false,
  perSuiteConcurrency: SUITE_GENERATION_LIMITS.defaultPerSuiteConcurrency
};

const LIVE_SUITE_STATUSES = new Set<GenerationSuiteStatus>([
  "queued",
  "generating_anchor",
  "awaiting_anchor",
  "generating_scenes"
]);

export function GenerationSuiteWorkbench({
  models,
  selectedModel,
  selectedModelId,
  params,
  endpointOverride,
  modelOverride,
  onSelectModel,
  onParamsChange
}: GenerationSuiteWorkbenchProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const referencesRef = useRef<SuiteReferenceDraft[]>([]);
  const initialTemplate = GENERATION_SUITE_TEMPLATES[0];
  const [templates, setTemplates] = useState<GenerationSuiteTemplate[]>([
    ...GENERATION_SUITE_TEMPLATES
  ]);
  const [templateId, setTemplateId] = useState<GenerationSuiteTemplateId>(initialTemplate.id);
  const [suiteName, setSuiteName] = useState("");
  const [sharedSpec, setSharedSpec] = useState<SharedVisualSpec>(() =>
    cloneSharedSpec(initialTemplate.defaultSpec)
  );
  const [slots, setSlots] = useState<SuiteFormSlot[]>(() => createFormSlots(initialTemplate));
  const [options, setOptions] = useState<GenerationSuiteOptions>(DEFAULT_SUITE_OPTIONS);
  const [references, setReferences] = useState<SuiteReferenceDraft[]>([]);
  const [history, setHistory] = useState<GenerationSet[]>([]);
  const [activeSuite, setActiveSuite] = useState<GenerationSet | undefined>();
  const [busyAction, setBusyAction] = useState<string>();
  const [feedback, setFeedback] = useState<SuiteFeedback>();
  const [streamState, setStreamState] = useState<"idle" | "connected" | "reconnecting">("idle");
  const [loadingInitialData, setLoadingInitialData] = useState(true);

  useEffect(() => {
    referencesRef.current = references;
  }, [references]);

  useEffect(() => {
    return () => {
      referencesRef.current.forEach((reference) => revokePreviewURL(reference.previewURL));
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    Promise.allSettled([listGenerationSuiteTemplates(), listGenerationSuites(40)])
      .then(([templateResult, historyResult]) => {
        if (!mounted) {
          return;
        }

        if (templateResult.status === "fulfilled" && templateResult.value.length > 0) {
          setTemplates(templateResult.value);
        }

        if (historyResult.status === "fulfilled") {
          setHistory(historyResult.value);
          setActiveSuite((current) => current ?? historyResult.value[0]);
        }

        if (templateResult.status === "rejected" && historyResult.status === "rejected") {
          setFeedback({
            kind: "error",
            message: "套图服务暂时不可用，请确认 BFF 已启动。"
          });
        }
      })
      .finally(() => {
        if (mounted) {
          setLoadingInitialData(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!feedback) {
      return;
    }

    const timer = window.setTimeout(() => setFeedback(undefined), 3600);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    if (!activeSuite || !LIVE_SUITE_STATUSES.has(activeSuite.status)) {
      setStreamState("idle");
      return;
    }

    setStreamState("reconnecting");
    const unsubscribe = subscribeGenerationSuiteEvents(activeSuite.id, {
      onOpen: () => setStreamState("connected"),
      onEvent: (event) => {
        setStreamState("connected");

        if (event.type === "suite.deleted") {
          setHistory((current) => current.filter((suite) => suite.id !== event.suiteId));
          setActiveSuite((current) => current?.id === event.suiteId ? undefined : current);
          return;
        }

        if (event.suite) {
          syncSuite(event.suite);
        }
      },
      onError: () => setStreamState("reconnecting")
    });

    return unsubscribe;
  }, [activeSuite?.id, activeSuite?.status]);

  const activeTemplate =
    templates.find((template) => template.id === templateId) ?? templates[0] ?? initialTemplate;
  const candidateTotal = slots.reduce((sum, slot) => sum + slot.candidateCount, 0);
  const referenceLimit = Math.min(
    selectedModel?.capabilities.maxReferenceImages ?? 0,
    SUITE_GENERATION_LIMITS.maxReferences
  );
  const sceneUserReferenceLimit = Math.max(0, referenceLimit - 1);
  const modelSupportsSuites = Boolean(
    selectedModel?.capabilities.supportsImageToImage &&
      (selectedModel?.capabilities.maxReferenceImages ?? 0) > 0
  );
  const referencesExceedModelLimit =
    modelSupportsSuites && references.length > referenceLimit;
  const canCreateSuite =
    modelSupportsSuites &&
    !referencesExceedModelLimit &&
    slots.length >= SUITE_GENERATION_LIMITS.minSlots &&
    slots.length <= SUITE_GENERATION_LIMITS.maxSlots &&
    candidateTotal <= SUITE_GENERATION_LIMITS.maxTotalCandidates &&
    Boolean(sharedSpec.subject.trim() || references.some((reference) => reference.role === "subject"));
  const activeAnchorSlot = activeSuite?.slots.find((slot) => slot.id === activeSuite.anchorSlotId);
  const isActiveSuiteLive = Boolean(activeSuite && LIVE_SUITE_STATUSES.has(activeSuite.status));
  const canStartActiveSuite = Boolean(
    activeSuite &&
      ["draft", "failed", "partial_success", "interrupted", "cancelled"].includes(activeSuite.status)
  );

  function syncSuite(suite: GenerationSet) {
    setActiveSuite(suite);
    setHistory((current) => [
      suite,
      ...current.filter((item) => item.id !== suite.id)
    ].slice(0, 40));
  }

  function applyTemplate(nextTemplateId: GenerationSuiteTemplateId) {
    const template = templates.find((item) => item.id === nextTemplateId);

    if (!template) {
      return;
    }

    setTemplateId(nextTemplateId);
    setSharedSpec(cloneSharedSpec(template.defaultSpec));
    setSlots(createFormSlots(template));
    setSuiteName("");
  }

  function updateSharedSpec<Key extends keyof SharedVisualSpec>(
    key: Key,
    value: SharedVisualSpec[Key]
  ) {
    setSharedSpec((current) => ({
      ...current,
      [key]: value
    }));
  }

  function updateSlot(slotKey: string, patch: Partial<SuiteFormSlot>) {
    setSlots((current) =>
      current.map((slot) => (slot.key === slotKey ? { ...slot, ...patch } : slot))
    );
  }

  function addSceneSlot() {
    if (slots.length >= SUITE_GENERATION_LIMITS.maxSlots) {
      return;
    }

    setSlots((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        kind: "scene",
        title: `场景 ${current.length}`,
        description: "自定义套图场景",
        scenePrompt: "保持主体、风格、材质与主视觉锚点一致，生成新的场景画面。",
        candidateCount: 1
      }
    ]);
  }

  function removeSceneSlot(slotKey: string) {
    setSlots((current) => {
      if (current.length <= SUITE_GENERATION_LIMITS.minSlots) {
        return current;
      }

      return current.filter((slot) => slot.key !== slotKey || slot.kind === "anchor");
    });
  }

  async function handleReferenceFiles(fileList: FileList | File[]) {
    if (!selectedModel) {
      return;
    }

    const validation = validateReferenceImageFiles(
      Array.from(fileList),
      selectedModel.capabilities,
      references.length
    );

    if (validation.issues.length > 0) {
      setFeedback({
        kind: "error",
        message: validation.issues[0]?.message ?? "参考图校验失败"
      });
    }

    if (validation.acceptedFiles.length === 0) {
      return;
    }

    setBusyAction("upload");

    try {
      const uploaded = await Promise.all(
        validation.acceptedFiles.map((file, index) =>
          createReferenceImageWithBase64(file, references.length + index)
        )
      );
      const hasSubject = references.some((reference) => reference.role === "subject");
      const nextReferences = uploaded.map((image, index): SuiteReferenceDraft => ({
        id: image.id,
        role: !hasSubject && index === 0 ? "subject" : "style",
        name: image.name,
        mimeType: image.mimeType,
        format: image.format,
        sizeBytes: image.sizeBytes,
        width: image.width,
        height: image.height,
        base64: image.base64,
        remoteURL: image.remoteURL,
        order: references.length + index,
        previewURL: image.previewURL
      }));

      setReferences((current) => [...current, ...nextReferences]);
      setFeedback({
        kind: "success",
        message: `已加入 ${nextReferences.length} 张参考图`
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "读取参考图失败"
      });
    } finally {
      setBusyAction(undefined);
    }
  }

  function removeReference(id: string) {
    setReferences((current) => {
      const removed = current.find((reference) => reference.id === id);

      if (removed) {
        revokePreviewURL(removed.previewURL);
      }

      return current
        .filter((reference) => reference.id !== id)
        .map((reference, order) => ({ ...reference, order }));
    });
  }

  async function handleCreateSuite() {
    if (!selectedModel || !canCreateSuite) {
      setFeedback({
        kind: "error",
        message: referencesExceedModelLimit
          ? `当前模型最多支持 ${referenceLimit} 张参考图，请先删除多余图片。`
          : modelSupportsSuites
            ? "请填写主体或上传主体参考图，并检查场景数量。"
            : "请选择支持参考图的图片模型。"
      });
      return;
    }

    setBusyAction("create");

    try {
      const suite = await createGenerationSuite({
        name: suiteName.trim() || undefined,
        templateId,
        modelId: selectedModel.id,
        modelDisplayName: selectedModel.displayName,
        modelOverride,
        endpointOverride,
        params: {
          ...params,
          count: 1
        },
        sharedSpec: normalizeSharedSpec(sharedSpec),
        referenceImages: references.map(({ previewURL: _previewURL, ...reference }) => reference),
        options,
        slots: slots.map((slot) => ({
          kind: slot.kind,
          title: slot.title,
          description: slot.description,
          scenePrompt: slot.scenePrompt,
          negativePrompt: slot.negativePrompt,
          candidateCount: slot.candidateCount
        }))
      });

      syncSuite(suite);
      setFeedback({
        kind: "success",
        message: "套图草稿已创建，可以开始生成。"
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: suiteErrorMessage(error, "创建套图失败")
      });
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleStartSuite() {
    if (!activeSuite) {
      return;
    }

    await runSuiteAction("start", "套图已进入生成队列", () =>
      startGenerationSuite(activeSuite.id, {
        endpointOverride,
        modelOverride
      })
    );
  }

  async function handleSelectAnchor(imageId: string) {
    if (!activeSuite) {
      return;
    }

    await runSuiteAction("anchor", "主视觉已确认，场景生成已开始", () =>
      selectGenerationSuiteAnchor(activeSuite.id, {
        imageId,
        endpointOverride,
        modelOverride
      })
    );
  }

  async function handleRetrySlot(slotId: string, slotKind: GenerationSlotKind) {
    if (!activeSuite) {
      return;
    }

    await runSuiteAction(
      `retry:${slotId}`,
      slotKind === "anchor" ? "锚点已重新进入队列" : "场景已重新进入队列",
      () =>
        retryGenerationSuiteSlot(activeSuite.id, slotId, {
          endpointOverride,
          modelOverride
        })
    );
  }

  async function handleCancelSuite() {
    if (!activeSuite) {
      return;
    }

    await runSuiteAction("cancel", "套图任务已取消", () =>
      cancelGenerationSuite(activeSuite.id)
    );
  }

  async function handleDeleteSuite() {
    if (!activeSuite || !window.confirm(`删除套图“${activeSuite.name}”？`)) {
      return;
    }

    setBusyAction("delete");

    try {
      await deleteGenerationSuite(activeSuite.id);
      const remaining = history.filter((suite) => suite.id !== activeSuite.id);
      setHistory(remaining);
      setActiveSuite(remaining[0]);
      setFeedback({ kind: "success", message: "套图记录已删除" });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: suiteErrorMessage(error, "删除套图失败")
      });
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleRefresh() {
    setBusyAction("refresh");

    try {
      const [nextHistory, nextActive] = await Promise.all([
        listGenerationSuites(40),
        activeSuite ? getGenerationSuite(activeSuite.id).catch(() => undefined) : Promise.resolve(undefined)
      ]);

      setHistory(nextHistory);
      setActiveSuite(nextActive ?? nextHistory[0]);
      setFeedback({ kind: "success", message: "套图状态已刷新" });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: suiteErrorMessage(error, "刷新套图失败")
      });
    } finally {
      setBusyAction(undefined);
    }
  }

  async function runSuiteAction(
    action: string,
    successMessage: string,
    work: () => Promise<GenerationSet>
  ) {
    setBusyAction(action);

    try {
      const suite = await work();
      syncSuite(suite);
      setFeedback({ kind: "success", message: successMessage });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: suiteErrorMessage(error, "套图操作失败")
      });
    } finally {
      setBusyAction(undefined);
    }
  }

  return (
    <div className="suite-workbench">
      <section className="panel suite-builder-panel" aria-label="套图配置">
        <header className="suite-panel-heading">
          <div>
            <span>Suite Builder</span>
            <h2>一致性配置</h2>
          </div>
          <strong>{candidateTotal} 张候选</strong>
        </header>

        <div className="suite-template-grid" aria-label="套图模板">
          {templates.map((template) => (
            <button
              className={`suite-template-button${template.id === templateId ? " is-active" : ""}`}
              key={template.id}
              onClick={() => applyTemplate(template.id)}
              type="button"
            >
              <strong>{template.name}</strong>
              <span>{template.recommendedFor}</span>
            </button>
          ))}
        </div>

        <label className="field">
          <span>套图名称</span>
          <input
            onChange={(event) => setSuiteName(event.target.value)}
            placeholder={`${activeTemplate.name} ${new Date().toISOString().slice(0, 10)}`}
            value={suiteName}
          />
        </label>

        <div className="suite-parameter-grid">
          <label className="field suite-field-wide">
            <span>模型</span>
            <select onChange={(event) => onSelectModel(event.target.value)} value={selectedModelId}>
              {models.map((model) => (
                <option
                  disabled={
                    !model.capabilities.supportsImageToImage ||
                    model.capabilities.maxReferenceImages < 1
                  }
                  key={model.id}
                  value={model.id}
                >
                  {model.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>尺寸</span>
            <select
              onChange={(event) =>
                onParamsChange({
                  ...params,
                  ratio: event.target.value as GenerationParams["ratio"]
                })
              }
              value={params.ratio}
            >
              {selectedModel?.capabilities.ratios.map((option) => (
                <option disabled={!option.enabled} key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>分辨率</span>
            <select
              onChange={(event) =>
                onParamsChange({
                  ...params,
                  resolution: event.target.value as GenerationParams["resolution"]
                })
              }
              value={params.resolution}
            >
              {selectedModel?.capabilities.resolutions.map((option) => (
                <option disabled={!option.enabled} key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>质量</span>
            <select
              onChange={(event) =>
                onParamsChange({
                  ...params,
                  quality: event.target.value as GenerationParams["quality"]
                })
              }
              value={params.quality}
            >
              {selectedModel?.capabilities.qualities.map((option) => (
                <option disabled={!option.enabled} key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {selectedModel && selectedModel.capabilities.outputFormats.length > 1 && (
            <label className="field">
              <span>格式</span>
              <select
                onChange={(event) =>
                  onParamsChange({
                    ...params,
                    outputFormat: event.target.value as GenerationParams["outputFormat"]
                  })
                }
                value={params.outputFormat ?? selectedModel.capabilities.outputFormats[0]}
              >
                {selectedModel.capabilities.outputFormats.map((format) => (
                  <option key={format} value={format}>
                    {format.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <details className="suite-config-section" open>
          <summary>
            <span>视觉基准</span>
            <strong>主体与风格</strong>
          </summary>
          <div className="suite-config-body">
            <label className="field">
              <span>主体</span>
              <textarea
                onChange={(event) => updateSharedSpec("subject", event.target.value)}
                placeholder="人物、产品、角色或品牌主体"
                rows={3}
                value={sharedSpec.subject}
              />
            </label>
            <label className="field">
              <span>统一风格</span>
              <textarea
                onChange={(event) => updateSharedSpec("style", event.target.value)}
                rows={3}
                value={sharedSpec.style}
              />
            </label>
            <div className="suite-spec-grid">
              <label className="field">
                <span>配色</span>
                <textarea
                  onChange={(event) => updateSharedSpec("palette", event.target.value)}
                  rows={3}
                  value={sharedSpec.palette}
                />
              </label>
              <label className="field">
                <span>光线</span>
                <textarea
                  onChange={(event) => updateSharedSpec("lighting", event.target.value)}
                  rows={3}
                  value={sharedSpec.lighting}
                />
              </label>
              <label className="field">
                <span>镜头</span>
                <textarea
                  onChange={(event) => updateSharedSpec("camera", event.target.value)}
                  rows={3}
                  value={sharedSpec.camera}
                />
              </label>
              <label className="field">
                <span>构图</span>
                <textarea
                  onChange={(event) => updateSharedSpec("composition", event.target.value)}
                  rows={3}
                  value={sharedSpec.composition}
                />
              </label>
            </div>
          </div>
        </details>

        <details className="suite-config-section" open>
          <summary>
            <span>一致性规则</span>
            <strong>{sharedSpec.continuityRules.length} 条</strong>
          </summary>
          <div className="suite-config-body">
            <label className="field">
              <span>每行一条规则</span>
              <textarea
                onChange={(event) =>
                  updateSharedSpec(
                    "continuityRules",
                    event.target.value.split("\n")
                  )
                }
                rows={5}
                value={sharedSpec.continuityRules.join("\n")}
              />
            </label>
            <label className="field">
              <span>排除内容</span>
              <textarea
                onChange={(event) => updateSharedSpec("negativePrompt", event.target.value)}
                rows={3}
                value={sharedSpec.negativePrompt ?? ""}
              />
            </label>
          </div>
        </details>

        <details className="suite-config-section" open>
          <summary>
            <span>参考图</span>
            <strong>{references.length}/{referenceLimit}</strong>
          </summary>
          <div className="suite-config-body">
            <div
              className={`suite-upload-zone${busyAction === "upload" ? " is-busy" : ""}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void handleReferenceFiles(event.dataTransfer.files);
              }}
            >
              <input
                accept="image/jpeg,image/png"
                hidden
                multiple
                onChange={(event) => {
                  if (event.target.files) {
                    void handleReferenceFiles(event.target.files);
                    event.target.value = "";
                  }
                }}
                ref={fileInputRef}
                type="file"
              />
              {busyAction === "upload" ? <LoaderCircle className="is-spinning" size={20} /> : <Upload size={20} />}
              <div>
                <strong>上传角色参考图</strong>
                <span>场景阶段可使用 {sceneUserReferenceLimit} 张用户参考 + 1 张锚点</span>
              </div>
              <button
                className="secondary-action compact-action"
                disabled={!selectedModel || references.length >= referenceLimit || busyAction === "upload"}
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                <Plus size={15} />
                添加
              </button>
            </div>

            {references.length > 0 && (
              <div className="suite-reference-list">
                {references.map((reference) => (
                  <div className="suite-reference-item" key={reference.id}>
                    <img alt="" src={reference.previewURL} />
                    <div>
                      <strong>{reference.name}</strong>
                      <span>{reference.sizeBytes ? formatFileSize(reference.sizeBytes) : reference.format}</span>
                    </div>
                    <select
                      aria-label={`${reference.name} 的参考角色`}
                      onChange={(event) =>
                        setReferences((current) =>
                          current.map((item) =>
                            item.id === reference.id
                              ? { ...item, role: event.target.value as SuiteReferenceRole }
                              : item
                          )
                        )
                      }
                      value={reference.role}
                    >
                      {REFERENCE_ROLE_OPTIONS.map((role) => (
                        <option key={role.value} value={role.value}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                    <button
                      aria-label={`删除 ${reference.name}`}
                      className="icon-button"
                      onClick={() => removeReference(reference.id)}
                      title="删除参考图"
                      type="button"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>

        <details className="suite-config-section" open>
          <summary>
            <span>场景槽位</span>
            <strong>{slots.length}/{SUITE_GENERATION_LIMITS.maxSlots}</strong>
          </summary>
          <div className="suite-config-body">
            <div className="suite-slot-editor-list">
              {slots.map((slot, index) => (
                <article className={`suite-slot-editor${slot.kind === "anchor" ? " is-anchor" : ""}`} key={slot.key}>
                  <header>
                    <span>{slot.kind === "anchor" ? "锚点" : `场景 ${index}`}</span>
                    <div>
                      <label>
                        <span>候选</span>
                        <select
                          aria-label={`${slot.title} 候选数`}
                          onChange={(event) =>
                            updateSlot(slot.key, {
                              candidateCount: Number(event.target.value)
                            })
                          }
                          value={slot.candidateCount}
                        >
                          {Array.from(
                            { length: SUITE_GENERATION_LIMITS.maxCandidatesPerSlot },
                            (_, candidateIndex) => candidateIndex + 1
                          ).map((count) => (
                            <option key={count} value={count}>
                              {count}
                            </option>
                          ))}
                        </select>
                      </label>
                      {slot.kind === "scene" && (
                        <button
                          aria-label={`删除 ${slot.title}`}
                          className="icon-button"
                          disabled={slots.length <= SUITE_GENERATION_LIMITS.minSlots}
                          onClick={() => removeSceneSlot(slot.key)}
                          title="删除场景"
                          type="button"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </header>
                  <input
                    aria-label={`${slot.kind === "anchor" ? "锚点" : "场景"}标题`}
                    onChange={(event) => updateSlot(slot.key, { title: event.target.value })}
                    value={slot.title}
                  />
                  <textarea
                    aria-label={`${slot.title}生成任务`}
                    onChange={(event) => updateSlot(slot.key, { scenePrompt: event.target.value })}
                    rows={3}
                    value={slot.scenePrompt}
                  />
                </article>
              ))}
            </div>
            <button
              className="secondary-action suite-add-scene"
              disabled={
                slots.length >= SUITE_GENERATION_LIMITS.maxSlots ||
                candidateTotal >= SUITE_GENERATION_LIMITS.maxTotalCandidates
              }
              onClick={addSceneSlot}
              type="button"
            >
              <Plus size={15} />
              添加场景
            </button>
            {candidateTotal > SUITE_GENERATION_LIMITS.maxTotalCandidates && (
              <div className="suite-inline-alert is-error">
                <AlertTriangle size={15} />
                候选图总数不能超过 {SUITE_GENERATION_LIMITS.maxTotalCandidates} 张
              </div>
            )}
          </div>
        </details>

        <div className="suite-option-grid">
          <label className="suite-toggle-row">
            <input
              checked={options.requireAnchorConfirmation}
              onChange={(event) =>
                setOptions((current) => ({
                  ...current,
                  requireAnchorConfirmation: event.target.checked,
                  autoSelectFirstAnchor: event.target.checked
                    ? false
                    : current.autoSelectFirstAnchor
                }))
              }
              type="checkbox"
            />
            <span>
              <strong>人工确认锚点</strong>
              <small>锚点完成后暂停</small>
            </span>
          </label>
          <label className="suite-toggle-row">
            <input
              checked={options.autoSelectFirstAnchor}
              disabled={options.requireAnchorConfirmation}
              onChange={(event) =>
                setOptions((current) => ({
                  ...current,
                  autoSelectFirstAnchor: event.target.checked
                }))
              }
              type="checkbox"
            />
            <span>
              <strong>自动选择首张</strong>
              <small>无需确认时生效</small>
            </span>
          </label>
          <label className="field suite-concurrency-field">
            <span>单套并发</span>
            <select
              onChange={(event) =>
                setOptions((current) => ({
                  ...current,
                  perSuiteConcurrency: Number(event.target.value)
                }))
              }
              value={options.perSuiteConcurrency}
            >
              {Array.from(
                { length: SUITE_GENERATION_LIMITS.maxPerSuiteConcurrency },
                (_, index) => index + 1
              ).map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!modelSupportsSuites && selectedModel && (
          <div className="suite-inline-alert is-error">
            <AlertTriangle size={15} />
            当前模型不支持参考图，无法维持跨场景一致性
          </div>
        )}
        {referencesExceedModelLimit && (
          <div className="suite-inline-alert is-error">
            <AlertTriangle size={15} />
            当前模型最多支持 {referenceLimit} 张参考图，请删除 {references.length - referenceLimit} 张后创建
          </div>
        )}

        <button
          className="primary-action suite-create-action"
          disabled={!canCreateSuite || Boolean(busyAction)}
          onClick={handleCreateSuite}
          type="button"
        >
          {busyAction === "create" ? (
            <LoaderCircle className="is-spinning" size={18} />
          ) : (
            <WandSparkles size={18} />
          )}
          创建套图草稿
        </button>
      </section>

      <section className="panel suite-monitor-panel" aria-label="套图生成与结果">
        <header className="suite-monitor-header">
          <div>
            <span>Generation Set</span>
            <h2>{activeSuite?.name ?? "套图任务"}</h2>
          </div>
          <div className="suite-monitor-tools">
            {activeSuite && (
              <span className={`suite-status-badge status-${activeSuite.status}`}>
                {suiteStatusLabel(activeSuite.status)}
              </span>
            )}
            <button
              aria-label="刷新套图状态"
              className="icon-button"
              disabled={busyAction === "refresh"}
              onClick={handleRefresh}
              title="刷新"
              type="button"
            >
              <RefreshCw className={busyAction === "refresh" ? "is-spinning" : undefined} size={16} />
            </button>
          </div>
        </header>

        {feedback && (
          <div className={`suite-feedback is-${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>
            {feedback.kind === "error" ? <AlertTriangle size={16} /> : <Check size={16} />}
            <span>{feedback.message}</span>
          </div>
        )}

        <div className="suite-history-strip">
          <div className="suite-history-title">
            <History size={16} />
            <span>最近套图</span>
            <strong>{history.length}</strong>
          </div>
          <div className="suite-history-list">
            {history.slice(0, 10).map((suite) => (
              <button
                className={suite.id === activeSuite?.id ? "is-active" : undefined}
                key={suite.id}
                onClick={() => setActiveSuite(suite)}
                type="button"
              >
                <strong>{suite.name}</strong>
                <span>{suiteStatusLabel(suite.status)} · {formatSuiteDate(suite.updatedAt)}</span>
              </button>
            ))}
            {!loadingInitialData && history.length === 0 && <span className="suite-history-empty">暂无记录</span>}
          </div>
        </div>

        {!activeSuite ? (
          <div className="suite-empty-state">
            <Images size={42} />
            <strong>{loadingInitialData ? "正在加载套图记录" : "尚未创建套图"}</strong>
            <span>{loadingInitialData ? "请稍候" : "完成左侧配置后创建草稿"}</span>
          </div>
        ) : (
          <div className="suite-monitor-content">
            <section className="suite-progress-panel">
              <div className="suite-progress-head">
                <div>
                  <strong>{activeSuite.progress.percent}%</strong>
                  <span>
                    {activeSuite.progress.completedSlots}/{activeSuite.progress.totalSlots} 个槽位完成
                  </span>
                </div>
                <div className={`suite-stream-state is-${streamState}`}>
                  <span />
                  {streamState === "connected"
                    ? "实时连接"
                    : streamState === "reconnecting"
                      ? "正在重连"
                      : "静态状态"}
                </div>
              </div>
              <div className="suite-progress-track" aria-label={`套图进度 ${activeSuite.progress.percent}%`}>
                <span style={{ width: `${activeSuite.progress.percent}%` }} />
              </div>
              <div className="suite-progress-facts">
                <span>候选 {activeSuite.progress.completedCandidates}/{activeSuite.progress.totalCandidates}</span>
                <span>运行 {activeSuite.progress.runningSlots}</span>
                <span>排队 {activeSuite.progress.queuedSlots}</span>
                <span>失败 {activeSuite.progress.failedSlots}</span>
              </div>
            </section>

            <div className="suite-run-toolbar">
              {canStartActiveSuite && (
                <button
                  className="primary-action compact-action"
                  disabled={Boolean(busyAction)}
                  onClick={handleStartSuite}
                  type="button"
                >
                  {busyAction === "start" ? (
                    <LoaderCircle className="is-spinning" size={16} />
                  ) : (
                    <Play size={16} />
                  )}
                  开始生成
                </button>
              )}
              {isActiveSuiteLive && (
                <button
                  className="secondary-action compact-action"
                  disabled={Boolean(busyAction)}
                  onClick={handleCancelSuite}
                  type="button"
                >
                  <Pause size={15} />
                  取消任务
                </button>
              )}
              <button
                className="secondary-action compact-action danger-action"
                disabled={Boolean(busyAction)}
                onClick={handleDeleteSuite}
                type="button"
              >
                <Trash2 size={15} />
                删除
              </button>
              <span className="suite-run-meta">
                {activeSuite.modelDisplayName} · {activeSuite.params.ratio} · {activeSuite.params.resolution}
              </span>
            </div>

            {activeSuite.status === "awaiting_anchor" && activeAnchorSlot && (
              <section className="suite-anchor-review">
                <header>
                  <div>
                    <span>Anchor Review</span>
                    <h3>选择主视觉锚点</h3>
                  </div>
                  <strong>{activeAnchorSlot.images.length} 个候选</strong>
                </header>
                <div className="suite-anchor-grid">
                  {activeAnchorSlot.images.map((image) => (
                    <button
                      className={image.id === activeSuite.selectedAnchorImageId ? "is-selected" : undefined}
                      disabled={busyAction === "anchor"}
                      key={image.id}
                      onClick={() => handleSelectAnchor(image.id)}
                      type="button"
                    >
                      <img alt={`${activeAnchorSlot.title} 候选 ${image.candidateIndex + 1}`} src={image.url} />
                      <span>
                        {image.id === activeSuite.selectedAnchorImageId && <Check size={14} />}
                        选择候选 {image.candidateIndex + 1}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {activeSuite.lastError && (
              <div className="suite-error-panel" role="alert">
                <AlertTriangle size={18} />
                <div>
                  <strong>{activeSuite.lastError.title}</strong>
                  <span>{activeSuite.lastError.message}</span>
                </div>
              </div>
            )}

            <div className="suite-result-grid">
              {activeSuite.slots.map((slot) => (
                <article
                  className={`suite-result-slot status-${slot.status}${slot.kind === "anchor" ? " is-anchor" : ""}`}
                  key={slot.id}
                >
                  <header>
                    <div>
                      <span>{slot.kind === "anchor" ? "主视觉锚点" : `场景 ${slot.order}`}</span>
                      <h3>{slot.title}</h3>
                    </div>
                    <span className={`suite-slot-status status-${slot.status}`}>
                      {slotStatusLabel(slot.status)}
                    </span>
                  </header>
                  <p>{slot.description || slot.scenePrompt}</p>

                  {slot.images.length > 0 ? (
                    <div className="suite-candidate-grid">
                      {slot.images.map((image) => (
                        <div
                          className={`suite-candidate${image.selected ? " is-selected" : ""}`}
                          key={image.id}
                        >
                          <button
                            aria-label={`打开 ${slot.title} 候选 ${image.candidateIndex + 1}`}
                            onClick={() => window.open(image.url, "_blank", "noopener,noreferrer")}
                            type="button"
                          >
                            <img alt={`${slot.title} 候选 ${image.candidateIndex + 1}`} src={image.url} />
                            {image.selected && (
                              <span className="suite-selected-mark">
                                <Check size={14} />
                              </span>
                            )}
                          </button>
                          <div>
                            <span>候选 {image.candidateIndex + 1}</span>
                            <a
                              aria-label={`下载 ${slot.title} 候选 ${image.candidateIndex + 1}`}
                              className="icon-button"
                              download
                              href={image.url}
                              rel="noreferrer"
                              target="_blank"
                              title="下载"
                            >
                              <Download size={14} />
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="suite-slot-placeholder">
                      {slot.status === "running" || slot.status === "queued" ? (
                        <LoaderCircle className="is-spinning" size={22} />
                      ) : (
                        <Images size={22} />
                      )}
                      <span>{slotStatusLabel(slot.status)}</span>
                    </div>
                  )}

                  {["failed", "interrupted"].includes(slot.status) && (
                    <button
                      className="secondary-action compact-action suite-retry-action"
                      disabled={Boolean(busyAction)}
                      onClick={() => handleRetrySlot(slot.id, slot.kind)}
                      type="button"
                    >
                      {busyAction === `retry:${slot.id}` ? (
                        <LoaderCircle className="is-spinning" size={15} />
                      ) : (
                        <RotateCcw size={15} />
                      )}
                      {slot.kind === "anchor" ? "重试锚点" : "重试场景"}
                    </button>
                  )}
                </article>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function createFormSlots(template: GenerationSuiteTemplate): SuiteFormSlot[] {
  return template.slots.map((slot) => ({
    key: slot.key,
    kind: slot.kind,
    title: slot.title,
    description: slot.description,
    scenePrompt: slot.scenePrompt,
    candidateCount: slot.defaultCandidateCount
  }));
}

function cloneSharedSpec(spec: SharedVisualSpec): SharedVisualSpec {
  return {
    ...spec,
    continuityRules: [...spec.continuityRules]
  };
}

function normalizeSharedSpec(spec: SharedVisualSpec): SharedVisualSpec {
  return {
    subject: spec.subject.trim(),
    style: spec.style.trim(),
    palette: spec.palette.trim(),
    lighting: spec.lighting.trim(),
    camera: spec.camera.trim(),
    composition: spec.composition.trim(),
    continuityRules: spec.continuityRules.map((rule) => rule.trim()).filter(Boolean),
    negativePrompt: spec.negativePrompt?.trim() || undefined
  };
}

function suiteErrorMessage(error: unknown, fallback: string) {
  if (error instanceof GenerationSuiteApiError) {
    return error.apiError?.message ?? error.message;
  }

  return error instanceof Error ? error.message : fallback;
}

function suiteStatusLabel(status: GenerationSuiteStatus) {
  const labels: Record<GenerationSuiteStatus, string> = {
    draft: "草稿",
    queued: "排队中",
    generating_anchor: "生成锚点",
    awaiting_anchor: "等待确认",
    generating_scenes: "生成场景",
    completed: "已完成",
    partial_success: "部分完成",
    failed: "失败",
    cancelled: "已取消",
    interrupted: "已中断"
  };

  return labels[status];
}

function slotStatusLabel(status: GenerationSet["slots"][number]["status"]) {
  const labels: Record<GenerationSet["slots"][number]["status"], string> = {
    pending: "待生成",
    queued: "排队中",
    running: "生成中",
    awaiting_selection: "待选择",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
    interrupted: "已中断"
  };

  return labels[status];
}

function formatSuiteDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function revokePreviewURL(value: string) {
  if (value.startsWith("blob:") && typeof URL !== "undefined") {
    URL.revokeObjectURL(value);
  }
}
