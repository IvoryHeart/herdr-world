import type { Database } from "bun:sqlite";
import { join } from "node:path";
import type { Run } from "../gate/observe";
import { getMeta, setMeta } from "./store";

/** Allocate only crew-owned helpers; another seat must detach its own checkout. */
export function allocateFixerWorktree(
  db: Database,
  run: Run,
  primary: string,
  pr: number,
  branch: string | undefined,
  head: string,
): { path: string } | { why: string } {
  if (!branch || !/^[0-9a-f]{40}$/u.test(head))
    return { why: "missing PR branch or exact head" };
  const git = (...args: string[]) => run(["git", "-C", primary, ...args]);
  const list = git("worktree", "list", "--porcelain");
  if (list.code !== 0) return { why: "git cannot read worktree ownership" };
  const occupied = list.stdout
    .split("\n\n")
    .find((entry) => entry.split("\n").includes(`branch refs/heads/${branch}`));
  if (occupied)
    return {
      why: `owner clean-detach handoff required for ${branch}; existing checkout preserved`,
    };
  const key = `fixer-worktree:${pr}:${head}`;
  const slug = `crew-fix-${pr}-${head.slice(0, 12)}`;
  const path = join(primary, ".agents", "worktrees", slug);
  const known = getMeta(db, key);
  if (known && known !== path)
    return { why: "recorded fixer checkout identity differs" };
  {
    // A separate private ref makes concurrent fetches in other seats harmless.
    const ref = `refs/crew/fixer-${pr}-${head}`;
    const fetched = git(
      "fetch",
      "--no-tags",
      "--quiet",
      "origin",
      `refs/heads/${branch}:${ref}`,
    );
    if (fetched.code !== 0)
      return { why: "cannot fetch the exact PR branch; no fixer launched" };
    const current = git("rev-parse", ref);
    if (current.code !== 0 || current.stdout.trim() !== head)
      return { why: "remote PR head changed before allocation" };
  }
  if (!known) {
    const created = run([
      "bun",
      join(primary, "scripts/agent/worktree.mjs"),
      "create",
      slug,
      head,
    ]);
    if (created.code !== 0)
      return {
        why: "helper allocation failed; any existing tree and branch remain untouched",
      };
    setMeta(db, key, path);
  }
  const registry = git("worktree", "list", "--porcelain");
  if (
    registry.code !== 0 ||
    !registry.stdout
      .split("\n\n")
      .some(
        (entry) =>
          entry.split("\n").includes(`worktree ${path}`) &&
          entry.split("\n").includes(`branch refs/heads/agent/${slug}`),
      )
  )
    return { why: "crew helper registration or branch changed" };
  if (
    registry.stdout
      .split("\n\n")
      .some((entry) =>
        entry.split("\n").includes(`branch refs/heads/${branch}`),
      )
  )
    return { why: "another owner checked out the PR branch during allocation" };
  const status = run(["git", "-C", path, "status", "--porcelain"]);
  const at = run(["git", "-C", path, "rev-parse", "HEAD"]);
  if (
    status.code !== 0 ||
    status.stdout.trim() ||
    at.code !== 0 ||
    at.stdout.trim() !== head
  )
    return {
      why: "crew helper is dirty or at a different head; preserved without reset",
    };
  return { path };
}
