import { execFileSync } from "node:child_process";
import { readdirSync, readlinkSync, rmSync, statSync } from "node:fs";
import { mkdir, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

function git(args, cwd = process.cwd()) {
  return execFileSync("git", ["-c", "core.fsmonitor=false", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }).trimEnd();
}

function primaryCheckout(cwd = process.cwd()) {
  const first = git(["worktree", "list", "--porcelain"], cwd).split("\n")[0];
  if (!first.startsWith("worktree ")) {
    throw new Error("Cannot resolve primary checkout");
  }
  return first.slice("worktree ".length);
}

function validateSlug(value) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value ?? "")) {
    throw new Error(
      "Use a lowercase task slug (letters, digits, hyphens; max 64)",
    );
  }
}

async function createWorktree(name, ref, cwd = process.cwd()) {
  validateSlug(name);
  const primary = primaryCheckout(cwd);
  for (const part of [
    join(primary, ".agents"),
    join(primary, ".agents/worktrees"),
  ]) {
    try {
      if ((await lstat(part)).isSymbolicLink()) {
        throw new Error("Worktree parent cannot be a symbolic link");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await mkdir(part, { recursive: true });
  }
  const parent = ref || "origin/main";
  if (!ref) git(["fetch", "origin"], cwd);
  git(["rev-parse", "--verify", `${parent}^{commit}`], cwd);
  const destination = join(primary, ".agents/worktrees", name);
  git(
    [
      "worktree",
      "add",
      "--no-track",
      "-b",
      `agent/${name}`,
      destination,
      parent,
    ],
    cwd,
  );
  warnIfInstallCacheElsewhere(destination);
  return destination;
}

/**
 * `bun install` hardlinks packages from ~/.bun/install/cache, so a worktree's
 * node_modules costs almost no space, but only on the cache's filesystem.
 */
function warnIfInstallCacheElsewhere(destination) {
  const cache =
    process.env.BUN_INSTALL_CACHE_DIR ||
    join(process.env.BUN_INSTALL || join(homedir(), ".bun"), "install/cache");
  try {
    if (statSync(cache).dev !== statSync(destination).dev)
      console.warn(
        `Bun's install cache (${cache}) is on another filesystem, so this worktree's node_modules will be a full copy rather than hardlinks.`,
      );
  } catch {
    // No cache yet: the first install creates it.
  }
}

/** Build output a live agent's worktree can lose without losing work. */
export const BUILD_OUTPUTS = [
  "node_modules",
  "web/node_modules",
  "server/node_modules",
  "tools/quint/node_modules",
  "dist",
  "web/dist",
  "server/public",
  "server/herdr-world",
  ".agents/verification",
];

// A detached checkout (a review) is only pruned after it has been idle.
const DETACHED_IDLE_MS = 12 * 60 * 60 * 1000;

export function listWorktrees(cwd = process.cwd()) {
  const entries = [];
  let entry = null;
  for (const line of git(["worktree", "list", "--porcelain"], cwd).split(
    "\n",
  )) {
    if (line.startsWith("worktree ")) {
      entry = { path: line.slice(9), detached: false, locked: false };
      entries.push(entry);
    } else if (!entry) continue;
    else if (line.startsWith("HEAD ")) entry.head = line.slice(5);
    else if (line.startsWith("branch ")) entry.branch = line.slice(7);
    else if (line === "detached") entry.detached = true;
    else if (line.startsWith("locked")) entry.locked = true;
  }
  return entries;
}

/** Working directories of this user's processes (shells in agent panes included). */
export function liveWorkingDirectories() {
  const found = new Set();
  if (process.platform === "linux") {
    for (const pid of readdirSync("/proc")) {
      if (!/^\d+$/.test(pid)) continue;
      try {
        found.add(readlinkSync(`/proc/${pid}/cwd`));
      } catch {
        // Another user's process, or it exited.
      }
    }
    return found;
  }
  try {
    const listing = execFileSync("lsof", ["-a", "-d", "cwd", "-Fn"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const line of listing.split("\n"))
      if (line.startsWith("n")) found.add(line.slice(1));
  } catch {
    // Without lsof, treat every worktree as possibly in use.
    found.add(sep);
  }
  return found;
}

function inside(path, directory) {
  return path === directory || path.startsWith(directory + sep);
}

function isAncestor(commit, of, cwd) {
  try {
    git(["merge-base", "--is-ancestor", commit, of], cwd);
    return true;
  } catch {
    return false;
  }
}

/** Why a worktree's work is (not) already in origin/main. */
function mergedState(entry, now) {
  if (!isAncestor(entry.head, "origin/main", entry.path))
    return { merged: false, reason: "has commits not in origin/main" };
  if (entry.branch) {
    // The branch reflog's oldest entry is where it was created. A branch
    // still there has no work of its own yet (a worktree prepared for a
    // task), even though origin/main contains it.
    let created;
    try {
      created = git(["reflog", "show", "--format=%H", entry.branch], entry.path)
        .split("\n")
        .at(-1);
    } catch {
      return { merged: false, reason: "branch history unknown" };
    }
    if (!created || created === entry.head)
      return { merged: false, reason: "no commits of its own yet" };
    return { merged: true, reason: "merged into origin/main" };
  }
  const gitDir = resolve(
    entry.path,
    git(["rev-parse", "--git-dir"], entry.path),
  );
  const idle = now - statSync(join(gitDir, "HEAD")).mtimeMs;
  if (idle < DETACHED_IDLE_MS)
    return { merged: false, reason: "detached checkout used recently" };
  return { merged: true, reason: "detached at a commit in origin/main" };
}

/**
 * Remove agent worktrees whose work is merged into origin/main and that are
 * clean. A worktree a live process still works in (an agent's pane, say)
 * keeps its checkout and loses only build output. Unmerged, dirty, locked,
 * fresh and current worktrees are never touched.
 */
export function pruneWorktrees({
  cwd = process.cwd(),
  dryRun = false,
  live = liveWorkingDirectories(),
  now = Date.now(),
} = {}) {
  const primary = primaryCheckout(cwd);
  const root = join(primary, ".agents/worktrees") + sep;
  const here = resolve(cwd);
  const actions = [];
  for (const entry of listWorktrees(cwd)) {
    if (!entry.path.startsWith(root)) continue;
    const act = (action, reason) =>
      actions.push({ path: entry.path, action, reason });
    if (entry.locked) {
      act("keep", "locked");
      continue;
    }
    if (inside(here, entry.path)) {
      act("keep", "current worktree");
      continue;
    }
    const merged = mergedState(entry, now);
    if (!merged.merged) {
      act("keep", merged.reason);
      continue;
    }
    if (git(["status", "--porcelain"], entry.path)) {
      act("keep", "uncommitted changes");
      continue;
    }
    if ([...live].some((directory) => inside(directory, entry.path))) {
      act("strip", `${merged.reason}; a process works in it`);
      if (!dryRun)
        for (const output of BUILD_OUTPUTS)
          rmSync(join(entry.path, output), { recursive: true, force: true });
      continue;
    }
    act("remove", merged.reason);
    if (dryRun) continue;
    git(["worktree", "remove", entry.path], primary);
    if (entry.branch) {
      try {
        git(
          ["branch", "-d", entry.branch.replace(/^refs\/heads\//, "")],
          primary,
        );
      } catch {
        // Keep a branch Git does not consider merged.
      }
    }
  }
  return actions;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [action, name, ref] = process.argv.slice(2);
  try {
    if (action === "create") console.log(await createWorktree(name, ref));
    else if (action === "list") console.log(git(["worktree", "list"]));
    else if (action === "prune") {
      const dryRun = process.argv.slice(3).includes("--dry-run");
      for (const { path, action: done, reason } of pruneWorktrees({ dryRun }))
        console.log(
          `${dryRun && done !== "keep" ? `would ${done}` : done}\t${path}\t${reason}`,
        );
    } else
      throw new Error(
        "Usage: agent:worktree -- create <slug> [ref] | list | prune [--dry-run]",
      );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
