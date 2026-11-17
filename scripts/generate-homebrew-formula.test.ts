import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderHomebrewFormula } from "./generate-homebrew-formula";
import {
  isolatedPath,
  loginEntry,
  writeCoreRelease,
} from "./herdr-core-fixture";

test("Homebrew Formula uses each platform's verified archive digest", () => {
  const digests = {
    "darwin-arm64": "a".repeat(64),
    "darwin-x64": "b".repeat(64),
    "linux-arm64": "c".repeat(64),
    "linux-x64": "d".repeat(64),
  };
  const formula = renderHomebrewFormula("0.2.0", digests);
  for (const [platform, digest] of Object.entries(digests)) {
    expect(formula).toContain(
      `herdr-world-v0.2.0-${platform}.tar.xz"\n      sha256 "${digest}"`,
    );
  }
  expect(formula).not.toContain("@HERDR_");
  expect(formula).toContain('version "0.2.0"');
  expect(formula).toContain('homepage "https://herdr.world/"');
  expect(formula).toContain('libexec.install "herdr-world", "VERSION"');
  expect(formula).not.toContain('Dir["herdr-world-*"]');
  expect(formula).toContain('libexec/"herdr-world"');
  expect(formula).not.toContain('resource "herdr"');
  // herdr-core's install steps are embedded; the Herdr TUI is never fetched.
  expect(formula).toContain("herdr_core_setup");
  expect(formula).toContain("https://releases.herdr.dev");
  expect(formula).not.toContain("github.com/herdrdev/herdr");
  expect(formula).not.toContain('bin.install_symlink libexec/"herdr/herdr"');
});

