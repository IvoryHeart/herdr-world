/**
 * Recognize a push that only merges main into an already-pushed branch, so
 * the pre-push hook can run static checks instead of the test gate (CI stays
 * authoritative). It is deliberately conservative; any doubt means "no":
 *
 *   - the push adds exactly one commit to the remote branch tip, and that
 *     commit is a merge whose first parent is the tip and whose second parent
 *     is in main's history;
 *   - `git merge-tree` reproduces the merge without conflicts, except a
 *     CHANGELOG.md conflict resolved by taking main's CHANGELOG.md;
 *   - the merge commit's tree equals that clean merge, apart from changelog
 *     fragments (changes/<name>.md, not changes/README.md).
 *
 * So the pushed code is exactly what Git merged on its own: tests already
 * passed on both sides, and no hand-written conflict resolution changes code.
 */

export type MergePushResult = { ok: boolean; reason: string };

function git(cwd: string, args: string[]) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: result.exitCode ?? 1,
    stdout: result.stdout.toString().trim(),
  };
}

const FRAGMENT = /^changes\/(?!README\.md$)[^/]+\.md$/;

export function mainMergeOnly({
  cwd = process.cwd(),
  head = "HEAD",
  remote,
  main = "origin/main",
}: {
  cwd?: string;
  head?: string;
  remote: string;
  main?: string;
}): MergePushResult {
  const no = (reason: string) => ({ ok: false, reason });
  if (!remote || /^0+$/.test(remote)) return no("the branch is new");
  const parents = git(cwd, ["rev-list", "--parents", "-n", "1", head]);
  if (parents.code !== 0) return no("cannot read the pushed commit");
  const [commit, first, second, ...more] = parents.stdout.split(" ");
  if (!second || more.length) return no("the pushed commit is not a merge");
  const remoteSha = git(cwd, ["rev-parse", "--verify", `${remote}^{commit}`]);
  if (remoteSha.code !== 0 || first !== remoteSha.stdout)
    return no("the push adds more than one merge to the remote branch");
  if (git(cwd, ["merge-base", "--is-ancestor", second, main]).code !== 0)
    return no(`the merged commit is not in ${main}`);
  const merge = git(cwd, [
    "merge-tree",
    "--write-tree",
    "--name-only",
    "--no-messages",
    first,
    second,
  ]);
  if (merge.code !== 0 && merge.code !== 1)
    return no("git merge-tree could not reproduce the merge");
  const [tree, ...conflicts] = merge.stdout.split("\n").filter(Boolean);
  const blob = (ref: string) =>
    git(cwd, ["rev-parse", "--verify", "--quiet", ref]).stdout;
  for (const path of conflicts) {
    if (path !== "CHANGELOG.md")
      return no(`the merge resolved a conflict in ${path}`);
    if (blob(`${commit}:CHANGELOG.md`) !== blob(`${second}:CHANGELOG.md`))
      return no("CHANGELOG.md was not resolved to main's version");
  }
  const changed = git(cwd, [
    "diff",
    "--name-only",
    "--no-renames",
    tree,
    commit,
  ]);
  if (changed.code !== 0) return no("cannot compare with the clean merge");
  for (const path of changed.stdout.split("\n").filter(Boolean)) {
    if (FRAGMENT.test(path)) continue;
    if (path === "CHANGELOG.md" && conflicts.includes(path)) continue;
    return no(`the merge commit also changes ${path}`);
  }
  return {
    ok: true,
    reason: `only merges ${second.slice(0, 8)} from ${main}`,
  };
}

if (import.meta.main) {
  const result = mainMergeOnly({ remote: process.argv[2] ?? "" });
  console.info(`merge-push: ${result.reason}`);
  process.exitCode = result.ok ? 0 : 1;
}
