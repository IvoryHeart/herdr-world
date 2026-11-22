import type {
  ShipyardInstance,
  ShipyardPipeline,
  ShipyardPullRequest,
  ShipyardRelease,
  ShipyardWorkflow,
} from "../../../../shared/shipyard";
import type { ShipyardState } from "./shipyardStore";

/**
 * What Town's harbour and the Work lens's Releases tab show (#1028): one
 * read model of the Shipyard API's snapshot (docs/shipyard-api.md), so both
 * views say the same thing. It keeps the API's honesty rules:
 *
 * - Stale data is labelled old, and old health is never "passing".
 * - A waiting list that is shortened, diverged or unprovable never reads as
 *   "nothing waiting"; its count says so ("200+", "unknown").
 * - Running Worlds show whatever GitHub's state; only fresh ones open. A
 *   report past its lease, or any report kept from before a failed read,
 *   is not fresh: it shows as stopped reporting and loses its Open link.
 * - A failed read of World's own service makes everything shown old, even
 *   when the last snapshot said it was fresh.
 * - Waiting changes are the pull requests the commit graph proves; the API
 *   does not prove how other commits reached main, so none are called
 *   "direct".
 *
 * Pure: the views, the harbour art and the tests read it.
 */

/** Main's beacon: the latest checks on its head, or unknown when old. */
export type ShipyardBeacon = "pass" | "fail" | "pending" | "unknown";

export type ShipyardShip = {
  release: ShipyardRelease;
  /** The baseline: the release waiting changes are counted from. */
  baseline: boolean;
  /** Running Worlds whose version matches this release exactly. */
  running: ShipyardInstance[];
};

export type ShipyardCargo = {
  /** The changes in words: "4 waiting", "200+ waiting", "unknown". */
  count: string;
  /** Proven waiting pull requests, newest merge first. */
  pullRequests: ShipyardPullRequest[];
  /** Commits on main since the baseline, when the comparison is complete. */
  commits: number | null;
  /** What limits the list, in words; null when complete. */
  note: string | null;
  /** "since v1.4.0", or null without a baseline. */
  since: string | null;
  pullRequestsUrl: string;
  compareUrl: string | null;
};

export type ShipyardView =
  /** The service has not answered yet. */
  | { status: "loading" }
  /** The service could not be reached; running Worlds unknown too. */
  | { status: "unreachable"; detail: string }
  | {
      /** No repository chosen or suggested. */
      status: "no_repo";
      running: ShipyardInstance[];
      runningNote: string | null;
    }
  | {
      /** GitHub off, signed out or never read: how to connect. */
      status: "off" | "closed" | "reading";
      repo: string;
      detail: string;
      running: ShipyardInstance[];
      runningNote: string | null;
    }
  | {
      status: "open";
      repo: string;
      /** The last refresh failed: everything GitHub said is old. */
      stale: boolean;
      /** The read's age in words, from its last success. */
      detail: string;
      lastSuccessAt: number | null;
      refreshing: boolean;
      main: {
        beacon: ShipyardBeacon;
        words: string;
        sha: string;
        url: string;
        workflows: ShipyardWorkflow[];
        note: string | null;
      };
      cargo: ShipyardCargo;
      /** Releases, newest first. */
      ships: ShipyardShip[];
      shipsNote: string | null;
      running: ShipyardInstance[];
      runningNote: string | null;
    };

const BEACON_WORDS: Record<ShipyardBeacon, string> = {
  pass: "main passing",
  fail: "main failing",
  pending: "main checks running",
  unknown: "main checks unknown",
};

export const shipyardBeaconWords = (beacon: ShipyardBeacon) =>
  BEACON_WORDS[beacon];

/**
 * The Shipyard as the store last read it, at `now`. A store error means the
 * last read failed: whatever an earlier read said is kept but shown old.
 */
