import { closeSync, openSync } from "node:fs";
import { runProcess, type Run } from "../gate/observe";
import type { StoredRun } from "./store";
import { readUsage } from "./worker";

/**
 * The crew's side effects on Herdr and processes, behind one seam so passes
 * can be tested without either.
 */

/** Where a reviewer run is shown: a pane in its round's Herdr tab. */
export type Place = {
  /** The round's tab once it has one, and its newest pane to split. */
  tab: string | null;
  after: string | null;
  direction: "right" | "down";
  /** The tab's label, should a new one open, and the pane's own name. */
  label: string;
  title: string;
};

export type Deps = {
  run: Run;
  /**
   * Starts a reviewer run in a pane of its round's Herdr tab, so the owner
   * can watch it, or else as a detached process group. A pane run reports
   * its pid itself.
   */
  spawn: (
    argv: string[],
    log: string,
    place: Place,
  ) => { pid: number | null; pane: string | null; tab: string | null };
  /** True once the tab is gone, including one the owner already closed. */
  closeTab: (tab: string) => boolean;
  /** Runs a shell line in a new, focused Herdr tab; its id, or null if it can't. */
  openTab: (line: string, cwd: string, label: string) => string | null;
  /** A run's token usage so far, read from its harness's session files. */
  usage: (run: StoredRun, cwd: string) => string | null;
  alive: (pid: number) => boolean;
  /** Stops a run's whole process group. */
  kill: (pid: number) => void;
  out: (text: string) => void;
};

export const realDeps: Deps = {
  run: runProcess,
  spawn(argv, log, place) {
    // Join the round's tab beside its newest pane; a new round, or a tab
    // the owner has closed, gets a new tab.
    let { tab } = place;
    let pane: string | null = null;
    if (place.after) {
      const split = runProcess([
        "herdr",
        "pane",
        "split",
        place.after,
        "--direction",
        place.direction,
        "--cwd",
        process.cwd(),
        "--no-focus",
      ]);
      pane = split.code === 0 ? herdrIds(split.stdout).pane : null;
    }
    if (!pane) {
      const created = newTab(process.cwd(), place.label, false);
      ({ pane, tab } = created);
    }
    if (pane) {
      runProcess(["herdr", "pane", "rename", pane, place.title]);
      const ran = runProcess(["herdr", "pane", "run", pane, shellLine(argv)]);
      if (ran.code === 0) return { pid: null, pane, tab };
      runProcess(["herdr", "pane", "close", pane]);
    }
    // The worker appends its own lines to the log; errors join them, appended.
    const errors = openSync(log, "a");
    const child = Bun.spawn(argv, {
      stdio: ["ignore", "ignore", errors],
      detached: true,
    } as Parameters<typeof Bun.spawn>[1]);
    closeSync(errors);
    child.unref();
    return { pid: child.pid, pane: null, tab };
  },
  closeTab(tab) {
    return tabClosed(runProcess(["herdr", "tab", "close", tab]));
  },
  openTab(line, cwd, label) {
    const { pane, tab } = newTab(cwd, label, true);
    return pane !== null &&
      runProcess(["herdr", "pane", "run", pane, line]).code === 0
      ? tab
      : null;
  },
  usage: (run, cwd) =>
    readUsage({ harness: run.harness, session: run.session, cwd }),
  alive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  kill(pid) {
    for (const target of [-pid, pid])
      try {
        process.kill(target, "SIGTERM");
        return;
      } catch {
        // Not a group leader, or already gone.
      }
  },
  out: (text) => console.log(text),
};

/**
 * Whether `herdr tab close` left the tab gone: it closed it, or Herdr
 * reports (on stderr) that there is no such tab, as after the owner closed it.
 */
export function tabClosed(result: ReturnType<Run>) {
  if (result.code === 0) return true;
  for (const stream of [result.stderr, result.stdout])
    try {
      const value = JSON.parse(stream) as { error?: { code?: unknown } };
      if (value.error?.code === "tab_not_found") return true;
    } catch {
      // Not Herdr's JSON error.
    }
  return false;
}

function newTab(cwd: string, label: string, focus: boolean) {
  const created = runProcess([
    "herdr",
    "tab",
    "create",
    ...(process.env.HERDR_WORKSPACE_ID
      ? ["--workspace", process.env.HERDR_WORKSPACE_ID]
      : []),
    "--cwd",
    cwd,
    "--label",
    label,
    ...(focus ? [] : ["--no-focus"]),
  ]);
  return created.code === 0
    ? herdrIds(created.stdout)
    : { pane: null, tab: null };
}

/**
 * The new pane and its tab: `herdr tab create` returns `root_pane` and
 * `tab`, `herdr pane split` returns `pane`.
 */
export function herdrIds(stdout: string): {
  pane: string | null;
  tab: string | null;
} {
  try {
    const result =
      (
        JSON.parse(stdout) as {
          result?: Record<string, { pane_id?: unknown; tab_id?: unknown }>;
        }
      ).result ?? {};
    const pane = (result.root_pane ?? result.pane)?.pane_id;
    const tab = result.tab?.tab_id ?? result.pane?.tab_id;
    return {
      pane: typeof pane === "string" ? pane : null,
      tab: typeof tab === "string" ? tab : null,
    };
  } catch {
    return { pane: null, tab: null };
  }
}

/** A command line a POSIX shell runs as exactly these arguments. */
export function shellLine(argv: string[]) {
  return argv
    .map((arg) =>
      /^[\w@%+=:,./-]+$/u.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`,
    )
    .join(" ");
}
