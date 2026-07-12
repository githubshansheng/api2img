import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GenerationSuiteAssetStore,
  isPublicArchiveAddress
} from "../../../server/suite/suite-assets";
import { TINY_PNG_BASE64 } from "../helpers/generation-suite";

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

function createAssetStore(
  options: ConstructorParameters<typeof GenerationSuiteAssetStore>[2] = {}
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "api2img-suite-assets-"));
  const assets = new GenerationSuiteAssetStore(
    path.join(directory, "assets"),
    "/api/generation-suites/assets",
    options
  );

  cleanups.push(() => fs.rmSync(directory, { recursive: true, force: true }));
  return assets;
}

function remoteGeneratedImage(url: string) {
  return {
    id: "remote-image",
    sourceType: "url" as const,
    url,
    mimeType: "image/png",
    format: "png" as const,
    index: 0,
    temporary: true,
    saved: false
  };
}

describe("generation suite asset store", () => {
  it("classifies private, special-use and public archive addresses", () => {
    [
      "0.0.0.0",
      "10.0.0.8",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "198.51.100.7",
      "::",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "fe80::1",
      "2001:db8::1"
    ].forEach((address) => expect(isPublicArchiveAddress(address)).toBe(false));

    expect(isPublicArchiveAddress("8.8.8.8")).toBe(true);
    expect(isPublicArchiveAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("rejects remote results that resolve to a private address when they cannot be archived", async () => {
    const resolveHostname = vi.fn(async () => [
      {
        address: "169.254.169.254",
        family: 4 as const
      }
    ]);
    const assets = createAssetStore({ resolveHostname });

    await expect(
      assets.persistGeneratedImage({
        suiteId: "suite-private-host",
        slotId: "anchor",
        attemptId: "attempt",
        candidateIndex: 0,
        image: remoteGeneratedImage("https://metadata.example/latest/meta-data")
      })
    ).rejects.toMatchObject({
      code: "SUITE_REMOTE_ASSET_URL_UNSAFE"
    });

    expect(resolveHostname).toHaveBeenCalledWith("metadata.example");
    expect(fs.readdirSync(assets.rootDirectory)).toEqual([]);
  });

  it("skips archive download outside the allowlist but permits a safe public URL fallback", async () => {
    const resolveHostname = vi.fn(async () => [
      {
        address: "8.8.8.8",
        family: 4 as const
      }
    ]);
    const assets = createAssetStore({
      remoteHostAllowlist: ["images.example.com"],
      resolveHostname
    });

    const persisted = await assets.persistGeneratedImage({
      suiteId: "suite-host-allowlist",
      slotId: "anchor",
      attemptId: "attempt",
      candidateIndex: 0,
      image: remoteGeneratedImage("https://untrusted.example.net/result.png")
    });

    expect(resolveHostname).toHaveBeenCalledWith("untrusted.example.net");
    expect(persisted.sourceType).toBe("url");
    expect(persisted.url).toBe("https://untrusted.example.net/result.png");
    expect(fs.readdirSync(assets.rootDirectory)).toEqual([]);
  });

  it("can disable remote image archiving while retaining safe public URLs", async () => {
    const resolveHostname = vi.fn(async () => [
      {
        address: "8.8.8.8",
        family: 4 as const
      }
    ]);
    const assets = createAssetStore({
      archiveRemoteImages: false,
      resolveHostname
    });

    const persisted = await assets.persistGeneratedImage({
      suiteId: "suite-archive-disabled",
      slotId: "anchor",
      attemptId: "attempt",
      candidateIndex: 0,
      image: remoteGeneratedImage("https://images.example.com/result.png")
    });

    expect(resolveHostname).toHaveBeenCalledWith("images.example.com");
    expect(persisted).toMatchObject({
      sourceType: "url",
      url: "https://images.example.com/result.png"
    });
  });

  it("keeps base64 references local and never persists an accompanying remote URL", async () => {
    const assets = createAssetStore();
    const persisted = await assets.persistReference("suite-base64-reference", {
      id: "subject-reference",
      role: "subject",
      name: "subject.png",
      mimeType: "image/png",
      format: "png",
      base64: TINY_PNG_BASE64,
      remoteURL: "https://images.example.com/subject.png?signature=secret",
      order: 0
    });
    const materialized = await assets.materializeReference(persisted);

    expect(persisted.assetURL).toMatch(
      /^\/api\/generation-suites\/assets\/suite-base64-reference-subject-reference-/
    );
    expect(persisted.remoteURL).toBeUndefined();
    expect(materialized.base64).toBe(TINY_PNG_BASE64);
    expect(materialized.remoteURL).toBeUndefined();
  });

  it("retains a remote reference only when it is a query-free public URL", async () => {
    const resolveHostname = vi.fn(async () => [
      {
        address: "8.8.8.8",
        family: 4 as const
      }
    ]);
    const assets = createAssetStore({
      archiveRemoteImages: false,
      resolveHostname
    });
    const persisted = await assets.persistReference("suite-public-reference", {
      id: "subject-reference",
      role: "subject",
      name: "subject.png",
      mimeType: "image/png",
      format: "png",
      remoteURL: "https://images.example.com/subject.png",
      order: 0
    });

    expect(resolveHostname).toHaveBeenCalledWith("images.example.com");
    expect(persisted).toMatchObject({
      assetURL: undefined,
      remoteURL: "https://images.example.com/subject.png"
    });
  });

  it("rejects signed reference URLs when local archiving is unavailable", async () => {
    const resolveHostname = vi.fn(async () => [
      {
        address: "8.8.8.8",
        family: 4 as const
      }
    ]);
    const assets = createAssetStore({
      archiveRemoteImages: false,
      resolveHostname
    });

    await expect(
      assets.persistReference("suite-signed-reference", {
        id: "subject-reference",
        role: "subject",
        name: "subject.png",
        mimeType: "image/png",
        format: "png",
        remoteURL: "https://images.example.com/subject.png?X-Amz-Signature=secret",
        order: 0
      })
    ).rejects.toMatchObject({
      code: "SUITE_REMOTE_ASSET_URL_UNSAFE"
    });
    expect(resolveHostname).not.toHaveBeenCalled();
  });

  it("rejects signed generated-image URLs when local archiving is unavailable", async () => {
    const assets = createAssetStore({
      archiveRemoteImages: false,
      resolveHostname: vi.fn(async () => [
        {
          address: "8.8.8.8",
          family: 4 as const
        }
      ])
    });

    await expect(
      assets.persistGeneratedImage({
        suiteId: "suite-signed-result",
        slotId: "anchor",
        attemptId: "attempt",
        candidateIndex: 0,
        image: remoteGeneratedImage(
          "https://images.example.com/result.png?token=temporary-secret"
        )
      })
    ).rejects.toMatchObject({
      code: "SUITE_REMOTE_ASSET_URL_UNSAFE"
    });
    expect(fs.readdirSync(assets.rootDirectory)).toEqual([]);
  });
});
