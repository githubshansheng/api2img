import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const DEFAULT_REFERENCE_PATH = "K:\\开源项目\\GPT-Image2-Studio";
const VENDOR_PATH = path.resolve("vendor", "gpt-image2-studio");

const AUDITED_DIRECTORIES = ["public", "lib", "examples", "scripts", "test"];
const AUDITED_ROOT_FILES = [
  ".env.example",
  ".gitattributes",
  ".gitignore",
  ".vercelignore",
  "cloudflare-pages-worker.mjs",
  "cloudflare-r2-lifecycle.json",
  "generate-image.mjs",
  "launch-studio.cmd",
  "launch-studio.ps1",
  "package-lock.json",
  "package.json",
  "portrait-no-image-name.png",
  "prompt-template-popover.png",
  "README.md",
  "server.mjs",
  "stop-studio-services.cmd",
  "vercel.json",
  "wrangler.api.jsonc",
  "wrangler.jsonc"
];

const ignoredDirectoryNames = new Set([".git", "node_modules"]);

function toPortablePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function hashFile(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function collectDirectoryFiles(basePath, directoryName, output) {
  const directoryPath = path.join(basePath, directoryName);

  if (!existsSync(directoryPath)) {
    output.set(toPortablePath(directoryName), { exists: false, hash: null });
    return;
  }

  const walk = (currentPath) => {
    for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) {
        continue;
      }

      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = toPortablePath(path.relative(basePath, absolutePath));

      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        output.set(relativePath, { exists: true, hash: hashFile(absolutePath) });
      }
    }
  };

  walk(directoryPath);
}

function collectAuditedFiles(basePath) {
  const files = new Map();

  for (const directoryName of AUDITED_DIRECTORIES) {
    collectDirectoryFiles(basePath, directoryName, files);
  }

  for (const fileName of AUDITED_ROOT_FILES) {
    const filePath = path.join(basePath, fileName);
    files.set(fileName, {
      exists: existsSync(filePath) && statSync(filePath).isFile(),
      hash: existsSync(filePath) && statSync(filePath).isFile() ? hashFile(filePath) : null
    });
  }

  return files;
}

function compareFiles(sourceFiles, targetFiles) {
  const allPaths = Array.from(new Set([...sourceFiles.keys(), ...targetFiles.keys()])).sort();
  const missing = [];
  const extra = [];
  const different = [];

  for (const relativePath of allPaths) {
    const source = sourceFiles.get(relativePath);
    const target = targetFiles.get(relativePath);

    if (source?.exists && !target?.exists) {
      missing.push(relativePath);
      continue;
    }

    if (!source?.exists && target?.exists) {
      extra.push(relativePath);
      continue;
    }

    if (source?.exists && target?.exists && source.hash !== target.hash) {
      different.push(relativePath);
    }
  }

  return { missing, extra, different };
}

const referencePath = path.resolve(process.env.GPT_STUDIO_REFERENCE_PATH ?? DEFAULT_REFERENCE_PATH);
const strict = process.argv.includes("--strict");

if (!existsSync(referencePath)) {
  throw new Error(`Reference GPT-Image2-Studio path does not exist: ${referencePath}`);
}

if (!existsSync(VENDOR_PATH)) {
  throw new Error(`Vendored GPT-Image2-Studio path does not exist: ${VENDOR_PATH}`);
}

const sourceFiles = collectAuditedFiles(referencePath);
const targetFiles = collectAuditedFiles(VENDOR_PATH);
const comparison = compareFiles(sourceFiles, targetFiles);
const report = {
  referencePath,
  vendorPath: VENDOR_PATH,
  auditedDirectories: AUDITED_DIRECTORIES,
  auditedRootFiles: AUDITED_ROOT_FILES,
  sourceCount: Array.from(sourceFiles.values()).filter((entry) => entry.exists).length,
  targetCount: Array.from(targetFiles.values()).filter((entry) => entry.exists).length,
  missingCount: comparison.missing.length,
  extraCount: comparison.extra.length,
  differentCount: comparison.different.length,
  missing: comparison.missing,
  extra: comparison.extra,
  different: comparison.different
};

console.log(JSON.stringify(report, null, 2));

if (strict && (comparison.missing.length > 0 || comparison.extra.length > 0 || comparison.different.length > 0)) {
  process.exitCode = 1;
}
