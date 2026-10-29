import { expect, test } from "bun:test";
import { cleanupAuthorWorktree } from "./cleanup";

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