export function shipyardView(
  state: ShipyardState,
  now: number = Date.now(),
): ShipyardView {
  const { catalog, snapshot } = state;
  if (!catalog && !snapshot)
    return state.error
      ? { status: "unreachable", detail: state.error }
      : { status: "loading" };
  const failed = state.error !== null;
  const window = snapshot?.instances ?? catalog!.instances;
  const running = window.items.map((instance) =>
    instanceAt(instance, now, failed),
  );
  running.sort(
    (a, b) =>
      Number(b.state === "fresh") - Number(a.state === "fresh") ||
      b.reportedAt - a.reportedAt ||
      a.port - b.port,
  );
  const runningNote = failed
    ? "World did not answer; running Worlds are as last seen."
    : window.complete
      ? null
      : (window.detail ?? "Some running Worlds could not be read.");
  if (!state.repo) return { status: "no_repo", running, runningNote };
  if (!snapshot || snapshot.repo !== state.repo)
    return {
      status: "reading",
      repo: state.repo,
      detail: "Reading GitHub…",
      running,
      runningNote,
    };
  if (!snapshot.data)
    return {
      status: snapshot.state === "disabled" ? "off" : "closed",
      repo: snapshot.repo,
      detail: snapshot.refreshing ? "Reading GitHub…" : snapshot.detail,
      running,
      runningNote,
    };
  const stale = failed || snapshot.state === "stale";
  const data = snapshot.data;
  return {
    status: "open",
    repo: snapshot.repo,
    stale,
    detail: failed
      ? `World did not answer (${state.error}); showing the last read.`
      : snapshot.detail,
    lastSuccessAt: snapshot.lastSuccessAt,
    refreshing: !failed && snapshot.refreshing,
    main: mainOf(data, stale),
    cargo: cargoOf(data),
    ships: shipsOf(data, running),
    shipsNote: data.releases.complete
      ? null
      : (data.releases.detail ?? "Older releases are not shown."),
    running,
    runningNote,
  };
}

/**
 * A running World as it stands at `now`: past its lease, or kept from before
 * a failed read, it is no longer known to run, so it cannot be opened.
 */
function instanceAt(
  instance: ShipyardInstance,
  now: number,
  failed: boolean,
): ShipyardInstance {
  if (instance.state === "fresh" && !failed && instance.expiresAt > now)
    return instance;
  if (instance.state === "stale" && instance.openUrl === null) return instance;
  return { ...instance, state: "stale", openUrl: null };
}

function mainOf(data: ShipyardPipeline, stale: boolean) {
  const beacon: ShipyardBeacon = stale ? "unknown" : data.main.health;
  return {
    beacon,
    words: stale ? "main: last seen checks are old" : BEACON_WORDS[beacon],
    sha: data.main.sha,
    url: data.main.url,
    workflows: data.main.workflows.items,
    note: data.main.workflows.complete
      ? null
      : (data.main.workflows.detail ?? "Not every workflow was read."),
  };
}

function cargoOf(data: ShipyardPipeline): ShipyardCargo {
  const waiting = data.waiting;
  const prs = [...waiting.pullRequests].sort((a, b) => b.mergedAt - a.mergedAt);
  const since = waiting.baseline ? `since ${waiting.baseline.tag}` : null;
  const base = {
    pullRequests: prs,
    since,
    pullRequestsUrl: waiting.pullRequestsUrl,
    compareUrl: waiting.compareUrl,
  };
  switch (waiting.state) {
    case "ready": {
      const complete = waiting.complete;
      return {
        ...base,
        count: `${prs.length}${complete ? "" : "+"} waiting`,
        commits: complete ? waiting.commits.length : null,
        note: complete
          ? null
          : (waiting.detail ?? "The list may be missing some changes."),
      };
    }
    case "limited":
      return {
        ...base,
        count: `${prs.length}+ waiting`,
        commits: null,
        note:
          waiting.detail ??
          `Main is ${waiting.aheadBy ?? "many"} commits ahead; only part was read.`,
      };
    case "no_baseline":
      return {
        ...base,
        count: "no release yet",
        commits: null,
        note:
          waiting.detail ??
          "No published release to count from, so nothing is counted as waiting.",
      };
    case "diverged":
      return {
        ...base,
        count: "unknown",
        commits: null,
        note:
          waiting.detail ??
          "Main and the last release have diverged; waiting changes are unknown.",
      };
    case "unavailable":
      return {
        ...base,
        count: "unknown",
        commits: null,
        note:
          waiting.detail ?? "GitHub could not compare main with the release.",
      };
  }
}

