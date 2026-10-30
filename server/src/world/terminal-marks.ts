import type { createRevisionPublisher } from "./revision-publisher";
import { WorldCompletionSeenRegistry } from "./completion-seen";
import { WorldWatchlistRegistry } from "./watchlist";

/**
 * Per-terminal marks World keeps in process memory for every browser: the
 * watchlist and Town's checked completions. Both are keyed by runtime
 * generation, so a new generation retires its connection's older marks.
 */
export function createTerminalMarks(
  publisher: ReturnType<typeof createRevisionPublisher>,
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
