import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
        const child = Bun.spawn(
          [
            powershell,
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            join(root, "scripts/install-plugin.ps1"),
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
