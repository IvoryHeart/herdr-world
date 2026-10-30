import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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

/**
 * Ubuntu 24.04 and later deny unprivileged user namespaces unless an
 * AppArmor profile allows them, so Chrome's sandbox aborts ("No usable
 * sandbox!") outside the packaged /opt/google/chrome path. This is the same
 * profile the Chrome package installs, for the pinned binary's path: it
 * names the program and allows user namespaces; Chrome keeps its sandbox.
 */
export function appArmorProfile(chrome: string) {
  return [
    "abi <abi/4.0>,",
    "include <tunables/global>",
    "",
    `profile herdr-test-chrome "${chrome}" flags=(unconfined) {`,
    "  userns,",
    "}",
    "",
  ].join("\n");
}

const RESTRICTION = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";

/** Whether this machine restricts user namespaces to profiled programs. */
export function userNamespacesRestricted(read = readFileSync) {
  try {
    return String(read(RESTRICTION, "utf8")).trim() === "1";
  } catch {
    return false;
  }
}

/** Load the profile with the runner's passwordless sudo (CI only). */
function allowSandbox(chrome: string) {
  const file = "/etc/apparmor.d/herdr-test-chrome";
  const draft = join(mkdtempSync(join(tmpdir(), "test-chrome-")), "profile");
  writeFileSync(draft, appArmorProfile(chrome));
  for (const command of [
    ["sudo", "-n", "install", "-m", "0644", draft, file],
    ["sudo", "-n", "apparmor_parser", "-r", file],
  ]) {
    const result = Bun.spawnSync(command);
    if (result.exitCode !== 0)
      throw new Error(
        `Test Chrome sandbox profile failed (${command.slice(2).join(" ")}): ${result.stderr.toString()}`,
      );
  }
}

/** Start the pinned browser headless once, as the suites do, sandbox on. */
export function smokeTestChrome(chrome: string) {
  const profile = mkdtempSync(join(tmpdir(), "test-chrome-smoke-"));
  try {
    const result = Bun.spawnSync(
      [
        chrome,
        "--headless=new",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-dev-shm-usage",
        `--user-data-dir=${profile}`,
        "--dump-dom",
        "about:blank",
      ],
      { timeout: 60_000 },
    );
    if (result.exitCode !== 0 || !result.stdout.toString().includes("<html"))
      throw new Error(
        `Test Chrome did not start headless (${result.signalCode ?? `exit ${result.exitCode}`}): ${result.stderr.toString().slice(-2000)}`,
      );
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
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
  if (userNamespacesRestricted()) {
    if (Bun.env.CI === "true") allowSandbox(chrome);
    else
      console.info(
        `[test-chrome] This machine restricts user namespaces. Allow the pinned build's sandbox with:\n` +
          `  printf '%b' '${appArmorProfile(chrome).replaceAll("\n", "\\n")}' | sudo tee /etc/apparmor.d/herdr-test-chrome\n` +
          `  sudo apparmor_parser -r /etc/apparmor.d/herdr-test-chrome`,
      );
  }
  smokeTestChrome(chrome);
  console.info(describeMachine(chrome));
  if (Bun.env.GITHUB_ENV)
    appendFileSync(Bun.env.GITHUB_ENV, `CHROME_BIN=${chrome}\n`);
  else console.info(`CHROME_BIN=${chrome}`);
}
