import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorktreeGit } from "../agent/worktree-git";
import { runProcessWithCodeTimeout, shQuote } from "../utils/process-utils";
import { createUsageProjects } from "./projects";

test("Git project evidence joins linked worktrees, keeps connections separate and exports no paths", async () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-projects-")),
    repo = join(dir, "repo"),
    linked = join(dir, "linked");
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
  };
  try {
    git("init", "-q", repo);
    git(
      "-C",
      repo,
      "-c",
      "user.name=Example",
      "-c",
      "user.email=example@example.test",
      "commit",
      "--allow-empty",
      "-qm",
      "synthetic",
    );
    git("-C", repo, "worktree", "add", "-q", "--detach", linked);
    const resolver = createUsageProjects({
      now: () => 1000,
      current: () => true,
      git: () =>
        createWorktreeGit({
          sshHost: () => undefined,
          shQuote,
          runProcessWithCodeTimeout,
        }),
    });
    const first = await resolver("a", 1, repo),
      second = await resolver("a", 1, linked),
      other = await resolver("b", 1, repo);
    expect(first?.id).toBe(second?.id);
    expect(first?.id).not.toBe(other?.id);
    expect(JSON.stringify([first, second, other])).not.toContain(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("retired project lookup cannot publish a replacement connection's evidence", async () => {
  let current = true;
  const resolver = createUsageProjects({
    now: () => 1000,
    current: () => current,
    git: () => ({
      inspect: async () => {
        current = false;
        return {
          canonicalRoot: "/synthetic/repo",
          gitCommonDir: "/synthetic/repo/.git",
          branch: null,
        };
      },
    }),
  });
  expect(await resolver("a", 1, "/synthetic/repo")).toBeNull();
});
