import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import pin from "../tools/chrome/test-chrome.json";

/**
 * The Chrome that CI's browser suites and the latency trend run on: one
 * Chrome for Testing build, pinned with its checksum, instead of whatever the
 * runner image ships. A browser update is then a reviewed change to
 * tools/chrome/test-chrome.json, not a silent image roll-out (Linux x64).
 */
export function verifyArchive(bytes: Uint8Array, sha256 = pin.sha256) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== sha256)
    throw new Error(`Test Chrome checksum mismatch: ${actual} != ${sha256}`);
}

/** The pinned binary under `directory`, downloaded and verified when absent. */
export async function installTestChrome(
  directory: string,
  download: (url: string) => Promise<Uint8Array> = async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok)
      throw new Error(`Test Chrome download failed: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  },
): Promise<string> {
  const target = join(directory, pin.version);
  const chrome = join(target, "chrome-linux64", "chrome");
  if (!existsSync(chrome)) {
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    const archive = join(target, "chrome-linux64.zip");
    const bytes = await download(pin.url);
    verifyArchive(bytes);
    await Bun.write(archive, bytes);
    const unzip = Bun.spawnSync(["unzip", "-q", archive, "-d", target]);
    if (unzip.exitCode !== 0)
      throw new Error(`Test Chrome unzip failed: ${unzip.stderr.toString()}`);
    rmSync(archive);
  }
  const version = Bun.spawnSync([chrome, "--version"]).stdout.toString().trim();
  if (!version.endsWith(` ${pin.version}`))
    throw new Error(`Test Chrome reports ${version}, expected ${pin.version}`);
  return chrome;
}

/** What the timing depends on: the browser build and the runner's CPU. */
export function describeMachine(chrome: string): string {
  const version = Bun.spawnSync([chrome, "--version"]).stdout.toString().trim();
  const lscpu = Bun.spawnSync(["lscpu"]).stdout.toString();
  const cpu = lscpu
    .split("\n")
    .filter((line) => /^(Model name|CPU\(s\)|Thread\(s\) per core):/.test(line))
    .map((line) => line.replace(/\s+/g, " ").trim());
  return [
    `[test-chrome] ${version}`,
    ...cpu.map((line) => `[cpu] ${line}`),
  ].join("\n");
}

if (import.meta.main) {
  const directory = process.argv[2];
  if (!directory)
    throw new Error("Usage: bun scripts/test-chrome.ts <cache-dir>");
  const chrome = await installTestChrome(directory);
  console.info(describeMachine(chrome));
  if (Bun.env.GITHUB_ENV)
    appendFileSync(Bun.env.GITHUB_ENV, `CHROME_BIN=${chrome}\n`);
  else console.info(`CHROME_BIN=${chrome}`);
}
