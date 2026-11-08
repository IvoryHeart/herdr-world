/**
 * Testing only: `?outOfFuel=3` (minutes until the reset, or `1h`; a bare
 * `?outOfFuel` means 3) marks one Claude and one Codex agent as stopped on
 * their usage limit, so the out-of-fuel look can be tried on a preview
 * without a real limit. The parameter is removed at once, as `?awaySince=`
 * is; the stops live in this page only and clear when their reset passes.
 * It is not a user-facing control.
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { AgentUsageStop } from "../../../../shared/usageStop";
import type { Pane } from "../../types";
import type { WorldLeafObject } from "../worldObject";

const PARAM = "outOfFuel";
const DEFAULT_MINUTES = 3;

/** How far ahead the simulated reset is, in ms, or null without the switch. */
export function outOfFuelParam(search: string): number | null {
  const params = new URLSearchParams(search);
  if (!params.has(PARAM)) return null;
  const value = params.get(PARAM) ?? "";
  if (!value) return DEFAULT_MINUTES * 60_000;
  const match = value.match(/^(\d{1,4})(m|h)?$/u);
  if (!match) return null;
  const ms = Number(match[1]) * (match[2] === "h" ? 3_600_000 : 60_000);
  return ms > 0 ? ms : null;
}

const paneKey = (pane: Pick<Pane, "pane_id" | "terminal_id">) =>
  `${pane.pane_id}\u0000${pane.terminal_id}`;

type Trial = {
  /** Stops by leaf ID, for Town. */
  byLeaf: ReadonlyMap<string, AgentUsageStop>;
  /** The same stops by pane, for Chat. */
  byPane: ReadonlyMap<string, AgentUsageStop>;
};

const NONE: Trial = { byLeaf: new Map(), byPane: new Map() };

/**
 * One Claude and one Codex agent, each stopped now and resetting `ahead` ms
 * later. Quiet agents are preferred, since a working agent has fuel; when a
 * harness has no agent, another agent stands in for it.
 */
export function pickOutOfFuelTrial(
  leaves: readonly WorldLeafObject[],
  now: number,
  ahead: number,
): Trial {
  const agents = leaves
    .filter((leaf) => leaf.kind === "agent" && !leaf.stale)
    .sort(
      (a, b) => Number(a.status === "working") - Number(b.status === "working"),
    );
  const byLeaf = new Map<string, AgentUsageStop>();
  const byPane = new Map<string, AgentUsageStop>();
  const take = (leaf: WorldLeafObject | undefined, stop: AgentUsageStop) => {
    if (!leaf) return;
    byLeaf.set(leaf.id, stop);
    byPane.set(paneKey(leaf.pane), stop);
  };
  for (const harness of ["claude", "codex"] as const) {
    const stop = { harness, at: now, resets_at: now + ahead };
    take(
      agents.find(
        (leaf) => !byLeaf.has(leaf.id) && leaf.pane.agent === harness,
      ) ?? agents.find((leaf) => !byLeaf.has(leaf.id)),
      stop,
    );
  }
  return byLeaf.size ? { byLeaf, byPane } : NONE;
}

let pending: number | null | undefined;
let trial = NONE;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => trial;

/** Reads and removes the switch once per page load. */
function takeParam() {
  if (pending !== undefined || typeof location === "undefined") return;
  pending = outOfFuelParam(location.search);
  if (pending === null) return;
  const url = new URL(location.href);
  url.searchParams.delete(PARAM);
  history.replaceState(history.state, "", url);
}

/**
 * Town's stops with the switch's simulated ones added; the same map
 * without the switch. Agents are picked once Town has some.
 */
export function useOutOfFuelTrial(
  leaves: readonly WorldLeafObject[],
  stops: ReadonlyMap<string, AgentUsageStop>,
): ReadonlyMap<string, AgentUsageStop> {
  takeParam();
  const current = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    if (pending == null || !leaves.length) return;
    const picked = pickOutOfFuelTrial(leaves, Date.now(), pending);
    if (!picked.byLeaf.size) return;
    pending = null;
    trial = picked;
    for (const listener of listeners) listener();
  }, [leaves]);
  return useMemo(
    () =>
      current.byLeaf.size ? new Map([...stops, ...current.byLeaf]) : stops,
    [stops, current],
  );
}

/** Chat's simulated stop for this pane, when the switch picked it. */
export function useOutOfFuelTrialPane(
  pane: Pick<Pane, "pane_id" | "terminal_id">,
): AgentUsageStop | null {
  const current = useSyncExternalStore(subscribe, snapshot);
  return current.byPane.get(paneKey(pane)) ?? null;
}
