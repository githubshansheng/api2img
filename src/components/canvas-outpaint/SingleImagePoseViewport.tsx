import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref
} from "react";
import * as THREE from "three";
import {
  accumulateSingleImageRotation,
  buildSingleImageCameraPose,
  clampSingleImageCameraDistance,
  clampSingleImageRotationAngle,
  normalizeSingleImageRotationAngle,
  type XYZRotation
} from "../../domain";

export type SingleImagePoseViewportHandle = {
  exportPoseGuide: () => {
    cameraViewImage: string;
    image: string;
    width: number;
    height: number;
  };
};

type SingleImagePoseViewportProps = {
  cameraDistance: number;
  disabled?: boolean;
  imageHeight: number;
  imageURL?: string;
  imageWidth: number;
  onReadyChange?: (ready: boolean) => void;
  onRotationChange: (rotation: XYZRotation) => void;
  rotation: XYZRotation;
};

type PointerDrag = {
  pointerId: number;
  lastX: number;
  lastY: number;
  rollMode: boolean;
};

type RollRingDrag = {
  pointerId: number;
  previousVisualAngle: number;
};

type ViewportRuntime = {
  camera: THREE.PerspectiveCamera;
  cardGroup: THREE.Group;
  helperGroup: THREE.Group;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
};

const GUIDE_LONG_EDGE = 1536;

