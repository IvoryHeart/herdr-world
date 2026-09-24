import { describe, expect, test } from "bun:test";
import {
  agentChangeCandidates,
  resolveAgentChangeContext,
} from "./change-context";

describe("agent change context candidates", () => {
  test("prefers explicit checkout metadata before agent working directories", () => {
    expect(
      agentChangeCandidates({
        checkout_path: "/repo/worktree",
        foreground_cwd: "/repo/worktree/src",
        cwd: "/repo",
      }),
    ).toEqual([
      { source: "reported-checkout", path: "/repo/worktree" },
      { source: "foreground-cwd", path: "/repo/worktree/src" },
      { source: "cwd", path: "/repo" },
    ]);
  });

  test("does not invent a workspace candidate when the agent reports no path", () => {
    expect(
      agentChangeCandidates({ workspace_id: "workspace-from-herdr" }),
    ).toEqual([]);
  });

  test("deduplicates equivalent agent paths while preserving precedence", () => {
    expect(
      agentChangeCandidates({
        worktree: { checkout_path: "/repo/worktree" },
        checkout_path: "/repo/worktree",
        foreground_cwd: "/repo/worktree",
      }),
    ).toEqual([{ source: "reported-checkout", path: "/repo/worktree" }]);
  });

  test("uses the first reported path that resolves to Git", async () => {
    const commands: string[][] = [];
    const context = await resolveAgentChangeContext({
      paneId: "pane-1",
      agentInfo: {
        agent: "codex",
        display_agent: "Codex",
        workspace_id: "workspace-1",
        checkout_path: "/gone",
        foreground_cwd: "/repo/worktree/src",
      },
      shQuote: (value) => `'${value}'`,
      runProcessWithCodeTimeout: async (argv) => {
        commands.push(argv);
        if (argv.includes("/gone")) {
          return { code: 128, stdout: "", stderr: "missing" };
        }
        if (argv.includes("rev-parse")) {
          return { code: 0, stdout: "/repo/worktree\n", stderr: "" };
        }
        return { code: 0, stdout: "agent-feature\n", stderr: "" };
      },
    });

    expect(context).toMatchObject({
      status: "resolved",
      source: "foreground-cwd",
      checkout_path: "/repo/worktree/src",
      root: "/repo/worktree",
      branch: "agent-feature",
    });
    expect(commands).toHaveLength(3);
  });

  test("returns an explicit unavailable state instead of a workspace fallback", async () => {
    const context = await resolveAgentChangeContext({
      paneId: "pane-2",
      agentInfo: { agent: "claude", workspace_id: "workspace-2" },
      shQuote: (value) => value,
      runProcessWithCodeTimeout: async () => ({
        code: 0,
        stdout: "",
        stderr: "",
      }),
    });

    expect(context.status).toBe("unavailable");
    expect(context.source).toBe("unresolved");
    expect(context.checkout_path).toBe("");
    expect(context.detail).toContain("did not report");
  });
});
