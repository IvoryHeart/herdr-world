import { expect, test } from "bun:test";
import { cleanupAuthorWorktree, cleanupTerminalPrs } from "./cleanup";
import { openCrewStore } from "./store";
import type { GateInput } from "../gate/predicate";
import type { Deps } from "./deps";

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
      cleanupAuthor: (_repo, _pr, _branch, _out, options) =>
        options?.refreshMain?.("/repo"),
    },
  );
  expect(refreshes).toBe(1);
  crew.close();
});
