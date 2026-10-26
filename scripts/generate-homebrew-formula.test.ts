import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

test("Homebrew registers Herdr's owner globally and actually tests its executable", () => {
  const directory = mkdtempSync(join(tmpdir(), "herdr-world-homebrew-owner-"));
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
require "rubygems/version"
Version = Gem::Version
module Utils
  def self.safe_popen_read(binary, option)
    raise "wrong runtime owner" unless binary.to_s == "/fixture/herdr/bin/herdr" && option == "--version"
    raise "Herdr missing" if ARGV[1] == "missing"
    "herdr #{ARGV[1]}\n"
  end
end
class InstallPath < Pathname
  def install(*) = $world_modified = true
  def install_symlink(path)
    raise "World cannot export Herdr" unless path.basename.to_s == "herdr-world"
  end
end
class Formula
  class << self
    attr_reader :dependencies, :acceptance
    def inherited(child) = child.instance_variable_set(:@dependencies, [])
    def depends_on(name) = @dependencies << name
    def test(&block) = @acceptance = block
    def method_missing(*) = nil
    def respond_to_missing?(*) = true
  end
  def self.[](name)
    raise "wrong dependency" unless name == "herdr"
    Struct.new(:opt_bin).new(Pathname.new("/fixture/herdr/bin"))
  end
  attr_reader :commands
  def initialize = @commands = []
  def bin = InstallPath.new("/fixture/world/bin")
  def libexec = InstallPath.new("/fixture/world/libexec")
  def odie(message) = raise(message)
  def shell_output(command)
    @commands << command
    return "herdr-world 0.2.7\n" if command == "#{bin}/herdr-world --version"
    raise "unexpected executable: #{command}" unless command == "/fixture/herdr/bin/herdr --version"
    raise "Herdr is missing or not executable" if ARGV[1] == "missing"
    "herdr #{ARGV[1]}\n"
  end
  def assert_match(expected, actual)
    matched = expected.is_a?(Regexp) ? expected.match?(actual) : actual.include?(expected)
    raise "output mismatch" unless matched
  end
  def assert_operator(left, operation, right)
    raise "unsupported dependency version" unless left.public_send(operation, right)
  end
end
load ARGV[0]
raise "Herdr must be a dependency on every platform" unless HerdrWorld.dependencies == ["herdr"]
instance = HerdrWorld.new
if ARGV[2] == "install"
  begin
    instance.install
  rescue
    raise "World modified before rejecting its runtime" if $world_modified
    raise
  end
  raise "World was not installed" unless $world_modified
else
  instance.instance_eval(&HerdrWorld.acceptance)
  raise "Herdr executable was not tested" unless instance.commands.include?("/fixture/herdr/bin/herdr --version")
end
puts JSON.generate(instance.commands)
`;
    const execute = (version: string, phase = "test") =>
      Bun.spawnSync(["ruby", "-e", ruby, formula, version, phase], {
        stdout: "pipe",
        stderr: "pipe",
      });
    const valid = execute(VERIFIED_HERDR_VERSION);
    expect(valid.stderr.toString()).toBe("");
    expect(valid.exitCode).toBe(0);
    expect(execute("999.0.0").exitCode).toBe(0);
    expect(execute("0.8.0").exitCode).not.toBe(0);
    expect(execute("missing").exitCode).not.toBe(0);
    expect(execute(VERIFIED_HERDR_VERSION, "install").exitCode).toBe(0);
    const outdated = execute("0.8.2", "install");
    expect(outdated.exitCode).not.toBe(0);
    expect(outdated.stderr.toString()).not.toContain(
      "World modified before rejecting its runtime",
    );
    expect(execute("missing", "install").exitCode).not.toBe(0);
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
