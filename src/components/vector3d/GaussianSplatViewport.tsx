import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type Ref
} from "react";
import * as SPLAT from "gsplat";
import type { Vector3DCameraParameters } from "../../domain";
import {
  buildImageGaussianSplat,
  calculateProxySampleSize
} from "./image-gaussian-proxy";

export type GaussianSplatLoadState = {
  status: "idle" | "loading" | "ready" | "failed";
  progress: number;
  pointCount?: number;
  error?: string;
};

export type GaussianSplatViewportHandle = {
  capture: () => {
    image: string;
    camera: Vector3DCameraParameters;
  };
  resetCamera: () => void;
};

type GaussianSplatViewportProps = {
  sourceImage?: {
    dataURL: string;
    height: number;
    width: number;
  };
  onCameraChange: (camera: Vector3DCameraParameters) => void;
  onLoadStateChange: (state: GaussianSplatLoadState) => void;
  rebuildToken?: number;
};

function GaussianSplatViewportComponent(
  props: GaussianSplatViewportProps,
  ref: Ref<GaussianSplatViewportHandle>
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<SPLAT.Scene | undefined>(undefined);
  const cameraRef = useRef<SPLAT.Camera | undefined>(undefined);
  const rendererRef = useRef<SPLAT.WebGLRenderer | undefined>(undefined);
  const controlsRef = useRef<SPLAT.OrbitControls | undefined>(undefined);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const loadTokenRef = useRef(0);
  const hasModelRef = useRef(false);
  const lastCameraUpdateRef = useRef(0);

  const resetCamera = () => {
    const camera = cameraRef.current;
    const renderer = rendererRef.current;

    if (!camera || !renderer) {
      return;
    }

    controlsRef.current?.dispose();
    controlsRef.current = new SPLAT.OrbitControls(
      camera,
      renderer.canvas,
      0,
      -0.08,
      5,
      false,
      new SPLAT.Vector3()
    );
  };

  useImperativeHandle(ref, () => ({
    capture: () => {
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      const renderer = rendererRef.current;

      if (!scene || !camera || !renderer || !hasModelRef.current) {
        throw new Error("请先导入图片并等待 Gaussian 代理场景构建完成。");
      }

      controlsRef.current?.update();
      resizeRenderer(renderer);
      renderer.render(scene, camera);

      const { canvas, gl } = renderer;
      const width = canvas.width;
      const height = canvas.height;

      if (width < 1 || height < 1) {
        throw new Error("3D 视口尺寸无效，无法捕获镜头。");
      }

      const pixels = new Uint8Array(width * height * 4);
      gl.finish();
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = width;
      sourceCanvas.height = height;
      const sourceContext = sourceCanvas.getContext("2d");

      if (!sourceContext) {
        throw new Error("浏览器无法创建快照画布。");
      }

      const imageData = sourceContext.createImageData(width, height);
      const rowLength = width * 4;

      for (let row = 0; row < height; row += 1) {
        const sourceOffset = (height - row - 1) * rowLength;
        imageData.data.set(
          pixels.subarray(sourceOffset, sourceOffset + rowLength),
          row * rowLength
        );
      }

      sourceContext.putImageData(imageData, 0, 0);

      const targetAspect = 16 / 9;
      const sourceAspect = width / height;
      const cropWidth =
        sourceAspect > targetAspect ? height * targetAspect : width;
      const cropHeight =
        sourceAspect > targetAspect ? height : width / targetAspect;
      const cropX = (width - cropWidth) / 2;
      const cropY = (height - cropHeight) / 2;
      const scale = Math.min(1, 2048 / cropWidth, 1152 / cropHeight);
      const scaledWidth = Math.max(1, Math.floor(cropWidth * scale));
      const outputWidth =
        scaledWidth >= 16 ? Math.max(16, Math.floor(scaledWidth / 16) * 16) : scaledWidth;
      const outputHeight =
        scaledWidth >= 16
          ? Math.max(9, Math.floor((outputWidth * 9) / 16))
          : Math.max(1, Math.floor(cropHeight * scale));
      const outputCanvas = document.createElement("canvas");
      outputCanvas.width = outputWidth;
      outputCanvas.height = outputHeight;
      const outputContext = outputCanvas.getContext("2d");

      if (!outputContext) {
        throw new Error("浏览器无法创建 16:9 输出画布。");
      }

      outputContext.imageSmoothingEnabled = true;
      outputContext.imageSmoothingQuality = "high";
      outputContext.drawImage(
        sourceCanvas,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        0,
        0,
        outputWidth,
        outputHeight
      );

      return {
        image: outputCanvas.toDataURL("image/png"),
        camera: readCameraParameters(camera, {
          width: outputWidth,
          height: outputHeight
        })
      };
    },
    resetCamera
  }));

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    let disposed = false;

    try {
      const scene = new SPLAT.Scene();
      const camera = new SPLAT.Camera();
      const renderer = new SPLAT.WebGLRenderer(canvas);
      renderer.backgroundColor = new SPLAT.Color32(5, 9, 15, 255);

      sceneRef.current = scene;
      cameraRef.current = camera;
      rendererRef.current = renderer;
      resetCamera();

      const resizeObserver = new ResizeObserver(() => {
        resizeRenderer(renderer);
      });
      resizeObserver.observe(canvas);

      const frame = (time: number) => {
        if (disposed) {
          return;
        }

        controlsRef.current?.update();
        resizeRenderer(renderer);
        renderer.render(scene, camera);

        if (time - lastCameraUpdateRef.current > 80) {
          lastCameraUpdateRef.current = time;
          props.onCameraChange(readCameraParameters(camera, canvas));
        }

        animationFrameRef.current = requestAnimationFrame(frame);
      };

      animationFrameRef.current = requestAnimationFrame(frame);

      return () => {
        disposed = true;
        resizeObserver.disconnect();
        loadTokenRef.current += 1;

        if (animationFrameRef.current !== undefined) {
          cancelAnimationFrame(animationFrameRef.current);
        }

        controlsRef.current?.dispose();
        renderer.dispose();
        scene.reset();
        controlsRef.current = undefined;
        rendererRef.current = undefined;
        cameraRef.current = undefined;
        sceneRef.current = undefined;
      };
    } catch (error) {
      props.onLoadStateChange({
        status: "failed",
        progress: 0,
        error: error instanceof Error ? error.message : "WebGL 3D 视口初始化失败。"
      });
    }
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;

    if (!scene) {
      return;
    }

    const token = loadTokenRef.current + 1;
    loadTokenRef.current = token;
    scene.reset();
    hasModelRef.current = false;

    if (!props.sourceImage) {
      props.onLoadStateChange({
        status: "idle",
        progress: 0
      });
      return;
    }

    props.onLoadStateChange({
      status: "loading",
      progress: 4
    });

    void decodeImagePixels(props.sourceImage, selectPointBudget())
      .then(async (imageData) => {
        if (loadTokenRef.current !== token) {
          return;
        }

        props.onLoadStateChange({
          status: "loading",
          progress: 48
        });
        await yieldToBrowser();

        if (loadTokenRef.current !== token) {
          return;
        }

        const proxy = buildImageGaussianSplat(imageData, {
          maxPoints: selectPointBudget()
        });
        props.onLoadStateChange({
          status: "loading",
          progress: 82,
          pointCount: proxy.vertexCount
        });
        await yieldToBrowser();

        if (loadTokenRef.current !== token) {
          return;
        }

        const splat = new SPLAT.Splat(
          new SPLAT.SplatData(
            proxy.vertexCount,
            proxy.positions,
            proxy.rotations,
            proxy.scales,
            proxy.colors
          )
        );
        splat.recalculateBounds();
        normalizeSplat(splat);
        scene.addObject(splat);
        hasModelRef.current = true;
        resetCamera();
        props.onLoadStateChange({
          status: "ready",
          progress: 100,
          pointCount: splat.data.vertexCount
        });
      })
      .catch((error) => {
        if (loadTokenRef.current !== token) {
          return;
        }

        scene.reset();
        props.onLoadStateChange({
          status: "failed",
          progress: 0,
          error:
            error instanceof Error
              ? error.message
              : "图片 Gaussian 代理构建失败。"
        });
      });
  }, [props.sourceImage, props.rebuildToken]);

  return <canvas className="vector3d-canvas" ref={canvasRef} />;
}

