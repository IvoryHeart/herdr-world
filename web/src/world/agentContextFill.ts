import type { UsageContext, WorldUsageSnapshot } from "../../../shared/usage";
import { useEffect } from "react";
import { LIMITS_REFRESH_MS } from "./town/townLimits";
import {
  townUsageStore,
  useTownUsage,
  type TownUsageState,
} from "./town/townPlaceUsage";

/**
 * How full an agent's context window is, like a needs bar in a life-sim
 * game: the newest prompt of its current session against its model's window
 * (`world.usage.get` `contexts`, docs/usage.md). An agent without evidence,
 * or on a model whose window World does not know, has no fill: never zero.
 */
export type AgentContextFill = {
  /** 0–100, rounded. */
  percent: number;
  usedTokens: number;
  windowTokens: number;
  model: string;
  /** Past the threshold: about to compact or lose the thread. */
  tired: boolean;
  /** "Context 72% · 144k of 200k tokens · claude-…" */
  text: string;
};

/** At this fill an agent looks tired at its desk. */
export const CONTEXT_TIRED_PERCENT = 85;

/** An agent's pane, qualified by its connection and runtime generation. */
export type AgentContextPane = {
  connectionId: string;
  generation: number;
  paneId: string;
};

const indexes = new WeakMap<WorldUsageSnapshot, Map<string, UsageContext>>();
const paneKey = (connectionId: string, generation: number, paneId: string) =>
  JSON.stringify([connectionId, generation, paneId]);

/** 144000 → "144k", 1000000 → "1M". */
export function contextTokens(value: number) {
  if (value < 1000) return String(value);
  if (value < 999_500) return `${Math.round(value / 1000)}k`;
  return `${Number((value / 1_000_000).toFixed(1))}M`;
}

export function agentContextFill(
  state: TownUsageState,
  pane: AgentContextPane | null,
): AgentContextFill | null {
  if (state.status !== "ready" || !pane) return null;
  const snapshot = state.snapshot;
  let index = indexes.get(snapshot);
  if (!index) {
    index = new Map();
    for (const context of Array.isArray(snapshot.contexts)
      ? snapshot.contexts
      : [])
      index.set(
        paneKey(
          context.connection_id,
          context.connection_generation,
          context.pane_id,
        ),
        context,
      );
    indexes.set(snapshot, index);
  }
  const context = index.get(
    paneKey(pane.connectionId, pane.generation, pane.paneId),
  );
  if (!context?.window_tokens || context.used_tokens <= 0) return null;
  const percent = Math.min(
    100,
    Math.round((context.used_tokens / context.window_tokens) * 100),
  );
  return {
    percent,
    usedTokens: context.used_tokens,
    windowTokens: context.window_tokens,
    model: context.model,
    tired: percent >= CONTEXT_TIRED_PERCENT,
    text: `Context ${percent}% · ${contextTokens(context.used_tokens)} of ${contextTokens(context.window_tokens)} tokens · ${context.model}`,
  };
}

/**
 * The usage read, re-read every 30 seconds while `active` (the shared store
 * limits the rate across every caller).
 */
export function useContextUsage(active: boolean) {
  const store = townUsageStore();
  useEffect(() => {
    if (!active) return;
    store.request();
    const timer = window.setInterval(() => store.request(), LIMITS_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [store, active]);
  return useTownUsage(store);
}

/** One agent's fill, re-read while shown; null for no pane. */
export function useAgentContextFill(pane: AgentContextPane | null) {
  return agentContextFill(useContextUsage(pane !== null), pane);
}
