import { createAskRecipients, type AnswerLease } from "./ask-recipient";
import { createAnswerRecorder } from "./answer-record";
import { createAnswerDispatcher } from "./answer-dispatch";
import {
  ANSWER_DELIVERY_VERB,
  answeringAgent,
  validRecipient,
} from "./ask-delivery-types";
import { randomBytes } from "node:crypto";
import { handleWorldCliEndpoint } from "../http/world-cli-endpoint";
import { answerAsk, CliError, createWorldCli, dismissAsk } from "./world-cli";
import { type LedgerStore } from "./world-ledger";
import { createAttentionDispatcher } from "./attention-dispatch";
import type {
  StoragePorts,
  WorldLedgerStorage,
} from "../storage/world-protocol";
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
type Lease = AnswerLease;

export function createWorldCliService(deps: {
  ledger(): LedgerStore;
  attention?(): WorldLedgerStorage["outbox"];
  scheduler?: StoragePorts["scheduler"];
  now(): number;
  incarnation?: string;
  clock?: StoragePorts["clock"];
  board(): TownMoveContext["board"];
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
  const incarnation = deps.incarnation ?? randomBytes(16).toString("base64url");
  let dispatcher: ReturnType<typeof createAttentionDispatcher> | undefined;
  let answerDispatcher: ReturnType<typeof createAnswerDispatcher> | undefined;
  let deliveryRevision = 0;
  const recipients = createAskRecipients({
    connections: deps.connections,
    clock: deps.clock ?? { now, monotonic: () => performance.now() },
    incarnation,
  });
  const recordAnswer = deps.attention
    ? createAnswerRecorder({ ledger, recipients, now })
    : undefined;
  const publishDelivery = () =>
    deps.broadcast(
      JSON.stringify({
        control: {
          type: "world_ask_delivery_changed",
          revision: ++deliveryRevision,
          incarnation,
        },
      }),
    );
  const deliveryPage = async (after?: string) => {
    const revision = deliveryRevision;
    const page = (await deps
      .attention?.()
      .notices(ANSWER_DELIVERY_VERB.name, after, 60)) ?? {
      entries: [],
      checks: 0,
      waiting: 0,
      connections: {},
    };
    const entries = page.entries;
    return {
      revision,
      incarnation,
      counts: {
        checks: page.checks,
        waiting: page.waiting,
        connections: page.connections,
      },
      deliveries: entries.flatMap((entry) => {
        const ask = ledger().ask(entry.record_id);
        return ask
          ? [
              {
                ask,
                delivery: ask.delivery?.answer,
                can_resend:
                  !ask.withdrawn &&
                  validRecipient(ask.recipient) &&
                  ["uncertain", "refused"].includes(entry.state),
              },
            ]
          : [];
      }),
      next: entries.length === 60 ? entries.at(-1)!.id : null,
    };
  };
  // This query includes attention evidence as well as domain mutations.
  let queryRevision = ledger().get().revision;
  const openAsks = () => ({ ...ledger().openAsks(), revision: queryRevision });
  /** Pages fetch the open questions only when `asks` says they changed. */
  const publishLedger = (revision: number, asks = false, wake = true) => {
    queryRevision = Math.max(queryRevision + 1, revision);
    deps.broadcast(
      JSON.stringify({
        control: {
          type: "world_ledger_changed",
          revision: queryRevision,
          ...(asks ? { asks: true } : {}),
        },
      }),
    );
    if (wake) {
      void dispatcher?.wake();
      void answerDispatcher?.wake();
    }
  };
  if (deps.attention) {
    if (!deps.scheduler)
      throw new Error("Attention storage needs the service scheduler");
    dispatcher = createAttentionDispatcher({
      outbox: deps.attention,
      scheduler: deps.scheduler,
      clock: deps.clock ?? {
        now,
        monotonic: () => performance.now(),
      },
      incarnation,
      ledger,
      hasConnection: (id) =>
        deps
          .connections()
          .list()
          .some((entry) => entry.id === id),
      lease: (id) => {
        const lease = deps.connections().readyRuntimeLease(id);
        return (
          lease && {
            connectionId: lease.connectionId,
            generation: lease.generation,
            isCurrent: () => lease.isCurrent(),
            call: (method, params) =>
              lease.runtime.herdr.call(method, params, 5000),
          }
        );
      },
      changed: () => publishLedger(ledger().get().revision, true, false),
      log: (message) => console.warn(message),
    });
  }
  if (deps.attention && deps.scheduler)
    answerDispatcher = createAnswerDispatcher({
      ledger,
      outbox: deps.attention,
      recipients,
      scheduler: deps.scheduler,
      clock: deps.clock ?? { now, monotonic: () => performance.now() },
      changed: publishDelivery,
      log: (message) => console.warn(message),
    });
  const cli = createWorldCli({
    recordAnswer: recordAnswer
      ? async (id, text, actor) => {
          const revision = await recordAnswer(id, text, answeringAgent(actor));
          publishDelivery();
          return revision;
        }
      : undefined,
    captureRecipient: deps.attention ? recipients.capture : undefined,
    acknowledgeAnswer: async (id, occurrence, attempt, actor) => {
      const entry = (await deps.attention?.().forRecord(id))?.find(
        (entry) => entry.kind === ANSWER_DELIVERY_VERB.name,
      );
      if (!entry)
        throw new CliError("not_found", "No retained answer delivery");
      const acknowledged = await deps.attention!().acknowledge(
        entry.id,
        occurrence,
        attempt,
        actor,
      );
      if (!acknowledged)
        throw new CliError(
          "refused",
          "Only the verified original asker can acknowledge this exact answer",
        );
      publishDelivery();
      return { acknowledged: true };
    },
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
    incarnation,
  });
  return {
    /** A page's question method; undefined when `method` is not one. */
    async rpc(method: string, params: unknown): Promise<unknown> {
      if (method === "world.asks.get") return openAsks();
      if (method === "world.ask.delivery.get") {
        const p = (params ?? {}) as Record<string, unknown>;
        if (
          typeof p.id !== "string" ||
          typeof p.occurrence !== "string" ||
          p.id.length > 200 ||
          p.occurrence.length > 200
        )
          throw new Error(
            "An exact delivery read needs an ask and answer occurrence",
          );
        await deps.attention?.().forRecord(p.id);
        const ask = ledger().ask(p.id);
        return ask?.answer?.occurrence === p.occurrence
          ? { ask, delivery: ask.delivery?.answer, can_resend: false }
          : null;
      }
      if (method === "world.ask.deliveries.get") {
        const p = (params ?? {}) as Record<string, unknown>;
        if (
          p.after !== undefined &&
          (typeof p.after !== "string" || p.after.length > 200)
        )
          throw new Error("invalid delivery cursor");
        return deliveryPage(p.after as string | undefined);
      }
      if (
        method === "world.ask.delivery.resend" ||
        method === "world.ask.delivery.close"
      ) {
        const p = (params ?? {}) as Record<string, unknown>;
        if (
          typeof p.id !== "string" ||
          typeof p.occurrence !== "string" ||
          !Number.isSafeInteger(p.attempt)
        )
          throw new Error(
            "A delivery decision needs an ask, answer occurrence and attempt",
          );
        const resend = method === "world.ask.delivery.resend";
        if (resend && p.confirm_duplicate !== true)
          throw new Error(
            "Resending may duplicate a prior submission; confirm that risk",
          );
        const entry = (await deps.attention?.().forRecord(p.id))?.find(
          (entry) => entry.kind === ANSWER_DELIVERY_VERB.name,
        );
        if (
          !entry ||
          !(await deps.attention!().decide(
            entry.id,
            p.occurrence,
            p.attempt as number,
            resend ? "resend" : "close",
          ))
        )
          throw new Error("Delivery changed; refresh before deciding");
        publishDelivery();
        void answerDispatcher?.wake();
        return deliveryPage();
      }
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
          await (method === "world.ask.answer"
            ? recordAnswer
              ? recordAnswer(p.id, answer, { kind: "owner" })
              : answerAsk(ledger(), p.id, answer, "owner", now())
            : dismissAsk(ledger(), p.id, "owner", now())),
          true,
        );
        if (method === "world.ask.answer") publishDelivery();
      } catch (error) {
        throw error instanceof CliError ? new Error(error.message) : error;
      }
      return openAsks();
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
        handle: async (body, locate) => {
          const reply = await cli.handle(body as never, locate);
          if (
            reply.ok &&
            (body as { command?: unknown })?.command === "ask withdraw"
          )
            publishDelivery();
          if ((body as { command?: unknown })?.command !== "ask") return reply;
          if (!reply.ok) return { ...reply, recorded: false, notified: null };
          const result = reply.result as { id: string; created?: boolean };
          if (!result.created)
            return { ...reply, recorded: true, notified: null };
          const notification = (await dispatcher?.notify(result.id)) ?? {
            shown: false,
            reason: "Owner-alert dispatcher is unavailable",
          };
          return {
            ...reply,
            recorded: true,
            notified: {
              shown: notification.shown,
              reason: notification.reason,
            },
            ...(notification.retrying ? { retrying: true } : {}),
          };
        },
      });
    },
    start: () => {
      void dispatcher?.wake();
      void answerDispatcher?.wake();
    },
    /** Cancel held reads immediately, then drain already-started alerts. */
    async stop() {
      stopped.abort();
      await Promise.all([dispatcher?.stop(), answerDispatcher?.stop()]);
    },
  };
}
