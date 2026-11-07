/**
 * Agents this page started, as World confirmed them: the launcher's start
 * answered `sent` or `started` with the new terminal (AgentLauncherDialog).
 * Town plays an arrival for each (town/townArrivals.ts). Failed, uncertain
 * and errored starts are never noted, and this is page memory only, so a
 * reload never replays an arrival for agents that were already there.
 */

import { useSyncExternalStore } from "react";
import type { LaunchOutcome } from "./agentProfiles";

/** Where the start was asked for: Town's center, or anywhere else. */
export type AgentStartFrom = "center" | "elsewhere";

export type AgentStart = {
  /** Unique in this page. */
  id: number;
  connectionId: string;
  generation: number;
  terminalId: string;
  from: AgentStartFrom;
  /** When World confirmed it (performance.now()). */
  at: number;
};

/**
 * The started terminal when World confirmed the start (the agent is ready,
 * and any first prompt sent), else null: failed, uncertain, or no terminal.
 */
export function launchConfirmedTerminal(
  result: Pick<LaunchOutcome, "status" | "terminal_id">,
): string | null {
  return (result.status === "sent" || result.status === "started") &&
    result.terminal_id
    ? result.terminal_id
    : null;
}

/** A start whose agent never showed in this long is forgotten. */
export const AGENT_START_KEEP_MS = 30_000;

let starts: readonly AgentStart[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

export function noteAgentStarted(
  start: Omit<AgentStart, "id" | "at">,
  at = performance.now(),
) {
  starts = [
    ...starts.filter((kept) => at - kept.at < AGENT_START_KEEP_MS),
    { ...start, id: nextId++, at },
  ];
  for (const listener of listeners) listener();
}

export function agentStarts() {
  return starts;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAgentStarts() {
  return useSyncExternalStore(subscribe, agentStarts, agentStarts);
}

/** Testing only: forget every start. */
export function resetAgentStarts() {
  starts = [];
}