function normalizeSplat(splat: SPLAT.Splat) {
  const center = splat.bounds.center();
  const size = splat.bounds.size();
  const maxExtent = Math.max(size.x, size.y, size.z);

  if (!Number.isFinite(maxExtent) || maxExtent <= 0) {
    return;
  }

  const scale = 3.6 / maxExtent;
  splat.scale = SPLAT.Vector3.One(scale);
  splat.position = center.multiply(-scale);
}

async function decodeImagePixels(
  source: { dataURL: string; height: number; width: number },
  maxPoints: number
) {
  const image = await loadImage(source.dataURL);
  const sourceWidth = image.naturalWidth || image.width || source.width;
  const sourceHeight = image.naturalHeight || image.height || source.height;
  const sampleSize = calculateProxySampleSize(
    sourceWidth,
    sourceHeight,
    maxPoints
  );
  const canvas = document.createElement("canvas");
  canvas.width = sampleSize.width;
  canvas.height = sampleSize.height;
  const context = canvas.getContext("2d", {
    willReadFrequently: true
  });

  if (!context) {
    throw new Error("浏览器无法创建图片采样画布。");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, sampleSize.width, sampleSize.height);
  return context.getImageData(0, 0, sampleSize.width, sampleSize.height);
}

function loadImage(dataURL: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("图片无法解码，不能构建 Gaussian 代理。"));
    image.src = dataURL;
  });
}

