import type { EffectStore } from "../effects/types";
import type { AttentionOutbox } from "../storage/world-protocol";
import { createBinCloser, type BinLease } from "../world/bin-close";
import { WorldBinRegistry } from "../world/bin";
import type { LedgerStore } from "../world/world-ledger";
import type { Clock, Scheduler } from "./ports";

type Lease = {
  connectionId: string;
  generation: number;
  isCurrent(): boolean;
  runtime: {
    herdr: {
      call(
        method: string,
        params: Record<string, unknown>,
        timeoutMs?: number,
        beforeSend?: () => void,
      ): Promise<unknown>;
    };
  };
};

/**
 * The agent bin's composition: in-memory holding and the scheduled bus
 * (bin.ts), and the durable, per-connection close (bin-close.ts).
 */
export function createBinService(deps: {
  incarnation: string;
  clock: Clock;
  scheduler: Scheduler;
  ledger(): LedgerStore;
  outbox(): AttentionOutbox;
  effects(): EffectStore;
  connections(): {
    list(): { id: string }[];
    readyRuntimeLease(id: string): Lease | null | undefined;
  };
  publish(revision: number): void;
  log(message: string): void;
}) {
  const lease = (id: string): BinLease | null => {
    const current = deps.connections().readyRuntimeLease(id);
    return current
      ? {
          connectionId: current.connectionId,
          generation: current.generation,
          isCurrent: () => current.isCurrent(),
          call: (method, params, timeoutMs, beforeSend) =>
            current.runtime.herdr.call(method, params, timeoutMs, beforeSend),
        }
      : null;
  };
  // The registry and closer refer to each other; each call is made later.
  const registry: WorldBinRegistry = new WorldBinRegistry({
    epoch: deps.incarnation,
    clock: deps.clock,
    scheduler: deps.scheduler,
    commit: (entries) => closer.commit(entries),
    publish: deps.publish,
    log: deps.log,
  });
  const closer = createBinCloser({
    ledger: deps.ledger,
    outbox: deps.outbox,
    effects: deps.effects,
    incarnation: deps.incarnation,
    clock: deps.clock,
    scheduler: deps.scheduler,
    hasConnection: (id) =>
      deps
        .connections()
        .list()
        .some((entry) => entry.id === id),
    lease,
    settle: (id, outcome) => {
      if (registry.owns(id)) registry.settle(id, outcome);
    },
    log: deps.log,
  });

  return {
    registry,
    lease,
    /** Intents left by an earlier run resume under their recovery rules. */
    start: () => closer.wake(),
    connectionStatus(status: {
      id: string;
      generation: number;
      state: string;
    }) {
      registry.retireConnectionGeneration(status.id, status.generation);
      if (status.state === "ready") void closer.wake(status.id);
    },
    async stop() {
      registry.dispose();
      await closer.stop();
    },
  };
}
export type BinService = ReturnType<typeof createBinService>;
