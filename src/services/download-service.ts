import JSZip from "jszip";
import type { GeneratedImage } from "../domain";

export type ZipDownloadItem = {
  requestId: string;
  modelDisplayName: string;
  prompt: string;
  image: GeneratedImage;
  createdAt: string;
  resolutionText?: string;
};

export type ZipBuildResult = {
  blob: Blob;
  filename: string;
  fileCount: number;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function formatTimestamp(date = new Date()) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function sanitizePart(value?: string) {
  return (value ?? "image")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "image";
}

function base64ToUint8Array(value: string) {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function parseDataUrl(value: string) {
  const match = value.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/);

  if (!match) {
    return undefined;
  }

  return {
    mimeType: match[1] ?? "image/png",
    data: decodeURIComponent(match[2] ?? "")
  };
}

function inferExtension(image: GeneratedImage) {
  const fromFormat = image.format?.toLowerCase();
  const fromMime = image.mimeType?.split("/")[1]?.toLowerCase();

  return sanitizePart(fromFormat ?? fromMime ?? "png");
}

async function readImageBytes(image: GeneratedImage) {
  if (image.base64) {
    return base64ToUint8Array(image.base64);
  }

  if (image.url?.startsWith("data:")) {
    const parsed = parseDataUrl(image.url);

    if (!parsed) {
      throw new Error("图片 data URL 无法解析");
    }

    return base64ToUint8Array(parsed.data);
  }

  if (image.url) {
    const response = await fetch(image.url);

    if (!response.ok) {
      throw new Error(`图片下载失败：HTTP ${response.status}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  throw new Error("图片没有可下载地址");
}

export async function buildImageResultZip(
  items: ZipDownloadItem[],
  onProgress?: (progress: number) => void
): Promise<ZipBuildResult> {
  const zip = new JSZip();
  const manifest = items.map((item, index) => ({
    index: index + 1,
    requestId: item.requestId,
    modelDisplayName: item.modelDisplayName,
    prompt: item.prompt,
    createdAt: item.createdAt,
    resolutionText: item.resolutionText,
    imageId: item.image.id,
    format: item.image.format ?? "png",
    width: item.image.width,
    height: item.image.height,
    temporary: item.image.temporary,
    expiresAt: item.image.expiresAt
  }));

  onProgress?.(5);

  for (const [index, item] of items.entries()) {
    const bytes = await readImageBytes(item.image);
    const imageIndex = String(index + 1).padStart(2, "0");
    const filename = `${imageIndex}-${sanitizePart(item.requestId).slice(-16)}-${sanitizePart(item.modelDisplayName)}.${inferExtension(
      item.image
    )}`;

    zip.file(filename, bytes);
    onProgress?.(Math.round(((index + 1) / Math.max(1, items.length)) * 70));
  }

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  const blob = await zip.generateAsync({ type: "blob" }, (metadata) => {
    onProgress?.(70 + Math.round(metadata.percent * 0.3));
  });

  onProgress?.(100);

  return {
    blob,
    filename: `api2image-results-${formatTimestamp()}.zip`,
    fileCount: items.length
  };
}
