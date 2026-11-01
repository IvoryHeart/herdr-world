import { expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  symlinkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  VERIFIED_HERDR_VERSION,
  VERIFIED_HERDR_SHA256,
} from "../server/src/herdr/release";
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
  expect(formula).not.toContain("@HERDR_");
  expect(formula).toContain('version "0.2.0"');
  expect(formula).toContain('homepage "https://herdr.world/"');
  expect(formula).toContain('libexec.install "herdr-world", "VERSION"');
  expect(formula).not.toContain('Dir["herdr-world-*"]');
  expect(formula).toContain('libexec/"herdr-world"');
  expect(formula).not.toContain('resource "herdr"');
  for (const [target, hash] of Object.entries(VERIFIED_HERDR_SHA256)) {
    if (!target.startsWith("windows"))
      expect(formula).toContain(`expected=${hash}`);
  }
  expect(formula).not.toContain('bin.install_symlink libexec/"herdr/herdr"');
});

// About fifteen Ruby launches take about a second; a cold CI runner once took
// over Bun's 5 s default. The limit only catches a hung launch.
test("Homebrew reuses any existing Herdr and bootstraps only a missing runtime", () => {
  const directory = mkdtempSync(join(tmpdir(), "herdr-world-homebrew-reuse-"));
  try {
    const formula = join(directory, "herdr-world.rb");
    const payload =
      "#!/bin/sh\nprintf 'herdr %s\\n' \"${FIXTURE_RUNTIME_VERSION:-" +
      VERIFIED_HERDR_VERSION +
      '}"\n';
    const payloadFile = join(directory, "payload");
    writeFileSync(payloadFile, payload);
    const hash = new Bun.CryptoHasher("sha256").update(payload).digest("hex");
    const fixtureRuntime = {
      version: VERIFIED_HERDR_VERSION,
      digests: Object.fromEntries(
        Object.keys(VERIFIED_HERDR_SHA256).map((target) => [target, hash]),
      ),
    };
    writeFileSync(
      formula,
      renderHomebrewFormula(
        "0.2.7",
        {
          "darwin-arm64": "a".repeat(64),
          "darwin-x64": "b".repeat(64),
          "linux-arm64": "c".repeat(64),
          "linux-x64": "d".repeat(64),
        },
        fixtureRuntime,
      ),
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
  count=0
  [ ! -f "$FIXTURE_COUNTER" ] || count="$(cat "$FIXTURE_COUNTER")"
  count=$((count + 1)); echo "$count" > "$FIXTURE_COUNTER"
  if [ "\${FIXTURE_LATE_STATUS:-}" = "$count" ]; then
    mkdir -p "$HERDR_INSTALL_DIR"
    if [ "\${FIXTURE_LATE_KIND:-file}" = symlink ]; then ln -s "$HERDR_INSTALL_DIR/absent" "$HERDR_INSTALL_DIR/herdr";
    elif [ "\${FIXTURE_LATE_KIND:-file}" = directory ]; then mkdir "$HERDR_INSTALL_DIR/herdr";
    else printf 'herdr 999.0.0\\n' > "$HERDR_INSTALL_DIR/herdr"; fi
  fi
fi
if [ "\${2:-}" = upgrade ]; then exit "\${FIXTURE_INSTALL_EXIT:-0}"; fi
exit "\${FIXTURE_EXIT:-0}"
`,
      { mode: 0o755 },
    );
    const existing = join(directory, "existing runtime", "herdr");
    mkdirSync(join(directory, "existing runtime"));
    writeFileSync(existing, payload, { mode: 0o755 });
    const log = join(directory, "commands");
    const fakeBin = join(directory, "curl-bin");
    mkdirSync(fakeBin);
    writeFileSync(
      join(fakeBin, "curl"),
      `#!/bin/sh
echo download >> "$FIXTURE_DOWNLOAD_LOG"
[ "\${FIXTURE_INSTALL_EXIT:-0}" = 0 ] || exit "$FIXTURE_INSTALL_EXIT"
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then destination="$2"; shift 2; else shift; fi
done
if [ -n "\${FIXTURE_RACE_VERSION:-}" ]; then
  printf 'herdr %s\\n' "$FIXTURE_RACE_VERSION" > "$HERDR_INSTALL_DIR/herdr"
fi
cp "$FIXTURE_PAYLOAD" "$destination"
if [ "\${FIXTURE_CORRUPT_DOWNLOAD:-}" = 1 ]; then echo '# corrupted' >> "$destination"; fi
`,
      { mode: 0o755 },
    );
    const execute = (
      state: string,
      args: string[] = [],
      extra: Record<string, string> = {},
    ) => {
      writeFileSync(log, "");
      rmSync(join(directory, "counter"), { force: true });
      rmSync(join(directory, "runtime"), { recursive: true, force: true });
      writeFileSync(join(directory, "downloads"), "");
      if (extra.FIXTURE_PREEXIST_DANGLING === "1") {
        mkdirSync(join(directory, "runtime"));
        symlinkSync(
          join(directory, "absent"),
          join(directory, "runtime", "herdr"),
        );
      }
      const result = Bun.spawnSync(
        [join(directory, "bin", "herdr-world"), ...args],
        {
          env: {
            ...process.env,
            HOME: directory,
            PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
            HERDR_INSTALL_DIR: join(directory, "runtime"),
            FIXTURE_PAYLOAD: payloadFile,
            FIXTURE_EXISTING: existing,
            FIXTURE_COUNTER: join(directory, "counter"),
            FIXTURE_DOWNLOAD_LOG: join(directory, "downloads"),
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
      "herdr status",
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
    const detectionFailure = execute("error", ["--port", "12345"]);
    expect(detectionFailure.exitCode).toBe(0);
    expect(detectionFailure.commands).toEqual(["herdr status", "--port 12345"]);
    const failed = execute("missing", ["--port", "12345"], {
      FIXTURE_INSTALL_EXIT: "9",
    });
    expect(failed.exitCode).toBe(0);
    expect(failed.commands).toEqual(["herdr status", "--port 12345"]);
    for (const failure of [detectionFailure, failed]) {
      const warning = failure.stderr.toString();
      expect(warning).toContain("herdr-world herdr upgrade --install");
      expect(warning).toContain("HERDR_WORLD_SKIP_HERDR=1");
      expect(warning.trim().split("\n")).toHaveLength(1);
    }
    expect(execute("current", [], { FIXTURE_EXIT: "23" }).exitCode).toBe(23);
    for (const version of ["0.8.2", "999.0.0"]) {
      const race = execute("missing", [], { FIXTURE_RACE_VERSION: version });
      expect(race.exitCode).toBe(0);
      expect(readFileSync(join(directory, "runtime", "herdr"), "utf8")).toBe(
        `herdr ${version}\n`,
      );
      expect(race.commands).not.toContain(
        "herdr upgrade --install --no-integrations --no-plugin",
      );
    }
    for (const extra of [
      { FIXTURE_CORRUPT_DOWNLOAD: "1" },
      { FIXTURE_RUNTIME_VERSION: "0.8.2" },
    ] as Record<string, string>[]) {
      const invalid = execute("missing", [], extra);
      expect(invalid.exitCode).toBe(0);
      expect(invalid.stderr.toString()).toContain(
        "herdr-world herdr upgrade --install",
      );
      expect(existsSync(join(directory, "runtime", "herdr"))).toBe(false);
    }
    const dangling = execute("missing", [], { FIXTURE_PREEXIST_DANGLING: "1" });
    expect(dangling.exitCode).toBe(0);
    expect(dangling.stderr.toString()).toContain(
      join(directory, "runtime", "herdr"),
    );
    expect(readFileSync(join(directory, "downloads"), "utf8")).toBe("");
    expect(
      lstatSync(join(directory, "runtime", "herdr")).isSymbolicLink(),
    ).toBe(true);
    for (const phase of ["1", "2"]) {
      const raced = execute("missing", [], { FIXTURE_LATE_STATUS: phase });
      expect(raced.exitCode).toBe(0);
      expect(readFileSync(join(directory, "runtime", "herdr"), "utf8")).toBe(
        "herdr 999.0.0\n",
      );
    }
    for (const kind of ["symlink", "directory"]) {
      expect(
        execute("missing", [], {
          FIXTURE_LATE_STATUS: "2",
          FIXTURE_LATE_KIND: kind,
        }).exitCode,
      ).toBe(0);
      const entry = lstatSync(join(directory, "runtime", "herdr"));
      expect(
        kind === "symlink" ? entry.isSymbolicLink() : entry.isDirectory(),
      ).toBe(true);
      expect(existsSync(join(directory, "runtime", "herdr", "herdr"))).toBe(
        false,
      );
    }
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
