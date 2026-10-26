import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  lstatSync,
  statSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  linkSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

/**
 * Herdr World only installs this exact Herdr build. The SHA-256 values were
 * recorded from https://herdr.dev/latest.json when this version was verified,
 * so a replaced or tampered release asset fails verification instead of
 * installing. Bump the version, the package checksums and the Windows
 * installer checksum together after verifying a new Herdr release against
 * Herdr World's supported protocol range (server/src/bridge/protocol-compat.ts).
 */
export const VERIFIED_HERDR_VERSION = "0.9.5";
export const VERIFIED_HERDR_PROTOCOL = 22;

export type HerdrReleaseTarget =
  | "linux-x86_64"
  | "linux-aarch64"
  | "macos-x86_64"
  | "macos-aarch64"
  | "windows-x86_64";

export const VERIFIED_HERDR_SHA256: Record<HerdrReleaseTarget, string> = {
  "linux-x86_64":
    "14d9e8bc8b4a9e0118d77c32266f76d461f09b40342eb23752960bd89f59929d",
  "linux-aarch64":
    "17d7536f2da50859523680ef279dffcac8e4a235f4e46fe8da6c2ec44141897c",
  "macos-x86_64":
    "5fb0a908ec7f6745e3e245738b06bfad56c46391c391ab3c0955fbead01f1369",
  "macos-aarch64":
    "fb77c2232a05a8035421382c894392f4174e4e38a18e48af3dd0290157c3a7e2",
  "windows-x86_64":
    "d2c6c9c971c43a0bfdde8c692a9a1a7a45c3e4807cd01ae45662b4734fac1cbf",
};

/**
 * Herdr's official Windows installer (distribution/install.ps1 at the verified
 * tag). It owns the Windows layout, so Herdr World runs it in local-package
 * mode with the package it already verified instead of reimplementing it.
 */
export const VERIFIED_HERDR_WINDOWS_INSTALLER_SHA256 =
  "369e0d2b5a5f976e11b512f3c4b610a2eba6119732b292a2f587ca8f80fe0baf";

export function resolveHerdrReleaseTarget(
  platform: string,
  arch: string,
): HerdrReleaseTarget | null {
  // Herdr ships one x86_64 Windows build; its installer runs it under
  // emulation on ARM64.
  if (platform === "win32") {
    return arch === "x64" || arch === "arm64" ? "windows-x86_64" : null;
  }
  const os =
    platform === "linux" ? "linux" : platform === "darwin" ? "macos" : null;
  const cpu = arch === "x64" ? "x86_64" : arch === "arm64" ? "aarch64" : null;
  if (!os || !cpu) return null;
  return `${os}-${cpu}` as HerdrReleaseTarget;
}

export function herdrReleaseAssetName(target: HerdrReleaseTarget): string {
  const base = `herdr-${target}`;
  // Windows ships a zip (herdr.exe + conpty/); Unix ships a raw binary.
  return target.startsWith("windows") ? `${base}.zip` : base;
}

export function herdrReleaseUrl(
  target: HerdrReleaseTarget,
  version: string = VERIFIED_HERDR_VERSION,
): string {
  return `https://github.com/herdrdev/herdr/releases/download/v${version}/${herdrReleaseAssetName(target)}`;
}

export function herdrWindowsInstallerUrl(
  version: string = VERIFIED_HERDR_VERSION,
): string {
  return `https://raw.githubusercontent.com/herdrdev/herdr/v${version}/distribution/install.ps1`;
}

export interface HerdrLocationEnv {
  platform?: string;
  homeDir?: string;
  /** %LOCALAPPDATA% on Windows. */
  localAppDataDir?: string;
  /** %APPDATA% on Windows; only locates installs made by older World releases. */
  appDataDir?: string;
  /** HERDR_INSTALL_DIR, honored by both official installers. */
  installDir?: string;
  /** HERDR_HOME: where install.ps1 keeps its Windows release store. */
  herdrHome?: string;
}

