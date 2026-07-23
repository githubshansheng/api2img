import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ImagePlus,
  LoaderCircle,
  Maximize2,
  Orbit,
  Rotate3D,
  RotateCcw,
  Settings2,
  Sparkles,
  Upload,
  View,
  X
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
  DEFAULT_SINGLE_IMAGE_PROMPT_LANGUAGE,
  DEFAULT_SINGLE_IMAGE_REASONING_MODEL,
  DEFAULT_SINGLE_IMAGE_USER_PROMPT_EN,
  DEFAULT_SINGLE_IMAGE_USER_PROMPT_ZH,
  normalizeSingleImageRotationAngle,
  SINGLE_IMAGE_CAMERA_DISTANCE_DEFAULT,
  type SingleImagePromptLanguage,
  type SingleImageViewpointResult,
  type XYZRotation
} from "../../domain";
import {
  generateSingleImageViewpoint,
  isCurrentSingleImageCameraProtocol,
  SingleImageViewpointApiError
} from "../../services/single-image-viewpoint-service";
import { openFrontendDebugPanel } from "../../services/debug-log-service";
import {
  SingleImagePoseViewport,
  type SingleImagePoseViewportHandle
} from "./SingleImagePoseViewport";

const DEFAULT_BASE_URL = "https://api.openai.com";
const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ZERO_ROTATION: XYZRotation = { x: 0, y: 0, z: 0 };
const PRIMARY_PROMPT_LANGUAGE = DEFAULT_SINGLE_IMAGE_PROMPT_LANGUAGE;
const PROMPT_LANGUAGES = [PRIMARY_PROMPT_LANGUAGE, "zh"] as const;

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
    description: "正值：镜头向画面左边移动，即对象自身右边"
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
  { label: "对象右前 45°", rotation: { x: 0, y: 45, z: 0 } },
  { label: "对象右侧 90°", rotation: { x: 0, y: 90, z: 0 } },
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
  const [promptZh, setPromptZh] = useState(
    DEFAULT_SINGLE_IMAGE_USER_PROMPT_ZH
  );
  const [promptEn, setPromptEn] = useState(
    DEFAULT_SINGLE_IMAGE_USER_PROMPT_EN
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
  const [results, setResults] = useState<
    Partial<Record<SingleImagePromptLanguage, SingleImageViewpointResult>>
  >({});
  const [renderPrompts, setRenderPrompts] = useState<
    Partial<Record<SingleImagePromptLanguage, string>>
  >({});
  const [resultsStale, setResultsStale] = useState(false);
  const [detailLanguage, setDetailLanguage] =
    useState<SingleImagePromptLanguage>();
  const [error, setError] = useState("");
  const cameraPrompt = useMemo(
    () =>
      buildSingleImageCameraPrompt(rotation, cameraDistance, {
        sourceWidth: source?.width,
        sourceHeight: source?.height,
        outputSize
      }),
    [
      cameraDistance,
      outputSize,
      rotation.x,
      rotation.y,
      rotation.z,
      source?.height,
      source?.width
    ]
  );
  const invalidResultLanguages = PROMPT_LANGUAGES.filter((language) => {
    const result = results[language];
    const renderPrompt = renderPrompts[language];

    return Boolean(
      result &&
        renderPrompt &&
        !isCurrentSingleImageCameraProtocol({
          cameraPrompt: result.cameraPrompt,
          renderPrompt,
          promptLanguage: language
        })
    );
  });
  const detailResult = detailLanguage
    ? results[detailLanguage]
    : undefined;

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
    if (invalidResultLanguages.length === 0) {
      return;
    }

    setRenderPrompts((current) =>
      omitPromptLanguages(current, invalidResultLanguages)
    );
    setResults((current) =>
      omitPromptLanguages(current, invalidResultLanguages)
    );
    setStage("failed");
    setStageMessage("检测到不兼容的服务端提示词，已移除对应结果");
    setError(
      `以下结果未通过 10.6 相机协议校验：${invalidResultLanguages
        .map((language) => (language === "en" ? "英文" : "中文"))
        .join("、")}`
    );
  }, [
    invalidResultLanguages.join(",")
  ]);

  useEffect(() => {
    if (!detailLanguage || results[detailLanguage]) {
      return;
    }

    setDetailLanguage(undefined);
  }, [detailLanguage, results.en, results.zh]);

  useEffect(() => {
    if (!detailLanguage) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDetailLanguage(undefined);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [detailLanguage]);

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
      setResults({});
      setRenderPrompts({});
      setResultsStale(false);
      setDetailLanguage(undefined);
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

  function updateOutputSize(value: string) {
    invalidateGeneratedOutput();
    setOutputSize(value);
  }

  function updateUserPrompt(
    language: SingleImagePromptLanguage,
    value: string
  ) {
    invalidateGeneratedOutput();

    if (language === "en") {
      setPromptEn(value);
    } else {
      setPromptZh(value);
    }
  }

  function resetPose() {
    invalidateGeneratedOutput();
    setRotation(ZERO_ROTATION);
    setCameraDistance(SINGLE_IMAGE_CAMERA_DISTANCE_DEFAULT);
  }

  function invalidateGeneratedOutput() {
    const hasRetainedResults = Boolean(results.en || results.zh);

    if (hasRetainedResults) {
      setResultsStale(true);
    }

    if (
      stage === "success" ||
      stage === "failed" ||
      stage === "cancelled"
    ) {
      setStage("idle");
      setStageMessage(
        hasRetainedResults
          ? "相机或生成参数已更新，上一机位结果已保留"
          : "参数已更新，等待重新生成"
      );
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

    const normalizedImageModel = imageModel.trim();

    if (!normalizedImageModel) {
      setError("图像模型不能为空。");
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
    if (results.en || results.zh) {
      setResultsStale(true);
    }
    setStage("reasoning");
    setStageMessage(
      `${DEFAULT_SINGLE_IMAGE_REASONING_MODEL} 正在共享分析原图、目标投影与完整机位图`
    );

    try {
      const settledResults = await Promise.allSettled(
        PROMPT_LANGUAGES.map((language) =>
          generateSingleImageViewpoint(
            {
              requestId: `${createRequestId()}-${language}`,
              source_image: source.dataURL,
              pose_guide_image: guide.image,
              camera_pose_image: guide.cameraViewImage,
              rotation_degrees: rotation,
              camera_distance: cameraDistance,
              source_width: source.width,
              source_height: source.height,
              prompt_language: language,
              user_prompt:
                language === "en" ? promptEn.trim() : promptZh.trim(),
              background_mode: "preserve_scene",
              api_key: apiKey,
              reasoning_model: DEFAULT_SINGLE_IMAGE_REASONING_MODEL,
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
                _nextAnalysis,
                _nextCameraPrompt,
                nextRenderPrompt,
                nextPromptLanguage
              ) => {
                if (requestAbortRef.current !== controller) {
                  return;
                }

                setStage(nextStage);
                setStageMessage(message);

                void nextRenderPrompt;
                void nextPromptLanguage;
              }
            },
            controller.signal
          )
        )
      );

      if (requestAbortRef.current !== controller) {
        return;
      }

      if (controller.signal.aborted) {
        setStage("cancelled");
        setStageMessage("当前生成已取消，可调整姿态后重新开始");
        return;
      }

      const nextResults: Partial<
        Record<SingleImagePromptLanguage, SingleImageViewpointResult>
      > = {};
      const nextPrompts: Partial<
        Record<SingleImagePromptLanguage, string>
      > = {};
      const failures: string[] = [];

      settledResults.forEach((settled, index) => {
        const language = PROMPT_LANGUAGES[index]!;

        if (settled.status === "fulfilled") {
          nextResults[language] = settled.value;
          nextPrompts[language] = settled.value.renderPrompt;
        } else {
          failures.push(
            `${language === "en" ? "英文" : "中文"}：${formatRequestError(settled.reason)}`
          );
        }
      });

      const completedCount = Object.keys(nextResults).length;

      if (completedCount > 0) {
        setResults(nextResults);
        setRenderPrompts(nextPrompts);
        setResultsStale(false);
      }

      if (failures.length === 0) {
        setStage("success");
        setStageMessage("英文主结果与中文对照均已完成");
      } else if (Object.keys(nextResults).length > 0) {
        setStage("failed");
        setStageMessage("双语对比仅部分完成");
        setError(failures.join("\n"));
      } else {
        setStage("failed");
        setStageMessage("中文与英文新视角生成均失败");
        setError(failures.join("\n"));
      }
    } catch (requestError) {
      if (requestAbortRef.current !== controller) {
        return;
      }

      setStage("failed");
      setStageMessage("双语新视角生成失败");
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
        <div className="single-view-pipeline-route" aria-label="新机位生成链">
          <span className="is-ready">XYZ 机位</span>
          <i />
          <span
            className={
              stage === "reasoning"
                ? "is-active"
                : stage === "rendering" || stage === "success"
                  ? "is-ready"
                  : ""
            }
          >
            {DEFAULT_SINGLE_IMAGE_REASONING_MODEL} 视觉分析
          </span>
          <i />
          <span
            className={
              stage === "rendering"
                ? "is-active"
                : stage === "success"
                  ? "is-ready"
                  : ""
            }
          >
            {imageModel || DEFAULT_SINGLE_IMAGE_IMAGE_MODEL} 整场景重拍
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
                  <strong>拖入或选择一张场景参考图</strong>
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
              cameraPrompts={{
                zh: cameraPrompt.deterministicPromptZh,
                en: cameraPrompt.deterministicPromptEn
              }}
              renderPrompts={renderPrompts}
              stale={resultsStale}
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
              XYZ 直接改变虚拟相机机位，整幅画面随镜头移动而重新成像和构图，不是让画面中的某一个对象在原背景中单独转动。
              左右以原图观看者为首要基准：Yaw 正值让镜头向画面左边移动；对象大致正对原相机时，这等于来到对象自身右边。
              前景、对象、中景、背景、地面、环境空间和画面边界会按新视锥一起重建；最终画面朝向由目标相机决定，不锁定原图朝屏幕的方向。
              输出始终锁定原图宽高比，原图未拍到的新可见区域由 AI 延续原环境风格补全。
            </span>
          </div>
        </section>

        <section className="single-view-output-panel">
          <header className="single-view-panel-header">
            <div>
              <span>NOVEL VIEW OUTPUT</span>
              <strong>English 主结果 / 中文提示词对照</strong>
            </div>
            {resultsStale && (results.en || results.zh) && (
              <span className="single-view-stale-badge">
                上一机位结果
              </span>
            )}
            <div className="single-view-header-actions">
              {PROMPT_LANGUAGES.map((language) => {
                const languageResult = results[language];

                return languageResult ? (
                  <a
                    className="single-view-tool-button"
                    download={`single-image-view-${language}-${languageResult.requestId}.png`}
                    href={languageResult.image}
                    key={language}
                  >
                    <Download size={15} />
                    {language === PRIMARY_PROMPT_LANGUAGE
                      ? "EN 主结果"
                      : "中文对照"}
                  </a>
                ) : null;
              })}
            </div>
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
              className="single-view-result-preview is-primary"
              downloadName={
                results.en
                  ? `single-image-view-en-${results.en.requestId}.png`
                  : undefined
              }
              image={results.en?.image}
              label="English 主结果（推荐）"
              loading={isLoading}
              meta={
                results.en
                  ? formatResultPreviewMeta(results.en, resultsStale)
                  : outputSize
              }
              onOpen={
                results.en
                  ? () => setDetailLanguage("en")
                  : undefined
              }
            />
            <PreviewPanel
              className="single-view-result-preview"
              downloadName={
                results.zh
                  ? `single-image-view-zh-${results.zh.requestId}.png`
                  : undefined
              }
              image={results.zh?.image}
              label="中文对照结果"
              loading={isLoading}
              meta={
                results.zh
                  ? formatResultPreviewMeta(results.zh, resultsStale)
                  : outputSize
              }
              onOpen={
                results.zh
                  ? () => setDetailLanguage("zh")
                  : undefined
              }
            />
          </div>

          {isLoading && (
            <GenerationProgress imageModel={imageModel} stage={stage} />
          )}

          <div className="single-view-generation-console">
            <div className="single-view-bilingual-constraints">
              <label>
                <span>中文补充约束</span>
                <textarea
                  disabled={isLoading}
                  maxLength={1500}
                  onChange={(event) =>
                    updateUserPrompt("zh", event.target.value)
                  }
                  value={promptZh}
                />
              </label>
              <label>
                <span>English additional constraint</span>
                <textarea
                  disabled={isLoading}
                  maxLength={1500}
                  onChange={(event) =>
                    updateUserPrompt("en", event.target.value)
                  }
                  value={promptEn}
                />
              </label>
            </div>

            <details className="single-view-model-settings">
              <summary>
                <Settings2 size={15} />
                模型与端点
              </summary>
              <div>
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
                  <span>
                    输出尺寸（锁定原图比例
                    {source
                      ? ` ${formatAspectRatio(source.width, source.height)}`
                      : ""}
                    ）
                  </span>
                  <select
                    disabled={isLoading}
                    onChange={(event) =>
                      updateOutputSize(event.target.value)
                    }
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
                <div className="single-view-error-copy">
                  <span>{error}</span>
                  <button
                    onClick={openFrontendDebugPanel}
                    type="button"
                  >
                    打开 Debug 日志
                  </button>
                </div>
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
                  中英文各生成一张并对比
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
      {detailLanguage && detailResult && (
        <ResultPreviewDialog
          language={detailLanguage}
          onClose={() => setDetailLanguage(undefined)}
          result={detailResult}
          stale={resultsStale}
        />
      )}
    </section>
  );
}

function PromptToolIsland({
  cameraPrompts,
  renderPrompts,
  stale
}: {
  cameraPrompts: Record<SingleImagePromptLanguage, string>;
  renderPrompts: Partial<Record<SingleImagePromptLanguage, string>>;
  stale: boolean;
}) {
  const [activeTab, setActiveTab] = useState<"camera" | "render">("camera");
  const [activeLanguage, setActiveLanguage] =
    useState<SingleImagePromptLanguage>("zh");
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (renderPrompts.zh || renderPrompts.en) {
      setActiveTab("render");
      setActiveLanguage(PRIMARY_PROMPT_LANGUAGE);
    } else {
      setActiveTab("camera");
    }
  }, [renderPrompts.en, renderPrompts.zh]);

  const activePrompt =
    activeTab === "camera"
      ? cameraPrompts[activeLanguage]
      : renderPrompts[activeLanguage] ?? "";

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
        <div className="single-view-prompt-selectors">
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
          <div aria-label="提示词语言" role="tablist">
            <button
              aria-selected={activeLanguage === "zh"}
              className={activeLanguage === "zh" ? "is-active" : ""}
              onClick={() => setActiveLanguage("zh")}
              role="tab"
              type="button"
            >
              中文
            </button>
            <button
              aria-selected={activeLanguage === "en"}
              className={activeLanguage === "en" ? "is-active" : ""}
              onClick={() => setActiveLanguage("en")}
              role="tab"
              type="button"
            >
              EN
            </button>
          </div>
        </div>
        <span>
          {stale && activeTab === "render" && activePrompt && (
            <em>上一机位</em>
          )}
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
        <span>观察距离 / 景别</span>
        <strong>{cameraPromptLabel}</strong>
        <output>{value.toFixed(1)} / 10</output>
      </div>
      <input
        aria-label="观察距离与景别控制值"
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
  downloadName,
  image,
  label,
  loading = false,
  meta,
  onOpen
}: {
  className?: string;
  downloadName?: string;
  image?: string;
  label: string;
  loading?: boolean;
  meta: string;
  onOpen?: () => void;
}) {
  return (
    <figure
      className={`single-view-preview ${className}${
        image && onOpen ? " is-clickable" : ""
      }`.trim()}
    >
      <figcaption>
        <strong>{label}</strong>
        <span>{meta}</span>
      </figcaption>
      <div>
        {image ? (
          <>
            {onOpen ? (
              <button
                aria-label={`放大查看${label}`}
                className="single-view-preview-open"
                onClick={onOpen}
                title="放大查看"
                type="button"
              >
                <img alt={label} src={image} />
              </button>
            ) : (
              <img alt={label} src={image} />
            )}
            {downloadName && (
              <a
                aria-label={`下载${label}`}
                className="single-view-preview-download"
                download={downloadName}
                href={image}
                title="下载图片"
              >
                <Download size={15} />
              </a>
            )}
            {onOpen && (
              <span className="single-view-preview-expand">
                <Maximize2 size={15} />
              </span>
            )}
          </>
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

function ResultPreviewDialog({
  language,
  onClose,
  result,
  stale
}: {
  language: SingleImagePromptLanguage;
  onClose: () => void;
  result: SingleImageViewpointResult;
  stale: boolean;
}) {
  const label =
    language === "en" ? "English 主结果（推荐）" : "中文对照结果";
  const prompt = result.cameraPrompt;
  const downloadName = `single-image-view-${language}-${result.requestId}.png`;

  return (
    <div
      className="single-view-detail-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-label={`${label}详情`}
        aria-modal="true"
        className="single-view-detail-dialog"
        role="dialog"
      >
        <header>
          <div>
            <span>GENERATED VIEW DETAIL</span>
            <h2>{label}</h2>
            <p>
              {stale ? "上一机位结果 · " : ""}
              {prompt.azimuthLabelZh} · {prompt.elevationLabelZh} ·{" "}
              {prompt.distanceLabelZh}
            </p>
          </div>
          <div className="single-view-detail-actions">
            <a
              download={downloadName}
              href={result.image}
              title="下载原图"
            >
              <Download size={17} />
              下载
            </a>
            <button
              aria-label="关闭图片详情"
              onClick={onClose}
              title="关闭"
              type="button"
            >
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="single-view-detail-stage">
          <img alt={`${label}详情`} src={result.image} />
        </div>
        <dl className="single-view-detail-meta">
          <div>
            <dt>累计 XYZ</dt>
            <dd>
              X {formatAngle(prompt.cumulativeRotationDegrees.x)} · Y{" "}
              {formatAngle(prompt.cumulativeRotationDegrees.y)} · Z{" "}
              {formatAngle(prompt.cumulativeRotationDegrees.z)}
            </dd>
          </div>
          <div>
            <dt>真实相机方向</dt>
            <dd>
              方位 {formatAngle(prompt.cameraAzimuthDegrees)} · 俯仰{" "}
              {formatAngle(prompt.cameraElevationDegrees)} · Roll{" "}
              {formatAngle(prompt.cameraRollDegrees)}
            </dd>
          </div>
          <div>
            <dt>输出</dt>
            <dd>
              {result.outputSize} · {result.imageMimeType}
            </dd>
          </div>
          <div>
            <dt>模型</dt>
            <dd>
              {result.reasoningModel} → {result.imageModel}
            </dd>
          </div>
          <div>
            <dt>耗时</dt>
            <dd>
              分析 {(result.reasoningDurationMs / 1000).toFixed(1)} s ·
              重绘 {(result.renderingDurationMs / 1000).toFixed(1)} s ·
              总计 {(result.totalDurationMs / 1000).toFixed(1)} s
            </dd>
          </div>
          <div>
            <dt>请求 ID</dt>
            <dd>{result.requestId}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

function GenerationProgress({
  imageModel,
  stage
}: {
  imageModel: string;
  stage: "reasoning" | "rendering";
}) {
  return (
    <div className="single-view-progress">
      <ProgressStep
        active={stage === "reasoning"}
        complete={stage === "rendering"}
        label={`${DEFAULT_SINGLE_IMAGE_REASONING_MODEL} 正在生成中英文共享视觉事实包`}
      />
      <ProgressStep
        active={stage === "rendering"}
        complete={false}
        label={`${imageModel} 正在执行中文提示词重拍`}
      />
      <ProgressStep
        active={stage === "rendering"}
        complete={false}
        label={`${imageModel} is rendering the English prompt`}
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

function formatAspectRatio(width: number, height: number) {
  const divisor = greatestCommonDivisor(width, height);
  const reducedWidth = width / divisor;
  const reducedHeight = height / divisor;

  return reducedWidth <= 100 && reducedHeight <= 100
    ? `${reducedWidth}:${reducedHeight}`
    : `${(width / height).toFixed(3)}:1`;
}

function greatestCommonDivisor(left: number, right: number) {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));

  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }

  return Math.max(1, a);
}

function formatAngle(value: number) {
  return `${formatInputAngle(value)}°`;
}

function formatResultPreviewMeta(
  result: SingleImageViewpointResult,
  stale: boolean
) {
  const rotation = result.cameraPrompt.cumulativeRotationDegrees;
  return [
    stale ? "上一机位" : undefined,
    `X ${formatAngle(rotation.x)} · Y ${formatAngle(rotation.y)} · Z ${formatAngle(rotation.z)}`,
    result.outputSize,
    `${(result.totalDurationMs / 1000).toFixed(1)} s`
  ]
    .filter(Boolean)
    .join(" · ");
}

function omitPromptLanguages<T>(
  input: Partial<Record<SingleImagePromptLanguage, T>>,
  languages: readonly SingleImagePromptLanguage[]
) {
  const next = { ...input };

  for (const language of languages) {
    delete next[language];
  }

  return next;
}

function formatInputAngle(value: number) {
  return Number.isInteger(value) ? value : Math.round(value * 10) / 10;
}

function rotationsEqual(left: XYZRotation, right: XYZRotation) {
  return (
    left.x === right.x && left.y === right.y && left.z === right.z
  );
}