function SingleImagePoseViewportComponent(
  {
    cameraDistance,
    disabled = false,
    imageHeight,
    imageURL,
    imageWidth,
    onReadyChange,
    onRotationChange,
    rotation
  }: SingleImagePoseViewportProps,
  ref: Ref<SingleImagePoseViewportHandle>
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<ViewportRuntime | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);
  const textureLoadTokenRef = useRef(0);
  const dragRef = useRef<PointerDrag | null>(null);
  const rollDragRef = useRef<RollRingDrag | null>(null);
  const rotationRef = useRef(rotation);
  const cameraDistanceRef = useRef(cameraDistance);
  const onRotationChangeRef = useRef(onRotationChange);
  const onReadyChangeRef = useRef(onReadyChange);
  const imageSizeRef = useRef({
    width: Math.max(1, imageWidth),
    height: Math.max(1, imageHeight)
  });

  rotationRef.current = rotation;
  cameraDistanceRef.current = cameraDistance;
  onRotationChangeRef.current = onRotationChange;
  onReadyChangeRef.current = onReadyChange;
  imageSizeRef.current = {
    width: Math.max(1, imageWidth),
    height: Math.max(1, imageHeight)
  };

  useImperativeHandle(ref, () => ({
    exportPoseGuide: () => {
      const runtime = runtimeRef.current;

      if (!runtime || !textureRef.current || !imageURL) {
        throw new Error("请先上传并完成参考图加载。");
      }

      return exportPoseGuide(runtime, imageSizeRef.current);
    }
  }));

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    let resizeObserver: ResizeObserver | undefined;

    try {
      const renderer = new THREE.WebGLRenderer({
        alpha: false,
        antialias: true,
        canvas,
        preserveDrawingBuffer: true
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x081019, 1);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x081019);
      const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
      const cardGroup = new THREE.Group();
      const helperGroup = buildPoseHelpers();

      scene.add(cardGroup);
      scene.add(helperGroup);
      scene.add(new THREE.HemisphereLight(0xb8ddf2, 0x101722, 1.6));

      const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
      keyLight.position.set(-3.5, 4.5, -5);
      scene.add(keyLight);

      const rimLight = new THREE.DirectionalLight(0x54d8e8, 1.4);
      rimLight.position.set(4, 1.5, 4);
      scene.add(rimLight);

      runtimeRef.current = {
        camera,
        cardGroup,
        helperGroup,
        renderer,
        scene
      };

      const resize = () => {
        const bounds = canvas.getBoundingClientRect();
        const width = Math.max(1, Math.round(bounds.width));
        const height = Math.max(1, Math.round(bounds.height));

        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderRuntime(
          runtimeRef.current,
          rotationRef.current,
          cameraDistanceRef.current
        );
      };

      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(canvas);
      resize();
    } catch {
      runtimeRef.current = null;
      onReadyChangeRef.current?.(false);
    }

    return () => {
      textureLoadTokenRef.current += 1;
      resizeObserver?.disconnect();

      const runtime = runtimeRef.current;

      if (runtime) {
        disposeGroup(runtime.cardGroup);
        disposeGroup(runtime.helperGroup);
        runtime.renderer.dispose();
      }

      textureRef.current?.dispose();
      textureRef.current = null;
      runtimeRef.current = null;
      onReadyChangeRef.current?.(false);
      dragRef.current = null;
      rollDragRef.current = null;
    };
  }, []);

  useEffect(() => {
    renderRuntime(runtimeRef.current, rotation, cameraDistance);
  }, [cameraDistance, rotation]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    const loadToken = textureLoadTokenRef.current + 1;
    textureLoadTokenRef.current = loadToken;

    if (!runtime) {
      return;
    }

    disposeGroup(runtime.cardGroup);
    runtime.cardGroup.clear();
    textureRef.current?.dispose();
    textureRef.current = null;
    onReadyChangeRef.current?.(false);

    if (!imageURL) {
      renderRuntime(
        runtime,
        rotationRef.current,
        cameraDistanceRef.current
      );
      return;
    }

    new THREE.TextureLoader().load(
      imageURL,
      (texture) => {
        if (textureLoadTokenRef.current !== loadToken) {
          texture.dispose();
          return;
        }

        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        textureRef.current = texture;
        populateReferenceCard(
          runtime.cardGroup,
          texture,
          Math.max(1, imageWidth),
          Math.max(1, imageHeight)
        );
        onReadyChangeRef.current?.(true);
        renderRuntime(
          runtime,
          rotationRef.current,
          cameraDistanceRef.current
        );
      },
      undefined,
      () => {
        if (textureLoadTokenRef.current === loadToken) {
          textureRef.current = null;
          onReadyChangeRef.current?.(false);
          renderRuntime(
            runtime,
            rotationRef.current,
            cameraDistanceRef.current
          );
        }
      }
    );
  }, [imageHeight, imageURL, imageWidth]);

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled || !imageURL) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      rollMode: event.shiftKey || event.button === 2
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId || disabled) {
      return;
    }

    const deltaX = event.clientX - drag.lastX;
    const deltaY = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;

    const nextRotation = applyPoseDragDelta(
      rotationRef.current,
      deltaX,
      deltaY,
      drag.rollMode
    );
    rotationRef.current = nextRotation;
    onRotationChangeRef.current(nextRotation);
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragRef.current = null;
  }

  function handleRollPointerDown(
    event: ReactPointerEvent<SVGSVGElement>
  ) {
    if (disabled || !imageURL) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    rollDragRef.current = {
      pointerId: event.pointerId,
      previousVisualAngle: calculateRollPointerAngle(event)
    };
  }

  function handleRollPointerMove(
    event: ReactPointerEvent<SVGSVGElement>
  ) {
    const drag = rollDragRef.current;

    if (!drag || drag.pointerId !== event.pointerId || disabled) {
      return;
    }

    const currentVisualAngle = calculateRollPointerAngle(event);
    const nextRotation = applyRollRingVisualAngle(
      rotationRef.current,
      drag.previousVisualAngle,
      currentVisualAngle
    );
    drag.previousVisualAngle = currentVisualAngle;
    rotationRef.current = nextRotation;
    onRotationChangeRef.current(nextRotation);
  }

  function handleRollPointerEnd(
    event: ReactPointerEvent<SVGSVGElement>
  ) {
    if (rollDragRef.current?.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }

    rollDragRef.current = null;
  }

  function handleRollKeyDown(
    event: ReactKeyboardEvent<SVGSVGElement>
  ) {
    if (disabled || !imageURL) {
      return;
    }

    const increments: Partial<Record<string, number>> = {
      ArrowDown: -1,
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: 1,
      PageDown: -15,
      PageUp: 15
    };
    const increment = increments[event.key];

    if (increment === undefined) {
      return;
    }

    event.preventDefault();
    const nextRotation = roundRotation({
      ...rotationRef.current,
      z: clampSingleImageRotationAngle(
        rotationRef.current.z + increment
      )
    });
    rotationRef.current = nextRotation;
    onRotationChangeRef.current(nextRotation);
  }

  const visualRoll = normalizeSingleImageRotationAngle(rotation.z);

  return (
    <>
      <canvas
        aria-label="XYZ 虚拟相机姿态预览"
        className="single-view-pose-canvas"
        onContextMenu={(event) => event.preventDefault()}
        onPointerCancel={handlePointerEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        ref={canvasRef}
      />
      <div
        className={`single-view-roll-ring${disabled ? " is-disabled" : ""}`}
      >
        <svg
          aria-label="Z 轴 Roll 旋转环"
          aria-valuemax={720}
          aria-valuemin={-720}
          aria-valuenow={rotation.z}
          onKeyDown={handleRollKeyDown}
          onPointerCancel={handleRollPointerEnd}
          onPointerDown={handleRollPointerDown}
          onPointerMove={handleRollPointerMove}
          onPointerUp={handleRollPointerEnd}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          viewBox="0 0 100 100"
        >
          <circle
            className="single-view-roll-track"
            cx="50"
            cy="50"
            r="43"
          />
          <g
            className="single-view-roll-indicator"
            style={{ transform: `rotate(${visualRoll}deg)` }}
          >
            <line x1="50" x2="50" y1="50" y2="10" />
            <circle cx="50" cy="8" r="4.5" />
          </g>
        </svg>
        <span>ROLL {formatRollAngle(rotation.z)}</span>
      </div>
    </>
  );
}

