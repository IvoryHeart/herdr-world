import { describe, expect, test } from "bun:test";
import { shQuote } from "../utils/process-utils";
import { syncWorktreeBase, WORKTREE_BASE_REF } from "./create";

describe("worktree creation preparation", () => {
  test("refreshes origin/main and returns the explicit Herdr base", async () => {
    const calls: string[][] = [];
    const result = await syncWorktreeBase({
      workspaceId: "w1",
      resolveGitRoot: async () => ({ root: "/repo with spaces" }),
      shQuote,
      runProcessWithCodeTimeout: async (argv) => {
        calls.push(argv);
        if (calls.length === 1) {
          return { code: 0, stdout: "", stderr: "fetched\n" };
        }
        return { code: 0, stdout: "abc123\n", stderr: "" };
      },
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual([
      "sh",
      "-lc",
      "GIT_TERMINAL_PROMPT=0 git -C '/repo with spaces' fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main",
    ]);
    expect(result).toMatchObject({
      workspace_id: "w1",
      root: "/repo with spaces",
      base: WORKTREE_BASE_REF,
      commit: "abc123",
      command: "git fetch origin main",
      stderr: "fetched",
    });
  });

  test("does not create from a stale base when fetch fails", async () => {
    await expect(
      syncWorktreeBase({
        workspaceId: "w1",
        resolveGitRoot: async () => ({ root: "/repo" }),
        host: "dev@example.test",
        shQuote,
        runProcessWithCodeTimeout: async () => ({
          code: 128,
          stdout: "",
          stderr: "remote main is unavailable",
        }),
      }),
    ).rejects.toThrow(
      "Unable to update origin/main before creating the worktree: remote main is unavailable",
    );
  });
});