// About a dozen launches; a cold CI runner once took over Bun's 5 s default.
// The limit only catches a hung launch.
test("Homebrew uses any installed runtime and installs herdr-core only when none is", () => {
  const directory = mkdtempSync(join(tmpdir(), "herdr-world-homebrew-reuse-"));
  try {
    const formula = join(directory, "herdr-world.rb");
    writeFileSync(
      formula,
      renderHomebrewFormula("0.2.7", {
        "darwin-arm64": "a".repeat(64),
        "darwin-x64": "b".repeat(64),
        "linux-arm64": "c".repeat(64),
        "linux-x64": "d".repeat(64),
      }),
    );
    const ruby = String.raw`
require "json"
require "pathname"
require "shellwords"
class InstallPath < Pathname
  def /(path) = self.class.new(File.join(to_s, path))
  def install(*) = nil
  def write(content)
    FileUtils.mkdir_p(dirname)
    super(content)
    chmod(0755)
  end
  def install_symlink(*) = raise("World must install the conditional launcher")
end
class Formula
  class << self
    attr_reader :dependencies
    def inherited(child) = child.instance_variable_set(:@dependencies, [])
    def depends_on(name) = @dependencies << name
    def test(*) = nil
    def method_missing(*) = nil
    def respond_to_missing?(*) = true
  end
  def bin = InstallPath.new(File.join(ARGV[1], "bin"))
  def libexec = InstallPath.new(File.join(ARGV[1], "libexec"))
end
require "fileutils"
load ARGV[0]
raise "World must reuse Herdr outside Homebrew" unless HerdrWorld.dependencies.empty?
HerdrWorld.new.install
`;
    const staged = Bun.spawnSync(["ruby", "-e", ruby, formula, directory], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(staged.stderr.toString()).toBe("");
    expect(staged.exitCode).toBe(0);
    const world = join(directory, "libexec", "herdr-world");
    mkdirSync(join(directory, "libexec"), { recursive: true });
    writeFileSync(
      world,
      `#!/bin/sh
printf '%s\\n' "$*" >> "$FIXTURE_LOG"
if [ "$*" = "herdr status" ]; then
  if [ "$FIXTURE_STATE" = error ]; then exit 7; fi
  if [ "$FIXTURE_STATE" = missing ]; then echo 'Herdr is not installed.';
  elif [ "$FIXTURE_STATE" = running ]; then echo 'Herdr is running (version 0.9.5, protocol 22).';
  else echo "Herdr is installed but not running: $FIXTURE_EXISTING"; fi
fi
exit "\${FIXTURE_EXIT:-0}"
`,
      { mode: 0o755 },
    );
    const existing = join(directory, "existing runtime", "herdr");
    mkdirSync(join(directory, "existing runtime"));
    writeFileSync(existing, "#!/bin/sh\necho herdr 0.9.5\n", { mode: 0o755 });
    const assets = join(directory, "assets");
    const fakeBin = join(directory, "fake-bin");
    mkdirSync(assets);
    writeCoreRelease(assets, fakeBin);
    writeFileSync(
      join(fakeBin, "curl"),
      `#!/bin/sh
out=""; url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    --max-time|--retry|--connect-timeout|--proto|--proto-redir) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
[ "\${FIXTURE_OFFLINE:-}" != 1 ] || exit 6
cp "$FIXTURE_ASSETS/\${url##*/}" "$out"
`,
      { mode: 0o755 },
    );
    const home = join(directory, "home");
    const core = join(home, ".local", "bin", "herdr-core");
    const log = join(directory, "commands");
    const coreLog = join(directory, "core.log");
    const execute = (
      state: string,
      args: string[] = [],
      extra: Record<string, string> = {},
    ) => {
      writeFileSync(log, "");
      writeFileSync(coreLog, "");
      rmSync(home, { recursive: true, force: true });
      mkdirSync(home);
      if (extra.FIXTURE_CORE) {
        mkdirSync(join(core, ".."), { recursive: true });
        writeFileSync(core, "#!/bin/sh\necho 'hc 0.0.1'\n", { mode: 0o755 });
      }
      const result = Bun.spawnSync(
        [join(directory, "bin", "herdr-world"), ...args],
        {
          env: {
            HOME: home,
            PATH: isolatedPath(fakeBin),
            TMPDIR: directory,
            FIXTURE_ASSETS: assets,
            FIXTURE_EXISTING: existing,
            FIXTURE_STATE: state,
            FIXTURE_LOG: log,
            HC_FIXTURE_LOG: coreLog,
            ...extra,
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      return {
        ...result,
        commands: readFileSync(log, "utf8").replace(/\n$/, "").split("\n"),
        coreLog: readFileSync(coreLog, "utf8"),
      };
    };
    // Any installed Herdr TUI: World starts and nothing is installed.
    for (const state of ["current", "running"]) {
      const result = execute(state, ["--port", "12345"]);
      expect(result.exitCode).toBe(0);
      expect(result.commands).toEqual(["herdr status", "--port 12345"]);
      expect(existsSync(core)).toBe(false);
      expect(result.coreLog).toBe("");
    }
    // An installed herdr-core, with or without the TUI: nothing changes.
    for (const state of ["missing", "current"]) {
      const result = execute(state, [], { FIXTURE_CORE: "1" });
      expect(result.exitCode).toBe(0);
      expect(result.coreLog).toBe("");
      expect(readFileSync(core, "utf8")).toContain("0.0.1");
      expect(existsSync(loginEntry(home))).toBe(false);
    }
    // No runtime: herdr-core is installed, set to start at login, and started.
    const fresh = execute("missing");
    expect(fresh.stderr.toString()).toBe("");
    expect(fresh.exitCode).toBe(0);
    expect(fresh.commands).toEqual([
      "herdr status",
      "connections add core-local --core --default --auto-connect --label herdr-core on this computer",
      "",
    ]);
    expect(existsSync(core)).toBe(true);
    expect(readFileSync(loginEntry(home), "utf8")).toContain(core);
    expect(fresh.coreLog).toContain("core server start");
    for (const args of [
      ["--version"],
      ["-V"],
      ["--help"],
      ["herdr", "status"],
      ["service", "status"],
      ["--skill"],
      ["--port", "12345", "--help"],
      ["--ssh-host", "remote.example"],
    ]) {
      const result = execute("missing", args);
      expect(result.commands).toEqual([args.join(" ")]);
      expect(existsSync(core)).toBe(false);
    }
    for (const extra of [
      { HERDR_WORLD_SKIP_HERDR: "1" },
      { HERDR_SSH_HOST: "remote.example" },
    ] as Record<string, string>[]) {
      expect(execute("missing", [], extra).commands).toEqual([""]);
      expect(existsSync(core)).toBe(false);
    }
    const detectionFailure = execute("error", ["--port", "12345"]);
    const failed = execute("missing", ["--port", "12345"], {
      FIXTURE_OFFLINE: "1",
    });
    for (const failure of [detectionFailure, failed]) {
      expect(failure.exitCode).toBe(0);
      expect(failure.commands.at(-1)).toBe("--port 12345");
      const warning = failure.stderr.toString();
      expect(warning).toContain("herdr-world herdr upgrade --install");
      expect(warning).toContain("HERDR_WORLD_SKIP_HERDR=1");
      expect(existsSync(core)).toBe(false);
    }
    expect(failed.stderr.toString()).toContain("internet connection");
    expect(execute("current", [], { FIXTURE_EXIT: "23" }).exitCode).toBe(23);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);

test("Homebrew RC Formula uses the separate candidate identity", () => {
  const digests = {
    "darwin-arm64": "a".repeat(64),
    "darwin-x64": "b".repeat(64),
    "linux-arm64": "c".repeat(64),
    "linux-x64": "d".repeat(64),
  };
  const formula = renderHomebrewFormula("0.2.0-rc.1", digests);
  expect(formula).toContain("class HerdrWorldRc < Formula");
  expect(formula).toContain('conflicts_with "herdr-world"');
  expect(formula).toContain("herdr-world-v0.2.0-rc.1-linux-x64.tar.xz");
});
