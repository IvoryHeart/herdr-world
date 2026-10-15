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

test("native compatibility launcher preserves every cached verb without Bun and delegates only to World", () => {
  const root = mkdtempSync(join(tmpdir(), "world native plugin "));
  try {
    const config = join(root, ".config", "herdr-world");
    mkdirSync(config, { recursive: true });
    writeFileSync(
      join(config, "herdr-world.env"),
      "HOST=127.0.0.1\nPORT=8799\n",
    );
    writeFileSync(join(config, "auth-token"), "synthetic-token\n");
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
      if (verb === "version") expect(output.trim()).toBe("herdr-world 9.8.7");
      if (verb === "url" || verb === "panel")
        expect(output).toContain(
          "http://127.0.0.1:8799/?token=synthetic-token",
        );
      if (verb === "panel")
        expect(output).toContain("Version: herdr-world 9.8.7");
    }
    const services = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(services).toEqual([
      [canonical, "service", "status"],
      [canonical, "service", "install", "--force"],
      [canonical, "service", "install"],
      [canonical, "service", "status"],
      [canonical, "service", "uninstall"],
    ]);
    expect(
      invoke(canonical, ["plugin", "version"]).stdout.toString().trim(),
    ).toBe("herdr-world 9.8.7");
    expect(invoke(launcher, ["restart", "--force"]).exitCode).not.toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
