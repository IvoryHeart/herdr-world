import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts/release.mjs");
const androidFile = "android/app/build.gradle";
const originalGradle = readFileSync(join(root, androidFile), "utf8");
const notes = "# Changelog\n\n## [Unreleased]\n\n### Changed\n\n- Test release.\n";

function fixture(t, gradle = originalGradle) {
  const directory = mkdtempSync(join(tmpdir(), "herdr-release-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repo = join(directory, "repo");
  const remote = join(directory, "origin.git");
  const bin = join(directory, "bin");
  mkdirSync(join(repo, "android/app"), { recursive: true });
  mkdirSync(bin);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, RELEASE_TEST_LOG: join(directory, "calls.jsonl") };
  const git = (...args) => execFileSync("git", args, { cwd: repo, env, encoding: "utf8", stdio: "pipe" }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.name", "Release test");
  git("config", "user.email", "release-test@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", "/dev/null");
  git("init", "--bare", remote);
  git("remote", "add", "origin", remote);
  writeFileSync(join(repo, androidFile), gradle);
  writeFileSync(join(repo, "CHANGELOG.md"), notes);
  writeFileSync(join(repo, "package.json"), '{"version":"0.0.0"}\n');
  git("add", ".");
  git("commit", "-m", "Initial fixture");
  git("push", "-u", "origin", "main");
  for (const command of ["npm", "gh"]) {
    const file = join(bin, command);
    writeFileSync(file, `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.RELEASE_TEST_LOG, JSON.stringify(['${command}', ...process.argv.slice(2)]) + '\\n');
if ('${command}' === 'npm' && process.env.RELEASE_TEST_FAIL_CHECK === '1') process.exit(1);
`);
    chmodSync(file, 0o755);
  }
  return {
    git,
    read: (file) => readFileSync(join(repo, file), "utf8"),
    write: (file, contents) => writeFileSync(join(repo, file), contents),
    release: (version, extraEnv = {}) => spawnSync(process.execPath, [script, version], {
      cwd: repo, env: { ...env, ...extraEnv }, encoding: "utf8", timeout: 20_000,
    }),
    calls: () => readFileSync(env.RELEASE_TEST_LOG, "utf8").trim().split("\n").map(JSON.parse),
  };
}

test("release tags contain Android versions; repeat attempts do not increment them", (t) => {
  const f = fixture(t);
  const initialCode = Number(originalGradle.match(/versionCode (\d+)/)[1]);
  const first = f.release("v0.6.2");
  assert.equal(first.status, 0, first.stderr);
  const released = f.git("show", `v0.6.2:${androidFile}`);
  assert.match(released, new RegExp(`versionCode ${initialCode + 1}\\b`));
  assert.match(released, /versionName "0\.6\.2"/);
  assert.equal(f.read(androidFile).trim(), released);
  assert.match(f.git("show", "v0.6.2:CHANGELOG.md"), /## \[0\.6\.2\]/);
  assert.match(f.read("CHANGELOG.md"), /## \[Unreleased\]/);
  assert.equal(f.git("status", "--porcelain"), "");
  assert.equal(f.git("rev-parse", "main"), f.git("rev-parse", "origin/main"));
  assert.deepEqual(f.calls().map(([command]) => command), ["npm", "gh"]);
  assert.equal(f.read("package.json"), '{"version":"0.0.0"}\n');

  const retry = f.release("v0.6.2");
  assert.notEqual(retry.status, 0);
  assert.match(retry.stderr, /tag already exists/);
  assert.equal(f.read(androidFile).trim(), released);
  assert.equal(f.git("status", "--porcelain"), "");

  f.write("CHANGELOG.md", f.read("CHANGELOG.md").replace("### Changed", "### Changed\n\n- Next test release."));
  f.git("add", "CHANGELOG.md");
  f.git("commit", "-m", "Next release notes");
  f.git("push", "origin", "main");
  const next = f.release("0.6.3-rc.1");
  assert.equal(next.status, 0, next.stderr);
  const nextRelease = f.git("show", `v0.6.3-rc.1:${androidFile}`);
  assert.match(nextRelease, new RegExp(`versionCode ${initialCode + 2}\\b`));
  assert.match(nextRelease, /versionName "0\.6\.3-rc\.1"/);
  assert.equal(f.git("show", `v0.6.2:${androidFile}`), released);
});

test("failed checks leave Android metadata and release notes untouched", (t) => {
  const f = fixture(t);
  const result = f.release("v0.6.2", { RELEASE_TEST_FAIL_CHECK: "1" });
  assert.notEqual(result.status, 0);
  assert.equal(f.read(androidFile), originalGradle);
  assert.equal(f.read("CHANGELOG.md"), notes);
  assert.equal(f.git("status", "--porcelain"), "");
  assert.equal(f.git("tag", "--list"), "");
  assert.deepEqual(f.calls(), [["npm", "run", "check"]]);
});

for (const [name, gradle, error] of [
  ["nonliteral code", originalGradle.replace(/versionCode \d+/, "versionCode releaseCode"), /exactly one literal/],
  ["missing version name", originalGradle.replace(/versionName "[^"]*"/, ""), /exactly one literal/],
  ["multiple codes", originalGradle + "\nversionCode 2\n", /exactly one literal/],
  ["exhausted version code", originalGradle.replace(/versionCode \d+/, "versionCode 2100000000"), /exceed 2100000000/],
]) {
  test(`rejects ${name} before stamping or tagging`, (t) => {
    const f = fixture(t, gradle);
    const result = f.release("v0.6.2");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, error);
    assert.equal(f.read(androidFile), gradle);
    assert.equal(f.read("CHANGELOG.md"), notes);
    assert.equal(f.git("status", "--porcelain"), "");
    assert.equal(f.git("tag", "--list"), "");
  });
}
