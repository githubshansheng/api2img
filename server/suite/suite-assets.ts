import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import { lookup } from "node:dns/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import net, { type LookupFunction } from "node:net";
import path from "node:path";
import type {
  GeneratedImage,
  GenerationReferenceInput,
  SuiteImage,
  SuiteReference,
  SuiteReferenceInput
} from "../../src/domain";

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_REMOTE_REDIRECTS = 3;
const REMOTE_ARCHIVE_TIMEOUT_MS = 30_000;
const BLOCKED_REMOTE_ADDRESSES = createBlockedRemoteAddressList();

type ResolvedRemoteAddress = {
  address: string;
  family: 4 | 6;
};

export type GenerationSuiteAssetStoreOptions = {
  archiveRemoteImages?: boolean;
  remoteHostAllowlist?: readonly string[];
  resolveHostname?: (hostname: string) => Promise<ResolvedRemoteAddress[]>;
};

export class GenerationSuiteAssetError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GenerationSuiteAssetError";
    this.code = code;
  }
}

export class GenerationSuiteAssetStore {
  readonly rootDirectory: string;
  readonly publicBaseURL: string;

  private readonly archiveRemoteImages: boolean;
  private readonly remoteHostAllowlist: string[];
  private readonly resolveHostname: (hostname: string) => Promise<ResolvedRemoteAddress[]>;

  constructor(
    rootDirectory: string,
    publicBaseURL = "/api/generation-suites/assets",
    options: GenerationSuiteAssetStoreOptions = {}
  ) {
    this.rootDirectory = rootDirectory;
    this.publicBaseURL = publicBaseURL.replace(/\/+$/, "");
    this.archiveRemoteImages = options.archiveRemoteImages ?? true;
    this.remoteHostAllowlist = normalizeRemoteHostAllowlist(options.remoteHostAllowlist);
    this.resolveHostname = options.resolveHostname ?? resolveRemoteHostname;
    fs.mkdirSync(this.rootDirectory, { recursive: true });
  }

  async persistReference(suiteId: string, input: SuiteReferenceInput): Promise<SuiteReference> {
    const createdAt = new Date().toISOString();
    let assetURL: string | undefined;
    let remoteURL: string | undefined;

    if (input.base64?.trim()) {
      const buffer = decodeBase64(input.base64);
      assetURL = await this.writeAsset(suiteId, input.id, buffer, extensionForMime(input.mimeType, input.format));
    } else if (input.remoteURL?.trim()) {
      const sourceURL = input.remoteURL.trim();
      assetURL = await this.tryArchiveRemoteImage(
        suiteId,
        input.id,
        sourceURL,
        input.mimeType,
        input.format
      );

      if (!assetURL) {
        remoteURL = await this.requirePersistableRemoteURL(sourceURL);
      }
    }

    return {
      id: input.id,
      role: input.role,
      name: input.name,
      mimeType: input.mimeType,
      format: input.format,
      sizeBytes: input.sizeBytes,
      width: input.width,
      height: input.height,
      remoteURL,
      order: input.order,
      assetURL,
      createdAt
    };
  }

  async persistGeneratedImage(input: {
    suiteId: string;
    slotId: string;
    attemptId: string;
    candidateIndex: number;
    image: GeneratedImage;
    signal?: AbortSignal;
  }): Promise<SuiteImage> {
    const createdAt = new Date().toISOString();
    let url = input.image.url ?? "";
    let sourceType: SuiteImage["sourceType"] = "url";

    if (input.image.base64?.trim()) {
      const buffer = decodeBase64(input.image.base64);
      url = await this.writeAsset(
        input.suiteId,
        `${input.slotId}-${input.attemptId}-${input.candidateIndex}`,
        buffer,
        extensionForMime(input.image.mimeType, input.image.format)
      );
      sourceType = "asset";
    } else if (url.startsWith("data:")) {
      const buffer = decodeBase64(url);
      url = await this.writeAsset(
        input.suiteId,
        `${input.slotId}-${input.attemptId}-${input.candidateIndex}`,
        buffer,
        extensionForMime(input.image.mimeType, input.image.format)
      );
      sourceType = "asset";
    } else if (url) {
      const archived = await this.tryArchiveRemoteImage(
        input.suiteId,
        `${input.slotId}-${input.attemptId}-${input.candidateIndex}`,
        url,
        input.image.mimeType,
        input.image.format,
        input.signal
      );

      if (archived) {
        url = archived;
        sourceType = "asset";
      } else {
        url = await this.requirePersistableRemoteURL(url);
      }
    }

    return {
      id: crypto.randomUUID(),
      slotId: input.slotId,
      attemptId: input.attemptId,
      candidateIndex: input.candidateIndex,
      sourceType,
      url,
      mimeType: input.image.mimeType,
      format: input.image.format,
      width: input.image.width,
      height: input.image.height,
      selected: false,
      createdAt
    };
  }

