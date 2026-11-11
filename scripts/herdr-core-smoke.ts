/**
 * Smoke-tests World's herdr-core provider against the newest official core
 * release: downloads it from releases.herdr.dev, checks the SHA-256 from its
 * manifest, and runs the live suites under scratch HOME/XDG directories
 * (with HERDR_WORLD_PWSH=<pwsh 7>, also the Windows relay through PowerShell). It
 * installs nothing and pins nothing; a failure flags protocol drift to fix.
 *
 *   bun scripts/herdr-core-smoke.ts          # newest release
 *   bun scripts/herdr-core-smoke.ts 0.1.20   # a named release
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = "https://releases.herdr.dev/core";

function target(): string {
  if (process.platform !== "linux")
    throw new Error(
      "the live suite runs on Linux (it scans /proc to clean up)",
    );
  return process.arch === "arm64" ? "linux-aarch64" : "linux-x86_64";
}

async function json(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

const requested = process.argv[2];
const root = mkdtempSync(join(tmpdir(), "hcw-smoke-"));
try {
  const manifest = requested
    ? await json(`${BASE}/${requested}/manifest.json`)
    : await json(`${BASE}/latest.json`);
  const version = String(manifest.version);
  const asset = (
    manifest.targets as Record<string, { url: string; sha256: string }>
  )[target()];
  if (!asset) throw new Error(`release ${version} has no ${target()} build`);
  const archive = new Uint8Array(await (await fetch(asset.url)).arrayBuffer());
  const digest = createHash("sha256").update(archive).digest("hex");
  if (digest !== asset.sha256)
    throw new Error(`checksum mismatch for ${asset.url}`);
  const unpacked = join(root, "release");
  mkdirSync(unpacked);
  writeFileSync(join(root, "core.tar.gz"), archive);
  const tar = Bun.spawnSync([
    "tar",
    "-xzf",
    join(root, "core.tar.gz"),
    "-C",
    unpacked,
  ]);
  if (tar.exitCode !== 0) throw new Error("could not unpack the release");
  console.log(`herdr-core ${version} (${target()}), sha256 ${digest}`);
  const test = Bun.spawnSync(
    [
      process.execPath,
      "test",
      "server/src/herdr-core/core.live.test.ts",
      // Windows relay checks; they run when HERDR_WORLD_PWSH names pwsh 7.
      "server/src/herdr-core/windows.live.test.ts",
    ],
    {
      env: { ...process.env, HERDR_CORE_BIN: join(unpacked, "herdr-core") },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  process.exitCode = test.exitCode ?? 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
