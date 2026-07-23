import {
  AlertTriangle,
  Camera,
  Check,
  Circle,
  CircleCheck,
  Download,
  FileImage,
  FolderOpen,
  Image as ImageIcon,
  ImagePlus,
  LoaderCircle,
  Orbit,
  RefreshCw,
  RotateCcw,
  Settings,
  Sparkles,
  Trash2,
  Upload
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode
} from "react";
import type {
  EndpointOverride,
  GenerateVector3DViewResult,
  ModelConfig,
  Vector3DCameraParameters,
  Vector3DGenerationStage,
  Vector3DRepairAnalysis
} from "../../domain";
import { VECTOR3D_VIEW_LIMITS } from "../../domain";
import {
  generateVector3DView,
  Vector3DViewpointApiError
} from "../../services/vector3d-viewpoint-service";
import {
  GaussianSplatViewport,
  type GaussianSplatLoadState,
  type GaussianSplatViewportHandle
} from "./GaussianSplatViewport";

type Vector3DViewpointWorkbenchProps = {
  endpointOverride?: EndpointOverride;
  models: ModelConfig[];
  onOpenSettings: () => void;
  onSelectModel: (modelId: string) => void;
  selectedModel?: ModelConfig;
};

type SourceImageState = {
  dataURL: string;
  height: number;
  name: string;
  sizeBytes: number;
  width: number;
};

type SourceUploadStatus = "idle" | "reading" | "ready" | "error";

type WorkbenchStatus =
  | "idle"
  | "captured"
  | Vector3DGenerationStage
  | "success"
  | "failed"
  | "cancelled";

type WorkbenchError = {
  code?: string;
  message: string;
  requestId?: string;
  retryable?: boolean;
};

type ReadinessItem = {
  id: "source" | "draft" | "model" | "api-key" | "size";
  label: string;
  ready: boolean;
};

const DEFAULT_CAMERA: Vector3DCameraParameters = {
  yaw: 0,
  pitch: 0,
  distance: 5,
  position: { x: 0, y: 0, z: -5 },
  rotation: { x: 0, y: 0, z: 0 },
  viewport: { width: 1, height: 1 }
};

