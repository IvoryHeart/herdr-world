import { describe, expect, test } from "bun:test";
import { shQuote } from "../utils/process-utils";
import { syncWorktreeBase } from "./create";

const defaultCommit = "a".repeat(40);

describe("worktree creation preparation", () => {
  test("fetches the advertised default commit for Herdr worktree creation", async () => {
    const calls: string[][] = [];
    const result = await syncWorktreeBase({
      workspaceId: "w1",
      resolveGitRoot: async () => ({ root: "/repo with spaces" }),
      shQuote,
      runProcessWithCodeTimeout: async (argv) => {
        calls.push(argv);
        if (calls.length === 1)
          return {
            code: 0,
            stdout: `ref: refs/heads/trunk\tHEAD\n${defaultCommit}\tHEAD\n`,
            stderr: "",
          };
        if (calls.length === 2) return { code: 0, stdout: "", stderr: "" };
        if (calls.length === 3)
          return { code: 0, stdout: "", stderr: "fetched\n" };
        return { code: 0, stdout: `${defaultCommit}\n`, stderr: "" };
      },
    });

    expect(calls).toHaveLength(4);
    expect(calls[0]).toEqual([
      "sh",
      "-lc",
      "GIT_TERMINAL_PROMPT=0 git -C '/repo with spaces' ls-remote --symref origin HEAD",
    ]);
    expect(calls[2]?.at(-1)).toContain(
      `fetch --no-tags --no-write-fetch-head --refmap= origin '${defaultCommit}'`,
    );
    expect(result).toMatchObject({
      workspace_id: "w1",
      root: "/repo with spaces",
      base: "origin/trunk",
      commit: defaultCommit,
      command: `git fetch --no-tags --no-write-fetch-head --refmap= origin '${defaultCommit}'`,
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
        runProcessWithCodeTimeout: async (argv) =>
          argv.at(-1)?.includes("ls-remote")
            ? {
                code: 0,
                stdout: `ref: refs/heads/trunk\tHEAD\n${defaultCommit}\tHEAD\n`,
                stderr: "",
              }
            : argv.at(-1)?.includes("check-ref-format")
              ? { code: 0, stdout: "", stderr: "" }
              : {
                  code: 128,
                  stdout: "",
                  stderr: "remote trunk is unavailable",
                },
      }),
    ).rejects.toThrow(
      "Unable to update origin/trunk: remote trunk is unavailable",
    );
  });
});
