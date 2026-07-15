import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ImagePlus,
  LoaderCircle,
  Orbit,
  Rotate3D,
  RotateCcw,
  Settings2,
  Sparkles,
  Upload,
  View
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent
} from "react";
import {
  buildSingleImageCameraPrompt,
  calculateSingleImageOutputSize,
  clampSingleImageCameraDistance,
  clampSingleImageRotationAngle,
  DEFAULT_SINGLE_IMAGE_IMAGE_MODEL,
  DEFAULT_SINGLE_IMAGE_REASONING_MODEL,
  normalizeSingleImageRotationAngle,
  SINGLE_IMAGE_CAMERA_DISTANCE_DEFAULT,
  SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER,
  type SingleImageViewpointAnalysis,
  type SingleImageViewpointResult,
  type XYZRotation
} from "../../domain";
import {
  generateSingleImageViewpoint,
  SingleImageViewpointApiError
} from "../../services/single-image-viewpoint-service";
import {
  SingleImagePoseViewport,
  type SingleImagePoseViewportHandle
} from "./SingleImagePoseViewport";

const DEFAULT_BASE_URL = "https://api.openai.com";
const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ZERO_ROTATION: XYZRotation = { x: 0, y: 0, z: 0 };
const DEFAULT_VIEW_CONSTRAINT_ZH =
  "保持同一主体身份、同一时刻的关节或零件关系、材质、光线与原始场景。XYZ 控制相机围绕主体移动，必须按锁定机位重建新的屏幕朝向、轮廓、可见结构与遮挡；必要时从正面变为侧面、背面、俯视或仰视。禁止的只是新增无关动作或重排零件，不禁止相机运动产生的新投影。";

type CanvasOutpaintWorkbenchProps = {
  apiKey?: string;
  defaultBaseURL?: string;
  defaultEditURL?: string;
  onOpenSettings: () => void;
};

type SourceAsset = {
  dataURL: string;
  fileName: string;
  fileSize: number;
  height: number;
  id: string;
  width: number;
};

type WorkbenchStage =
  | "idle"
  | "reasoning"
  | "rendering"
  | "success"
  | "failed"
  | "cancelled";

type AxisKey = keyof XYZRotation;

const AXES: Array<{
  key: AxisKey;
  label: string;
  name: string;
  description: string;
}> = [
  {
    key: "x",
    label: "X",
    name: "俯仰 Pitch",
    description: "正值抬高相机，生成向下观察的视图"
  },
  {
    key: "y",
    label: "Y",
    name: "偏航 Yaw",
    description: "正值向主体右侧环绕，补全侧面与背面"
  },
  {
    key: "z",
    label: "Z",
    name: "滚转 Roll",
    description: "正值顺时针滚转画面，不改变观察距离"
  }
];

const VIEW_PRESETS: Array<{
  label: string;
  rotation: XYZRotation;
}> = [
  { label: "正面", rotation: { x: 0, y: 0, z: 0 } },
  { label: "右前 45°", rotation: { x: 0, y: 45, z: 0 } },
  { label: "右侧 90°", rotation: { x: 0, y: 90, z: 0 } },
  { label: "背面 180°", rotation: { x: 0, y: 180, z: 0 } }
];

const DISTANCE_PRESETS = [
  { label: "远景", value: 1 },
  { label: "中景", value: 5 },
  { label: "特写", value: 8 }
] as const;