  async materializeReference(reference: SuiteReference): Promise<GenerationReferenceInput> {
    const base64 = reference.assetURL
      ? await this.readAssetAsBase64(reference.assetURL)
      : undefined;

    return {
      id: reference.id,
      name: reference.name,
      mimeType: reference.mimeType,
      format: reference.format,
      sizeBytes: reference.sizeBytes,
      width: reference.width,
      height: reference.height,
      base64,
      remoteURL: base64 ? undefined : reference.remoteURL,
      order: reference.order
    };
  }

  async materializeSuiteImage(image: SuiteImage, order: number): Promise<GenerationReferenceInput> {
    return {
      id: image.id,
      name: `anchor-${image.id}.${image.format ?? "png"}`,
      mimeType: image.mimeType ?? "image/png",
      format: image.format === "jpeg" ? "jpg" : image.format ?? "png",
      width: image.width,
      height: image.height,
      base64: image.sourceType === "asset" ? await this.readAssetAsBase64(image.url) : undefined,
      remoteURL: image.sourceType === "url" ? image.url : undefined,
      order
    };
  }

  async deleteSuiteAssets(suiteId: string) {
    const prefix = `${sanitizeSegment(suiteId)}-`;
    const entries = await fsPromises.readdir(this.rootDirectory, { withFileTypes: true });

    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
        .map((entry) => fsPromises.unlink(path.join(this.rootDirectory, entry.name)))
    );
  }

  async deleteGeneratedImages(suiteId: string, images: SuiteImage[]) {
    const targetPaths = new Set(
      images
        .filter((image) => image.sourceType === "asset")
        .map((image) => this.resolveOwnedAssetPath(suiteId, image.url))
        .filter((targetPath): targetPath is string => Boolean(targetPath))
    );

    await Promise.all(
      Array.from(targetPaths, async (targetPath) => {
        try {
          await fsPromises.unlink(targetPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }
      })
    );
  }

  private async tryArchiveRemoteImage(
    suiteId: string,
    assetId: string,
    url: string,
    fallbackMime?: string,
    fallbackFormat?: string,
    externalSignal?: AbortSignal
  ) {
    if (!this.archiveRemoteImages || externalSignal?.aborted) {
      return undefined;
    }

    let currentURL: URL;

    try {
      currentURL = new URL(url);
    } catch {
      return undefined;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REMOTE_ARCHIVE_TIMEOUT_MS);
    const handleExternalAbort = () => controller.abort();

    externalSignal?.addEventListener("abort", handleExternalAbort, { once: true });
    if (externalSignal?.aborted) {
      handleExternalAbort();
    }

    try {
      for (let redirectCount = 0; redirectCount <= MAX_REMOTE_REDIRECTS; redirectCount += 1) {
        const resolvedAddresses = await this.resolveSafeRemoteAddresses(currentURL);

        if (!resolvedAddresses) {
          return undefined;
        }

        const response = await requestRemoteImage(
          currentURL,
          resolvedAddresses,
          controller.signal
        );
        const statusCode = response.statusCode ?? 0;

        if (isRedirectStatus(statusCode)) {
          const location = firstHeaderValue(response.headers.location);
          response.destroy();

          if (!location || redirectCount >= MAX_REMOTE_REDIRECTS) {
            return undefined;
          }

          try {
            currentURL = new URL(location, currentURL);
          } catch {
            return undefined;
          }

          continue;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.destroy();
          return undefined;
        }

        const contentLength = Number(firstHeaderValue(response.headers["content-length"]) ?? 0);

        if (contentLength > MAX_ARCHIVE_BYTES) {
          response.destroy();
          return undefined;
        }

        const responseMime = firstHeaderValue(response.headers["content-type"])
          ?.split(";")[0]
          ?.trim()
          .toLowerCase();

        if (responseMime && !responseMime.startsWith("image/")) {
          response.destroy();
          return undefined;
        }

        const buffer = await readResponseBuffer(response, MAX_ARCHIVE_BYTES);
        const detectedFormat = buffer ? detectArchiveImageFormat(buffer) : undefined;

        if (!buffer || buffer.length === 0 || !detectedFormat) {
          return undefined;
        }

        return this.writeAsset(suiteId, assetId, buffer, detectedFormat);
      }

      return undefined;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", handleExternalAbort);
    }
  }

  private async requirePersistableRemoteURL(value: string) {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      throw unsafeRemoteAssetError();
    }

    if (
      url.search ||
      url.hash ||
      !(await this.resolveSafeRemoteAddresses(url, false))
    ) {
      throw unsafeRemoteAssetError();
    }

    return url.toString();
  }

  private async resolveSafeRemoteAddresses(url: URL, enforceAllowlist = true) {
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return undefined;
    }

    const hostname = normalizeRemoteHostname(url.hostname);

    if (
      !hostname ||
      isLocalHostname(hostname) ||
      (enforceAllowlist &&
        !matchesRemoteHostAllowlist(hostname, this.remoteHostAllowlist))
    ) {
      return undefined;
    }

    const literalFamily = net.isIP(hostname);
    let addresses: ResolvedRemoteAddress[];

    try {
      addresses =
        literalFamily === 4 || literalFamily === 6
          ? [{ address: hostname, family: literalFamily }]
          : await this.resolveHostname(hostname);
    } catch {
      return undefined;
    }

    const normalized = uniqueRemoteAddresses(addresses);

    if (
      normalized.length === 0 ||
      normalized.some((entry) => !isPublicArchiveAddress(entry.address))
    ) {
      return undefined;
    }

    return normalized;
  }

  private async writeAsset(suiteId: string, assetId: string, buffer: Buffer, extension: string) {
    if (buffer.length === 0 || buffer.length > MAX_ARCHIVE_BYTES) {
      throw new Error("SUITE_ASSET_SIZE_INVALID");
    }

    const filename = `${sanitizeSegment(suiteId)}-${sanitizeSegment(assetId)}-${Date.now()}.${extension}`;
    const targetPath = path.join(this.rootDirectory, filename);

    await fsPromises.writeFile(targetPath, buffer, { flag: "wx" });
    return `${this.publicBaseURL}/${encodeURIComponent(filename)}`;
  }

  private async readAssetAsBase64(assetURL: string) {
    const targetPath = this.resolveAssetPath(assetURL);

    if (!targetPath) {
      throw new Error("SUITE_ASSET_PATH_INVALID");
    }

    return (await fsPromises.readFile(targetPath)).toString("base64");
  }

  private resolveOwnedAssetPath(suiteId: string, assetURL: string) {
    const targetPath = this.resolveAssetPath(assetURL);

    if (!targetPath) {
      return undefined;
    }

    const filename = path.basename(targetPath);
    const suitePrefix = `${sanitizeSegment(suiteId)}-`;
    return filename.startsWith(suitePrefix) ? targetPath : undefined;
  }

  private resolveAssetPath(assetURL: string) {
    const pathWithoutQuery = assetURL.split(/[?#]/, 1)[0] ?? "";
    const encodedFilename = pathWithoutQuery.split("/").pop() ?? "";
    let filename: string;

    try {
      filename = decodeURIComponent(encodedFilename);
    } catch {
      return undefined;
    }

    const targetPath = path.resolve(this.rootDirectory, filename);
    const rootPath = path.resolve(this.rootDirectory);
    const relativePath = path.relative(rootPath, targetPath);

    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return undefined;
    }

    return targetPath;
  }
}

