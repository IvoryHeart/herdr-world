import { handleWorldCliEndpoint } from "../http/world-cli-endpoint";
import { answerAsk, CliError, createWorldCli, dismissAsk } from "./world-cli";
import type { WorldLedger } from "./world-ledger";
import type { WorldSnapshotResult } from "./snapshot";
import type { WorldSourcesSnapshot } from "../../../shared/worldSources";
import { runGroupMove } from "./group-move";
import type { TownMoveContext } from "./town-move";

/**
 * The agent CLI inside the running service: its ledger, the notices World's
 * pages get when it changes, the `/api/world/cli` route, and the
 * methods pages call for questions (`world.asks.get`, `world.ask.answer`,
 * `world.ask.dismiss`).
 */
/** A ready runtime of one connection, as the connection manager leases it. */
type Lease = {
  isCurrent(): boolean;
  connectionId: string;
  generation: number;
  runtime: {
    sshHost(): unknown;
    herdr: {
      call(
        method: string,
        params: Record<string, unknown>,
        timeoutMs: number,
      ): Promise<unknown>;
    };
  };
};

export function createWorldCliService(deps: {
  board(): TownMoveContext["board"];
  /** The service's own ledger, opened on first use. */
  ledger(): WorldLedger;
  /** The service's wall clock: question times and wait deadlines. */
  now(): number;
  /** Read when a call arrives, so the service may be built first. */
  connections(): {
    list(): { id: string }[];
    readyRuntimeLease(id: string): Lease | null | undefined;
    defaultId(): string | null;
  };
  snapshots(): {
    snapshot(params: Record<string, never>): Promise<WorldSnapshotResult>;
  } | null;
  sources?(): Promise<WorldSourcesSnapshot>;
  townMoveQueues: TownMoveContext["queues"];
  publishBoard(revision: number): void;
  /** Send one control line to every connected page. */
  broadcast(line: string): void;
}) {
  const board: TownMoveContext["board"] = {
    get: () => deps.board().get(),
    patch: (ops) => deps.board().patch(ops),
    captureColorChanges: () => deps.board().captureColorChanges(),
    captureAppearanceChanges: () => deps.board().captureAppearanceChanges(),
  };
  const ledger = () => deps.ledger();
  const now = () => deps.now();
  // Ends the calls that wait for an answer, so the service can stop.
  const stopped = new AbortController();
  /** Pages fetch the open questions only when `asks` says they changed. */
  const publishLedger = (revision: number, asks = false) =>
    deps.broadcast(
      JSON.stringify({
        control: {
          type: "world_ledger_changed",
          revision,
          ...(asks ? { asks: true } : {}),
        },
      }),
    );
  const cli = createWorldCli({
    board,
    get ledger() {
      return ledger();
    },
    // Herdr on this machine can be checked for the caller's processes.
    hosts: () =>
      deps
        .connections()
        .list()
        .flatMap((status) => {
          const lease = deps.connections().readyRuntimeLease(status.id);
          if (!lease?.isCurrent()) return [];
          return [
            {
              connection_id: lease.connectionId,
              generation: lease.generation,
              local: !lease.runtime.sshHost(),
              call: (method: string, params: Record<string, unknown>) =>
                lease.runtime.herdr.call(method, params, 5_000),
            },
          ];
        }),
    defaultConnectionId: () => deps.connections().defaultId(),
    snapshot: async () => {
      const snapshots = deps.snapshots();
      if (!snapshots) throw new Error("World snapshot service is unavailable");
      return snapshots.snapshot({});
    },
    sources: deps.sources,
    groupMove: (request) => {
      const lease = deps.connections().readyRuntimeLease(request.connection_id);
      if (
        !lease?.isCurrent() ||
        lease.connectionId !== request.connection_id ||
        lease.generation !== request.generation
      )
        throw new CliError(
          "refused",
          "The selected host reconnected. Read Groups again.",
        );
      return runGroupMove(
        {
          connectionId: lease.connectionId,
          generation: lease.generation,
          isCurrent: () => lease.isCurrent(),
          call: (method, params) =>
            lease.runtime.herdr.call(method, params, 10_000),
          queues: deps.townMoveQueues,
          board,
          publishBoard: deps.publishBoard,
          onFollowError: () =>
            console.warn(
              "Group move completed; Board following could not be reconciled",
            ),
        },
        request,
      );
    },
    publishBoard: deps.publishBoard,
    publishLedger,
    now,
    signal: stopped.signal,
  });
  return {
    /** A page's question method; undefined when `method` is not one. */
    rpc(method: string, params: unknown): unknown {
      if (method === "world.asks.get") return ledger().openAsks();
      if (method !== "world.ask.answer" && method !== "world.ask.dismiss")
        return undefined;
      const p = (params ?? {}) as Record<string, unknown>;
      const answer = typeof p.answer === "string" ? p.answer.trim() : "";
      if (
        typeof p.id !== "string" ||
        (method === "world.ask.answer" && (!answer || answer.length > 4000))
      )
        throw new Error(
          method === "world.ask.answer"
            ? "an answer needs a question ID and text"
            : "a dismissal needs a question ID",
        );
      try {
        publishLedger(
          method === "world.ask.answer"
            ? answerAsk(ledger(), p.id, answer, "owner", now())
            : dismissAsk(ledger(), p.id, "owner", now()),
          true,
        );
      } catch (error) {
        throw error instanceof CliError ? new Error(error.message) : error;
      }
      return ledger().openAsks();
    },
    /** `/api/world/cli`, for `herdr-world` on this machine. */
    http(
      req: Request,
      peer: { address: string; port: number } | null,
      serverPort: number,
      bearerAuth: (req: Request, ip: string) => true | Response | null,
    ) {
      return handleWorldCliEndpoint(req, peer, {
        serverPort,
        bearerAuth,
        handle: (body, locate) => cli.handle(body as never, locate),
      });
    },
    /** End every wait for an answer now; the service is stopping. */
    stop() {
      stopped.abort();
    },
  };
}