export function CanvasOutpaintWorkbench({
  apiKey,
  defaultBaseURL,
  defaultEditURL,
  onOpenSettings
}: CanvasOutpaintWorkbenchProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const viewportRef = useRef<SingleImagePoseViewportHandle | null>(null);
  const guidePreviewTimerRef = useRef<number | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  const [source, setSource] = useState<SourceAsset>();
  const [poseReady, setPoseReady] = useState(false);
  const [rotation, setRotation] = useState<XYZRotation>(ZERO_ROTATION);
  const [cameraDistance, setCameraDistance] = useState(
    SINGLE_IMAGE_CAMERA_DISTANCE_DEFAULT
  );
  const [guidePreview, setGuidePreview] = useState("");
  const [prompt, setPrompt] = useState(DEFAULT_VIEW_CONSTRAINT_ZH);
  const [reasoningModel, setReasoningModel] = useState(
    DEFAULT_SINGLE_IMAGE_REASONING_MODEL
  );
  const [imageModel, setImageModel] = useState(
    DEFAULT_SINGLE_IMAGE_IMAGE_MODEL
  );
  const [apiBaseURL, setApiBaseURL] = useState(() =>
    deriveEndpointRoot(defaultBaseURL)
  );
  const [imageEditURL, setImageEditURL] = useState(defaultEditURL ?? "");
  const [outputSize, setOutputSize] = useState("2048x2048");
  const [stage, setStage] = useState<WorkbenchStage>("idle");
  const [stageMessage, setStageMessage] = useState("");
  const [analysis, setAnalysis] = useState<SingleImageViewpointAnalysis>();
  const [result, setResult] = useState<SingleImageViewpointResult>();
  const [renderPrompt, setRenderPrompt] = useState("");
  const [error, setError] = useState("");
  const cameraPrompt = useMemo(
    () => buildSingleImageCameraPrompt(rotation, cameraDistance),
    [cameraDistance, rotation.x, rotation.y, rotation.z]
  );

  const captureGuidePreview = useCallback(() => {
    if (!poseReady || !source || !viewportRef.current) {
      return "";
    }

    try {
      const guide = viewportRef.current.exportPoseGuide();
      setGuidePreview(guide.image);
      return guide.image;
    } catch {
      return "";
    }
  }, [poseReady, source]);

  useEffect(() => {
    if (defaultBaseURL) {
      setApiBaseURL(deriveEndpointRoot(defaultBaseURL));
    }
  }, [defaultBaseURL]);

  useEffect(() => {
    setImageEditURL(defaultEditURL ?? "");
  }, [defaultEditURL]);

  useEffect(() => {
    if (
      !renderPrompt ||
      renderPrompt.includes(SINGLE_IMAGE_CAMERA_PROTOCOL_MARKER)
    ) {
      return;
    }

    setRenderPrompt("");
    setResult(undefined);
    setAnalysis(undefined);

    if (stage !== "reasoning" && stage !== "rendering") {
      setStage("idle");
      setStageMessage("检测到旧版提示词，已清除，请按当前目标机位重新生成");
    }
  }, [renderPrompt, stage]);

  useEffect(() => {
    if (guidePreviewTimerRef.current !== null) {
      window.clearTimeout(guidePreviewTimerRef.current);
    }

    if (!source || !poseReady) {
      setGuidePreview("");
      return;
    }

    guidePreviewTimerRef.current = window.setTimeout(() => {
      guidePreviewTimerRef.current = null;
      captureGuidePreview();
    }, 180);

    return () => {
      if (guidePreviewTimerRef.current !== null) {
        window.clearTimeout(guidePreviewTimerRef.current);
        guidePreviewTimerRef.current = null;
      }
    };
  }, [
    captureGuidePreview,
    poseReady,
    rotation.x,
    rotation.y,
    rotation.z,
    source
  ]);

  useEffect(
    () => () => {
      const controller = requestAbortRef.current;
      requestAbortRef.current = null;
      controller?.abort();

      if (guidePreviewTimerRef.current !== null) {
        window.clearTimeout(guidePreviewTimerRef.current);
      }
    },
    []
  );

  async function loadImageFile(file?: File) {
    if (!file) {
      return;
    }

    setError("");

    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      setError("请选择 PNG、JPEG 或 WebP 图片。");
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setError("参考图不能超过 20 MB。");
      return;
    }

    try {
      const dataURL = await readFileAsDataURL(file);
      const dimensions = await decodeImageDimensions(dataURL);
      const nextSource = {
        dataURL,
        fileName: file.name,
        fileSize: file.size,
        width: dimensions.width,
        height: dimensions.height,
        id: createRequestId()
      };

      const controller = requestAbortRef.current;
      requestAbortRef.current = null;
      controller?.abort();
      setSource(nextSource);
      setPoseReady(false);
      setRotation(ZERO_ROTATION);
      setCameraDistance(SINGLE_IMAGE_CAMERA_DISTANCE_DEFAULT);
      setGuidePreview("");
      setResult(undefined);
      setAnalysis(undefined);
      setRenderPrompt("");
      setStage("idle");
      setStageMessage("");
      setOutputSize(
        calculateSingleImageOutputSize(
          dimensions.width,
          dimensions.height,
          2048
        )
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "图片无法解码，请更换文件后重试。"
      );
    }
  }

  function handleUploadChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    void loadImageFile(file);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    void loadImageFile(event.dataTransfer.files?.[0]);
  }

  function updateAxis(axis: AxisKey, value: number) {
    if (!Number.isFinite(value)) {
      return;
    }

    invalidateGeneratedOutput();
    setRotation((current) => ({
      ...current,
      [axis]: clampSingleImageRotationAngle(value)
    }));
  }

  function updateRotation(nextRotation: XYZRotation) {
    invalidateGeneratedOutput();
    setRotation(nextRotation);
  }

  function updateCameraDistance(value: number) {
    if (!Number.isFinite(value)) {
      return;
    }

    invalidateGeneratedOutput();
    setCameraDistance(clampSingleImageCameraDistance(value));
  }

  function updateUserPrompt(value: string) {
    invalidateGeneratedOutput();
    setPrompt(value);
  }

  function resetPose() {
    invalidateGeneratedOutput();
    setRotation(ZERO_ROTATION);
    setCameraDistance(SINGLE_IMAGE_CAMERA_DISTANCE_DEFAULT);
  }

  function invalidateGeneratedOutput() {
    setResult(undefined);
    setAnalysis(undefined);
    setRenderPrompt("");

    if (
      stage === "success" ||
      stage === "failed" ||
      stage === "cancelled"
    ) {
      setStage("idle");
      setStageMessage("参数已更新，等待重新生成");
      setError("");
    }
  }

  async function generateViewpoint() {
    if (!source || !poseReady || !viewportRef.current) {
      setError("请先上传参考图，并等待 XYZ 机位视口完成加载。");
      return;
    }

    if (!apiKey) {
      setError("缺少 API Key，请先打开设置保存。");
      return;
    }

    const normalizedReasoningModel = reasoningModel.trim();
    const normalizedImageModel = imageModel.trim();

    if (!normalizedReasoningModel || !normalizedImageModel) {
      setError("空间推理模型和图像模型不能为空。");
      return;
    }

    let guide: ReturnType<SingleImagePoseViewportHandle["exportPoseGuide"]>;

    try {
      guide = viewportRef.current.exportPoseGuide();
      setGuidePreview(guide.image);
    } catch (guideError) {
      setError(
        guideError instanceof Error
          ? guideError.message
          : "目标投影与完整机位图导出失败。"
      );
      return;
    }

    const previousController = requestAbortRef.current;
    requestAbortRef.current = null;
    previousController?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    setError("");
    setResult(undefined);
    setAnalysis(undefined);
    setRenderPrompt("");
    setStage("reasoning");
    setStageMessage(
      `${normalizedReasoningModel} 正在识别主体并推导目标视角的隐藏表面`
    );

    try {
      const nextResult = await generateSingleImageViewpoint(
        {
          requestId: createRequestId(),
          source_image: source.dataURL,
          pose_guide_image: guide.image,
          camera_pose_image: guide.cameraViewImage,
          rotation_degrees: rotation,
          camera_distance: cameraDistance,
          user_prompt: prompt.trim(),
          background_mode: "preserve_scene",
          api_key: apiKey,
          reasoning_model: normalizedReasoningModel,
          image_model: normalizedImageModel,
          output_size: outputSize,
          endpoint_override: {
            baseURL: apiBaseURL.trim() || DEFAULT_BASE_URL,
            editURL: imageEditURL.trim() || undefined
          }
        },
        {
          onStage: (
            nextStage,
            message,
            nextAnalysis,
            _nextCameraPrompt,
            nextRenderPrompt
          ) => {
            if (requestAbortRef.current !== controller) {
              return;
            }

            setStage(nextStage);
            setStageMessage(message);

            if (nextAnalysis) {
              setAnalysis(nextAnalysis);
            }

            if (nextRenderPrompt) {
              setRenderPrompt(nextRenderPrompt);
            }
          }
        },
        controller.signal
      );

      if (requestAbortRef.current !== controller) {
        return;
      }

      setResult(nextResult);
      setAnalysis(nextResult);
      setRenderPrompt(nextResult.renderPrompt);
      setStage("success");
      setStageMessage("目标视角已完成完整画幅重绘");
    } catch (requestError) {
      if (requestAbortRef.current !== controller) {
        return;
      }

      if (controller.signal.aborted) {
        setStage("cancelled");
        setStageMessage("当前生成已取消，可调整姿态后重新开始");
        return;
      }

      setStage("failed");
      setStageMessage("新视角生成失败");
      setError(formatRequestError(requestError));
    } finally {
      if (requestAbortRef.current === controller) {
        requestAbortRef.current = null;
      }
    }
  }

  function cancelGeneration() {
    requestAbortRef.current?.abort();
  }

  const isLoading = stage === "reasoning" || stage === "rendering";
  const normalizedRotation = {
    x: normalizeSingleImageRotationAngle(rotation.x),
    y: normalizeSingleImageRotationAngle(rotation.y),
    z: normalizeSingleImageRotationAngle(rotation.z)
  };
  const outputSizes = source
    ? [1024, 1536, 2048].map((edge) =>
        calculateSingleImageOutputSize(source.width, source.height, edge)
      )
    : ["1024x1024", "1536x1536", "2048x2048"];
  const uniqueOutputSizes = [...new Set(outputSizes)];

  return (
    <section
      className="single-view-workbench"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <div className="single-view-pipeline">
        <div className="single-view-pipeline-title">
          <Orbit size={18} />
          <div>
            <strong>单图 XYZ 新视角</strong>
            <span>2D 目标投影引导 + AI 新视角重建</span>
          </div>
        </div>
        <div className="single-view-pipeline-route" aria-label="双模型处理链">
          <span className="is-ready">XYZ 机位</span>
          <i />
          <span className={stage === "reasoning" ? "is-active" : ""}>
            {reasoningModel || DEFAULT_SINGLE_IMAGE_REASONING_MODEL}
          </span>
          <i />
          <span className={stage === "rendering" ? "is-active" : ""}>
            {imageModel || DEFAULT_SINGLE_IMAGE_IMAGE_MODEL}
          </span>
        </div>
        <div className={`single-view-live-state status-${stage}`}>
          <span />
          {stageMessage || "等待参考图与目标机位"}
        </div>
      </div>

      <div className="single-view-main-grid">
        <section className="single-view-pose-panel">
          <header className="single-view-panel-header">
            <div>
              <span>INTERACTIVE CAMERA</span>
              <strong>虚拟相机轨道</strong>
            </div>
            <div className="single-view-header-actions">
              <button
                className="single-view-tool-button"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                <Upload size={15} />
                {source ? "替换参考图" : "上传参考图"}
              </button>
              <input
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={handleUploadChange}
                ref={fileInputRef}
                type="file"
              />
              <button
                aria-label="重置 XYZ 机位"
                className="single-view-icon-button"
                disabled={!source || isLoading}
                onClick={resetPose}
                title="重置 XYZ 机位"
                type="button"
              >
                <RotateCcw size={16} />
              </button>
            </div>
          </header>

          <div className={`single-view-source-strip${source ? " is-ready" : ""}`}>
            {source ? (
              <>
                <img alt="" src={source.dataURL} />
                <div>
                  <span>原始事实参考</span>
                  <strong>{source.fileName}</strong>
                  <small>
                    {source.width} × {source.height} ·{" "}
                    {formatFileSize(source.fileSize)}
                  </small>
                </div>
                <p>身份、材质、服饰、光线与场景均以此图为准</p>
              </>
            ) : (
              <button
                className="single-view-upload-empty"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                <ImagePlus size={22} />
                <span>
                  <strong>拖入或选择一张主体参考图</strong>
                  <small>PNG、JPEG、WebP，最大 20 MB</small>
                </span>
              </button>
            )}
          </div>

          <div className="single-view-viewport-stage">
            <div
              className="single-view-viewport-shell"
              style={{
                aspectRatio: source
                  ? `${source.width} / ${source.height}`
                  : "1 / 1"
              }}
            >
              <SingleImagePoseViewport
                cameraDistance={cameraDistance}
                disabled={!source || isLoading}
                imageHeight={source?.height ?? 1}
                imageURL={source?.dataURL}
                imageWidth={source?.width ?? 1}
                key={source?.id ?? "empty"}
                onReadyChange={setPoseReady}
                onRotationChange={updateRotation}
                ref={viewportRef}
                rotation={rotation}
              />
              {!source && (
                <div className="single-view-viewport-empty">
                  <Rotate3D size={30} />
                  <strong>XYZ 机位视口</strong>
                  <span>上传后显示主体平面、坐标轴与相机轨道</span>
                </div>
              )}
              {source && !poseReady && (
                <div className="single-view-viewport-empty is-loading">
                  <LoaderCircle className="animate-spin" size={25} />
                  <strong>正在建立机位视口</strong>
                </div>
              )}
              <div className="single-view-axis-legend" aria-hidden="true">
                <span className="axis-x">X</span>
                <span className="axis-y">Y</span>
                <span className="axis-z">Z</span>
              </div>
            </div>
            <PromptToolIsland
              cameraPrompt={cameraPrompt.deterministicPromptZh}
              renderPrompt={renderPrompt}
            />
          </div>

          <div className="single-view-preset-row">
            {VIEW_PRESETS.map((preset) => (
              <button
                className={
                  rotationsEqual(rotation, preset.rotation) ? "is-active" : ""
                }
                disabled={!source || isLoading}
                key={preset.label}
                onClick={() => updateRotation(preset.rotation)}
                type="button"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <CameraDistanceControl
            cameraPromptLabel={cameraPrompt.distanceLabelZh}
            disabled={!source || isLoading}
            onChange={updateCameraDistance}
            value={cameraDistance}
          />

          <div className="single-view-axis-console">
            {AXES.map((axis) => (
              <AxisControl
                axis={axis}
                disabled={!source || isLoading}
                key={axis.key}
                normalizedValue={normalizedRotation[axis.key]}
                onChange={(value) => updateAxis(axis.key, value)}
                value={rotation[axis.key]}
              />
            ))}
          </div>

          <div className="single-view-inference-note">
            <View size={16} />
            <span>
              XYZ 控制目标相机围绕同一三维时刻移动；主体世界状态保持连续，屏幕朝向、轮廓、可见结构、遮挡与背景视差由目标相机重新投影。
              原图不可见结构由 AI 基于类别与结构连续性保守补全。
            </span>
          </div>
        </section>

        <section className="single-view-output-panel">
          <header className="single-view-panel-header">
            <div>
              <span>NOVEL VIEW OUTPUT</span>
              <strong>原图、目标投影与重绘结果</strong>
            </div>
            {result && (
              <a
                className="single-view-tool-button"
                download={`single-image-view-${result.requestId}.png`}
                href={result.image}
              >
                <Download size={15} />
                下载
              </a>
            )}
          </header>

          <div className="single-view-comparison">
            <PreviewPanel
              image={source?.dataURL}
              label="原始参考"
              meta={
                source ? `${source.width} × ${source.height}` : "等待上传"
              }
            />
            <PreviewPanel
              image={guidePreview}
              label="目标投影引导"
              meta={`${formatAngle(normalizedRotation.x)} / ${formatAngle(
                normalizedRotation.y
              )} / ${formatAngle(normalizedRotation.z)}`}
            />
            <PreviewPanel
              className="single-view-result-preview"
              image={result?.image}
              label="AI 新视角"
              loading={isLoading}
              meta={
                result
                  ? `${result.imageModel} · ${(result.totalDurationMs / 1000).toFixed(1)} s`
                  : outputSize
              }
            />
          </div>

          {isLoading && (
            <GenerationProgress
              reasoningModel={reasoningModel}
              imageModel={imageModel}
              stage={stage}
            />
          )}

          {analysis && !isLoading && (
            <details className="single-view-analysis" open={stage === "success"}>
              <summary>
                <span>
                  <Sparkles size={15} />
                  空间推演摘要
                </span>
                <small>{analysis.viewDescription}</small>
              </summary>
              <div>
                <p>{analysis.optimizedPrompt}</p>
                <AnalysisList
                  items={analysis.hiddenSurfacePlan}
                  label="隐藏表面计划"
                />
                <AnalysisList
                  items={analysis.uncertaintyNotes}
                  label="不确定性说明"
                />
              </div>
            </details>
          )}

          <div className="single-view-generation-console">
            <label>
              <span>视角重绘约束</span>
              <textarea
                disabled={isLoading}
                maxLength={1500}
                onChange={(event) => updateUserPrompt(event.target.value)}
                value={prompt}
              />
            </label>

            <details className="single-view-model-settings">
              <summary>
                <Settings2 size={15} />
                模型与端点
              </summary>
              <div>
                <TextField
                  disabled={isLoading}
                  label="空间推理模型"
                  onChange={setReasoningModel}
                  value={reasoningModel}
                />
                <TextField
                  disabled={isLoading}
                  label="完整重绘模型"
                  onChange={setImageModel}
                  value={imageModel}
                />
                <TextField
                  disabled={isLoading}
                  label="API 根地址"
                  onChange={setApiBaseURL}
                  value={apiBaseURL}
                />
                <TextField
                  disabled={isLoading}
                  label="图像编辑端点（可选）"
                  onChange={setImageEditURL}
                  placeholder="留空时使用 /v1/images/edits"
                  value={imageEditURL}
                />
                <label className="single-view-field">
                  <span>输出尺寸</span>
                  <select
                    disabled={isLoading}
                    onChange={(event) => setOutputSize(event.target.value)}
                    value={outputSize}
                  >
                    {uniqueOutputSizes.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </details>

            {!apiKey && (
              <button
                className="single-view-api-warning"
                onClick={onOpenSettings}
                type="button"
              >
                <AlertCircle size={15} />
                <span>API Key 尚未配置</span>
                <strong>打开设置</strong>
              </button>
            )}

            {error && (
              <div className="single-view-error" role="alert">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            <div className="single-view-generation-actions">
              {isLoading ? (
                <button
                  className="single-view-cancel-button"
                  onClick={cancelGeneration}
                  type="button"
                >
                  取消生成
                </button>
              ) : (
                <button
                  className="single-view-generate-button"
                  disabled={!source || !poseReady || !apiKey}
                  onClick={() => void generateViewpoint()}
                  type="button"
                >
                  <Sparkles size={17} />
                  生成该角度的新视图
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

function PromptToolIsland({
  cameraPrompt,
  renderPrompt
}: {
  cameraPrompt: string;
  renderPrompt: string;
}) {
  const [activeTab, setActiveTab] = useState<"camera" | "render">("camera");
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (renderPrompt) {
      setActiveTab("render");
    } else {
      setActiveTab("camera");
    }
  }, [renderPrompt]);

  const activePrompt =
    activeTab === "camera" ? cameraPrompt : renderPrompt;

  async function copyActivePrompt() {
    if (!activePrompt || !navigator.clipboard?.writeText) {
      return;
    }

    await navigator.clipboard.writeText(activePrompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <aside
      className={`single-view-prompt-island${
        expanded ? " is-expanded" : " is-collapsed"
      }`}
    >
      <div className="single-view-prompt-island-bar">
        <div aria-label="提示词视图" role="tablist">
          <button
            aria-selected={activeTab === "camera"}
            className={activeTab === "camera" ? "is-active" : ""}
            onClick={() => setActiveTab("camera")}
            role="tab"
            type="button"
          >
            相机协议
          </button>
          <button
            aria-selected={activeTab === "render"}
            className={activeTab === "render" ? "is-active" : ""}
            onClick={() => setActiveTab("render")}
            role="tab"
            type="button"
          >
            最终提示词
          </button>
        </div>
        <span>
          <button
            aria-label="复制当前提示词"
            disabled={!activePrompt}
            onClick={() => void copyActivePrompt()}
            title="复制当前提示词"
            type="button"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button
            aria-label={expanded ? "收起提示词工具岛" : "展开提示词工具岛"}
            onClick={() => setExpanded((current) => !current)}
            title={expanded ? "收起" : "展开"}
            type="button"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </span>
      </div>
      {expanded && (
        <pre aria-live="polite">
          {activePrompt ||
            "推理完成后，这里会显示服务端实际发送给 GPT Image 2 的完整提示词。"}
        </pre>
      )}
    </aside>
  );
}

function CameraDistanceControl({
  cameraPromptLabel,
  disabled,
  onChange,
  value
}: {
  cameraPromptLabel: string;
  disabled: boolean;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <div className="single-view-distance-control">
      <div>
        <span>景别</span>
        <strong>{cameraPromptLabel}</strong>
        <output>{value.toFixed(1)}</output>
      </div>
      <input
        aria-label="景别控制值"
        disabled={disabled}
        max="10"
        min="0"
        onChange={(event) => onChange(Number(event.target.value))}
        step="0.1"
        type="range"
        value={value}
      />
      <div className="single-view-distance-presets">
        {DISTANCE_PRESETS.map((preset) => (
          <button
            className={value === preset.value ? "is-active" : ""}
            disabled={disabled}
            key={preset.label}
            onClick={() => onChange(preset.value)}
            type="button"
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AxisControl({
  axis,
  disabled,
  normalizedValue,
  onChange,
  value
}: {
  axis: (typeof AXES)[number];
  disabled: boolean;
  normalizedValue: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <div className={`single-view-axis-control axis-${axis.key}`}>
      <div className="single-view-axis-copy">
        <span>{axis.label}</span>
        <div>
          <strong>{axis.name}</strong>
          <small>{axis.description}</small>
        </div>
      </div>
      <div className="single-view-axis-inputs">
        <input
          aria-label={`${axis.label} 轴累计角度`}
          disabled={disabled}
          max="720"
          min="-720"
          onChange={(event) => onChange(Number(event.target.value))}
          step="1"
          type="range"
          value={value}
        />
        <label>
          <input
            aria-label={`${axis.label} 轴角度数值`}
            disabled={disabled}
            max="720"
            min="-720"
            onChange={(event) => onChange(Number(event.target.value))}
            step="1"
            type="number"
            value={formatInputAngle(value)}
          />
          <span>°</span>
        </label>
      </div>
      <div className="single-view-axis-meta">
        <span>-720°</span>
        <span>等效 {formatAngle(normalizedValue)}</span>
        <span>720°</span>
      </div>
    </div>
  );
}

function PreviewPanel({
  className = "",
  image,
  label,
  loading = false,
  meta
}: {
  className?: string;
  image?: string;
  label: string;
  loading?: boolean;
  meta: string;
}) {
  return (
    <figure className={`single-view-preview ${className}`.trim()}>
      <figcaption>
        <strong>{label}</strong>
        <span>{meta}</span>
      </figcaption>
      <div>
        {image ? (
          <img alt={label} src={image} />
        ) : loading ? (
          <span className="single-view-preview-loading">
            <LoaderCircle className="animate-spin" size={22} />
            正在重绘完整画幅
          </span>
        ) : (
          <span className="single-view-preview-empty">
            <ImagePlus size={20} />
            暂无图像
          </span>
        )}
      </div>
    </figure>
  );
}

function GenerationProgress({
  imageModel,
  reasoningModel,
  stage
}: {
  imageModel: string;
  reasoningModel: string;
  stage: WorkbenchStage;
}) {
  const isRendering = stage === "rendering";

  return (
    <div className="single-view-progress">
      <ProgressStep
        active={!isRendering}
        complete={isRendering}
        label={`[Step 1/2] ${reasoningModel} 正在识别主体并推演隐藏表面`}
      />
      <ProgressStep
        active={isRendering}
        complete={false}
        label={`[Step 2/2] ${imageModel} 正在重绘目标相机视角`}
      />
    </div>
  );
}

function ProgressStep({
  active,
  complete,
  label
}: {
  active: boolean;
  complete: boolean;
  label: string;
}) {
  return (
    <div
      className={`single-view-progress-step${
        active ? " is-active" : complete ? " is-complete" : ""
      }`}
    >
      <span>
        {complete ? (
          <Check size={14} />
        ) : active ? (
          <LoaderCircle className="animate-spin" size={14} />
        ) : null}
      </span>
      <strong>{label}</strong>
    </div>
  );
}

function AnalysisList({ items, label }: { items: string[]; label: string }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section>
      <strong>{label}</strong>
      <ul>
        {items.map((item, index) => (
          <li key={`${label}-${index}`}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function TextField({
  disabled,
  label,
  onChange,
  placeholder,
  value
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <label className="single-view-field">
      <span>{label}</span>
      <input
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="text"
        value={value}
      />
    </label>
  );
}

function readFileAsDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("图片读取失败。"));
    reader.onerror = () => reject(new Error("图片读取失败。"));
    reader.readAsDataURL(file);
  });
}

function decodeImageDimensions(dataURL: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;

      if (!width || !height) {
        reject(new Error("图片尺寸无效。"));
        return;
      }

      resolve({ width, height });
    };
    image.onerror = () => reject(new Error("图片无法解码，请更换文件后重试。"));
    image.src = dataURL;
  });
}

function deriveEndpointRoot(value?: string) {
  const normalized = value?.trim();

  if (!normalized) {
    return DEFAULT_BASE_URL;
  }

  return normalized
    .replace(/\/v1\/responses$/i, "")
    .replace(/\/v1\/images\/(?:generations|edits)$/i, "")
    .replace(/\/+$/, "");
}

function createRequestId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `single-view-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function formatRequestError(error: unknown) {
  if (error instanceof SingleImageViewpointApiError) {
    const diagnostics = [
      error.message,
      error.code ? `错误码 ${error.code}` : "",
      error.retryable ? "该错误可以重试。" : ""
    ].filter(Boolean);
    return diagnostics.join(" · ");
  }

  return error instanceof Error ? error.message : "新视角生成失败，请稍后重试。";
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatAngle(value: number) {
  return `${formatInputAngle(value)}°`;
}

function formatInputAngle(value: number) {
  return Number.isInteger(value) ? value : Math.round(value * 10) / 10;
}

function rotationsEqual(left: XYZRotation, right: XYZRotation) {
  return (
    left.x === right.x && left.y === right.y && left.z === right.z
  );
}