export function Vector3DViewpointWorkbench(props: Vector3DViewpointWorkbenchProps) {
  const sourceInputRef = useRef<HTMLInputElement | null>(null);
  const viewportRef = useRef<GaussianSplatViewportHandle | null>(null);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const sourceReadTokenRef = useRef(0);
  const [proxyBuildVersion, setProxyBuildVersion] = useState(0);
  const [sourceImage, setSourceImage] = useState<SourceImageState>();
  const [sourceUploadStatus, setSourceUploadStatus] =
    useState<SourceUploadStatus>("idle");
  const [sourceStatusMessage, setSourceStatusMessage] =
    useState("尚未导入图片");
  const [sourceDropActive, setSourceDropActive] = useState(false);
  const [loadState, setLoadState] = useState<GaussianSplatLoadState>({
    status: "idle",
    progress: 0
  });
  const [camera, setCamera] = useState(DEFAULT_CAMERA);
  const [draftImage, setDraftImage] = useState<string>();
  const [draftSizeBytes, setDraftSizeBytes] = useState(0);
  const [draftCamera, setDraftCamera] = useState<Vector3DCameraParameters>();
  const [result, setResult] = useState<GenerateVector3DViewResult>();
  const [resultModelDisplayName, setResultModelDisplayName] = useState<string>();
  const [analysis, setAnalysis] = useState<Vector3DRepairAnalysis>();
  const [status, setStatus] = useState<WorkbenchStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("等待捕获新视角");
  const [error, setError] = useState<WorkbenchError>();

  const imageModels = useMemo(
    () =>
      props.models.filter(isVector3DImageModel),
    [props.models]
  );
  const activeImageModel = imageModels.find((model) => model.id === props.selectedModel?.id);

  useEffect(() => {
    if (!activeImageModel && imageModels[0]) {
      props.onSelectModel(imageModels[0].id);
    }
  }, [activeImageModel, imageModels, props.onSelectModel]);

  useEffect(
    () => () => {
      sourceReadTokenRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = undefined;
    },
    []
  );

  const busy = status === "reasoning" || status === "rendering";
  const canCapture =
    Boolean(sourceImage) &&
    sourceUploadStatus !== "reading" &&
    loadState.status === "ready" &&
    !busy;
  const sourceReady = Boolean(sourceImage) && sourceUploadStatus !== "reading";
  const combinedImageBytes = (sourceImage?.sizeBytes ?? 0) + draftSizeBytes;
  const readinessItems = useMemo<ReadinessItem[]>(
    () => [
      {
        id: "source",
        label:
          sourceUploadStatus === "reading"
            ? "原始参考图读取中"
            : sourceImage
              ? "原始参考图"
              : "缺少原始参考图",
        ready: sourceReady
      },
      {
        id: "draft",
        label:
          draftImage && draftCamera
            ? "Gaussian 代理镜头草图"
            : "尚未捕获代理镜头草图",
        ready: Boolean(draftImage && draftCamera)
      },
      {
        id: "model",
        label: activeImageModel ? activeImageModel.displayName : "缺少兼容的图片编辑模型",
        ready: Boolean(activeImageModel)
      },
      {
        id: "api-key",
        label: props.endpointOverride?.apiKey?.trim() ? "API Key" : "API Key 未配置",
        ready: Boolean(props.endpointOverride?.apiKey?.trim())
      },
      {
        id: "size",
        label:
          combinedImageBytes <= VECTOR3D_VIEW_LIMITS.combinedImageBytes
            ? `输入合计 ${formatBytes(combinedImageBytes)}`
            : "两张输入图合计超过 32 MB",
        ready: combinedImageBytes <= VECTOR3D_VIEW_LIMITS.combinedImageBytes
      }
    ],
    [
      activeImageModel,
      combinedImageBytes,
      draftCamera,
      draftImage,
      props.endpointOverride?.apiKey,
      sourceImage,
      sourceReady,
      sourceUploadStatus
    ]
  );
  const blockers = readinessItems.filter((item) => !item.ready);

  const handleSourceImage = async (file?: File) => {
    setError(undefined);

    if (!file) {
      return;
    }

    const readToken = sourceReadTokenRef.current + 1;
    sourceReadTokenRef.current = readToken;

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      const message = "原始参考图仅支持 PNG、JPEG 或 WebP。";
      setSourceUploadStatus("error");
      setSourceStatusMessage(sourceImage ? `${message} 已保留上一张图片。` : message);
      setError({ message });
      return;
    }

    if (file.size > VECTOR3D_VIEW_LIMITS.sourceImageBytes) {
      const message = "原始参考图不能超过 20 MB。";
      setSourceUploadStatus("error");
      setSourceStatusMessage(sourceImage ? `${message} 已保留上一张图片。` : message);
      setError({ message });
      return;
    }

    setSourceUploadStatus("reading");
    setSourceStatusMessage(`正在读取 ${file.name}`);

    try {
      const dataURL = await fileToDataURL(file);
      const dimensions = await readImageDimensions(dataURL);

      if (sourceReadTokenRef.current !== readToken) {
        return;
      }

      setSourceImage({
        dataURL,
        height: dimensions.height,
        name: file.name,
        sizeBytes: file.size,
        width: dimensions.width
      });
      setSourceUploadStatus("ready");
      setSourceStatusMessage(`图片已读取：${file.name}，正在构建 Gaussian 代理`);
      setLoadState({
        status: "loading",
        progress: 0
      });
      setProxyBuildVersion((current) => current + 1);
      setCamera(DEFAULT_CAMERA);
      setDraftImage(undefined);
      setDraftSizeBytes(0);
      setDraftCamera(undefined);
      setResult(undefined);
      setResultModelDisplayName(undefined);
      setAnalysis(undefined);
      setStatus("idle");
      setStatusMessage("正在从图片构建 Gaussian 代理场景");
    } catch (readError) {
      if (sourceReadTokenRef.current !== readToken) {
        return;
      }

      const message =
        readError instanceof Error ? readError.message : "原始参考图读取失败。";
      setSourceUploadStatus("error");
      setSourceStatusMessage(sourceImage ? `${message} 已保留上一张图片。` : message);
      setError({ message });
    }
  };

  const handleCapture = () => {
    setError(undefined);

    try {
      const snapshot = viewportRef.current?.capture();

      if (!snapshot) {
        throw new Error("3D 视口尚未就绪。");
      }

      const sizeBytes = dataURLByteLength(snapshot.image);

      if (sizeBytes > VECTOR3D_VIEW_LIMITS.draftImageBytes) {
        throw new Error("捕获的 Gaussian 代理草图超过 20 MB，请缩小浏览器窗口后重试。");
      }

      if (
        sizeBytes + (sourceImage?.sizeBytes ?? 0) >
        VECTOR3D_VIEW_LIMITS.combinedImageBytes
      ) {
        throw new Error("捕获草图与原始参考图合计超过 32 MB，请更换尺寸更小的原图。");
      }

      setDraftImage(snapshot.image);
      setDraftSizeBytes(sizeBytes);
      setDraftCamera(snapshot.camera);
      setCamera(snapshot.camera);
      setResult(undefined);
      setResultModelDisplayName(undefined);
      setAnalysis(undefined);
      setStatus("captured");
      setStatusMessage("已捕获当前相机矩阵与 Gaussian 代理草图");
    } catch (captureError) {
      setError({
        message:
          captureError instanceof Error ? captureError.message : "当前镜头捕获失败。"
      });
    }
  };

  const handleGenerate = async () => {
    if (busy) {
      return;
    }

    if (
      !sourceImage ||
      !draftImage ||
      !draftCamera ||
      !activeImageModel ||
      blockers.length > 0
    ) {
      const firstBlocker = blockers[0];
      setError({
        code: "VECTOR3D_NOT_READY",
        message: firstBlocker
          ? `暂时无法生成：${firstBlocker.label}。`
          : "当前输入尚未准备完成。"
      });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    const requestId = crypto.randomUUID();
    abortRef.current = controller;
    setError(undefined);
    setResult(undefined);
    setResultModelDisplayName(undefined);
    setAnalysis(undefined);
    setStatus("reasoning");
    setStatusMessage("gpt-5.5 正在分析三维几何与形变补偿");

    try {
      const generated = await generateVector3DView(
        {
          requestId,
          source_image: sourceImage.dataURL,
          draft_image: draftImage,
          camera_parameters: draftCamera,
          reasoning_model: "gpt-5.5",
          image_model: activeImageModel.apiModelName,
          endpoint_override: props.endpointOverride
        },
        {
          onStage: (nextStage, message, nextAnalysis) => {
            if (abortRef.current !== controller || controller.signal.aborted) {
              return;
            }

            setStatus(nextStage);
            setStatusMessage(
              nextStage === "rendering"
                ? `${activeImageModel.displayName} 正在以 Gaussian 代理草图为镜头锚点重塑材质与隐藏区域`
                : message
            );

            if (nextAnalysis) {
              setAnalysis(nextAnalysis);
            }
          }
        },
        controller.signal
      );

      if (abortRef.current !== controller || controller.signal.aborted) {
        return;
      }

      setResult(generated);
      setResultModelDisplayName(activeImageModel.displayName);
      setAnalysis(generated);
      setStatus("success");
      setStatusMessage("电影级新视角重塑完成");
    } catch (generationError) {
      if (controller.signal.aborted) {
        if (abortRef.current === controller) {
          setStatus("cancelled");
          setStatusMessage("当前生成已取消，可调整输入后重新开始");
        }
        return;
      }

      if (abortRef.current !== controller) {
        return;
      }

      setStatus("failed");
      setStatusMessage("双模型管线执行失败");
      setError({
        code:
          generationError instanceof Vector3DViewpointApiError
            ? generationError.code
            : undefined,
        message:
          generationError instanceof Error
            ? generationError.message
            : "3D 视角重塑失败。",
        requestId:
          generationError instanceof Vector3DViewpointApiError
            ? generationError.requestId ?? requestId
            : requestId,
        retryable:
          generationError instanceof Vector3DViewpointApiError
            ? generationError.retryable
            : false
      });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = undefined;
      }
    }
  };

  const handleCancelGeneration = () => {
    if (!abortRef.current) {
      return;
    }

    abortRef.current.abort();
    abortRef.current = undefined;
    setStatus("cancelled");
    setStatusMessage("当前生成已取消，可调整输入后重新开始");
    setError(undefined);
  };

  const handleRemoveSourceImage = () => {
    sourceReadTokenRef.current += 1;
    setSourceImage(undefined);
    setSourceUploadStatus("idle");
    setSourceStatusMessage("导入图片已移除");
    setLoadState({
      status: "idle",
      progress: 0
    });
    setProxyBuildVersion((current) => current + 1);
    setCamera(DEFAULT_CAMERA);
    setDraftImage(undefined);
    setDraftSizeBytes(0);
    setDraftCamera(undefined);
    setResult(undefined);
    setResultModelDisplayName(undefined);
    setAnalysis(undefined);
    setError(undefined);
    setStatus("idle");
    setStatusMessage("等待导入图片");
  };

  const handleRetryProxyBuild = () => {
    if (!sourceImage || busy) {
      return;
    }

    setError(undefined);
    setLoadState({
      status: "loading",
      progress: 0
    });
    setSourceUploadStatus("ready");
    setSourceStatusMessage(`正在重新构建 ${sourceImage.name} 的 Gaussian 代理`);
    setStatusMessage("正在重新构建 Gaussian 代理场景");
    setProxyBuildVersion((current) => current + 1);
  };

  const handleSourceInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    void handleSourceImage(file);
  };

  const handleSourceDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setSourceDropActive(false);

    if (!busy) {
      void handleSourceImage(event.dataTransfer.files?.[0]);
    }
  };

  const handleDownload = () => {
    if (!result?.image) {
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = result.image;
    anchor.download = `vector3d-view-${Date.now()}.png`;
    anchor.rel = "noreferrer";
    anchor.click();
  };

  return (
    <section className="vector3d-workbench" aria-label="Vector3D Viewpoint 工作台">
      <header className="vector3d-pipeline-bar">
        <div className="vector3d-pipeline-identity">
          <Orbit size={19} />
          <div>
            <strong>Vector3D-Viewpoint</strong>
            <span>IMAGE-DRIVEN GAUSSIAN PIPELINE</span>
          </div>
        </div>

        <div className="vector3d-model-route">
          <span>空间推理</span>
          <strong>gpt-5.5</strong>
          <i />
          <span>图像重塑</span>
          <select
            aria-label="图像重塑模型"
            disabled={busy || imageModels.length === 0}
            onChange={(event) => props.onSelectModel(event.target.value)}
            value={activeImageModel?.id ?? ""}
          >
            {imageModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName}
              </option>
            ))}
          </select>
        </div>

        <div
          className={`vector3d-api-state${props.endpointOverride?.apiKey ? " is-ready" : ""}`}
          title={props.endpointOverride?.apiKey ? "API Key 已配置" : "请在设置中配置 API Key"}
        >
          <span />
          {props.endpointOverride?.apiKey ? "API READY" : "API KEY MISSING"}
        </div>
      </header>

      <div className="vector3d-progress-rail" aria-label="生成进度">
        <ProgressStep
          active={loadState.status === "loading"}
          complete={loadState.status === "ready"}
          index="01"
          label="构建高斯代理"
        />
        <ProgressStep
          active={status === "captured"}
          complete={Boolean(draftImage)}
          index="02"
          label="捕获相机矩阵"
        />
        <ProgressStep
          active={status === "reasoning"}
          complete={status === "rendering" || status === "success"}
          index="03"
          label="空间与形变分析"
        />
        <ProgressStep
          active={status === "rendering"}
          complete={status === "success"}
          index="04"
          label="电影级细节重塑"
        />
        <div className={`vector3d-live-status status-${status}`}>
          {busy && <LoaderCircle className="spin" size={15} />}
          {status === "success" && <Check size={15} />}
          <span>{statusMessage}</span>
        </div>
      </div>

      {error && (
        <div className="vector3d-error" role="alert">
          <AlertTriangle size={16} />
          <div className="vector3d-error-copy">
            <strong>{error.message}</strong>
            {(error.code || error.requestId) && (
              <span>
                {error.code && `错误码 ${error.code}`}
                {error.code && error.requestId && " · "}
                {error.requestId && `请求 ID ${error.requestId}`}
              </span>
            )}
            {typeof error.retryable === "boolean" && (
              <span>{error.retryable ? "该错误可以重试" : "该错误不建议直接重试"}</span>
            )}
          </div>
          <div className="vector3d-error-actions">
            {error.retryable && (
              <button
                className="vector3d-error-action"
                disabled={busy}
                onClick={() => {
                  if (error.code === "VECTOR3D_PROXY_BUILD_FAILED") {
                    handleRetryProxyBuild();
                  } else {
                    void handleGenerate();
                  }
                }}
                type="button"
              >
                <RefreshCw size={14} />
                重试
              </button>
            )}
            {(!props.endpointOverride?.apiKey?.trim() || error.code === "API_KEY_REQUIRED") && (
              <button
                className="vector3d-error-action"
                onClick={props.onOpenSettings}
                type="button"
              >
                <Settings size={14} />
                打开设置
              </button>
            )}
          </div>
        </div>
      )}

      <div className="vector3d-main-grid">
        <section className="vector3d-viewport-panel">
          <header className="vector3d-panel-header">
            <div>
              <span>LIVE SCENE</span>
              <strong>{sourceImage?.name ?? "尚未导入图片"}</strong>
            </div>
            <div className="vector3d-file-actions">
              <input
                accept="image/png,image/jpeg,image/webp"
                className="visually-hidden"
                onChange={handleSourceInputChange}
                ref={sourceInputRef}
                type="file"
              />
              <button
                className={`vector3d-tool-button${sourceImage ? " is-ready" : ""}`}
                disabled={busy}
                onClick={() => sourceInputRef.current?.click()}
                title="导入用于构建 Gaussian 代理的图片"
                type="button"
              >
                <FileImage size={15} />
                <span>导入图片</span>
              </button>
            </div>
          </header>

          <div
            className={`vector3d-source-asset is-${sourceUploadStatus}${sourceDropActive ? " is-dragging" : ""}`}
            data-testid="vector3d-source-dropzone"
            onDragEnter={(event) => {
              event.preventDefault();
              if (!busy) {
                setSourceDropActive(true);
              }
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setSourceDropActive(false);
              }
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleSourceDrop}
          >
            <div className="vector3d-source-preview">
              {sourceImage ? (
                <img alt="原始高清参考图缩略图" src={sourceImage.dataURL} />
              ) : sourceUploadStatus === "reading" ? (
                <LoaderCircle className="spin" size={22} />
              ) : (
                <ImagePlus size={22} />
              )}
            </div>
            <div className="vector3d-source-copy">
              <span>IMAGE INPUT / IDENTITY REFERENCE</span>
              <strong>{sourceImage?.name ?? "拖放或选择一张图片"}</strong>
              <small>
                {sourceImage
                  ? `${sourceImage.width} × ${sourceImage.height} · ${formatBytes(sourceImage.sizeBytes)}`
                  : "PNG / JPEG / WebP · 单图不超过 20 MB"}
              </small>
              <p aria-live="polite">{sourceStatusMessage}</p>
            </div>
            <div className="vector3d-source-actions">
              <button
                className="vector3d-icon-button"
                disabled={busy || sourceUploadStatus === "reading"}
                onClick={() => sourceInputRef.current?.click()}
                title={sourceImage ? "替换导入图片" : "选择导入图片"}
                type="button"
              >
                {sourceImage ? <RefreshCw size={16} /> : <FolderOpen size={16} />}
              </button>
              {sourceImage && (
                <button
                  className="vector3d-icon-button is-danger"
                  disabled={busy}
                  onClick={handleRemoveSourceImage}
                  title="删除导入图片"
                  type="button"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>

          <div className="vector3d-viewport-shell">
            <GaussianSplatViewport
              sourceImage={sourceImage}
              onCameraChange={setCamera}
              onLoadStateChange={(nextState) => {
                setLoadState(nextState);

                if (nextState.status === "ready") {
                  setSourceUploadStatus("ready");
                  setSourceStatusMessage(
                    sourceImage
                      ? `图片高斯代理已就绪：${sourceImage.name}`
                      : "图片高斯代理已就绪"
                  );
                  setStatusMessage("图片 Gaussian 代理已就绪，可捕获当前镜头");
                } else if (nextState.status === "failed") {
                  setSourceStatusMessage("图片已读取，但 Gaussian 代理构建失败");
                  setError({
                    code: "VECTOR3D_PROXY_BUILD_FAILED",
                    message: nextState.error ?? "图片 Gaussian 代理构建失败。",
                    retryable: true
                  });
                }
              }}
              ref={viewportRef}
              rebuildToken={proxyBuildVersion}
            />

            {loadState.status !== "ready" && (
              <div className={`vector3d-viewport-overlay is-${loadState.status}`}>
                {loadState.status === "loading" ? (
                  <>
                    <LoaderCircle className="spin" size={25} />
                    <strong>{loadState.progress}%</strong>
                    <span>正在从图片采样颜色、轮廓与浅层深度</span>
                  </>
                ) : loadState.status === "failed" ? (
                  <>
                    <AlertTriangle size={25} />
                    <strong>PROXY BUILD FAILED</strong>
                    <span>{loadState.error ?? "无法从当前图片构建 Gaussian 代理"}</span>
                    {sourceImage && (
                      <button
                        className="vector3d-overlay-action"
                        disabled={busy}
                        onClick={handleRetryProxyBuild}
                        type="button"
                      >
                        <RefreshCw size={14} />
                        重试构建
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <Upload size={25} />
                    <strong>IMAGE-DRIVEN GAUSSIAN PROXY</strong>
                    <span>导入图片后生成可环绕的浅层 Gaussian 代理</span>
                    <button
                      className="vector3d-overlay-action"
                      disabled={busy}
                      onClick={() => sourceInputRef.current?.click()}
                      type="button"
                    >
                      <FolderOpen size={14} />
                      导入图片
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="vector3d-camera-console">
            <CameraAxis label="YAW / 方位角" max={180} min={-180} value={camera.yaw} />
            <CameraAxis label="PITCH / 极角" max={90} min={-90} value={camera.pitch} />
            <div className="vector3d-distance-readout">
              <span>DISTANCE</span>
              <strong>{camera.distance.toFixed(2)}</strong>
            </div>
          </div>

          <footer className="vector3d-viewport-actions">
            <button
              className="vector3d-icon-button"
              disabled={busy}
              onClick={() => viewportRef.current?.resetCamera()}
              title="重置相机"
              type="button"
            >
              <RotateCcw size={17} />
            </button>
            <div className="vector3d-scene-facts">
              <span>
                {loadState.pointCount
                  ? `${loadState.pointCount.toLocaleString()} IMAGE-DRIVEN SPLATS`
                  : "NO PROXY SCENE"}
              </span>
              <span>{camera.viewport.width} × {camera.viewport.height}</span>
            </div>
            <button
              className="vector3d-capture-button"
              disabled={!canCapture}
              onClick={handleCapture}
              type="button"
            >
              <Camera size={17} />
              捕获当前镜头
            </button>
          </footer>
        </section>

        <section className="vector3d-output-stack">
          <OutputPanel
            badge="DRAFT / GAUSSIAN PROXY"
            emptyIcon={<ImageIcon size={27} />}
            emptyLabel="等待捕获代理镜头草图"
            image={draftImage}
            title="当前视角结构骨架"
          />

          <OutputPanel
            actions={
              result ? (
                <button
                  className="vector3d-icon-button"
                  onClick={handleDownload}
                  title="下载重塑结果"
                  type="button"
                >
                  <Download size={17} />
                </button>
              ) : undefined
            }
            badge={`FINAL / ${resultModelDisplayName ?? activeImageModel?.displayName ?? "IMAGE EDITS"}`}
            emptyIcon={busy ? <LoaderCircle className="spin" size={27} /> : <Sparkles size={27} />}
            emptyLabel={busy ? statusMessage : "等待电影级重塑结果"}
            image={result?.image}
            title="材质与盲区重塑"
          />

          <div className="vector3d-generation-console">
            <div className="vector3d-generate-copy">
              <span>VIEWPOINT</span>
              <strong>{analysis?.viewDescription ?? formatViewDescription(draftCamera ?? camera)}</strong>
            </div>
            <div className="vector3d-generation-actions">
              {busy && (
                <button
                  className="vector3d-cancel-button"
                  onClick={handleCancelGeneration}
                  type="button"
                >
                  取消生成
                </button>
              )}
              <button
                className="vector3d-generate-button"
                disabled={busy}
                onClick={() => void handleGenerate()}
                type="button"
              >
                {busy ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}
                {busy ? "双模型协作中" : "生成电影级新视角"}
              </button>
            </div>
          </div>

          <div className="vector3d-readiness" aria-label="生成条件">
            {readinessItems.map((item) => (
              <div
                className={item.ready ? "is-ready" : "is-blocked"}
                key={item.id}
              >
                {item.ready ? <CircleCheck size={14} /> : <Circle size={14} />}
                <span>{item.label}</span>
                {item.id === "api-key" && !item.ready && (
                  <button onClick={props.onOpenSettings} type="button">
                    <Settings size={13} />
                    设置
                  </button>
                )}
              </div>
            ))}
          </div>

          {analysis && (
            <details className="vector3d-analysis-details">
              <summary>空间修复计划 · {analysis.repairNotes.length} 项补偿</summary>
              <p>{analysis.optimizedPrompt}</p>
              {analysis.repairNotes.length > 0 && (
                <ul>
                  {analysis.repairNotes.map((note, index) => (
                    <li key={`${index}-${note}`}>{note}</li>
                  ))}
                </ul>
              )}
              {result && (
                <div className="vector3d-timing-row">
                  <span>推理 {(result.reasoningDurationMs / 1000).toFixed(1)}s</span>
                  <span>渲染 {(result.renderingDurationMs / 1000).toFixed(1)}s</span>
                  <span>总计 {(result.totalDurationMs / 1000).toFixed(1)}s</span>
                </div>
              )}
            </details>
          )}
        </section>
      </div>
    </section>
  );
}

function ProgressStep(props: {
  active: boolean;
  complete: boolean;
  index: string;
  label: string;
}) {
  return (
    <div className={`vector3d-progress-step${props.active ? " is-active" : ""}${props.complete ? " is-complete" : ""}`}>
      <span>{props.complete ? <Check size={12} /> : props.index}</span>
      <strong>{props.label}</strong>
    </div>
  );
}

function CameraAxis(props: {
  label: string;
  min: number;
  max: number;
  value: number;
}) {
  const percent = ((props.value - props.min) / (props.max - props.min)) * 100;

  return (
    <div className="vector3d-camera-axis">
      <div>
        <span>{props.label}</span>
        <strong>{formatAngle(props.value)}</strong>
      </div>
      <div className="vector3d-axis-track">
        <i style={{ left: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
    </div>
  );
}

function OutputPanel(props: {
  actions?: ReactNode;
  badge: string;
  emptyIcon: ReactNode;
  emptyLabel: string;
  image?: string;
  title: string;
}) {
  return (
    <section className="vector3d-output-panel">
      <header>
        <div>
          <span>{props.badge}</span>
          <strong>{props.title}</strong>
        </div>
        {props.actions}
      </header>
      <div className="vector3d-image-stage">
        {props.image ? (
          <img alt={props.title} src={props.image} />
        ) : (
          <div className="vector3d-output-empty">
            {props.emptyIcon}
            <span>{props.emptyLabel}</span>
          </div>
        )}
      </div>
    </section>
  );
}

function formatAngle(value: number) {
  const normalized = Math.abs(value) < 0.005 ? 0 : value;
  return `${normalized >= 0 ? "+" : ""}${normalized.toFixed(1)}°`;
}

function formatViewDescription(camera: Vector3DCameraParameters) {
  const horizontal =
    Math.abs(camera.yaw) < 15
      ? "正面"
      : Math.abs(camera.yaw) > 165
        ? "背面"
        : camera.yaw > 0
          ? `右侧 ${Math.abs(camera.yaw).toFixed(0)}°`
          : `左侧 ${Math.abs(camera.yaw).toFixed(0)}°`;
  const vertical =
    Math.abs(camera.pitch) < 8
      ? "平视"
      : camera.pitch > 0
        ? `俯视 ${camera.pitch.toFixed(0)}°`
        : `仰视 ${Math.abs(camera.pitch).toFixed(0)}°`;

  return `${horizontal} · ${vertical}`;
}

function fileToDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("文件读取结果无效。"));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("文件读取失败。"));
    reader.readAsDataURL(file);
  });
}

export function isVector3DImageModel(model: ModelConfig) {
  return (
    model.enabled &&
    (model.apiType === "openai-image" ||
      model.apiType === "openai-image-edit") &&
    model.editCapabilities.supportsWholeImageEdit &&
    model.capabilities.maxReferenceImages >= 2
  );
}

function readImageDimensions(dataURL: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;

      if (width > 0 && height > 0) {
        resolve({ width, height });
      } else {
        reject(new Error("图片已读取，但没有有效的像素尺寸。"));
      }
    };
    image.onerror = () => reject(new Error("图片无法解码，请确认文件内容未损坏。"));
    image.src = dataURL;
  });
}

function dataURLByteLength(dataURL: string) {
  const separator = dataURL.indexOf(",");

  if (separator < 0) {
    return 0;
  }

  const payload = dataURL.slice(separator + 1).replace(/\s+/g, "");
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
