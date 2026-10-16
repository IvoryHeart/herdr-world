import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeInstallerFixture } from "./installer-upgrade";

test.skipIf(process.platform !== "win32")(
  "Windows plugin installer verifies and stages releases without Bun on PATH",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "herdr-world plugin installer "));
    let host: ReturnType<typeof Bun.serve> | undefined;
    try {
      for (const dir of ["scripts", "server", "assets"])
        mkdirSync(join(root, dir));
      copyFileSync(
        join(import.meta.dir, "install-plugin.ps1"),
        join(root, "scripts/install-plugin.ps1"),
      );
      writeFileSync(join(root, "herdr-plugin.toml"), 'version = "9.8.7"\n');
      const powershell = join(
        process.env.SystemRoot!,
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      );
      const arch = Bun.spawnSync([
        powershell,
        "-NoProfile",
        "-Command",
        "[Runtime.InteropServices.RuntimeInformation]::OSArchitecture",
      ])
        .stdout.toString()
        .trim();
      const platform = `windows-${arch === "Arm64" ? "arm64" : "x64"}`;
      const packageDir = `herdr-world-${platform}`;
      const packagePath = join(root, "assets", packageDir);
      mkdirSync(packagePath);
      const fixture = join(root, "fixture.ts");
      writeFileSync(
        fixture,
        `if (process.argv[2] === "version" || process.argv[2] === "--version" || (process.argv[2] === "plugin" && process.argv[3] === "version" && !process.env.PLUGIN_REJECT_NATIVE)) console.log("herdr-world 9.8.7"); else process.exit(2);`,
      );
      expect(
        Bun.spawnSync([
          process.execPath,
          "build",
          "--compile",
          "--no-compile-autoload-dotenv",
          "--no-compile-autoload-bunfig",
          fixture,
          "--outfile",
          join(packagePath, "herdr-world.exe"),
        ]).exitCode,
      ).toBe(0);
      const archiveName = `herdr-world-v9.8.7-${platform}.tar.xz`;
      const archive = join(root, "assets", archiveName);
      const packageArchive = (version: string) => {
        writeFileSync(
          join(packagePath, "VERSION"),
          `herdr-world ${version} ${platform}\n`,
        );
        expect(
          Bun.spawnSync([
            "tar.exe",
            "--options",
            "xz:compression-level=0",
            "-C",
            join(root, "assets"),
            "-cJf",
            archive,
            packageDir,
          ]).exitCode,
        ).toBe(0);
        return readFileSync(archive);
      };
      const validArchive = packageArchive("9.8.7");
      const invalidArchive = packageArchive("9.8.6");
      let failure = "none";
      host = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
          if (failure === "download")
            return new Response("unavailable", { status: 503 });
          const name = new URL(request.url).pathname.slice(1);
          return name === archiveName || name === `${archiveName}.sha256`
            ? new Response(Bun.file(join(root, "assets", name)))
            : new Response("missing", { status: 404 });
        },
      });
      const installerEnv = {
        ...process.env,
        PATH: `${join(process.env.SystemRoot!, "System32")};${join(process.env.SystemRoot!, "System32/WindowsPowerShell/v1.0")}`,
      };
      for (failure of [
        "fresh",
        "none",
        "checksum",
        "checksum-name",
        "metadata",
        "native-command",
        "download",
        "launcher-replacement",
      ]) {
        writeFileSync(
          archive,
          failure === "metadata" ? invalidArchive : validArchive,
        );
        const digest =
          failure === "checksum"
            ? "0".repeat(64)
            : createHash("sha256").update(readFileSync(archive)).digest("hex");
        writeFileSync(
          `${archive}.sha256`,
          `${digest}  ${failure === "checksum-name" ? "../unrelated" : archiveName}\n`,
        );
        const target = join(root, "server/herdr-world.exe");
        const compatibility = join(root, "server/herdr-world-plugin.exe");
        if (failure !== "fresh") {
          writeFileSync(target, "keep previous binary");
          writeFileSync(compatibility, "keep previous launcher");
        }
        const scriptPath = join(root, "scripts/install-plugin.ps1").replaceAll(
          "'",
          "''",
        );
        const compatibilityPath = compatibility.replaceAll("'", "''");
        // Keep the second target readable for staging, but deny replacement.
        // The canonical target must be rolled back after its successful promotion.
        const invokeInstaller =
          failure === "launcher-replacement"
            ? `$locked = [IO.File]::Open('${compatibilityPath}', [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read); try { & '${scriptPath}' } finally { $locked.Dispose() }`
            : `& '${scriptPath}'`;
        const child = Bun.spawn(
          [
            powershell,
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            `function Get-FileHash { throw "Get-FileHash must not be required" }; ${invokeInstaller}`,
          ],
          {
            env: {
              ...installerEnv,
              HERDR_WORLD_RELEASE_BASE_URL: `http://127.0.0.1:${host.port}`,
              PLUGIN_REJECT_NATIVE: failure === "native-command" ? "1" : "",
            },
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        const [code, stderr] = await Promise.all([
          child.exited,
          new Response(child.stderr).text(),
        ]);
        if (["fresh", "none"].includes(failure)) {
          expect(code, stderr).toBe(0);
          expect(
            Bun.spawnSync([target, "plugin", "version"])
              .stdout.toString()
              .trim(),
          ).toBe("herdr-world 9.8.7");
          expect(readFileSync(compatibility)).toEqual(readFileSync(target));
          expect(
            Bun.spawnSync([compatibility, "version"]).stdout.toString().trim(),
          ).toBe("herdr-world 9.8.7");
        } else {
          expect(code, failure).not.toBe(0);
          expect(readFileSync(target, "utf8")).toBe("keep previous binary");
          expect(readFileSync(compatibility, "utf8")).toBe(
            "keep previous launcher",
          );
        }
        expect(readdirSync(join(root, "server"))).toEqual([
          "herdr-world-plugin.exe",
          "herdr-world.exe",
        ]);
      }
      const script = join(root, "scripts/install-plugin.ps1").replaceAll(
        "'",
        "''",
      );
      const emptyOverride = Bun.spawnSync(
        [
          powershell,
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `function Invoke-WebRequest { param($Uri) throw "Selected release: $Uri" }; & '${script}'`,
        ],
        {
          env: {
            ...installerEnv,
            HERDR_WORLD_RELEASE_BASE_URL: "",
          },
        },
      );
      expect(emptyOverride.exitCode).not.toBe(0);
      expect(emptyOverride.stderr.toString()).toContain(
        "Selected release: https://github.com/IvoryHeart/herdr-world/releases/download/v9.8.7/",
      );
      expect(readdirSync(join(root, "server"))).toEqual([
        "herdr-world-plugin.exe",
        "herdr-world.exe",
      ]);
    } finally {
      host?.stop(true);
      rmSync(root, { recursive: true, force: true });
    }
  },
  180_000,
);