function selectPointBudget() {
  const mobileViewport =
    typeof window !== "undefined" && window.matchMedia?.("(max-width: 700px)").matches;
  const lowConcurrency =
    typeof navigator !== "undefined" &&
    navigator.hardwareConcurrency > 0 &&
    navigator.hardwareConcurrency <= 4;

  return mobileViewport || lowConcurrency ? 32_000 : 64_000;
}

function resizeRenderer(renderer: SPLAT.WebGLRenderer) {
  const { canvas } = renderer;
  const pixelRatio = Math.min(
    2,
    Math.max(1, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1)
  );
  const width = Math.max(1, Math.round(canvas.clientWidth * pixelRatio));
  const height = Math.max(1, Math.round(canvas.clientHeight * pixelRatio));

  if (canvas.width !== width || canvas.height !== height) {
    renderer.setSize(width, height);
  }
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function readCameraParameters(
  camera: SPLAT.Camera,
  viewport: { width: number; height: number }
): Vector3DCameraParameters {
  const euler = camera.rotation.toEuler();
  const radiansToDegrees = 180 / Math.PI;
  const yaw = normalizeDegrees(-euler.y * radiansToDegrees);
  const pitch = clamp(euler.x * radiansToDegrees, -90, 90);

  return {
    yaw,
    pitch,
    distance: Math.max(camera.position.magnitude(), 0.0001),
    position: {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z
    },
    rotation: {
      x: euler.x,
      y: euler.y,
      z: euler.z
    },
    viewport: {
      width: Math.max(1, viewport.width),
      height: Math.max(1, viewport.height)
    }
  };
}

function normalizeDegrees(value: number) {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 ? 180 : normalized;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export const GaussianSplatViewport = forwardRef(GaussianSplatViewportComponent);