function renderRuntime(
  runtime: ViewportRuntime | null,
  rotation: XYZRotation,
  cameraDistance: number
) {
  if (!runtime) {
    return;
  }

  const pose = buildSingleImageCameraPose(rotation);
  const quaternion = new THREE.Quaternion(
    pose.quaternion.x,
    pose.quaternion.y,
    pose.quaternion.z,
    pose.quaternion.w
  );
  const position = new THREE.Vector3(
    0,
    0,
    -calculatePreviewCameraDistance(cameraDistance)
  ).applyQuaternion(quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);

  runtime.camera.position.copy(position);
  runtime.camera.up.copy(up);
  runtime.camera.lookAt(0, 0, 0);
  runtime.camera.updateMatrixWorld();
  runtime.renderer.setRenderTarget(null);
  runtime.renderer.render(runtime.scene, runtime.camera);
}

function exportPoseGuide(
  runtime: ViewportRuntime,
  sourceSize: { width: number; height: number }
) {
  const sourceWidth = Math.max(1, sourceSize.width);
  const sourceHeight = Math.max(1, sourceSize.height);
  const sourceAspect = sourceWidth / sourceHeight;
  const width =
    sourceAspect >= 1
      ? GUIDE_LONG_EDGE
      : Math.max(16, Math.round(GUIDE_LONG_EDGE * sourceAspect));
  const height =
    sourceAspect >= 1
      ? Math.max(16, Math.round(GUIDE_LONG_EDGE / sourceAspect))
      : GUIDE_LONG_EDGE;
  return {
    cameraViewImage: exportRuntimeImage(runtime, width, height, true),
    image: exportRuntimeImage(runtime, width, height, false),
    width,
    height
  };
}

function exportRuntimeImage(
  runtime: ViewportRuntime,
  width: number,
  height: number,
  includeHelpers: boolean
) {
  const renderTarget = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: true,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.UnsignedByteType
  });
  const pixels = new Uint8Array(width * height * 4);
  const previousAspect = runtime.camera.aspect;
  const previousHelperVisibility = runtime.helperGroup.visible;

  try {
    runtime.helperGroup.visible = includeHelpers;
    runtime.camera.aspect = width / height;
    runtime.camera.updateProjectionMatrix();
    runtime.renderer.setRenderTarget(renderTarget);
    runtime.renderer.clear();
    runtime.renderer.render(runtime.scene, runtime.camera);
    runtime.renderer.readRenderTargetPixels(
      renderTarget,
      0,
      0,
      width,
      height,
      pixels
    );
  } finally {
    runtime.renderer.setRenderTarget(null);
    runtime.helperGroup.visible = previousHelperVisibility;
    runtime.camera.aspect = previousAspect;
    runtime.camera.updateProjectionMatrix();

    try {
      runtime.renderer.render(runtime.scene, runtime.camera);
    } finally {
      renderTarget.dispose();
    }
  }

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = width;
  outputCanvas.height = height;
  const context = outputCanvas.getContext("2d");

  if (!context) {
    throw new Error("浏览器无法导出姿态引导图。");
  }

  const imageData = context.createImageData(width, height);
  const rowLength = width * 4;

  for (let row = 0; row < height; row += 1) {
    const sourceOffset = (height - row - 1) * rowLength;
    imageData.data.set(
      pixels.subarray(sourceOffset, sourceOffset + rowLength),
      row * rowLength
    );
  }

  context.putImageData(imageData, 0, 0);

  return outputCanvas.toDataURL("image/png");
}

function populateReferenceCard(
  group: THREE.Group,
  texture: THREE.Texture,
  imageWidth: number,
  imageHeight: number
) {
  const aspect = imageWidth / imageHeight;
  const cardWidth = aspect >= 1 ? 3.65 : 3.65 * aspect;
  const cardHeight = aspect >= 1 ? 3.65 / aspect : 3.65;
  const depth = 0.075;
  const bodyGeometry = new THREE.BoxGeometry(cardWidth, cardHeight, depth);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x17212c,
    metalness: 0.15,
    roughness: 0.68
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  group.add(body);

  const frontGeometry = new THREE.PlaneGeometry(cardWidth, cardHeight);
  const frontMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.FrontSide,
    toneMapped: false
  });
  const front = new THREE.Mesh(frontGeometry, frontMaterial);
  front.position.z = -depth / 2 - 0.002;
  front.rotation.y = Math.PI;
  group.add(front);

  const backGeometry = new THREE.PlaneGeometry(cardWidth, cardHeight);
  const backMaterial = new THREE.MeshStandardMaterial({
    color: 0x111a24,
    metalness: 0.1,
    roughness: 0.82
  });
  const back = new THREE.Mesh(backGeometry, backMaterial);
  back.position.z = depth / 2 + 0.002;
  group.add(back);

  const edgeGeometry = new THREE.EdgesGeometry(bodyGeometry);
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0x73dce8,
    transparent: true,
    opacity: 0.78
  });
  group.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
}

