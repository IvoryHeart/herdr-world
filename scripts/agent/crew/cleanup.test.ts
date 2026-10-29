import { expect, test } from "bun:test";
import {
  cleanupAuthorWorktree,
  cleanupTerminalPrs,
  terminalInputs,
} from "./cleanup";
import { addRun, getMeta, openCrewStore } from "./store";
import type { GateInput } from "../gate/predicate";
import type { Deps } from "./deps";
import { config, input, NOW, SHA } from "../gate/cases";
import { openStore, recordPass } from "../gate/store";

test("cleanup prunes only the author's matching branch checkout", () => {
  const out: string[] = [];
  const paths: string[] = [];
  cleanupAuthorWorktree(
    "/repo",
    17,
    "agent/example",
    (line) => out.push(line),
    {
      worktrees: [
        {
          path: "/repo/.agents/worktrees/reviewer",
          branch: undefined,
          detached: true,
          locked: false,
        },
        {
          path: "/repo/.agents/worktrees/author",
          branch: "refs/heads/agent/example",
          detached: false,
          locked: false,
        },
      ],
      refreshMain: () => {},
      prune: (path) => {
        paths.push(path);
        return { path, action: "remove", reason: "merged into origin/main" };
      },
    },
  );
  expect(paths).toEqual(["/repo/.agents/worktrees/author"]);
  expect(out).toEqual([
    "#17 removed author worktree for agent/example: merged into origin/main",
  ]);
});

test("cleanup reports the prune reason and preserves an unsafe author checkout", () => {
  const out: string[] = [];
  cleanupAuthorWorktree("/repo", 18, "agent/dirty", (line) => out.push(line), {
    worktrees: [
      {
        path: "/repo/.agents/worktrees/dirty",
        branch: "refs/heads/agent/dirty",
        detached: false,
        locked: false,
      },
    ],
    refreshMain: () => {},
    prune: (path) => ({ path, action: "keep", reason: "uncommitted changes" }),
  });
  expect(out).toEqual([
    "#18 kept author worktree for agent/dirty: uncommitted changes",
  ]);
});

test("cleanup reports when only generated build output was stripped", () => {
  const out: string[] = [];
  cleanupAuthorWorktree("/repo", 19, "agent/live", (line) => out.push(line), {
    worktrees: [
      {
        path: "/repo/.agents/worktrees/live",
        branch: "refs/heads/agent/live",
        detached: false,
        locked: false,
      },
    ],
    refreshMain: () => {},
    prune: (path) => ({
      path,
      action: "strip",
      reason: "merged; a process works in it",
    }),
  });
  expect(out).toEqual([
    "#19 stripped build output from author worktree for agent/live: merged; a process works in it",
  ]);
});

test("terminal cleanup refreshes origin/main once for all author worktrees", () => {
  const crew = openCrewStore(":memory:");
  let refreshes = 0;
  const deps = {} as Deps;
  const terminal = new Map<number, GateInput>([
    [17, { number: 17, state: "CLOSED" } as GateInput],
    [18, { number: 18, state: "MERGED" } as GateInput],
  ]);
  cleanupTerminalPrs(
    crew,
    "/repo/.agents/crew",
    100,
    deps,
    terminal,
    () => {},
    {
      refreshMain: () => {
        refreshes++;
      },
      cleanupAuthor: (_repo, _pr, _branch, _out, options) => {
        options?.refreshMain?.("/repo");
        return true;
      },
    },
  );
  expect(refreshes).toBe(1);
  crew.close();
});

test("terminal observations retain the last known branch for author cleanup", () => {
  const crew = openCrewStore(":memory:");
  const gate = openStore(":memory:");
  addRun(
    crew,
    {
      actionKey: "manual-review",
      reviewer: "rev2",
      pr: 17,
      head: SHA.reviewed,
      log: "stdout",
    },
    NOW,
  );
  const open = {
    ...input({
      head: SHA.reviewed,
      posts: [],
      item: { branch: "agent/example" },
    }),
    number: 17,
  };
  recordPass(gate, {
    trigger: "open",
    config,
    startedAt: NOW,
    finishedAt: NOW,
    inputs: [open],
    verdicts: [],
  });
  const terminal = { ...open, state: "MERGED" as const, item: undefined };
  const selection = terminalInputs(crew, gate, [], [], [], () => ({
    inputs: [terminal],
    failures: new Map(),
  }));
  expect(selection.terminal.get(17)?.item?.branch).toBe("agent/example");
  expect(getMeta(crew, "terminal-branch:17")).toBe("agent/example");
  const retried = terminalInputs(crew, undefined, [], [], [], () => ({
    inputs: [terminal],
    failures: new Map(),
  }));
  expect(retried.terminal.get(17)?.item?.branch).toBe("agent/example");
  gate.close();
  crew.close();
});

test("failed main refresh leaves terminal cleanup pending for retry", () => {
  const crew = openCrewStore(":memory:");
  const pr = 17;
  addRun(
    crew,
    {
      actionKey: "manual-review",
      reviewer: "rev2",
      pr,
      head: SHA.reviewed,
      log: "stdout",
    },
    NOW,
  );
  const value = {
    ...input({
      head: SHA.reviewed,
      posts: [],
      item: { branch: "agent/example" },
    }),
    number: pr,
  };
  const deps = {
    closeTab: () => true,
    run: () => ({ code: 0, stdout: "", stderr: "" }),
    kill: () => {},
  } as unknown as Deps;
  cleanupTerminalPrs(
    crew,
    "/repo/.agents/crew",
    NOW,
    deps,
    new Map([[pr, value]]),
    () => {},
    {
      cleanupAuthor: (repo, number, branch, out, options) =>
        cleanupAuthorWorktree(repo, number, branch, out, {
          worktrees: [
            {
              path: "/repo/.agents/worktrees/author",
              branch: "refs/heads/agent/example",
              detached: false,
              locked: false,
            },
          ],
          refreshMain: options?.refreshMain,
          prune: () => {
            throw new Error("prune must wait for a successful refresh");
          },
        }),
      refreshMain: () => {
        throw new Error("network timeout");
      },
    },
  );
  expect(getMeta(crew, `terminal-cleanup:${pr}`)).toBe("pending");
  crew.close();
});