function unsafeRemoteAssetError() {
  return new GenerationSuiteAssetError(
    "SUITE_REMOTE_ASSET_URL_UNSAFE",
    "远程图片无法安全归档，请上传本地图片或使用不含账号、查询参数和片段的公开 HTTP(S) URL"
  );
}

function decodeBase64(value: string) {
  const markerIndex = value.indexOf(";base64,");
  const payload = markerIndex >= 0 ? value.slice(markerIndex + ";base64,".length) : value;

  return Buffer.from(payload.replace(/\s/g, ""), "base64");
}

function extensionForMime(mimeType?: string, fallbackFormat?: string) {
  const normalizedMime = mimeType?.toLowerCase();

  if (normalizedMime?.includes("jpeg") || normalizedMime?.includes("jpg") || fallbackFormat === "jpeg") {
    return "jpg";
  }

  if (normalizedMime?.includes("webp") || fallbackFormat === "webp") {
    return "webp";
  }

  return "png";
}

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 96);
}

function normalizeRemoteHostAllowlist(input?: readonly string[]) {
  return Array.from(
    new Set(
      (input ?? [])
        .map((hostname) => normalizeRemoteHostname(hostname.replace(/^\*\./, "")))
        .filter(Boolean)
    )
  );
}

function normalizeRemoteHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function isLocalHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    hostname === "home.arpa" ||
    hostname.endsWith(".home.arpa")
  );
}

