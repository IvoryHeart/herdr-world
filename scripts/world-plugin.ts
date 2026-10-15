#!/usr/bin/env bun
// Source-build and legacy Herdr plugin shim for Herdr World. Released installs
// use system installers and native commands; these verbs and their argv mapping
// are a frozen contract because managed installs call the action set cached
// at install time.
//
// Verbs: build, build-source, compile-launcher, start, restart, status, url,
// version, uninstall, panel. Explicit legacy build verbs run on Bun and compile
// this shim into a standalone launcher for source builds and cached build actions.
// `build` downloads the checksum-verified prebuilt release binary matching
// this checkout's version; `build-source` builds unreleased checkouts.
// The service verbs (start, restart, status, uninstall) delegate to the binary,
// downloading it first when missing. `url` and `version` only read on-disk
// state. `panel` is the interactive popup TUI behind the manifest [[panes]]
// entry and downloads on demand for its service keys.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { dataRoot, assertSafeDataPath } from "../server/src/config/data-paths";

import { computeUrl } from "../server/src/config/plugin-command";
export {
  computeUrl,
  readServiceEnv,
} from "../server/src/config/plugin-command";

const LAUNCHER_NAME = "herdr-world-plugin.exe";

export function resolvePluginRoot(
  executable: string,
  moduleUrl: string,
): string {
  return basename(executable).toLowerCase() === LAUNCHER_NAME
    ? dirname(dirname(executable))
    : fileURLToPath(new URL("..", moduleUrl));
}

const REPO_ROOT = resolvePluginRoot(process.execPath, import.meta.url);
const BINARY_CANDIDATES =
  process.platform === "win32"
    ? ["herdr-world.exe", "herdr-world"]
    : ["herdr-world"];

function binaryPath(): string | null {
  for (const name of BINARY_CANDIDATES) {
    const path = join(REPO_ROOT, "server", name);
    if (existsSync(path)) return path;
  }
  return null;
}

function run(argv: string[], cwd = REPO_ROOT): number {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(
      `world-plugin: cannot run ${argv[0]}: ${result.error.message}`,
    );
    return 1;
  }
  return result.status ?? 1;
}

function capture(argv: string[]): { code: number; out: string; err: string } {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.error) return { code: 1, out: "", err: result.error.message };
  return {
    code: result.status ?? 1,
    out: result.stdout ?? "",
    err: result.stderr ?? "",
  };
}

// Release archives ship one prebuilt binary per platform; `build` downloads
// and checksum-verifies the archive matching this checkout's version.
// Unreleased checkouts require an explicit `build-source`, then local linking.
export const PLATFORM_ASSETS: Record<
  string,
  { asset: string; binary: string }
> = {
  "darwin-arm64": { asset: "herdr-world-darwin-arm64", binary: "herdr-world" },
  "darwin-x64": { asset: "herdr-world-darwin-x64", binary: "herdr-world" },
  "linux-arm64": { asset: "herdr-world-linux-arm64", binary: "herdr-world" },
  "linux-x64": { asset: "herdr-world-linux-x64", binary: "herdr-world" },
  "win32-arm64": {
    asset: "herdr-world-windows-arm64",
    binary: "herdr-world.exe",
  },
  "win32-x64": { asset: "herdr-world-windows-x64", binary: "herdr-world.exe" },
};

const RELEASE_REPOSITORY = "IvoryHeart/herdr-world";
const SOURCE_INSTALL_HINT = `For an unreleased checkout, run \`bun scripts/world-plugin.ts build-source\` in a local clone, then \`herdr plugin link .\`. For release-only installation, select a published Herdr World tag with \`herdr plugin install ${RELEASE_REPOSITORY} --ref vX.Y.Z\`.`;

export function releaseAssetFor(
  platform: string,
  arch: string,
): { asset: string; binary: string } | null {
  return PLATFORM_ASSETS[`${platform}-${arch}`] ?? null;
}

export function parseSha256File(text: string): string | null {
  const match = /\b([0-9a-f]{64})\b/.exec(text);
  return match?.[1] ?? null;
}

