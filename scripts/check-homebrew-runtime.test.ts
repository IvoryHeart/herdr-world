import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderHerdrBootstrap } from "./herdr-bootstrap";

// This listener is a fixture, not a World service. The production launcher
// still performs its real bootstrap against the check's Linux fake release.
test.skipIf(process.platform !== "linux")(
  "Linux acceptance installs once, preserves the existing core and rejects a repeated start",
  () => {
    const root = mkdtempSync(join(tmpdir(), "homebrew-runtime-"));
    try {
      const binary = join(root, "world-fixture");
      writeFileSync(
        binary,
        `#!/usr/bin/ruby
require "socket"
case ARGV.first
when "herdr"
  puts "Herdr is not installed."
when "connections"
  exit 0
else
  system(File.join(ENV.fetch("HOME"), ".local/bin/herdr-core"), "server", "start") if ENV["CHECK_EXTRA_START"]
  port = ARGV[ARGV.index("--port") + 1].to_i
  server = TCPServer.new("127.0.0.1", port)
  STDOUT.sync = true
  puts "listening url=http://127.0.0.1:#{port}"
  loop { server.accept.close }
end
`,
        { mode: 0o755 },
      );
      const launcher = join(root, "launcher");
      writeFileSync(
        launcher,
        readFileSync(new URL("./homebrew-launcher.sh", import.meta.url), "utf8")
          .replace("@HERDR_BOOTSTRAP@", renderHerdrBootstrap())
          .replace("@HERDR_WORLD_BINARY@", `'${binary}'`),
        { mode: 0o755 },
      );
      const home = join(root, "home");
      const check = (extraStart = false) =>
        Bun.spawnSync(
          [
            "ruby",
            join(import.meta.dir, "check-homebrew-runtime.rb"),
            launcher,
            home,
          ],
          {
            env: {
              ...process.env,
              CHECK_EXTRA_START: extraStart ? "1" : undefined,
            },
            stdout: "pipe",
            stderr: "pipe",
          },
        );
      const missing = check();
      expect(missing.stderr.toString()).toBe("");
      expect(missing.exitCode).toBe(0);
      expect(missing.stdout.toString()).toContain(
        "Missing herdr-core installed, verified and started",
      );
      const core = join(home, ".local/bin/herdr-core");
      const original = readFileSync(core, "utf8");
      writeFileSync(core, `${original}\n# Separately owned runtime.\n`);
      const existing = check();
      expect(existing.stderr.toString()).toBe("");
      expect(existing.exitCode).toBe(0);
      expect(existing.stdout.toString()).toContain(
        "Existing herdr-core preserved",
      );
      expect(readFileSync(core, "utf8")).toBe(
        `${original}\n# Separately owned runtime.\n`,
      );
      const repeated = check(true);
      expect(repeated.exitCode).not.toBe(0);
      expect(repeated.stderr.toString()).toContain(
        "Existing herdr-core was started again",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  30_000,
);
