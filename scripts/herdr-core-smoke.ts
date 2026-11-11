/**
 * Download the newest official core, verify its checksum and run every live
 * suite. No installation, cached fallback, version pin or compatibility gate.
 * ScratchCore isolates live processes under scratch HOME/XDG and stops them.
 * Run on Linux: bun scripts/herdr-core-smoke.ts
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const BASE = "https://releases.herdr.dev/core";
const suiteDir = join(import.meta.dir, "../server/src/herdr-core");

function runLiveTests(binary: string, suites: string[]): number {
  return (
    Bun.spawnSync([process.execPath, "test", ...suites], {
      env: { ...process.env, HERDR_CORE_BIN: binary },
      stdout: "inherit",
      stderr: "inherit",
    }).exitCode ?? 1
  );
}

export async function smokeLatestCore(
  options: {
    download?: (url: string) => Promise<Response>;
    runTests?: typeof runLiveTests;
    reportPath?: string;
  } = {},
): Promise<number> {
  if (process.platform !== "linux" || !["arm64", "x64"].includes(process.arch))
    throw new Error("live core cleanup requires Linux x64 or arm64 (/proc)");
  const target = process.arch === "arm64" ? "linux-aarch64" : "linux-x86_64";
  const download =
    options.download ??
    ((url: string) => fetch(url, { signal: AbortSignal.timeout(30_000) }));
  async function checked(url: string) {
    const response = await download(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response;
  }
  const root = mkdtempSync(join(tmpdir(), "hcw-smoke-"));
  try {
    const manifest = (await (await checked(`${BASE}/latest.json`)).json()) as {
      version: string;
      targets: Record<string, { url: string; sha256: string }>;
    };
    const { version } = manifest;
    if (
      typeof version !== "string" ||
      !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)
    )
      throw new Error("release manifest has no valid version");
    const asset = manifest.targets?.[target];
    if (!asset) throw new Error(`release ${version} has no ${target} build`);
    const archive = new Uint8Array(
      await (await checked(asset.url)).arrayBuffer(),
    );
    const sha256 = createHash("sha256").update(archive).digest("hex");
    if (sha256 !== asset.sha256)
      throw new Error(`checksum mismatch for ${asset.url}`);
    const unpacked = join(root, "release");
    mkdirSync(unpacked);
    writeFileSync(join(root, "core.tar.gz"), archive);
    if (
      Bun.spawnSync(["tar", "-xzf", join(root, "core.tar.gz"), "-C", unpacked])
        .exitCode !== 0
    )
      throw new Error("could not unpack the release");
    // Discovery keeps new live suites from silently falling out of smoke coverage.
    const suites = readdirSync(suiteDir)
      .filter((name) => name.endsWith(".live.test.ts"))
      .sort()
      .map((name) => join(suiteDir, name));
    if (suites.length === 0) throw new Error("no live core suites found");
    console.log(`herdr-core ${version} (${target}), sha256 ${sha256}`);
    const report = {
      version,
      target,
      sha256,
      suites: suites.map((path) => basename(path)),
      result: "failed",
      exitCode: null as number | null,
    };
    try {
      report.exitCode = (options.runTests ?? runLiveTests)(
        join(unpacked, "herdr-core"),
        suites,
      );
      if (report.exitCode === 0) report.result = "passed";
      return report.exitCode;
    } finally {
      if (options.reportPath)
        writeFileSync(
          options.reportPath,
          `${JSON.stringify(report, null, 2)}\n`,
        );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  if (process.argv.length > 2)
    throw new Error(
      "Usage: bun scripts/herdr-core-smoke.ts (always newest release)",
    );
  process.exitCode = await smokeLatestCore({
    reportPath: process.env.HERDR_CORE_SMOKE_REPORT,
  });
}
