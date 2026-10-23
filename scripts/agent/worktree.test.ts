import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Action = { path: string; action: string; reason: string };
const modulePath: string = "./worktree.mjs";
const { pruneWorktrees } = (await import(modulePath)) as {
  pruneWorktrees: (options: {
    cwd: string;
    dryRun?: boolean;
    live: Set<string>;
    now?: number;
  }) => Action[];
};

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/** An origin, a primary clone and agent worktrees in every state. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "worktree-prune-"));
  roots.push(root);
  const run = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const origin = join(root, "origin.git");
  const primary = join(root, "primary");
  run(root, "init", "-q", "--bare", "-b", "main", origin);
  run(root, "clone", "-q", origin, primary);
  run(primary, "config", "user.email", "example@example.invalid");
  run(primary, "config", "user.name", "Example");
  writeFileSync(join(primary, "README.md"), "base\n");
  run(primary, "add", "-A");
  run(primary, "commit", "-qm", "base");
  run(primary, "push", "-q", "origin", "HEAD:main");
  run(primary, "fetch", "-q");
  const worktrees = join(primary, ".agents/worktrees");
  mkdirSync(worktrees, { recursive: true });
  const add = (name: string, ...extra: string[]) => {
    const path = join(worktrees, name);
    run(primary, "worktree", "add", "-q", ...extra, path, "origin/main");
    return path;
  };
  const commit = (path: string, file: string) => {
    writeFileSync(join(path, file), `${file}\n`);
    run(path, "add", "-A");
    run(path, "commit", "-qm", file);
  };
  const merged = add("merged", "-b", "agent/merged");
  commit(merged, "merged.ts");
  const dirty = add("dirty", "-b", "agent/dirty");
  commit(dirty, "dirty.ts");
  const live = add("live", "-b", "agent/live");
  commit(live, "live.ts");
  mkdirSync(join(live, "node_modules/example"), { recursive: true });
  mkdirSync(join(live, "server/public"), { recursive: true });
  // Merge all three into main, as their PRs would be.
  for (const branch of ["agent/merged", "agent/dirty", "agent/live"])
    run(primary, "merge", "-q", "--no-edit", branch);
  run(primary, "push", "-q", "origin", "HEAD:main");
  run(primary, "fetch", "-q");
  writeFileSync(join(dirty, "notes.txt"), "uncommitted\n");
  const unmerged = add("unmerged", "-b", "agent/unmerged");
  commit(unmerged, "unmerged.ts");
  const fresh = add("fresh", "-b", "agent/fresh"); // prepared, no work yet
  const review = add("review", "--detach");
  return { run, primary, merged, dirty, live, unmerged, fresh, review };
}

test("prune removes merged clean worktrees and spares everything else", () => {
  const repo = fixture();
  const decide = (options: { dryRun?: boolean; now?: number }) =>
    Object.fromEntries(
      pruneWorktrees({
        cwd: repo.primary,
        live: new Set([join(repo.live, "web")]),
        ...options,
      }).map(({ path, action, reason }) => [
        path.split("/").at(-1),
        `${action}: ${reason}`,
      ]),
    );
  const planned = decide({ dryRun: true });
  expect(planned).toEqual({
    merged: "remove: merged into origin/main",
    dirty: "keep: uncommitted changes",
    live: "strip: merged into origin/main; a process works in it",
    unmerged: "keep: has commits not in origin/main",
    fresh: "keep: no commits of its own yet",
    review: "keep: detached checkout used recently",
  });
  // A dry run changes nothing.
  expect(existsSync(repo.merged)).toBe(true);
  expect(existsSync(join(repo.live, "node_modules"))).toBe(true);

  // Later, the idle review checkout of a merged commit goes too.
  const later = decide({ now: Date.now() + 13 * 60 * 60 * 1000 });
  expect(later.review).toBe("remove: detached at a commit in origin/main");
  expect(existsSync(repo.merged)).toBe(false);
  expect(existsSync(repo.review)).toBe(false);
  expect(repo.run(repo.primary, "branch", "--list", "agent/merged")).toBe("");
  // The live worktree keeps its checkout and loses only build output.
  expect(existsSync(join(repo.live, "live.ts"))).toBe(true);
  expect(existsSync(join(repo.live, "node_modules"))).toBe(false);
  expect(existsSync(join(repo.live, "server/public"))).toBe(false);
  for (const kept of [repo.dirty, repo.unmerged, repo.fresh])
    expect(existsSync(kept)).toBe(true);
  expect(existsSync(join(repo.dirty, "notes.txt"))).toBe(true);
});

test("the current worktree is never pruned", () => {
  const repo = fixture();
  const actions = pruneWorktrees({
    cwd: repo.merged,
    dryRun: true,
    live: new Set(),
  });
  expect(actions.find((item) => item.path === repo.merged)).toMatchObject({
    action: "keep",
    reason: "current worktree",
  });
});
