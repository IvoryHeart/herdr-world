import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Action = { path: string; action: string; reason: string };
type Use = { cwds: string[]; uses: string[]; commands: string[] };
const modulePath: string = "./worktree.mjs";
const { pruneWorktrees, processUse } = (await import(modulePath)) as {
  processUse: () => Use;
  pruneWorktrees: (options: {
    cwd: string;
    dryRun?: boolean;
    live: Use;
    now?: number;
  }) => Action[];
};
const idle: Use = { cwds: [], uses: [], commands: [] };

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
  writeFileSync(
    join(primary, ".gitignore"),
    "node_modules/\n.agents/*\n.env*\n*.tsbuildinfo\nserver/public/\n",
  );
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
  // Prepared at the old main; later fast-forwarded without any work.
  const prepared = add("prepared", "-b", "agent/prepared");
  const merged = add("merged", "-b", "agent/merged");
  commit(merged, "merged.ts");
  const dirty = add("dirty", "-b", "agent/dirty");
  commit(dirty, "dirty.ts");
  const live = add("live", "-b", "agent/live");
  commit(live, "live.ts");
  mkdirSync(join(live, "node_modules/example"), { recursive: true });
  mkdirSync(join(live, "server/public"), { recursive: true });
  // Merged and clean, but in use or holding ignored work.
  const served = add("served", "-b", "agent/served");
  commit(served, "served.ts");
  const evidence = add("evidence", "-b", "agent/evidence");
  commit(evidence, "evidence.ts");
  mkdirSync(join(evidence, ".agents/evidence"), { recursive: true });
  writeFileSync(join(evidence, ".agents/evidence/shot.txt"), "evidence\n");
  writeFileSync(join(evidence, ".env.local"), "EXAMPLE=1\n");
  const built = add("built", "-b", "agent/built");
  commit(built, "built.ts");
  mkdirSync(join(built, "node_modules/example"), { recursive: true });
  mkdirSync(join(built, ".agents/delivery"), { recursive: true });
  writeFileSync(join(built, ".agents/delivery/gate.log"), "log\n");
  writeFileSync(join(built, "web.tsbuildinfo"), "{}\n");
  const locked = add("locked", "-b", "agent/locked");
  commit(locked, "locked.ts");
  // Merge them into main, as their PRs would be.
  for (const branch of [
    "agent/merged",
    "agent/dirty",
    "agent/live",
    "agent/served",
    "agent/evidence",
    "agent/built",
    "agent/locked",
  ])
    run(primary, "merge", "-q", "--no-edit", branch);
  run(primary, "push", "-q", "origin", "HEAD:main");
  run(primary, "fetch", "-q");
  run(prepared, "merge", "-q", "--ff-only", "origin/main");
  run(primary, "worktree", "lock", "--reason", "serves a preview", locked);
  writeFileSync(join(dirty, "notes.txt"), "uncommitted\n");
  const unmerged = add("unmerged", "-b", "agent/unmerged");
  commit(unmerged, "unmerged.ts");
  const fresh = add("fresh", "-b", "agent/fresh"); // prepared, no work yet
  const review = add("review", "--detach");
  return {
    root,
    run,
    primary,
    prepared,
    merged,
    dirty,
    live,
    served,
    evidence,
    built,
    locked,
    unmerged,
    fresh,
    review,
  };
}

