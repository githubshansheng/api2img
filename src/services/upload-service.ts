import type { ImageFormat, ModelCapabilities, ReferenceImage, ValidationIssue } from "../domain";

const MIME_TO_FORMAT: Record<string, ImageFormat> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png"
};

export type UploadFileLike = {
  name: string;
  type: string;
  size: number;
};

export type UploadValidationResult<TFile extends UploadFileLike> = {
  acceptedFiles: TFile[];
  issues: ValidationIssue[];
};

export function resolveImageFormat(file: UploadFileLike): ImageFormat | undefined {
  const mimeFormat = MIME_TO_FORMAT[file.type.toLowerCase()];

  if (mimeFormat) {
    return mimeFormat;
  }

  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "jpg" || extension === "jpeg" || extension === "png") {
    return extension === "jpeg" ? "jpg" : extension;
  }

  return undefined;
}

export function validateReferenceImageFiles<TFile extends UploadFileLike>(
  files: TFile[],
  capabilities: ModelCapabilities,
  existingCount = 0
): UploadValidationResult<TFile> {
  const acceptedFiles: TFile[] = [];
  const issues: ValidationIssue[] = [];
  const allowedFormats = new Set(capabilities.supportedReferenceFormats);
  const maxCount = Math.min(capabilities.maxReferenceImages, 12);
  const maxSizeBytes = capabilities.maxReferenceImageSizeMB * 1024 * 1024;

  for (const file of files) {
    const nextCount = existingCount + acceptedFiles.length + 1;
    const format = resolveImageFormat(file);

    if (nextCount > maxCount) {
      issues.push({
        field: "referenceImages",
        code: "REFERENCE_IMAGE_COUNT_EXCEEDED",
        message: `最多只能上传 ${maxCount} 张参考图`,
        blocking: true
      });
      continue;
    }

    if (!format || !allowedFormats.has(format)) {
      issues.push({
        field: file.name,
        code: "REFERENCE_IMAGE_FORMAT_UNSUPPORTED",
        message: `${file.name} 格式不支持，仅支持 JPG/PNG`,
        blocking: true
      });
      continue;
    }

    if (file.size > maxSizeBytes) {
      issues.push({
        field: file.name,
        code: "REFERENCE_IMAGE_TOO_LARGE",
        message: `${file.name} 超过 ${capabilities.maxReferenceImageSizeMB} MB`,
        blocking: true
      });
      continue;
    }

    acceptedFiles.push(file);
  }

  return { acceptedFiles, issues };
}

export function createReferenceImage(file: File, order: number): ReferenceImage {
  const format = resolveImageFormat(file) ?? "png";
  const mimeType = file.type || mimeTypeForFormat(format);
  const previewURL =
    typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "";

  return {
    id: crypto.randomUUID(),
    source: "local-file",
    file,
    name: file.name,
    mimeType,
    format,
    sizeBytes: file.size,
    previewURL,
    order,
    uploadStatus: "ready",
    createdAt: Date.now()
  };
}

export async function createReferenceImageWithBase64(file: File, order: number): Promise<ReferenceImage> {
  const format = resolveImageFormat(file) ?? "png";
  const mimeType = file.type || mimeTypeForFormat(format);
  const base64 = await readFileAsDataUrl(file, mimeType);
  const image = createReferenceImage(file, order);

  return {
    ...image,
    mimeType,
    format,
    previewURL: image.previewURL || base64,
    base64
  };
}

export async function readFileAsDataUrl(file: File, mimeType = file.type || "image/png"): Promise<string> {
  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onerror = () => reject(new Error("REFERENCE_IMAGE_READ_FAILED"));
      reader.onload = () => {
        if (typeof reader.result !== "string") {
          reject(new Error("REFERENCE_IMAGE_READ_FAILED"));
          return;
        }

        resolve(normalizeDataUrlMime(reader.result, mimeType));
      };
      reader.readAsDataURL(file);
    });
  }

  const buffer = await file.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);

  return `data:${mimeType};base64,${base64}`;
}

function mimeTypeForFormat(format: ImageFormat) {
  return format === "jpg" ? "image/jpeg" : "image/png";
}

function normalizeDataUrlMime(dataUrl: string, mimeType: string) {
  const commaIndex = dataUrl.indexOf(",");

  if (commaIndex < 0) {
    return dataUrl;
  }

  return `data:${mimeType};base64,${dataUrl.slice(commaIndex + 1)}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(buffer).toString("base64");
  }

  if (typeof btoa !== "function") {
    throw new Error("REFERENCE_IMAGE_READ_FAILED");
  }

  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  }

  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}
