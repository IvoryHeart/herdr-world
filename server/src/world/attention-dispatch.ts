import {
  attentionRetryDelay,
  type AttentionEntry,
  type DispatchFence,
  type StoragePorts,
  type WorldLedgerStorage,
} from "../storage/world-protocol";
import type { LedgerStore } from "./world-ledger";

type Lease = {
  connectionId: string;
  generation: number;
  isCurrent(): boolean;
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
};
export type AlertOutcome = {
  shown: boolean;
  reason: string;
  retrying?: boolean;
};

/** One owner-alert intent; retries are scheduled attempts on its original connection. */
export function createAttentionDispatcher(deps: {
  outbox(): WorldLedgerStorage["outbox"];
  ledger(): LedgerStore;
  hasConnection(id: string): boolean;
  lease(id: string): Lease | null | undefined;
  clock: StoragePorts["clock"];
  scheduler: StoragePorts["scheduler"];
  incarnation: string;
  changed(): void;
  log(message: string): void;
}) {
  let stopped = false;
  let timer: { cancel(): void } | undefined;
  let running: Promise<void> | null = null;
  let requested = false;
  let planning = Promise.resolve();
  const sending = new Map<string, Promise<AlertOutcome>>();
  const outcome = (entry: AttentionEntry | null): AlertOutcome => ({
    shown: entry?.state === "delivered",
    reason: entry?.evidence?.reason ?? "Owner alert is pending",
    ...(entry && (entry.state === "pending" || entry.state === "uncertain")
      ? { retrying: true }
      : {}),
  });
  const finish = async (
    entry: AttentionEntry,
    state: AttentionEntry["state"],
    reason: string,
  ) => {
    const updated = await deps
      .outbox()
      .finish(
        entry.id,
        entry.attempt,
        state,
        reason,
        deps.clock.now() + attentionRetryDelay(entry.attempt),
      );
    deps.changed();
    return outcome(updated ?? (await deps.outbox().get(entry.id)));
  };
  async function dispatch(entry: AttentionEntry): Promise<AlertOutcome> {
    if (stopped || entry.kind !== "ask.created") return outcome(entry);
    if (entry.state !== "dispatching" && entry.due_at > deps.clock.now())
      return outcome(entry);
    if (!["pending", "uncertain", "dispatching"].includes(entry.state))
      return outcome(entry);
    const connection = entry.target?.connection_id;
    const lease = connection ? deps.lease(connection) : null;
    const current =
      lease && lease.connectionId === connection && lease.isCurrent()
        ? lease
        : null;
    const fence: DispatchFence | undefined = current
      ? {
          connection_id: current.connectionId,
          generation: current.generation,
          service_incarnation: deps.incarnation,
        }
      : undefined;
    const claimed =
      entry.state === "dispatching"
        ? entry
        : await deps.outbox().claim(entry.id, fence);
    if (!claimed || claimed.state !== "dispatching") {
      deps.changed();
      return outcome(claimed ?? (await deps.outbox().get(entry.id)));
    }
    if (!connection || !deps.hasConnection(connection))
      return finish(
        claimed,
        "refused",
        "The captured owner-alert connection is absent or removed",
      );
    const ask = deps.ledger().ask(claimed.record_id);
    if (!ask || ask.answer || ask.dismissed || ask.withdrawn)
      return finish(
        claimed,
        "cancelled",
        "Question closed before owner notification",
      );
    if (stopped || !current || !current.isCurrent())
      return finish(
        claimed,
        "pending",
        "No current lease on the captured connection; owner alert deferred",
      );
    const captured = claimed.evidence?.fence;
    if (
      captured &&
      (captured.connection_id !== current.connectionId ||
        captured.generation !== current.generation ||
        captured.service_incarnation !== deps.incarnation)
    )
      return finish(
        claimed,
        "pending",
        "The captured dispatch attempt retired; retry will acquire a new lease on the same connection",
      );
    let result: { shown?: boolean; reason?: string } | null;
    try {
      result = (await current.call("notification.show", {
        title: `${ask.actor.name ?? ask.actor.label} asks`,
        body: `${ask.question} (${ask.id})`,
        sound: "request",
      })) as typeof result;
    } catch (error) {
      return finish(
        claimed,
        "uncertain",
        `Herdr notification outcome is uncertain: ${(error as Error).message}`,
      );
    }
    if (result?.shown === true)
      return finish(claimed, "delivered", result.reason ?? "shown");
    if (result?.shown === false)
      return finish(
        claimed,
        result.reason === "busy" || result.reason === "rate_limited"
          ? "pending"
          : "refused",
        result.reason ?? "Herdr refused the owner notification",
      );
    return finish(
      claimed,
      "uncertain",
      "Herdr returned no definite notification outcome",
    );
  }
  function send(entry: AttentionEntry): Promise<AlertOutcome> {
    const known = sending.get(entry.id);
    if (known) return known;
    const task = dispatch(entry).finally(() => sending.delete(entry.id));
    sending.set(entry.id, task);
    return task;
  }
  function plan() {
    planning = planning
      .then(async () => {
        timer?.cancel();
        timer = undefined;
        if (stopped) return;
        const next = (await deps.outbox().list("ask.created"))[0];
        if (next && !stopped)
          timer = deps.scheduler.schedule(
            () => {
              void wake();
            },
            Math.min(60_000, Math.max(0, next.due_at - deps.clock.now())),
          );
      })
      .catch((error) =>
        deps.log(`Attention scheduling failed: ${(error as Error).message}`),
      );
    return planning;
  }
  function wake(): Promise<void> {
    if (stopped) return Promise.resolve();
    requested = true;
    if (running) return running;
    timer?.cancel();
    timer = undefined;
    running = (async () => {
      while (requested && !stopped) {
        requested = false;
        for (const entry of await deps.outbox().list("ask.created")) {
          if (stopped || entry.due_at > deps.clock.now()) break;
          await send(entry);
        }
      }
    })()
      .catch((error) =>
        deps.log(`Attention dispatch failed: ${(error as Error).message}`),
      )
      .finally(async () => {
        running = null;
        await plan();
      });
    return running;
  }
  return {
    wake,
    async notify(recordId: string): Promise<AlertOutcome> {
      const entry = (await deps.outbox().forRecord(recordId)).find(
        (entry) => entry.kind === "ask.created",
      );
      if (!entry)
        return { shown: false, reason: "No owner-alert intent was recorded" };
      const result = await send(entry);
      void plan();
      return result;
    },
    async stop() {
      stopped = true;
      timer?.cancel();
      timer = undefined;
      await Promise.allSettled([running, planning, ...sending.values()]);
    },
  };
}
