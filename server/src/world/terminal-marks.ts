import type { createRevisionPublisher } from "./revision-publisher";
import { WorldCompletionSeenRegistry } from "./completion-seen";
import { WorldWatchlistRegistry } from "./watchlist";
import { observedAgentStatus } from "./desk-observation";

type HostObservation = (
  connectionId: string,
  generation: number,
  panes: readonly Record<string, unknown>[],
  at: number,
  agents?: readonly Record<string, unknown>[],
) => void;

/**
 * Per-terminal marks World keeps in process memory for every browser: the
 * watchlist and Town's checked completions. Both are keyed by runtime
 * generation, so a new generation retires its connection's older marks.
 * `observe` takes each fresh host read: Desk's, then the completion checks',
 * which end when their agent works or asks again.
 */
export function createTerminalMarks(
  publisher: ReturnType<typeof createRevisionPublisher>,
  observeDesk: HostObservation,
) {
  const worldWatchlist = new WorldWatchlistRegistry();
  const worldCompletionSeen = new WorldCompletionSeenRegistry();
  const publishWatchlistChanged = publisher(
    "world_watchlist_changed",
    "world-watchlist",
  );
  const publishCompletionSeenChanged = publisher(
    "world_completion_seen_changed",
    "world-completion-seen",
  );
  const marks = [
    [worldWatchlist, publishWatchlistChanged],
    [worldCompletionSeen, publishCompletionSeenChanged],
  ] as const;
  return {
    worldWatchlist,
    worldCompletionSeen,
    publishWatchlistChanged,
    publishCompletionSeenChanged,
    observe: ((connectionId, generation, panes, at, agents = []) => {
      observeDesk(connectionId, generation, panes, at, agents);
      const statusByPane = new Map<string, unknown>();
      for (const agent of agents)
        statusByPane.set(
          JSON.stringify([agent.pane_id, agent.terminal_id]),
          agent.agent_status,
        );
      let changed = false;
      for (const pane of panes) {
        if (typeof pane.terminal_id !== "string" || !pane.agent) continue;
        const status =
          statusByPane.get(JSON.stringify([pane.pane_id, pane.terminal_id])) ??
          pane.agent_status;
        const observed = observedAgentStatus(status);
        changed =
          worldCompletionSeen.observe(
            {
              connection_id: connectionId,
              connection_generation: generation,
              terminal_id: pane.terminal_id,
            },
            observed === "working" || observed === "blocked",
          ).changed || changed;
      }
      if (changed)
        publishCompletionSeenChanged(worldCompletionSeen.list().revision);
    }) satisfies HostObservation,
    retire(connectionId: string, generation: number) {
      for (const [registry, publish] of marks) {
        const retired = registry.retireConnectionGeneration(
          connectionId,
          generation,
        );
        if (retired.changed) publish(retired.revision);
      }
    },
  };
}
