import { afterEach, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mainMergeOnly } from "./merge-push";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * A repository with `main` and a pushed `feature` branch that both changed
 * since their common base. `pushed` is the remote branch tip.
 */
function fixture(options: { featureChangelog?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "merge-push-"));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const write = (path: string, text: string) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const commit = (message: string) => {
    git("add", "-A");
    git("commit", "-qm", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "example@example.invalid");
  git("config", "user.name", "Example");
  write("a.ts", "export const a = 1;\n");
  write("CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n");
  write("changes/README.md", "fragments\n");
  commit("base");
  git("switch", "-q", "-c", "feature");
  write("b.ts", "export const b = 1;\n");
  if (options.featureChangelog)
    write("CHANGELOG.md", "# Changelog\n\n## [Unreleased] - feature entry\n");
  const pushed = commit("feature");
  git("switch", "-q", "main");
  write("c.ts", "export const c = 1;\n");
  write(
    "CHANGELOG.md",
    "# Changelog\n\n## [Unreleased] - fragments live in changes/\n",
  );
  commit("main moved");
  git("switch", "-q", "feature");
  const check = (head = "HEAD", remote = pushed) =>
    mainMergeOnly({ cwd: root, head, remote, main: "main" });
  const merge = () =>
    spawnSync("git", ["merge", "--no-edit", "-q", "main"], { cwd: root });
  return { root, git, write, commit, check, merge, pushed };
}

test("a clean merge of main, optionally adding a fragment, is merge-only", () => {
  const repo = fixture();
  expect(repo.merge().status).toBe(0);
  expect(repo.check()).toMatchObject({ ok: true });
  expect(repo.check().reason).toMatch(/^only merges [0-9a-f]{8} from main$/);

  const amended = fixture();
  amended.merge();
  amended.write("changes/feature.md", "### Added\n\n- Feature entry.\n");
  amended.git("add", "-A");
  amended.git("commit", "-q", "--amend", "--no-edit");
  expect(amended.check()).toMatchObject({ ok: true });
});

test("a CHANGELOG conflict counts only when resolved to main's CHANGELOG", () => {
  const taken = fixture({ featureChangelog: true });
  expect(taken.merge().status).not.toBe(0);
  taken.git("checkout", "main", "--", "CHANGELOG.md");
  taken.write("changes/feature.md", "### Added\n\n- Feature entry.\n");
  taken.commit("merge main");
  expect(taken.check()).toMatchObject({ ok: true });

  const kept = fixture({ featureChangelog: true });
  kept.merge();
  kept.write("CHANGELOG.md", "# Changelog\n\n## [Unreleased] - both\n");
  kept.commit("merge main");
  expect(kept.check()).toEqual({
    ok: false,
    reason: "CHANGELOG.md was not resolved to main's version",
  });
});

test("any hand-made change beyond fragments needs the normal check", () => {
  const conflict = fixture();
  conflict.write("c.ts", "export const c = 2;\n");
  const pushed = conflict.commit("feature edits c");
  expect(conflict.merge().status).not.toBe(0);
  conflict.write("c.ts", "export const c = 3;\n");
  conflict.commit("merge main");
  expect(conflict.check("HEAD", pushed)).toEqual({
    ok: false,
    reason: "the merge resolved a conflict in c.ts",
  });

  const edited = fixture();
  edited.merge();
  edited.write("a.ts", "export const a = 2;\n");
  edited.write("changes/README.md", "edited\n");
  edited.git("add", "-A");
  edited.git("commit", "-q", "--amend", "--no-edit");
  expect(edited.check()).toEqual({
    ok: false,
    reason: "the merge commit also changes a.ts",
  });
});

test("only one merge of main on top of the pushed tip qualifies", () => {
  const repo = fixture();
  expect(repo.check()).toEqual({
    ok: false,
    reason: "the pushed commit is not a merge",
  });
  expect(repo.check("HEAD", "0".repeat(40))).toEqual({
    ok: false,
    reason: "the branch is new",
  });
  repo.write("d.ts", "export const d = 1;\n");
  repo.commit("unpushed work");
  repo.merge();
  expect(repo.check()).toEqual({
    ok: false,
    reason: "the push adds more than one merge to the remote branch",
  });

  const other = fixture();
  other.git("switch", "-q", "-c", "side", other.pushed);
  other.write("e.ts", "export const e = 1;\n");
  other.commit("side work");
  other.git("switch", "-q", "feature");
  other.git("merge", "--no-ff", "--no-edit", "-q", "side");
  expect(other.check()).toEqual({
    ok: false,
    reason: "the merged commit is not in main",
  });
});
