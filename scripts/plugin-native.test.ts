import { expect, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const tls of [false, true]) {
  test.skipIf(tls && !Bun.which("openssl"))(
    `native compatibility launcher preserves cached verbs over ${tls ? "HTTPS" : "HTTP"} without Bun and delegates only to World`,
    () => {
      const root = mkdtempSync(join(tmpdir(), "world native plugin "));
      try {
        const config = join(root, ".config", "herdr-world");
        mkdirSync(config, { recursive: true });
        const cert = join(root, "cert.pem");
        const key = join(root, "key.pem");
        if (tls) {
          const generated = Bun.spawnSync([
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-days",
            "1",
            "-subj",
            "/CN=localhost",
            "-keyout",
            key,
            "-out",
            cert,
          ]);
          expect(generated.exitCode, generated.stderr.toString()).toBe(0);
        }
        writeFileSync(
          join(config, "herdr-world.env"),
          "HOST=127.0.0.1\nPORT=8799\n" +
            (tls
              ? `HERDR_WORLD_TLS_CERT=${JSON.stringify(cert.replaceAll("\\", "/"))}\nHERDR_WORLD_TLS_KEY=${JSON.stringify(key.replaceAll("\\", "/"))}\n`
              : ""),
        );
        writeFileSync(join(config, "auth-token"), "a".repeat(64) + "\n");
        const entry = join(root, "entry.ts");
        const canonical = join(
          root,
          process.platform === "win32" ? "herdr-world.exe" : "herdr-world",
        );
        const launcher = join(root, "herdr-world-plugin.exe");
        const log = join(root, "services.jsonl");
        writeFileSync(
          entry,
          `import { appendFileSync } from "node:fs";
import { runPluginCommand } from ${JSON.stringify(join(import.meta.dir, "../server/src/config/plugin-command.ts"))};
if (process.argv[2] === "record-executable") {
 console.log(process.execPath);
 process.exit(0);
}
const result = await runPluginCommand(process.argv.slice(2), "9.8.7");
if (result !== null) process.exit(result);
if (process.argv[2] === "service") {
 appendFileSync(${JSON.stringify(log)}, JSON.stringify([process.execPath, ...process.argv.slice(2)]) + "\\n");
 console.log("installed");
 process.exit(0);
}
process.exit(2);
`,
        );
        const build = Bun.spawnSync([
          process.execPath,
          "build",
          "--compile",
          "--no-compile-autoload-dotenv",
          "--no-compile-autoload-bunfig",
          entry,
          "--outfile",
          canonical,
        ]);
        expect(build.exitCode, build.stderr.toString()).toBe(0);
        copyFileSync(canonical, launcher);
        const invoke = (binary: string, args: string[]) =>
          Bun.spawnSync([binary, ...args], {
            env: {
              ...process.env,
              PATH: "",
              HOME: root,
              USERPROFILE: root,
              APPDATA: join(root, ".config"),
            },
            stdin: "pipe",
          });
        // Ask the actual compiled files for their resolved identities. Bun's
        // Windows realpath can retain a short path while execPath expands it.
        const identity = (binary: string) => {
          const result = invoke(binary, ["record-executable"]);
          expect(result.exitCode, result.stderr.toString()).toBe(0);
          return result.stdout.toString().trim();
        };
        const canonicalIdentity = identity(canonical);
        const launcherIdentity = identity(launcher);
        expect(canonicalIdentity).not.toBe(launcherIdentity);
        for (const verb of [
          "version",
          "url",
          "panel",
          "start",
          "restart",
          "status",
          "uninstall",
        ]) {
          const result = invoke(launcher, [verb]);
          expect(result.exitCode, result.stderr.toString()).toBe(0);
          const output = result.stdout.toString();
          if (verb === "version")
            expect(output.trim()).toBe("herdr-world 9.8.7");
          if (verb === "url" || verb === "panel")
            expect(output).toContain(
              `${tls ? "https" : "http"}://localhost:8799/?token=${"a".repeat(64)}`,
            );
          if (verb === "panel")
            expect(output).toContain("Version: herdr-world 9.8.7");
        }
        const services = readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => {
            const [binary, ...args] = JSON.parse(line) as string[];
            expect(binary).not.toBe(launcherIdentity);
            return [binary, ...args];
          });
        expect(services).toEqual([
          [canonicalIdentity, "service", "status"],
          [canonicalIdentity, "service", "install", "--force"],
          [canonicalIdentity, "service", "install"],
          [canonicalIdentity, "service", "status"],
          [canonicalIdentity, "service", "uninstall"],
        ]);
        expect(
          invoke(canonical, ["plugin", "version"]).stdout.toString().trim(),
        ).toBe("herdr-world 9.8.7");
        expect(invoke(launcher, ["restart", "--force"]).exitCode).not.toBe(0);
        for (const verb of ["url", "panel"]) {
          const result = invoke(canonical, ["plugin", verb]);
          expect(result.exitCode, result.stderr.toString()).toBe(0);
          expect(result.stdout.toString()).toContain(
            `${tls ? "https" : "http"}://localhost:8799/?token=${"a".repeat(64)}`,
          );
        }
        writeFileSync(
          join(config, "herdr-world.env"),
          readFileSync(join(config, "herdr-world.env"), "utf8") +
            "HERDR_WORLD_PASSWORD=synthetic-password-long-enough\n",
        );
        for (const verb of ["url", "panel"]) {
          const result = invoke(launcher, [verb]);
          expect(result.exitCode, result.stderr.toString()).toBe(0);
          expect(result.stdout.toString()).toContain(
            `${tls ? "https" : "http"}://localhost:8799`,
          );
          expect(result.stdout.toString()).not.toContain("token=");
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
}