function locationEnv(env: HerdrLocationEnv) {
  const platform = env.platform ?? process.platform;
  const homeDir = env.homeDir ?? homedir();
  return {
    platform,
    homeDir,
    localAppDataDir:
      env.localAppDataDir ??
      process.env.LOCALAPPDATA ??
      join(homeDir, "AppData", "Local"),
    appDataDir:
      env.appDataDir ??
      process.env.APPDATA ??
      join(homeDir, "AppData", "Roaming"),
    installDir:
      env.installDir ?? (process.env.HERDR_INSTALL_DIR?.trim() || undefined),
    herdrHome: env.herdrHome ?? (process.env.HERDR_HOME?.trim() || undefined),
  };
}

/**
 * Where Herdr's own installers put the herdr command, so a Herdr that Herdr
 * World installs is found by `herdr`, `herdr update` and Herdr World alike:
 * ~/.local/bin/herdr on Unix (install.sh) and the junctioned
 * %LOCALAPPDATA%\Programs\Herdr\bin\herdr.exe on Windows (install.ps1).
 */
export function herdrDefaultBinaryPath(env: HerdrLocationEnv = {}): string {
  const { platform, homeDir, localAppDataDir, installDir } = locationEnv(env);
  if (platform === "win32") {
    return join(
      installDir ?? join(localAppDataDir, "Programs", "Herdr", "bin"),
      "herdr.exe",
    );
  }
  return join(installDir ?? join(homeDir, ".local", "bin"), "herdr");
}

/** Negative when a < b. Pre-releases sort before their release. */
export function compareHerdrVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const [core, pre] = value.split("-", 2);
    return { parts: core.split(".").map(Number), pre };
  };
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left.parts[index] ?? 0) - (right.parts[index] ?? 0);
    if (difference) return difference;
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre < right.pre ? -1 : 1;
}

/**
 * Herdr World 0.2.6 and earlier installed Windows Herdr into its own
 * versioned directories, %APPDATA%\herdr-world\herdr\<version>\herdr.exe,
 * outside PATH. Returns the installed copies, newest first.
 */
export function legacyWindowsHerdrBinaries(
  env: HerdrLocationEnv = {},
): string[] {
  const { appDataDir } = locationEnv(env);
  const root = join(appDataDir, "herdr-world", "herdr");
  let versions: string[];
  try {
    versions = readdirSync(root).filter((name) =>
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(name),
    );
  } catch {
    return [];
  }
  return versions
    .sort((left, right) => compareHerdrVersions(right, left))
    .map((version) => join(root, version, "herdr.exe"))
    .filter((path) => existsSync(path));
}

/**
 * Whether a Windows herdr.exe belongs to the layout Herdr's install.ps1
 * manages: its visible bin junction, the `current` junction, or a release
 * directory under %USERPROFILE%\.herdr\packages\standalone (HERDR_HOME
 * moves it). The installer puts the active release directory on PATH, so
 * PATH lookups often return the release directory itself.
 */
export function isOfficialWindowsHerdr(
  binaryPath: string,
  env: HerdrLocationEnv = {},
): boolean {
  const { homeDir, herdrHome } = locationEnv(env);
  const standalone = join(
    herdrHome ?? join(homeDir, ".herdr"),
    "packages",
    "standalone",
  );
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  return (
    basename(binaryPath).toLowerCase() === "herdr.exe" &&
    (same(binaryPath, herdrDefaultBinaryPath({ ...env, platform: "win32" })) ||
      same(binaryPath, join(standalone, "current", "herdr.exe")) ||
      same(dirname(dirname(binaryPath)), join(standalone, "releases")))
  );
}

export interface InstallHerdrDeps extends HerdrLocationEnv {
  arch?: string;
  download?: (url: string, destinationPath: string) => Promise<void>;
  /** Runs a command to completion and returns its exit code. */
  runCommand?: (argv: string[]) => number;
  /** Returns the trimmed `--version` output of a binary, or null if it fails. */
  readVersion?: (binaryPath: string) => string | null;
  /** Test-only overrides; production installs always use the verified table. */
  expectedSha256?: string;
  expectedInstallerSha256?: string;
  /** Recheck all discovery paths before publishing a missing Unix runtime. */
  findExistingBinary?: () => string | null;
}

