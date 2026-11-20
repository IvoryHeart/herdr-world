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

// Several real Git clones, commits and pushes need a bounded integration budget.
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
      SYNC_AUTH_CALLS: join(root, "auth.log"),
      SYNC_PR_BODY: join(root, "body.md"),
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
  'auth setup-git') printf 'auth' >> "$SYNC_AUTH_CALLS" ;;
  'repo clone') exec git clone --quiet "$SYNC_REMOTE" "$4" ;;
  'api '*) exit 0 ;;
  'pr create')
    if [ "\${SYNC_FAIL_PR:-}" = true ]; then exit 1; fi
    printf '%s\\n' "$*" >> "$SYNC_PR_CALLS"
    while [ "$#" -gt 0 ]; do
      if [ "$1" = --body-file ]; then cp "$2" "$SYNC_PR_BODY"; break; fi
      shift
    done ;;

  *) exit 64 ;;
esac
`,
      { mode: 0o755 },
    );
    const prepared = join(root, "prepared");
    const beforeRefs = git(["--git-dir", remote, "show-ref"]);
    const dryRun = Bun.spawnSync(
      [
        "bash",
        join(import.meta.dir, "open-homebrew-pr.sh"),
        "0.3.5",
        source,
        "--dry-run",
        prepared,
      ],
      { env: { ...env, GH_TOKEN: "" }, stdout: "pipe", stderr: "pipe" },
    );
    expect(dryRun.exitCode).toBe(0);
    expect(dryRun.stdout.toString()).toContain("no commit, push or PR created");
    expect(git(["--git-dir", remote, "show-ref"])).toBe(beforeRefs);
    expect(Bun.file(env.SYNC_PR_CALLS).size).toBe(0);
    expect(Bun.file(env.SYNC_AUTH_CALLS).size).toBe(0);
    expect(readFileSync(join(prepared, "pr.patch"), "utf8")).toContain(
      "check-homebrew-runtime.rb",
    );
    const candidateSource = join(root, "herdr-world-rc.rb");
    writeFileSync(
      candidateSource,
      formula.replaceAll("HerdrWorld", "HerdrWorldRc"),
    );
    const rcOutput = join(root, "rc-prepared");
    const rcDryRun = Bun.spawnSync(
      [
        "bash",
        join(import.meta.dir, "open-homebrew-pr.sh"),
        "0.3.6-rc.1",
        candidateSource,
        "--dry-run",
        rcOutput,
      ],
      { env, stdout: "pipe", stderr: "pipe" },
    );
    expect(rcDryRun.exitCode).toBe(0);
    expect(
      readFileSync(join(rcOutput, ".github/workflows/herdr-world.yml"), "utf8"),
    ).toContain("HERDR_WORLD_PACKAGE: herdr-world-rc");
    expect(git(["--git-dir", remote, "show-ref"])).toBe(beforeRefs);
    const handoff = (fail = false) =>
      Bun.spawnSync(
        [
          "bash",
          join(import.meta.dir, "open-homebrew-pr.sh"),
          "0.3.5",
          join(prepared, "Formula/herdr-world.rb"),
          "--prepared",
          prepared,
        ],
        {
          env: { ...env, SYNC_FAIL_PR: fail ? "true" : "false" },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
    expect(handoff(true).exitCode).toBe(1);
    const pushedHead = git([
      "--git-dir",
      remote,
      "rev-parse",
      "release/herdr-world-v0.3.5",
    ]);
    const first = handoff();
    expect(first.exitCode).toBe(0);
    expect(readFileSync(env.SYNC_PR_BODY, "utf8")).toBe(
      readFileSync(join(prepared, "pr-body.md"), "utf8"),
    );
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
    expect(originalHead).toBe(pushedHead);
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
    // Git attributes must not normalize verified bytes into different public blobs.
    git(["checkout", "main"], seed);
    writeFileSync(join(seed, ".gitattributes"), "*.rb text\n");
    git(["add", ".gitattributes"], seed);
    git(["commit", "-m", "Fixture normalization policy"], seed);
    git(["push", "origin", "main"], seed);
    writeFileSync(
      source,
      formula.replaceAll("0.3.5", "0.3.7").replaceAll("\n", "\r\n"),
    );
    const normalizedInput = join(root, "normalized");
    const normalizeDry = Bun.spawnSync(
      [
        "bash",
        join(import.meta.dir, "open-homebrew-pr.sh"),
        "0.3.7",
        source,
        "--dry-run",
        normalizedInput,
      ],
      { env, stdout: "pipe", stderr: "pipe" },
    );
    expect(normalizeDry.exitCode).toBe(0);
    const normalizePublish = Bun.spawnSync(
      [
        "bash",
        join(import.meta.dir, "open-homebrew-pr.sh"),
        "0.3.7",
        join(normalizedInput, "Formula/herdr-world.rb"),
        "--prepared",
        normalizedInput,
      ],
      { env, stdout: "pipe", stderr: "pipe" },
    );
    expect(normalizePublish.exitCode).toBe(1);
    expect(normalizePublish.stderr.toString()).toContain(
      "committed tap files differ from verified input",
    );
    expect(
      git([
        "--git-dir",
        remote,
        "for-each-ref",
        "--format=%(refname)",
        "refs/heads/release/herdr-world-v0.3.7",
      ]),
    ).toBe("");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
