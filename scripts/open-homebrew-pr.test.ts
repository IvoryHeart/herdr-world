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

test("tap handoff synchronizes acceptance even when the Formula is unchanged and refuses a drifting retry", () => {
  const root = mkdtempSync(join(tmpdir(), "homebrew-tap-sync-"));
  try {
    const remote = join(root, "remote.git");
    const seed = join(root, "seed");
    const fakeBin = join(root, "bin");
    mkdirSync(fakeBin);
    const env = {
      ...process.env,
      GH_TOKEN: "fixture-token",
      RUNNER_TEMP: root,
      SYNC_REMOTE: remote,
      SYNC_PR_CALLS: join(root, "prs.log"),
      PATH: `${fakeBin}:${process.env.PATH}`,
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    };
    const git = (args: string[], cwd = root) => {
      const result = Bun.spawnSync(["git", ...args], {
        cwd,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.exitCode).toBe(0);
      return result.stdout.toString().trim();
    };
    git(["init", "--bare", "--initial-branch=main", remote]);
    git(["clone", remote, seed]);
    mkdirSync(join(seed, "Formula"));
    const formula = 'class HerdrWorld < Formula\n  version "0.3.5"\nend\n';
    writeFileSync(join(seed, "Formula/herdr-world.rb"), formula);
    git(["add", "."], seed);
    git(["commit", "-m", "Fixture formula already at target version"], seed);
    git(["push", "origin", "main"], seed);
    const source = join(root, "herdr-world.rb");
    writeFileSync(source, formula);
    writeFileSync(
      join(fakeBin, "gh"),
      `#!/bin/sh
case "$1 $2" in
  'auth setup-git') exit 0 ;;
  'repo clone') exec git clone --quiet "$SYNC_REMOTE" "$4" ;;
  'api '*) exit 0 ;;
  'pr create') printf '%s\\n' "$*" >> "$SYNC_PR_CALLS" ;;
  *) exit 64 ;;
esac
`,
      { mode: 0o755 },
    );
    const handoff = () =>
      Bun.spawnSync(
        ["bash", join(import.meta.dir, "open-homebrew-pr.sh"), "0.3.5", source],
        { env, stdout: "pipe", stderr: "pipe" },
      );
    const first = handoff();
    expect(first.exitCode).toBe(0);
    const branch = "release/herdr-world-v0.3.5";
    for (const [target, canonical] of [
      [
        ".github/scripts/check-homebrew-runtime.rb",
        "check-homebrew-runtime.rb",
      ],
      [".github/workflows/herdr-world.yml", "homebrew-tap-workflow.yml"],
    ]) {
      expect(git(["--git-dir", remote, "show", `${branch}:${target}`])).toBe(
        readFileSync(join(import.meta.dir, canonical!), "utf8").trim(),
      );
    }
    const originalHead = git(["--git-dir", remote, "rev-parse", branch]);
    const retry = handoff();
    expect(retry.exitCode).toBe(0);
    expect(git(["--git-dir", remote, "rev-parse", branch])).toBe(originalHead);
    expect(
      readFileSync(env.SYNC_PR_CALLS, "utf8").trim().split("\n"),
    ).toHaveLength(2);

    git(["fetch", "origin", branch], seed);
    git(["checkout", "--detach", "FETCH_HEAD"], seed);
    writeFileSync(
      join(seed, ".github/scripts/check-homebrew-runtime.rb"),
      "# Drifting check\n",
    );
    git(["add", "."], seed);
    git(["commit", "-m", "Fixture acceptance drift"], seed);
    git(["push", "origin", `HEAD:refs/heads/${branch}`], seed);
    const drift = handoff();
    expect(drift.exitCode).toBe(1);
    expect(drift.stderr.toString()).toContain(
      "different Formula or runtime acceptance content",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