async function defaultDownload(
  url: string,
  destinationPath: string,
): Promise<void> {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`Herdr download failed: HTTP ${response.status}`);
  }
  await Bun.write(destinationPath, response);
}

export function readHerdrVersion(binaryPath: string): string | null {
  try {
    const result = Bun.spawnSync([binaryPath, "--version"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      timeout: 10_000,
    });
    if (result.exitCode !== 0) return null;
    return result.stdout.toString().trim();
  } catch {
    return null;
  }
}

/** `herdr 0.9.5` -> `0.9.5`; anything else -> null. */
export function parseHerdrVersion(output: string | null): string | null {
  const match = /^herdr (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(
    output?.trim() ?? "",
  );
  return match?.[1] ?? null;
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(new Uint8Array(await Bun.file(path).arrayBuffer()))
    .digest("hex");
}

function verifiedTarget(deps: InstallHerdrDeps): HerdrReleaseTarget {
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const target = resolveHerdrReleaseTarget(platform, arch);
  if (!target) {
    throw new Error(
      `no verified Herdr ${VERIFIED_HERDR_VERSION} release for ${platform}-${arch}`,
    );
  }
  return target;
}

async function downloadVerifiedPackage(
  target: HerdrReleaseTarget,
  destinationPath: string,
  deps: InstallHerdrDeps,
): Promise<void> {
  await (deps.download ?? defaultDownload)(
    herdrReleaseUrl(target),
    destinationPath,
  );
  const expected = deps.expectedSha256 ?? VERIFIED_HERDR_SHA256[target];
  if ((await sha256(destinationPath)) !== expected) {
    throw new Error(
      "downloaded Herdr checksum does not match the verified release",
    );
  }
}

function assertVerifiedVersion(binaryPath: string, deps: InstallHerdrDeps) {
  const output = (deps.readVersion ?? readHerdrVersion)(binaryPath);
  if (parseHerdrVersion(output) !== VERIFIED_HERDR_VERSION) {
    throw new Error(
      `Herdr at ${binaryPath} reports ${JSON.stringify(output ?? "no version")}, expected herdr ${VERIFIED_HERDR_VERSION}`,
    );
  }
}

/**
 * Install or upgrade Windows Herdr with Herdr's official installer, given the
 * package and installer this Herdr World release verified. The installer
 * keeps earlier releases beside the new one and switches its `current`
 * junction only after the new release passes its own checks.
 */
async function runVerifiedWindowsInstaller(
  deps: InstallHerdrDeps,
): Promise<string> {
  const target = verifiedTarget(deps);
  const staging = mkdtempSync(join(tmpdir(), "herdr-world-herdr-"));
  try {
    const packagePath = join(staging, herdrReleaseAssetName(target));
    await downloadVerifiedPackage(target, packagePath, deps);
    const installerPath = join(staging, "install.ps1");
    await (deps.download ?? defaultDownload)(
      herdrWindowsInstallerUrl(),
      installerPath,
    );
    const expectedInstaller =
      deps.expectedInstallerSha256 ?? VERIFIED_HERDR_WINDOWS_INSTALLER_SHA256;
    if ((await sha256(installerPath)) !== expectedInstaller) {
      throw new Error(
        "downloaded Herdr installer checksum does not match the verified release",
      );
    }
    const runCommand =
      deps.runCommand ??
      ((argv: string[]) => Bun.spawnSync(argv).exitCode ?? 1);
    const argv = [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      installerPath,
      "-LocalPackagePath",
      packagePath,
      "-LocalPackageFormat",
      "zip",
      "-LocalPackageIdentity",
      VERIFIED_HERDR_VERSION,
      "-LocalPackageSha256",
      deps.expectedSha256 ?? VERIFIED_HERDR_SHA256[target],
    ];
    const { installDir } = locationEnv(deps);
    if (installDir) argv.push("-InstallDir", installDir);
    if (runCommand(argv) !== 0) {
      throw new Error("Herdr's Windows installer failed");
    }
    const binaryPath = herdrDefaultBinaryPath(deps);
    assertVerifiedVersion(binaryPath, deps);
    return binaryPath;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** Validate a discovered entry before treating it as an installed runtime. */
export function assertHerdrBinaryRunnable(
  path: string,
  platform: string = process.platform,
) {
  try {
    if (!statSync(path).isFile()) throw new Error("not a file");
    if (platform !== "win32") accessSync(path, constants.X_OK);
  } catch {
    throw new Error(
      `Herdr installation blocked by non-executable entry: ${path}; repair it before retrying.`,
    );
  }
}

/**
 * Install the verified Herdr release into Herdr's default location and return
 * the binary path. Idempotent: an existing binary there is kept.
 */
export async function installVerifiedHerdr(
  deps: InstallHerdrDeps = {},
): Promise<{ binaryPath: string; version: string; installed: boolean }> {
  const target = verifiedTarget(deps);
  const binaryPath = herdrDefaultBinaryPath(deps);
  const reuse = (path: string) => {
    assertHerdrBinaryRunnable(path, deps.platform);
    return {
      binaryPath: path,
      version: VERIFIED_HERDR_VERSION,
      installed: false,
    };
  };
  if (lstatSync(binaryPath, { throwIfNoEntry: false }))
    return reuse(binaryPath);
  if (target.startsWith("windows")) {
    await runVerifiedWindowsInstaller(deps);
    return { binaryPath, version: VERIFIED_HERDR_VERSION, installed: true };
  }

  const installDir = dirname(binaryPath);
  mkdirSync(installDir, { recursive: true });
  // A unique sibling staging directory supports concurrent missing installers.
  const staging = mkdtempSync(join(installDir, ".herdr.new-"));
  const staged = join(staging, "herdr");
  try {
    await downloadVerifiedPackage(target, staged, deps);
    chmodSync(staged, 0o755);
    assertVerifiedVersion(staged, deps);
    const discovered = deps.findExistingBinary?.();
    if (discovered) return reuse(discovered);
    try {
      // link is atomic and never replaces an entry, including a dangling symlink.
      linkSync(staged, binaryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return reuse(binaryPath);
    }
    return { binaryPath, version: VERIFIED_HERDR_VERSION, installed: true };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Replace an installed Herdr with the verified release. On Unix the old binary
 * is kept as `<binary>.previous` and restored if the new one fails its version
 * check; on Windows Herdr's installer keeps the earlier release directories.
 */
export async function replaceWithVerifiedHerdr(
  binaryPath: string,
  deps: InstallHerdrDeps = {},
): Promise<{ binaryPath: string; backupPath?: string }> {
  const target = verifiedTarget(deps);
  if (target.startsWith("windows")) {
    return { binaryPath: await runVerifiedWindowsInstaller(deps) };
  }
  const directory = dirname(binaryPath);
  const name = basename(binaryPath);
  const staged = join(directory, `.${name}.new-${process.pid}`);
  const backupPath = `${binaryPath}.previous`;
  try {
    await downloadVerifiedPackage(target, staged, deps);
    chmodSync(staged, 0o755);
    assertVerifiedVersion(staged, deps);
    copyFileSync(binaryPath, backupPath);
    chmodSync(backupPath, 0o755);
    renameSync(staged, binaryPath);
  } finally {
    rmSync(staged, { force: true });
  }
  try {
    assertVerifiedVersion(binaryPath, deps);
  } catch (error) {
    renameSync(backupPath, binaryPath);
    throw new Error(
      `${(error as Error).message}; restored the previous Herdr binary`,
      { cause: error },
    );
  }
  return { binaryPath, backupPath };
}