function matchesRemoteHostAllowlist(hostname: string, allowlist: string[]) {
  return (
    allowlist.length === 0 ||
    allowlist.some(
      (allowedHostname) =>
        hostname === allowedHostname || hostname.endsWith(`.${allowedHostname}`)
    )
  );
}

function uniqueRemoteAddresses(addresses: ResolvedRemoteAddress[]) {
  const seen = new Set<string>();

  return addresses.filter((entry): entry is ResolvedRemoteAddress => {
    const address = normalizeRemoteHostname(entry.address);
    const family = net.isIP(address);
    const key = `${family}:${address}`;

    if ((family !== 4 && family !== 6) || seen.has(key)) {
      return false;
    }

    entry.address = address;
    entry.family = family;
    seen.add(key);
    return true;
  });
}

async function resolveRemoteHostname(hostname: string): Promise<ResolvedRemoteAddress[]> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });

  return addresses.flatMap((entry) =>
    entry.family === 4 || entry.family === 6
      ? [{ address: entry.address, family: entry.family }]
      : []
  );
}

function requestRemoteImage(
  url: URL,
  addresses: ResolvedRemoteAddress[],
  signal: AbortSignal
) {
  const transport = url.protocol === "https:" ? https : http;

  return new Promise<IncomingMessage>((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: "GET",
        headers: {
          Accept: "image/png,image/jpeg,image/webp;q=0.9"
        },
        lookup: createPinnedLookup(addresses),
        signal
      },
      resolve
    );

    request.once("error", reject);
    request.end();
  });
}

function createPinnedLookup(addresses: ResolvedRemoteAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(
        null,
        addresses.map((entry) => ({
          address: entry.address,
          family: entry.family
        }))
      );
      return;
    }

    const requestedFamily = Number(options.family ?? 0);
    const selected =
      addresses.find((entry) => requestedFamily === 0 || entry.family === requestedFamily) ??
      addresses[0];

    if (!selected) {
      callback(Object.assign(new Error("SUITE_REMOTE_ADDRESS_UNAVAILABLE"), { code: "ENOTFOUND" }), "");
      return;
    }

    callback(null, selected.address, selected.family);
  };
}

function isRedirectStatus(statusCode: number) {
  return [301, 302, 303, 307, 308].includes(statusCode);
}

function firstHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function detectArchiveImageFormat(buffer: Buffer) {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer.subarray(1, 4).toString("ascii") === "PNG" &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "jpg";
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }

  return undefined;
}

async function readResponseBuffer(response: IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > maxBytes) {
      response.destroy();
      return undefined;
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks, totalBytes);
}

export function isPublicArchiveAddress(address: string) {
  const normalized = normalizeRemoteHostname(address);
  const family = net.isIP(normalized);

  if (family !== 4 && family !== 6) {
    return false;
  }

  return family === 4
    ? !BLOCKED_REMOTE_ADDRESSES.ipv4.check(normalized, "ipv4")
    : !BLOCKED_REMOTE_ADDRESSES.ipv6.check(normalized, "ipv6");
}

function createBlockedRemoteAddressList() {
  const ipv4 = new net.BlockList();
  const ipv6 = new net.BlockList();
  const ipv4Ranges: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4]
  ];
  const ipv6Ranges: Array<[string, number]> = [
    ["::", 128],
    ["::1", 128],
    ["::", 96],
    ["::ffff:0:0", 96],
    ["64:ff9b::", 96],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001::", 32],
    ["2001:2::", 48],
    ["2001:10::", 28],
    ["2001:20::", 28],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["fc00::", 7],
    ["fe80::", 10],
    ["fec0::", 10],
    ["ff00::", 8]
  ];

  ipv4Ranges.forEach(([network, prefix]) => ipv4.addSubnet(network, prefix, "ipv4"));
  ipv6Ranges.forEach(([network, prefix]) => ipv6.addSubnet(network, prefix, "ipv6"));
  return { ipv4, ipv6 };
}