test("prune removes merged clean worktrees and spares everything else", () => {
  const repo = fixture();
  const decide = (options: { dryRun?: boolean; now?: number }) =>
    Object.fromEntries(
      pruneWorktrees({
        cwd: repo.primary,
        live: {
          // An idle shell sits in one; a server outside names another.
          cwds: [join(repo.live, "web")],
          uses: [],
          commands: [
            `python3 -m http.server --directory ${repo.served}/.pages-dist`,
          ],
        },
        ...options,
      }).map(({ path, action, reason }) => [
        path.split("/").at(-1),
        `${action}: ${reason}`,
      ]),
    );
  const planned = decide({ dryRun: true });
  expect(planned).toEqual({
    prepared: "keep: no commits of its own yet",
    merged: "remove: merged into origin/main",
    dirty: "keep: uncommitted changes",
    live: "strip: merged into origin/main; a process works in it",
    served: "keep: merged into origin/main; a running process uses it",
    evidence:
      "keep: ignored files that are not build output: .agents/evidence, .env.local",
    built: "remove: merged into origin/main",
    locked: "keep: locked",
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
  expect(existsSync(repo.built)).toBe(false);
  for (const kept of [
    repo.dirty,
    repo.unmerged,
    repo.fresh,
    repo.prepared,
    repo.served,
    repo.locked,
  ])
    expect(existsSync(kept)).toBe(true);
  expect(existsSync(join(repo.evidence, ".agents/evidence/shot.txt"))).toBe(
    true,
  );
  expect(existsSync(join(repo.evidence, ".env.local"))).toBe(true);
  expect(existsSync(join(repo.dirty, "notes.txt"))).toBe(true);
});

test("the current worktree is never pruned", () => {
  const repo = fixture();
  const actions = pruneWorktrees({
    cwd: repo.merged,
    dryRun: true,
    live: idle,
  });
  expect(actions.find((item) => item.path === repo.merged)).toMatchObject({
    action: "keep",
    reason: "current worktree",
  });
});

test("an executable or open file inside a worktree keeps it", () => {
  const repo = fixture();
  const decide = (live: Use) =>
    pruneWorktrees({ cwd: repo.primary, dryRun: true, live }).find(
      (item) => item.path === repo.merged,
    );
  for (const live of [
    { ...idle, uses: [join(repo.merged, "server/herdr-world")] },
    { ...idle, uses: [join(repo.merged, "web/dist/index.html")] },
    // No process listing at all: assume everything is in use.
    { ...idle, uses: ["/"] },
  ])
    expect(decide(live)).toMatchObject({
      action: "keep",
      reason: "merged into origin/main; a running process uses it",
    });
});

test("paths are compared after resolving symlinks", () => {
  const repo = fixture();
  const link = join(repo.root, "link");
  symlinkSync(repo.primary, link);
  const viaLink = join(link, ".agents/worktrees/linked");
  repo.run(
    repo.primary,
    "worktree",
    "add",
    "-q",
    "-b",
    "agent/linked",
    viaLink,
    "origin/main",
  );
  writeFileSync(join(viaLink, "linked.ts"), "linked\n");
  repo.run(viaLink, "add", "-A");
  repo.run(viaLink, "commit", "-qm", "linked");
  repo.run(repo.primary, "merge", "-q", "--no-edit", "agent/linked");
  repo.run(repo.primary, "push", "-q", "origin", "HEAD:main");
  repo.run(repo.primary, "fetch", "-q");
  // /proc reports the resolved path of a shell sitting in it.
  const actions = pruneWorktrees({
    cwd: repo.primary,
    dryRun: true,
    live: { ...idle, cwds: [realpathSync(viaLink)] },
  });
  expect(actions.find((item) => item.path.endsWith("/linked"))).toMatchObject({
    action: "strip",
  });
});

test.skipIf(process.platform !== "linux")(
  "only a shell's working directory counts as idle presence",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "worktree-use-"));
    roots.push(root);
    const shellDir = join(root, "shell");
    const serverDir = join(root, "server");
    mkdirSync(shellDir);
    mkdirSync(serverDir);
    // An idle shell waiting for input, and a non-shell process (a server, say).
    const shell = Bun.spawn(["sh"], { cwd: shellDir, stdin: "pipe" });
    const server = Bun.spawn(["sleep", "30"], { cwd: serverDir });
    try {
      await Bun.sleep(200);
      const use = processUse();
      const real = (path: string) => realpathSync(path);
      expect(use.cwds).toContain(real(shellDir));
      expect(use.uses).not.toContain(real(shellDir));
      expect(use.uses).toContain(real(serverDir));
      expect(use.cwds).not.toContain(real(serverDir));
    } finally {
      shell.kill();
      server.kill();
      await Promise.all([shell.exited, server.exited]);
    }
  },
);
