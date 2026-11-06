import type { createRevisionPublisher } from "./revision-publisher";
import { WorldWatchlistRegistry } from "./watchlist";

type HostObservation = (
  connectionId: string,
  generation: number,
  panes: readonly Record<string, unknown>[],
  at: number,
  agents?: readonly Record<string, unknown>[],
) => void;

/** Desk and watch projections are shared by every browser of this World. */
export function createTerminalMarks(
  publisher: ReturnType<typeof createRevisionPublisher>,
  observeDesk: HostObservation,
) {
  const worldWatchlist = new WorldWatchlistRegistry();
  const publishWatchlistChanged = publisher(
    "world_watchlist_changed",
    "world-watchlist",
  );
  return {
    worldWatchlist,
    publishWatchlistChanged,
    observe: observeDesk,
    retire(connectionId: string, generation: number) {
      const retired = worldWatchlist.retireConnectionGeneration(
        connectionId,
        generation,
      );
      if (retired.changed) publishWatchlistChanged(retired.revision);
    },
  };
}
