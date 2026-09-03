import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
const extension = target.includes("windows") ? ".exe" : "";
const binary = join(root, "src-tauri", "binaries", `mihomo-${target}${extension}`);
const config = join(root, "fixtures", "minimal.yaml");
const dataDir = mkdtempSync(join(tmpdir(), "mihomo-codex-smoke-"));

try {
  const version = execFileSync(binary, ["-v"], { encoding: "utf8" }).trim();
  const validation = execFileSync(binary, ["-t", "-d", dataDir, "-f", config], {
    encoding: "utf8",
  }).trim();
  console.log(version.split("\n")[0]);
  console.log(validation.split("\n").at(-1));
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}