function buildPoseHelpers() {
  const group = new THREE.Group();
  const axes = new THREE.AxesHelper(2.75);
  group.add(axes);

  const ringSpecs = [
    { color: 0xf26b6b, rotation: [0, Math.PI / 2, 0] },
    { color: 0x68d391, rotation: [Math.PI / 2, 0, 0] },
    { color: 0x64b5f6, rotation: [0, 0, 0] }
  ] as const;

  ringSpecs.forEach((spec) => {
    const material = new THREE.MeshBasicMaterial({
      color: spec.color,
      depthWrite: false,
      opacity: 0.34,
      transparent: true
    });
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.25, 0.012, 8, 128),
      material
    );
    ring.rotation.set(spec.rotation[0], spec.rotation[1], spec.rotation[2]);
    group.add(ring);
  });

  const labels = [
    { label: "X", color: "#f26b6b", position: [2.95, 0, 0] },
    { label: "Y", color: "#68d391", position: [0, 2.95, 0] },
    { label: "Z", color: "#64b5f6", position: [0, 0, 2.95] }
  ] as const;

  labels.forEach((item) => {
    const sprite = createAxisLabel(item.label, item.color);
    sprite.position.set(item.position[0], item.position[1], item.position[2]);
    group.add(sprite);
  });

  return group;
}

function createAxisLabel(label: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");

  if (context) {
    context.clearRect(0, 0, 128, 128);
    context.fillStyle = "rgba(5, 10, 16, 0.88)";
    context.beginPath();
    context.arc(64, 64, 38, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = color;
    context.lineWidth = 4;
    context.stroke();
    context.fillStyle = color;
    context.font = "700 46px system-ui";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, 64, 67);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    depthTest: false,
    map: texture,
    transparent: true
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(0.42);
  return sprite;
}

function disposeGroup(group: THREE.Group) {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line)) {
      if (object instanceof THREE.Sprite) {
        object.material.map?.dispose();
        object.material.dispose();
      }
      return;
    }

    object.geometry.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];

    materials.forEach((material) => {
      material.dispose();
    });
  });
}

function calculateRollPointerAngle(
  event: ReactPointerEvent<SVGSVGElement>
) {
  const bounds = event.currentTarget.getBoundingClientRect();
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  const angle =
    (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) /
      Math.PI +
    90;

  return ((angle % 360) + 360) % 360;
}

function calculatePreviewCameraDistance(value: number) {
  const normalized = clampSingleImageCameraDistance(value) / 10;

  return 8.4 - normalized * 3.7;
}

function formatRollAngle(value: number) {
  const rounded = Math.round(value * 10) / 10;

  return `${rounded > 0 ? "+" : ""}${rounded}°`;
}

function roundRotation(rotation: XYZRotation): XYZRotation {
  return {
    x: Math.round(rotation.x * 10) / 10,
    y: Math.round(rotation.y * 10) / 10,
    z: Math.round(rotation.z * 10) / 10
  };
}

export function applyPoseDragDelta(
  rotation: XYZRotation,
  deltaX: number,
  deltaY: number,
  rollMode: boolean,
  sensitivity = 0.42
): XYZRotation {
  const nextRotation = rollMode
    ? {
        ...rotation,
        z: clampSingleImageRotationAngle(
          rotation.z + deltaX * sensitivity
        )
      }
    : {
        ...rotation,
        x: clampSingleImageRotationAngle(
          rotation.x - deltaY * sensitivity
        ),
        y: clampSingleImageRotationAngle(
          rotation.y + deltaX * sensitivity
        )
      };

  return roundRotation(nextRotation);
}

export function applyRollRingVisualAngle(
  rotation: XYZRotation,
  previousVisualAngle: number,
  currentVisualAngle: number
) {
  return roundRotation({
    ...rotation,
    z: accumulateSingleImageRotation(
      rotation.z,
      previousVisualAngle,
      currentVisualAngle
    )
  });
}

export const SingleImagePoseViewport = forwardRef(
  SingleImagePoseViewportComponent
);
