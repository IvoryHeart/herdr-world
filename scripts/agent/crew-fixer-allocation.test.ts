import { afterEach, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allocateFixerWorktree } from "./crew/fixer-allocation";
import { openCrewStore } from "./crew/store";

const fixtures: { path: string; close: () => void }[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) {
    f.close();
    rmSync(f.path, { recursive: true, force: true });
  }
});
function fixture() {
  const path = mkdtempSync(join(tmpdir(), "crew-allocation-"));
  const primary = join(path, "repo");
  mkdirSync(primary);
  const run = (argv: string[]) => {
    const x = Bun.spawnSync(argv, {
      cwd: primary,
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      code: x.exitCode,
      stdout: x.stdout.toString(),
      stderr: x.stderr.toString(),
    };
  };
  const git = (...argv: string[]) => {
    const x = run(["git", ...argv]);
    if (x.code) throw new Error(x.stderr);
    return x.stdout.trim();
  };
  git("init", "-b", "main");
  git("config", "user.name", "Example Author");
  git("config", "user.email", "author@example.invalid");
  mkdirSync(join(primary, "scripts/agent"), { recursive: true });
  writeFileSync(
    join(primary, "scripts/agent/worktree.mjs"),
    readFileSync(join(import.meta.dir, "worktree.mjs")),
  );
  writeFileSync(join(primary, "feature.txt"), "original");
  git("add", ".");
  git("commit", "-m", "Original feature");
  const head = git("rev-parse", "HEAD");
  git("branch", "agent/feature");
  git("init", "--bare", join(path, "origin.git"));
  git("remote", "add", "origin", join(path, "origin.git"));
  git("push", "origin", "HEAD:refs/heads/agent/feature");
  const db = openCrewStore(":memory:");
  fixtures.push({ path, close: () => db.close() });
  const allocate = () =>
    allocateFixerWorktree(db, run, primary, 7, "agent/feature", head);
  return { path, primary, run, git, head, allocate };
}

test("free branch gets a normal crew-owned helper at the exact remote head, preserving the original branch", () => {
  const f = fixture();
  const a = f.allocate();
  expect(a).toHaveProperty("path");
  if (!("path" in a)) throw new Error(a.why);
  expect(f.git("-C", a.path, "rev-parse", "HEAD")).toBe(f.head);
  expect(f.git("-C", a.path, "branch", "--show-current")).toBe(
    `agent/crew-fix-7-${f.head.slice(0, 12)}`,
  );
  expect(f.git("rev-parse", "agent/feature")).toBe(f.head);
  expect(f.allocate()).toEqual(a);
});

for (const dirty of [false, true])
  test(`occupied ${dirty ? "dirty" : "clean stale"} owner tree is preserved and requires its owner handoff`, () => {
    const f = fixture();
    const other = join(f.path, "other");
    f.git("worktree", "add", other, "agent/feature");
    writeFileSync(join(other, "feature.txt"), "owner work");
    if (!dirty) {
      f.git("-C", other, "add", ".");
      f.git("-C", other, "commit", "-m", "Unpublished owner work");
    }
    const before = f.git("rev-parse", "agent/feature");
    const status = f.git("-C", other, "status", "--porcelain");
    expect(f.allocate()).toHaveProperty("why");
    expect(f.git("rev-parse", "agent/feature")).toBe(before);
    expect(f.git("-C", other, "status", "--porcelain")).toBe(status);
    expect(readFileSync(join(other, "feature.txt"), "utf8")).toBe("owner work");
  });

test("remote movement aborts allocation without starting from an outdated observation", () => {
  const f = fixture();
  writeFileSync(join(f.primary, "feature.txt"), "new remote work");
  f.git("add", ".");
  f.git("commit", "-m", "Remote moved");
  f.git("push", "origin", "HEAD:refs/heads/agent/feature");
  expect(f.allocate()).toEqual({
    why: "remote PR head changed before allocation",
  });
  expect(
    f.git("worktree", "list", "--porcelain").split("worktree ").length,
  ).toBe(2);
});

test("dirty owned helper is held without reset or replacement", () => {
  const f = fixture();
  const a = f.allocate();
  if (!("path" in a)) throw new Error(a.why);
  writeFileSync(join(a.path, "feature.txt"), "unfinished fixer work");
  expect(f.allocate()).toEqual({
    why: "crew helper is dirty or at a different head; preserved without reset",
  });
  expect(readFileSync(join(a.path, "feature.txt"), "utf8")).toBe(
    "unfinished fixer work",
  );
});
