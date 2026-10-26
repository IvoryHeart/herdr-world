import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERIFIED_HERDR_VERSION } from "../server/src/herdr/release";
import { renderHomebrewFormula } from "./generate-homebrew-formula";

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
  expect(formula).toContain('version "0.2.0"');
  expect(formula).toContain('homepage "https://herdr.world/"');
  expect(formula).toContain('libexec.install "herdr-world", "VERSION"');
  expect(formula).not.toContain('Dir["herdr-world-*"]');
  expect(formula).toContain('libexec/"herdr-world"');
  expect(formula).not.toContain('resource "herdr"');
  expect(formula).not.toContain('bin.install_symlink libexec/"herdr/herdr"');
});

test("Homebrew reuses any existing Herdr and bootstraps only a missing runtime", () => {
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
  else echo "Herdr is installed but not running: /fixture/external herdr/$FIXTURE_STATE"; fi
fi
if [ "\${2:-}" = upgrade ]; then exit "\${FIXTURE_INSTALL_EXIT:-0}"; fi
exit "\${FIXTURE_EXIT:-0}"
`,
      { mode: 0o755 },
    );
    const log = join(directory, "commands");
    const execute = (
      state: string,
      args: string[] = [],
      extra: Record<string, string> = {},
    ) => {
      writeFileSync(log, "");
      const result = Bun.spawnSync(
        [join(directory, "bin", "herdr-world"), ...args],
        {
          env: {
            ...process.env,
            HERDR_WORLD_SKIP_HERDR: "",
            HERDR_SSH_HOST: "",
            HERDR_SOCKET_PATH: "",
            HERDR_CLIENT_SOCKET_PATH: "",
            HERDR_SESSION: "",
            FIXTURE_STATE: state,
            FIXTURE_LOG: log,
            ...extra,
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      return {
        ...result,
        commands: readFileSync(log, "utf8").replace(/\n$/, "").split("\n"),
      };
    };
    for (const existing of [
      VERIFIED_HERDR_VERSION,
      "999.0.0",
      "0.8.2",
      "managed",
      "running",
    ]) {
      const result = execute(existing, ["--port", "12345"]);
      expect(result.exitCode).toBe(0);
      expect(result.commands).toEqual(["herdr status", "--port 12345"]);
    }
    expect(execute("missing").commands).toEqual([
      "herdr status",
      "herdr upgrade --install --no-integrations --no-plugin",
      "",
    ]);
    for (const args of [
      ["--version"],
      ["-V"],
      ["--help"],
      ["herdr", "status"],
      ["service", "status"],
      ["--skill"],
    ]) {
      expect(execute("missing", args).commands).toEqual([args.join(" ")]);
    }
    expect(
      execute("missing", [], { HERDR_WORLD_SKIP_HERDR: "1" }).commands,
    ).toEqual([""]);
    expect(execute("error").exitCode).toBe(7);
    const failed = execute("missing", [], { FIXTURE_INSTALL_EXIT: "9" });
    expect(failed.exitCode).toBe(9);
    expect(failed.commands).toEqual([
      "herdr status",
      "herdr upgrade --install --no-integrations --no-plugin",
    ]);
    expect(execute("missing", ["--port", "12345", "--help"]).commands).toEqual([
      "--port 12345 --help",
    ]);
    expect(
      execute("missing", ["--ssh-host", "remote.example"]).commands,
    ).toEqual(["--ssh-host remote.example"]);
    expect(
      execute("missing", [], { HERDR_SSH_HOST: "remote.example" }).commands,
    ).toEqual([""]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

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
