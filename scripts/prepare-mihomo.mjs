import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, unzipSync } from "fflate";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "src-tauri", "core-manifest.json");
const binariesDir = join(root, "src-tauri", "binaries");
const cacheDir = join(binariesDir, ".cache");
const args = process.argv.slice(2);

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function hostTarget() {
  return execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status} ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

function unpack(entry, archiveBytes) {
  if (entry.archive === "gzip") return gunzipSync(archiveBytes);
  if (entry.archive === "zip") {
    const files = unzipSync(archiveBytes);
    const executable = Object.entries(files).find(([name]) => name.toLowerCase().endsWith(".exe"));
    if (!executable) throw new Error(`no executable found in ${entry.asset}`);
    return executable[1];
  }
  throw new Error(`unsupported archive format: ${entry.archive}`);
}

async function prepareTarget(manifest, target) {
  const entry = manifest.targets[target];
  if (!entry) throw new Error(`unsupported target: ${target}`);

  const outputPath = join(binariesDir, entry.executable);
  const markerPath = `${outputPath}.prepared.json`;
  if (await exists(outputPath) && await exists(markerPath)) {
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    if (marker.version === manifest.version && marker.assetSha256 === entry.sha256) {
      console.log(`mihomo ${manifest.version} already prepared for ${target}`);
      return;
    }
  }

  await mkdir(cacheDir, { recursive: true });
  await mkdir(binariesDir, { recursive: true });
  const sourceDir = argValue("--asset-dir");
  const cachePath = join(cacheDir, entry.asset);
  let archiveBytes;
  if (sourceDir && await exists(join(sourceDir, entry.asset))) {
    archiveBytes = new Uint8Array(await readFile(join(sourceDir, entry.asset)));
  } else if (await exists(cachePath)) {
    archiveBytes = new Uint8Array(await readFile(cachePath));
  } else {
    archiveBytes = await download(`${manifest.releaseBaseUrl}/${entry.asset}`);
    await writeFile(cachePath, archiveBytes);
  }

  const actualHash = sha256(archiveBytes);
  if (actualHash !== entry.sha256) {
    throw new Error(`sha256 mismatch for ${entry.asset}: expected ${entry.sha256}, got ${actualHash}`);
  }

  const executableBytes = unpack(entry, archiveBytes);
  await writeFile(outputPath, executableBytes);
  if (!target.includes("windows")) await chmod(outputPath, 0o755);
  await writeFile(markerPath, `${JSON.stringify({
    schemaVersion: 1,
    version: manifest.version,
    target,
    asset: entry.asset,
    assetSha256: entry.sha256,
    executableSha256: sha256(executableBytes),
  }, null, 2)}\n`);

  if (target === hostTarget()) {
    const version = execFileSync(outputPath, ["-v"], { encoding: "utf8" }).trim().split("\n")[0];
    if (!version.includes(`v${manifest.version}`)) {
      throw new Error(`unexpected mihomo version: ${version}`);
    }
    console.log(version);
  }
  console.log(`prepared ${outputPath}`);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const targets = args.includes("--all")
  ? Object.keys(manifest.targets)
  : [argValue("--target") || hostTarget()];

for (const target of targets) await prepareTarget(manifest, target);
