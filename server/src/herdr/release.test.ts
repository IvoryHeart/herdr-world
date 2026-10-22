import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  herdrDefaultBinaryPath,
  herdrReleaseAssetName,
  herdrReleaseUrl,
  herdrWindowsInstallerUrl,
  installVerifiedHerdr,
  legacyWindowsHerdrBinaryPath,
  parseHerdrVersion,
  replaceWithVerifiedHerdr,
  resolveHerdrReleaseTarget,
  VERIFIED_HERDR_SHA256,
  VERIFIED_HERDR_VERSION,
  VERIFIED_HERDR_WINDOWS_INSTALLER_SHA256,
} from "./release";

const trash: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "herdr-world-herdr-release-"));
  trash.push(dir);
  return dir;
}
afterEach(() => {
  while (trash.length) {
    const dir = trash.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveHerdrReleaseTarget", () => {
  test("maps supported platforms to published assets", () => {
    expect(resolveHerdrReleaseTarget("linux", "x64")).toBe("linux-x86_64");
    expect(resolveHerdrReleaseTarget("linux", "arm64")).toBe("linux-aarch64");
    expect(resolveHerdrReleaseTarget("darwin", "x64")).toBe("macos-x86_64");
    expect(resolveHerdrReleaseTarget("darwin", "arm64")).toBe("macos-aarch64");
    expect(resolveHerdrReleaseTarget("win32", "x64")).toBe("windows-x86_64");
    // Herdr's installer runs the x86_64 build under emulation on ARM64.
    expect(resolveHerdrReleaseTarget("win32", "arm64")).toBe("windows-x86_64");
  });

  test("rejects platforms without a verified asset", () => {
    expect(resolveHerdrReleaseTarget("freebsd", "x64")).toBeNull();
    expect(resolveHerdrReleaseTarget("linux", "ia32")).toBeNull();
  });
});

describe("verified release metadata", () => {
  test("pins a checksum for every published asset", () => {
    for (const [target, sha256] of Object.entries(VERIFIED_HERDR_SHA256)) {
      expect(sha256, target).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(Object.keys(VERIFIED_HERDR_SHA256)).toHaveLength(5);
  });

  test("builds GitHub release URLs for the verified version", () => {
    expect(herdrReleaseAssetName("macos-aarch64")).toBe("herdr-macos-aarch64");
    expect(herdrReleaseAssetName("windows-x86_64")).toBe(
      "herdr-windows-x86_64.zip",
    );
    expect(herdrReleaseUrl("linux-x86_64")).toBe(
      `https://github.com/herdrdev/herdr/releases/download/v${VERIFIED_HERDR_VERSION}/herdr-linux-x86_64`,
    );
    expect(herdrWindowsInstallerUrl()).toBe(
      `https://raw.githubusercontent.com/herdrdev/herdr/v${VERIFIED_HERDR_VERSION}/distribution/install.ps1`,
    );
    expect(VERIFIED_HERDR_WINDOWS_INSTALLER_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("parses only exact Herdr version output", () => {
    expect(parseHerdrVersion("herdr 0.9.5\n")).toBe("0.9.5");
    expect(parseHerdrVersion("herdr 0.9.6-rc.1")).toBe("0.9.6-rc.1");
    for (const output of [null, "", "herdr", "herdr-world 0.9.5", "herdr 0.9"])
      expect(parseHerdrVersion(output)).toBeNull();
  });
});

describe("default locations", () => {
  test("match Herdr's official installers", () => {
    const homeDir = join("/", "home", "example");
    expect(herdrDefaultBinaryPath({ platform: "linux", homeDir })).toBe(
      join(homeDir, ".local", "bin", "herdr"),
    );
    expect(
      herdrDefaultBinaryPath({
        platform: "darwin",
        homeDir,
        installDir: join("/", "opt", "tools"),
      }),
    ).toBe(join("/", "opt", "tools", "herdr"));
    expect(
      herdrDefaultBinaryPath({
        platform: "win32",
        homeDir,
        localAppDataDir: join(homeDir, "Local"),
      }),
    ).toBe(join(homeDir, "Local", "Programs", "Herdr", "bin", "herdr.exe"));
    expect(
      legacyWindowsHerdrBinaryPath({
        platform: "win32",
        homeDir,
        appDataDir: join(homeDir, "Roaming"),
      }),
    ).toBe(
      join(
        homeDir,
        "Roaming",
        "herdr-world",
        "herdr",
        VERIFIED_HERDR_VERSION,
        "herdr.exe",
      ),
    );
  });
});

/** A fake Herdr binary: a shell script that reports a version. */
function fakeHerdr(version: string): string {
  return `#!/bin/sh\necho "herdr ${version}"\n`;
}
function sha(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

describe("installVerifiedHerdr", () => {
  test("rejects unsupported platforms before downloading", async () => {
    let downloads = 0;
    await expect(
      installVerifiedHerdr({
        platform: "freebsd",
        arch: "x64",
        homeDir: scratch(),
        download: async () => {
          downloads += 1;
        },
      }),
    ).rejects.toThrow("no verified Herdr");
    expect(downloads).toBe(0);
  });

  test("keeps an existing binary in the default location without downloading", async () => {
    const homeDir = scratch();
    const binaryPath = herdrDefaultBinaryPath({ platform: "linux", homeDir });
    mkdirSync(dirname(binaryPath), { recursive: true });
    writeFileSync(binaryPath, "already-here");
    let downloads = 0;
    const result = await installVerifiedHerdr({
      platform: "linux",
      arch: "x64",
      homeDir,
      download: async () => {
        downloads += 1;
      },
    });
    expect(result).toEqual({
      binaryPath,
      version: VERIFIED_HERDR_VERSION,
      installed: false,
    });
    expect(downloads).toBe(0);
  });

  test("downloads, checks and installs the verified binary where Herdr's installer would", async () => {
    const homeDir = scratch();
    const content = fakeHerdr(VERIFIED_HERDR_VERSION);
    let url = "";
    const result = await installVerifiedHerdr({
      platform: "linux",
      arch: "x64",
      homeDir,
      expectedSha256: sha(content),
      download: async (downloadUrl, destinationPath) => {
        url = downloadUrl;
        writeFileSync(destinationPath, content);
      },
    });
    expect(url).toBe(
      `https://github.com/herdrdev/herdr/releases/download/v${VERIFIED_HERDR_VERSION}/herdr-linux-x86_64`,
    );
    expect(result.installed).toBe(true);
    expect(result.binaryPath).toBe(join(homeDir, ".local", "bin", "herdr"));
    expect(await Bun.file(result.binaryPath).text()).toBe(content);
    expect(statSync(result.binaryPath).mode & 0o111).not.toBe(0);
  });

  test("refuses a download whose checksum does not match", async () => {
    const homeDir = scratch();
    await expect(
      installVerifiedHerdr({
        platform: "darwin",
        arch: "arm64",
        homeDir,
        download: async (_url, destinationPath) => {
          writeFileSync(destinationPath, "tampered");
        },
      }),
    ).rejects.toThrow("checksum does not match");
    const binaryPath = herdrDefaultBinaryPath({ platform: "darwin", homeDir });
    expect(existsSync(binaryPath)).toBe(false);
    expect(readdirSync(dirname(binaryPath))).toEqual([]);
  });

  test("refuses a binary that does not report the verified version", async () => {
    const homeDir = scratch();
    const content = fakeHerdr("0.9.4");
    await expect(
      installVerifiedHerdr({
        platform: "linux",
        arch: "arm64",
        homeDir,
        expectedSha256: sha(content),
        download: async (_url, destinationPath) => {
          writeFileSync(destinationPath, content);
        },
      }),
    ).rejects.toThrow(`expected herdr ${VERIFIED_HERDR_VERSION}`);
    const binaryPath = herdrDefaultBinaryPath({ platform: "linux", homeDir });
    expect(readdirSync(dirname(binaryPath))).toEqual([]);
  });
});

describe("Windows installs through Herdr's verified installer", () => {
  function windowsDeps(
    overrides: { installer?: string; installerCode?: number } = {},
  ) {
    const homeDir = scratch();
    const localAppDataDir = join(homeDir, "Local");
    const zip = "fake-zip";
    const installer = "# fake install.ps1";
    const downloads: string[] = [];
    const commands: string[][] = [];
    const binaryPath = herdrDefaultBinaryPath({
      platform: "win32",
      homeDir,
      localAppDataDir,
    });
    return {
      binaryPath,
      downloads,
      commands,
      deps: {
        platform: "win32",
        arch: "arm64",
        homeDir,
        localAppDataDir,
        expectedSha256: sha(zip),
        expectedInstallerSha256: sha(installer),
        download: async (url: string, path: string) => {
          downloads.push(url);
          writeFileSync(
            path,
            url.endsWith("install.ps1")
              ? (overrides.installer ?? installer)
              : zip,
          );
        },
        runCommand: (argv: string[]) => {
          commands.push(argv);
          // Emulate install.ps1 publishing its junctioned visible bin.
          const code = overrides.installerCode ?? 0;
          if (code === 0) {
            mkdirSync(dirname(binaryPath), { recursive: true });
            writeFileSync(binaryPath, "exe");
          }
          return code;
        },
        readVersion: (path: string) =>
          path === binaryPath ? `herdr ${VERIFIED_HERDR_VERSION}` : null,
      },
    };
  }

  test("runs install.ps1 in local-package mode with the verified zip", async () => {
    const { deps, binaryPath, downloads, commands } = windowsDeps();
    const result = await installVerifiedHerdr(deps);
    expect(result).toEqual({
      binaryPath,
      version: VERIFIED_HERDR_VERSION,
      installed: true,
    });
    expect(downloads).toEqual([
      herdrReleaseUrl("windows-x86_64"),
      herdrWindowsInstallerUrl(),
    ]);
    expect(commands).toHaveLength(1);
    const argv = commands[0];
    expect(argv.slice(0, 6)).toEqual([
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
    ]);
    const flag = (name: string) => argv[argv.indexOf(name) + 1];
    expect(flag("-LocalPackageFormat")).toBe("zip");
    expect(flag("-LocalPackageIdentity")).toBe(VERIFIED_HERDR_VERSION);
    expect(flag("-LocalPackageSha256")).toBe(deps.expectedSha256);
    // The staged package and installer are removed afterwards.
    expect(existsSync(flag("-LocalPackagePath"))).toBe(false);
    expect(existsSync(argv[6])).toBe(false);
  });

  test("never runs an installer script whose checksum does not match", async () => {
    const { deps, commands, binaryPath } = windowsDeps({
      installer: "tampered",
    });
    await expect(installVerifiedHerdr(deps)).rejects.toThrow(
      "installer checksum does not match",
    );
    expect(commands).toEqual([]);
    expect(existsSync(binaryPath)).toBe(false);
  });

  test("reports an installer failure", async () => {
    const { deps } = windowsDeps({ installerCode: 1 });
    await expect(installVerifiedHerdr(deps)).rejects.toThrow(
      "Windows installer failed",
    );
  });

  test("upgrades through the same installer", async () => {
    const { deps, binaryPath, commands } = windowsDeps();
    expect(await replaceWithVerifiedHerdr(binaryPath, deps)).toEqual({
      binaryPath,
    });
    expect(commands).toHaveLength(1);
  });
});

describe("replaceWithVerifiedHerdr", () => {
  function installed(version: string) {
    const homeDir = scratch();
    const binaryPath = herdrDefaultBinaryPath({ platform: "linux", homeDir });
    mkdirSync(dirname(binaryPath), { recursive: true });
    writeFileSync(binaryPath, fakeHerdr(version), { mode: 0o755 });
    return { homeDir, binaryPath };
  }

  test("replaces the binary and keeps the previous one for rollback", async () => {
    const { homeDir, binaryPath } = installed("0.9.3");
    const content = fakeHerdr(VERIFIED_HERDR_VERSION);
    const result = await replaceWithVerifiedHerdr(binaryPath, {
      platform: "linux",
      arch: "x64",
      homeDir,
      expectedSha256: sha(content),
      download: async (_url, path) => writeFileSync(path, content),
    });
    expect(result).toEqual({
      binaryPath,
      backupPath: `${binaryPath}.previous`,
    });
    expect(await Bun.file(binaryPath).text()).toBe(content);
    expect(await Bun.file(`${binaryPath}.previous`).text()).toBe(
      fakeHerdr("0.9.3"),
    );
    expect(readdirSync(dirname(binaryPath)).sort()).toEqual([
      "herdr",
      "herdr.previous",
    ]);
  });

  test("leaves the installed binary untouched when the download is wrong", async () => {
    const { homeDir, binaryPath } = installed("0.9.3");
    const content = fakeHerdr("0.9.4");
    await expect(
      replaceWithVerifiedHerdr(binaryPath, {
        platform: "linux",
        arch: "x64",
        homeDir,
        expectedSha256: sha(content),
        download: async (_url, path) => writeFileSync(path, content),
      }),
    ).rejects.toThrow(`expected herdr ${VERIFIED_HERDR_VERSION}`);
    expect(await Bun.file(binaryPath).text()).toBe(fakeHerdr("0.9.3"));
    expect(readdirSync(dirname(binaryPath))).toEqual(["herdr"]);
  });

  test("restores the previous binary when the installed one fails its check", async () => {
    const { homeDir, binaryPath } = installed("0.9.3");
    const content = fakeHerdr(VERIFIED_HERDR_VERSION);
    let checks = 0;
    await expect(
      replaceWithVerifiedHerdr(binaryPath, {
        platform: "linux",
        arch: "x64",
        homeDir,
        expectedSha256: sha(content),
        download: async (_url, path) => writeFileSync(path, content),
        // The staged copy passes; the installed one then fails.
        readVersion: () =>
          checks++ === 0 ? `herdr ${VERIFIED_HERDR_VERSION}` : null,
      }),
    ).rejects.toThrow("restored the previous Herdr binary");
    expect(await Bun.file(binaryPath).text()).toBe(fakeHerdr("0.9.3"));
  });
});
