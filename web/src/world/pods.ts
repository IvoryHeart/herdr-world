import { readyToMerge } from "../../../shared/pullRequests";
import type {
  WorkItem,
  WorldSourcesSnapshot,
} from "../../../shared/worldSources";
import { linkMatchesPane, paneKey } from "./worldSources";

/**
 * Pods: a pull request's review rounds and its author, drawn as one group in
 * Town and Board. The crew watcher opens one tab per round, named
 * `#<N> <slug> · r<K>`, with a pane per reviewer, and closes them when the
 * pull request merges or closes. A pod is World's projection of those tab
 * names in one room, plus the tabs whose agents are linked to the pull
 * request (World sources) as its author. Herdr groups (#350) can replace the
 * projection later. Pure.
 */

export type PodTabInput = {
  /** The view's key for the tab: a Town desk or a Board tab card. */
  key: string;
  connectionId: string;
  /** Its workspace, qualified by connection. */
  roomKey: string;
  label: string;
  panes: readonly {
    paneId: string;
    generation: number;
    agentSessionFingerprint?: string;
  }[];
};

export type PodState = "reviewing" | "fixes" | "ready" | "merged";

export const POD_STATE_LABELS: Record<PodState, string> = {
  reviewing: "Reviewing",
  fixes: "Fixes requested",
  ready: "READY",
  merged: "Merged",
};

export type WorldPod = {
  key: string;
  connectionId: string;
  roomKey: string;
  number: number;
  /** The branch's short name from the tab label, when it has one. */
  slug: string | null;
  /** Round tabs, oldest first; the last is the current round. */
  rounds: { round: number; tabKey: string }[];
  /** Other tabs whose agents work on the pull request, in any room. */
  authorKeys: string[];
  /** The pull request, when World sources know it. */
  item: WorkItem | null;
  state: PodState | null;
};

const ROUND_LABEL = /^#(\d+)(?: (.+?))? · r(\d+)$/u;

/** A round tab's pull request, branch name and round, from its label. */
export function parseRoundLabel(
  label: string,
): { number: number; slug: string | null; round: number } | null {
  const match = ROUND_LABEL.exec(label.trim());
  if (!match) return null;
  return {
    number: Number(match[1]),
    slug: match[2] ?? null,
    round: Number(match[3]),
  };
}

/** The plaque's state, from the pull request card's own facts. */
export function podState(item: WorkItem, now = Date.now()): PodState {
  if (item.lane === "merged") return "merged";
  if (readyToMerge(item, now)) return "ready";
  if (item.review === "changes_requested" || item.lane === "fixing")
    return "fixes";
  return "reviewing";
}

export function worldPods(
  tabs: readonly PodTabInput[],
  sources: WorldSourcesSnapshot,
  now = Date.now(),
): WorldPod[] {
  const pods = new Map<string, WorldPod>();
  const roundTabs = new Set<string>();
  for (const tab of tabs) {
    const parsed = parseRoundLabel(tab.label);
    if (!parsed) continue;
    roundTabs.add(tab.key);
    const key = `${tab.roomKey}\u0000#${parsed.number}`;
    const pod = pods.get(key) ?? {
      key,
      connectionId: tab.connectionId,
      roomKey: tab.roomKey,
      number: parsed.number,
      slug: parsed.slug,
      rounds: [],
      authorKeys: [],
      item: null,
      state: null,
    };
    pod.slug ??= parsed.slug;
    pod.rounds.push({ round: parsed.round, tabKey: tab.key });
    pods.set(key, pod);
  }
  if (!pods.size) return [];

  // Each pane's linked pull requests, for the pod's item and its author.
  const items = new Map(sources.items.map((item) => [item.key, item]));
  const panes = new Map(
    tabs.flatMap((tab) =>
      tab.panes.map((pane) => [
        paneKey(tab.connectionId, pane.paneId),
        { tab, pane },
      ]),
    ),
  );
  const linked = new Map<string, Set<string>>();
  for (const link of sources.links) {
    const at = panes.get(paneKey(link.connectionId, link.paneId));
    const item = items.get(link.itemKey);
    if (!at || item?.kind !== "pull_request") continue;
    if (!linkMatchesPane(link, at.pane)) continue;
    linked.set(item.key, (linked.get(item.key) ?? new Set()).add(at.tab.key));
  }
  const pullRequests = sources.items.filter(
    (item) => item.kind === "pull_request",
  );
  for (const pod of pods.values()) {
    pod.rounds.sort((a, b) => a.round - b.round);
    const own = new Set(pod.rounds.map((round) => round.tabKey));
    const numbered = pullRequests.filter((item) => item.number === pod.number);
    // A linked one wins; otherwise the only pull request with that number.
    const item =
      numbered.find((entry) =>
        [...(linked.get(entry.key) ?? [])].some((key) => own.has(key)),
      ) ?? (numbered.length === 1 ? numbered[0]! : null);
    if (!item) continue;
    pod.item = item;
    pod.state = podState(item, now);
    for (const tab of tabs)
      if (
        tab.connectionId === pod.connectionId &&
        !roundTabs.has(tab.key) &&
        linked.get(item.key)?.has(tab.key)
      )
        pod.authorKeys.push(tab.key);
  }
  return [...pods.values()].sort(
    (a, b) => a.number - b.number || a.roomKey.localeCompare(b.roomKey),
  );
}

/** A pod's name on its plaque: `#512 settings-sync`. */
export const podName = (pod: WorldPod) =>
  `#${pod.number}${pod.slug ? ` ${pod.slug}` : ""}`;

/** The round line: `r2 · +1 earlier`. */
export function podRounds(pod: WorldPod) {
  const current = pod.rounds[pod.rounds.length - 1];
  if (!current) return "";
  const earlier = pod.rounds.length - 1;
  return `r${current.round}${earlier ? ` · +${earlier} earlier` : ""}`;
}

/** Each pod's tabs by key: its rounds and its author. */
export function podOfTab(
  pods: readonly WorldPod[],
): ReadonlyMap<string, WorldPod> {
  const byTab = new Map<string, WorldPod>();
  for (const pod of pods) {
    for (const round of pod.rounds) byTab.set(round.tabKey, pod);
    for (const key of pod.authorKeys) if (!byTab.has(key)) byTab.set(key, pod);
  }
  return byTab;
}