async function downloadPrebuilt(): Promise<number> {
  const version = packageVersion();
  const target = releaseAssetFor(process.platform, process.arch);
  if (!target) {
    console.error(
      `world-plugin: no prebuilt binary for ${process.platform}-${process.arch}. ${SOURCE_INSTALL_HINT}`,
    );
    return 1;
  }
  const base = `https://github.com/${RELEASE_REPOSITORY}/releases/download/v${version}`;
  const archiveName = `${target.asset}.tar.xz`;
  console.error(`world-plugin: downloading ${archiveName} (v${version})`);
  let tmp: string | null = null;
  try {
    const [checksumResponse, archiveResponse] = await Promise.all([
      fetch(`${base}/${archiveName}.sha256`),
      fetch(`${base}/${archiveName}`),
    ]);
    if (!checksumResponse.ok || !archiveResponse.ok) {
      console.error(
        `world-plugin: download failed for Herdr World v${version} (checksum HTTP ${checksumResponse.status}, archive HTTP ${archiveResponse.status}). ${SOURCE_INSTALL_HINT}`,
      );
      return 1;
    }
    const expected = parseSha256File(await checksumResponse.text());
    const archive = new Uint8Array(await archiveResponse.arrayBuffer());
    const actual = createHash("sha256").update(archive).digest("hex");
    if (!expected || actual !== expected) {
      console.error(
        `world-plugin: checksum mismatch (expected ${expected ?? "<none>"}, got ${actual})`,
      );
      return 1;
    }
    tmp = mkdtempSync(join(tmpdir(), "world-plugin-"));
    const archivePath = join(tmp, archiveName);
    writeFileSync(archivePath, archive);
    const extract = spawnSync("tar", ["-xJf", archivePath, "-C", tmp], {
      encoding: "utf8",
    });
    if (extract.error) {
      console.error(
        `world-plugin: cannot run tar: ${extract.error.message} (tar with xz support is required)`,
      );
      return 1;
    }
    if (extract.status !== 0) {
      console.error(
        `world-plugin: extraction failed (exit ${extract.status}): ${extract.stderr.trim()}`,
      );
      return 1;
    }
    const extracted = join(tmp, target.asset, target.binary);
    const serverDir = join(REPO_ROOT, "server");
    mkdirSync(serverDir, { recursive: true });
    const destination = join(serverDir, target.binary);
    copyFileSync(extracted, destination);
    if (process.platform !== "win32") chmodSync(destination, 0o755);
    console.error(`world-plugin: installed ${target.binary} ${version}`);
    return 0;
  } catch (error) {
    console.error(
      `world-plugin: download failed: ${error instanceof Error ? error.message : String(error)}. ${SOURCE_INSTALL_HINT}`,
    );
    return 1;
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

function buildSource(): number {
  const installCode = run(["bun", "install", "--frozen-lockfile"], REPO_ROOT);
  if (installCode !== 0) return installCode;
  const buildCode = run(["bun", "run", "build"]);
  if (buildCode !== 0) return buildCode;
  return compileLauncher();
}

function compileLauncher(): number {
  const output = join(REPO_ROOT, "server", LAUNCHER_NAME);
  mkdirSync(dirname(output), { recursive: true });
  return run([
    "bun",
    "build",
    "--compile",
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    join(REPO_ROOT, "scripts/world-plugin.ts"),
    "--outfile",
    output,
  ]);
}

async function buildRelease(): Promise<number> {
  const downloadCode = await downloadPrebuilt();
  return downloadCode === 0 ? compileLauncher() : downloadCode;
}

async function ensureBinary(): Promise<string | null> {
  const existing = binaryPath();
  if (existing) return existing;
  console.error(
    "world-plugin: herdr-world binary missing, downloading it first",
  );
  if ((await downloadPrebuilt()) !== 0) return null;
  const downloaded = binaryPath();
  if (!downloaded) {
    console.error("world-plugin: download finished but no binary was produced");
  }
  return downloaded;
}

async function service(...args: string[]): Promise<number> {
  const binary = await ensureBinary();
  if (!binary) return 1;
  return run([binary, "service", ...args]);
}

function packageVersion(): string {
  const manifest = readFileSync(join(REPO_ROOT, "herdr-plugin.toml"), "utf8");
  return /^\s*version\s*=\s*"([^"]+)"/m.exec(manifest)?.[1] ?? "unknown";
}