function shipsOf(
  data: ShipyardPipeline,
  running: ShipyardInstance[],
): ShipyardShip[] {
  const baseline = data.waiting.baseline?.releaseId ?? null;
  return [...data.releases.items]
    .sort((a, b) => b.publishedAt - a.publishedAt || b.id - a.id)
    .map((release) => ({
      release,
      baseline: release.id === baseline,
      running: running.filter(
        (instance) =>
          instance.releaseId === release.id && instance.repo === data.repo,
      ),
    }));
}

/** "v1.4.0 · 4 waiting · main passing": the harbour sign, in one line. */
export function shipyardSignText(view: ShipyardView): string {
  switch (view.status) {
    case "loading":
      return "Opening…";
    case "unreachable":
      return "Closed · World did not answer";
    case "no_repo":
      return view.running.length
        ? `${runningCount(view.running)} · no open project on GitHub`
        : "No open project on GitHub";
    case "reading":
      return "Reading GitHub…";
    case "off":
      return "Closed · GitHub source is off";
    case "closed":
      return "Closed · connect GitHub in Integrations";
    case "open": {
      const latest = view.ships[0]?.release;
      const parts = [
        latest ? latest.tag : "no releases",
        view.cargo.count,
        view.main.words,
      ];
      return view.stale
        ? `Out of date · ${parts.join(" · ")}`
        : parts.join(" · ");
    }
  }
}

/** "2 running", "1 running, 1 stopped reporting". */
export function runningCount(running: readonly ShipyardInstance[]) {
  const fresh = running.filter((entry) => entry.state === "fresh").length;
  const stale = running.length - fresh;
  return stale
    ? `${fresh} running, ${stale} stopped reporting`
    : `${fresh} running`;
}

/** "Checks passed" etc., for one workflow run. */
export function workflowWords(run: ShipyardWorkflow): {
  tone: ShipyardBeacon;
  words: string;
} {
  if (run.status !== "completed") return { tone: "pending", words: "running" };
  switch (run.conclusion) {
    case "success":
      return { tone: "pass", words: "passed" };
    case "failure":
    case "timed_out":
    case "startup_failure":
      return { tone: "fail", words: "failed" };
    case "cancelled":
      return { tone: "unknown", words: "cancelled" };
    case "skipped":
    case "neutral":
      return { tone: "unknown", words: run.conclusion };
    default:
      return { tone: "unknown", words: run.conclusion ?? "unknown" };
  }
}

/** A running World in words: where it runs and what it is. */
export function instanceWords(instance: ShipyardInstance) {
  const what =
    instance.kind === "installed"
      ? "installed"
      : instance.branch
        ? `branch ${instance.branch}`
        : "source checkout";
  return {
    name: `v${instance.version.replace(/^v/u, "")} on port ${instance.port}`,
    what,
    state: instance.state === "fresh" ? "running" : "stopped reporting",
  };
}

const SHORT = 7;
export const shortSha = (sha: string) => sha.slice(0, SHORT);

/** "today", "yesterday", "6 days ago", "3 Jan": a release's date. */
export function shipyardDate(at: number, now: number) {
  const day = 86_400_000;
  const days = Math.floor((now - at) / day);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year:
      new Date(at).getFullYear() === new Date(now).getFullYear()
        ? undefined
        : "numeric",
  });
}

/** "just now", "4 min ago", "2 h ago": how old a read is. */
export function shipyardAge(at: number | null, now: number) {
  if (at === null) return "never";
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}
