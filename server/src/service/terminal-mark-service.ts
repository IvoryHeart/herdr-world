import { sanitizeConnectionError } from "../connections/manager";
import type { Logger } from "../utils/logger";
import { createWorldDeskService } from "../world/desk-service";
import { createTerminalMarks } from "../world/terminal-marks";
import { PersistentTerminalMarks } from "../world/persistent-terminal-marks";
import type { createRevisionPublisher } from "../world/revision-publisher";

type PersistentOptions = ConstructorParameters<
  typeof PersistentTerminalMarks
>[0];
type Options = Pick<PersistentOptions, "incarnation" | "lease" | "now"> & {
  storage?: PersistentOptions["storage"];
  publisher: ReturnType<typeof createRevisionPublisher>;
  broadcast(line: string): void;
  invalidate(connectionId: string, generation: number): void;
  stop(): Promise<void>;
  logger: Logger;
};
/** The root owns one set of registries, projections and committed notices. */
export function createSharedTerminalMarks(options: Options) {
  const desk = createWorldDeskService(options.broadcast);
  const { observe, retire, ...marks } = createTerminalMarks(
    options.publisher,
    desk.observe,
  );
  const persistent = options.storage
    ? new PersistentTerminalMarks({
        storage: options.storage,
        incarnation: options.incarnation,
        lease: options.lease,
        now: options.now,
        registries: {
          desk: desk.registry,
          watchlist: marks.worldWatchlist,
          seen: marks.worldCompletionSeen,
        },
        changed(kind, revision, connectionId, generation) {
          if (kind === "desk") desk.publish(revision);
          else if (kind === "watchlist") {
            marks.publishWatchlistChanged(revision);
            if (connectionId !== undefined && generation !== undefined)
              options.invalidate(connectionId, generation);
          } else marks.publishCompletionSeenChanged(revision);
        },
        failed(error) {
          options.logger.error(
            "Terminal mark persistence failed; stopping service",
            { error: sanitizeConnectionError(error) },
          );
          void options.stop().catch((error) =>
            options.logger.error("Terminal mark failure shutdown failed", {
              error: sanitizeConnectionError(error),
            }),
          );
        },
      })
    : undefined;
  return {
    ...marks,
    worldDesk: desk.registry,
    publishDeskChanged: desk.publish,
    persistentMarks: persistent,
    close: () => persistent?.close() ?? Promise.resolve(),
    observe: persistent ? persistent.observe.bind(persistent) : observe,
    retire(connectionId: string, generation: number, ready = true) {
      if (persistent) persistent.retire(connectionId, generation, ready);
      else {
        desk.retire(connectionId, generation);
        retire(connectionId, generation);
      }
    },
  };
}
