import { createEffectRunner, type EffectDriver } from "../effects/runner";
import type {
  EffectEntry,
  EffectStore,
  QualifiedEffectTarget,
} from "../effects/types";
import type {
  StoragePorts,
  WorldLedgerStorage,
} from "../storage/world-protocol";
import type { LedgerStore } from "./world-ledger";

type Lease = {
  connectionId: string;
  generation: number;
  isCurrent(): boolean;
  call(
    method: string,
    params: Record<string, unknown>,
    beforeSend?: () => void,
  ): Promise<unknown>;
};
export type AlertOutcome = {
  shown: boolean;
  reason: string;
  retrying?: boolean;
};

/** A repeatable owner alert uses the same fenced outbox as every queued effect. */
export function createAttentionDispatcher(deps: {
  outbox(): WorldLedgerStorage["outbox"];
  effects(): EffectStore;
  ledger(): LedgerStore;
  hasConnection(id: string): boolean;
  lease(id: string): Lease | null | undefined;
  clock: StoragePorts["clock"];
  scheduler: StoragePorts["scheduler"];
  incarnation: string;
  changed(): void;
  log(message: string): void;
}) {
  const outcome = (entry: EffectEntry | null): AlertOutcome => ({
    shown: entry?.state === "delivered",
    reason: entry?.evidence?.reason ?? "Owner alert is pending",
    ...(entry && ["pending", "uncertain"].includes(entry.state)
      ? { retrying: true }
      : {}),
  });
  const current = (entry: EffectEntry) => {
    const connection = entry.target?.connection_id;
    const lease = connection ? deps.lease(connection) : null;
    return lease && lease.connectionId === connection && lease.isCurrent()
      ? lease
      : null;
  };
  const open = (entry: EffectEntry) => {
    const ask = deps.ledger().ask(entry.record_id);
    return ask && !ask.answer && !ask.dismissed && !ask.withdrawn ? ask : null;
  };
  const guard = (
    entry: EffectEntry,
    targets: readonly QualifiedEffectTarget[],
  ) => {
    const lease = current(entry);
    return Boolean(
      open(entry) &&
        lease &&
        targets.length === 1 &&
        targets[0]!.fence.generation === lease.generation &&
        deps.hasConnection(lease.connectionId),
    );
  };
  const driver: EffectDriver = {
    authorize: (entry) =>
      entry.target && deps.hasConnection(entry.target.connection_id)
        ? "allowed"
        : "refused",
    preconditions: (entry) => (open(entry) ? "allowed" : "refused"),
    resolve: (entry) => {
      if (!entry.target || !deps.hasConnection(entry.target.connection_id))
        return {
          state: "ended",
          reason: "The captured owner-alert connection is absent or removed",
        };
      const lease = current(entry);
      return lease
        ? {
            state: "attached",
            targets: [
              {
                capture: entry.target,
                fence: {
                  connection_id: lease.connectionId,
                  generation: lease.generation,
                  service_incarnation: deps.incarnation,
                },
              },
            ],
          }
        : {
            state: "unresolved",
            reason:
              "No current lease on the captured connection; owner alert deferred",
          };
    },
    guard,
    async invoke(entry, context) {
      if (!(await context.beforeSubmit()))
        return { state: "wait", reason: "Owner alert admission changed" };
      const lease = current(entry),
        ask = open(entry);
      if (!lease || !ask || !context.guard())
        return {
          state: "wait",
          reason: "Owner alert lease retired before send",
          not_submitted: true,
        };
      const result = (await lease.call(
        "notification.show",
        {
          title: `${ask.actor.name ?? ask.actor.label} asks`,
          body: `${ask.question} (${ask.id})`,
          sound: "request",
        },
        () => {
          if (!context.guard())
            throw new Error("Owner alert authority retired before native send");
        },
      )) as { shown?: boolean; reason?: string } | null;
      if (result?.shown === true)
        return {
          state: "delivered",
          receipt: {
            source: "herdr-notification",
            reason: result.reason ?? "shown",
          },
        };
      if (result?.shown === false)
        return {
          state:
            result.reason === "busy" || result.reason === "rate_limited"
              ? "wait"
              : "refused",
          reason: result.reason ?? "Herdr refused the owner notification",
          not_submitted: true,
        };
      return {
        state: "uncertain",
        reason: "Herdr returned no definite notification outcome",
      };
    },
  };
  const runner = createEffectRunner({
    ...deps,
    store: deps.effects(),
    verb: "notification.show",
    driver: (verb) => (verb === "notification.show" ? driver : undefined),
    log: (error) => deps.log(`Attention dispatch failed: ${String(error)}`),
  });
  return {
    wake: runner.wake,
    async notify(recordId: string): Promise<AlertOutcome> {
      const entry = (await deps.outbox().forRecord(recordId)).find(
        (entry) => entry.kind === "ask.created",
      );
      if (!entry)
        return { shown: false, reason: "No owner-alert intent was recorded" };
      const result = outcome(await runner.run(entry.id));
      await runner.rearm();
      return result;
    },
    stop: runner.stop,
  };
}