function configDir(): string {
  return dataRoot();
}

// URL/status are read-only and never consult another product's storage.
function readableConfigFile(dir: string, name: string): string {
  const path = join(dir, name);
  assertSafeDataPath(path);
  return path;
}

function printUrl(): number {
  const envFile = readableConfigFile(configDir(), "herdr-world.env");
  if (!existsSync(envFile)) {
    console.error(
      `world-plugin: no service environment at ${envFile}, showing defaults`,
    );
  }
  console.log(computeUrl());
  return 0;
}

function versionText(): string {
  const binary = binaryPath();
  if (binary) {
    const result = capture([binary, "--version"]);
    if (result.code === 0) return result.out.trim();
  }
  return `${packageVersion()} (binary not built)`;
}

function version(): number {
  console.log(versionText());
  return 0;
}

function statusText(): string {
  const binary = binaryPath();
  if (!binary) return "binary not built";
  const result = capture([binary, "service", "status"]);
  if (result.code !== 0) return "not installed";
  const firstLine = result.out.trim().split("\n")[0]?.trim();
  return firstLine || "installed";
}

function renderPanel(message: string) {
  const lines = [
    "Herdr World",
    "",
    `Status:  ${statusText()}`,
    `URL:     ${computeUrl()}`,
    `Version: ${versionText()}`,
    "",
    "[s] start  [r] restart  [u] uninstall  [q] close",
  ];
  if (message) lines.push("", message);
  process.stdout.write(`\x1b[?25l\x1b[2J\x1b[H${lines.join("\r\n")}\r\n`);
}

function panel(): Promise<number> {
  if (!process.stdin.isTTY) {
    console.log(`Status:  ${statusText()}`);
    console.log(`URL:     ${computeUrl()}`);
    console.log(`Version: ${versionText()}`);
    return Promise.resolve(0);
  }
  const stdin = process.stdin;
  return new Promise((resolve) => {
    let message = "";
    let done = false;
    let busy = false;
    const cleanup = (code: number) => {
      if (done) return;
      done = true;
      process.stdout.write("\x1b[?25h\x1b[0m\n");
      stdin.setRawMode(false);
      stdin.pause();
      resolve(code);
    };
    // The host can end the session by closing stdin or signaling the
    // process; leave the terminal restored in every exit path.
    stdin.on("end", () => cleanup(0));
    stdin.on("close", () => cleanup(0));
    process.on("SIGTERM", () => cleanup(0));
    process.on("SIGINT", () => cleanup(0));
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", (chunk: Buffer) => {
      const key = chunk.toString("utf8");
      if (key === "q" || key === "\x03") {
        cleanup(0);
        return;
      }
      const args =
        key === "s"
          ? ["install", "--force"]
          : key === "r"
            ? ["install"]
            : key === "u"
              ? ["uninstall"]
              : null;
      if (!args || busy) return;
      busy = true;
      message = "working...";
      renderPanel(message);
      void (async () => {
        const binary = await ensureBinary();
        if (done) return;
        if (!binary) {
          message = "download failed";
        } else {
          const result = capture([binary, "service", ...args]);
          const detail =
            (result.err || result.out).trim().split("\n").pop() ?? "";
          message =
            result.code === 0
              ? "done"
              : `failed (exit ${result.code}): ${detail}`;
        }
        busy = false;
        renderPanel(message);
      })();
    });
    renderPanel(message);
  });
}

async function main(): Promise<number> {
  switch (process.argv[2]) {
    case "build":
      return buildRelease();
    case "build-source":
      return buildSource();
    case "compile-launcher":
      return compileLauncher();
    case "start":
      return service("install", "--force");
    case "restart":
      return service("install");
    case "status":
      return service("status");
    case "url":
      return printUrl();
    case "version":
      return version();
    case "uninstall":
      return service("uninstall");
    case "panel":
      return panel();
    default:
      console.error(
        "usage: world-plugin.ts <build|build-source|compile-launcher|start|restart|status|url|version|uninstall|panel>",
      );
      return process.argv[2] ? 1 : 0;
  }
}

if (import.meta.main) {
  process.exit(await main());
}