test.skipIf(process.platform !== "win32")(
  "installer cleanup waits for transient Windows locks and rejects persistent locks",
  async () => {
    const powershell = join(
      process.env.SystemRoot!,
      "System32/WindowsPowerShell/v1.0/powershell.exe",
    );
    for (const transient of [true, false]) {
      const directory = mkdtempSync(join(tmpdir(), "world-cleanup-lock-"));
      const file = join(directory, "held.txt");
      writeFileSync(file, "synthetic locked file");
      const child = Bun.spawn(
        [
          powershell,
          "-NoProfile",
          "-Command",
          "$file=[System.IO.File]::Open($env:WORLD_CLEANUP_LOCK_FILE,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read); [Console]::WriteLine('locked'); [Console]::Out.Flush(); Start-Sleep -Seconds 30; $file.Dispose()",
        ],
        {
          env: { ...process.env, WORLD_CLEANUP_LOCK_FILE: file },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      let release: ReturnType<typeof setTimeout> | undefined;
      try {
        const reader = child.stdout.getReader();
        const ready = await reader.read();
        reader.releaseLock();
        expect(new TextDecoder().decode(ready.value)).toContain("locked");
        if (transient) {
          release = setTimeout(() => child.kill(), 150);
          await removeInstallerFixture(directory);
          expect(existsSync(directory)).toBe(false);
        } else {
          let failure: unknown;
          try {
            await removeInstallerFixture(directory);
          } catch (error) {
            failure = error;
          }
          expect(["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"]).toContain(
            (failure as NodeJS.ErrnoException)?.code ?? "",
          );
          expect(existsSync(file)).toBe(true);
        }
      } finally {
        if (release) clearTimeout(release);
        child.kill();
        await child.exited;
        await removeInstallerFixture(directory);
      }
    }
  },
  20_000,
);
