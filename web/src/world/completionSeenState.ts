import { useEffect, useSyncExternalStore } from "react";
import { bridge, type BridgeControlMsg, type ConnectionStatus } from "../api";
import type { OfficeAgent } from "./herdrOfficeProjection";

/**
 * Town's checked completions live in the World service, so every browser of
 * this World agrees. The service keeps them in memory only: a restart forgets
 * them, and so does a new runtime generation of the host.
 */
export type CompletionSeenState = {
  revision: number;
  /** completionSeenIdentity() of each checked agent. */
  identities: ReadonlySet<string>;
  /** Terminal IDs of those agents, to skip most of a dense roster cheaply. */
  terminals: ReadonlySet<string>;
  verified: boolean;
};

type Client = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onControl(callback: (control: BridgeControlMsg) => void): () => void;
  onStatus(callback: (status: ConnectionStatus) => void): () => void;
};

type SeenAgent = Pick<OfficeAgent, "currentTerminalRef">;

const EMPTY: CompletionSeenState = {
  revision: 0,
  identities: new Set(),
  terminals: new Set(),
  verified: false,
};

export function completionSeenIdentity(agent: SeenAgent) {
  const terminal = agent.currentTerminalRef;
  return JSON.stringify([
    terminal.connectionId,
    terminal.generation,
    terminal.nativeId,
  ]);
}

function wireIdentity(agent: SeenAgent) {
  const terminal = agent.currentTerminalRef;
  return {
    connection_id: terminal.connectionId,
    connection_generation: terminal.generation,
    terminal_id: terminal.nativeId,
  };
}

export function parseCompletionSeen(
  value: unknown,
): Omit<CompletionSeenState, "verified"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(input.revision) ||
    (input.revision as number) < 0 ||
    !Array.isArray(input.records)
  )
    return null;
  const identities = new Set<string>();
  const terminals = new Set<string>();
  for (const candidate of input.records) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      continue;
    const item = candidate as Record<string, unknown>;
    if (
      typeof item.connection_id !== "string" ||
      !item.connection_id ||
      !Number.isSafeInteger(item.connection_generation) ||
      typeof item.terminal_id !== "string" ||
      !item.terminal_id
    )
      continue;
    identities.add(
      JSON.stringify([
        item.connection_id,
        item.connection_generation,
        item.terminal_id,
      ]),
    );
    terminals.add(item.terminal_id);
  }
  return { revision: input.revision as number, identities, terminals };
}

export class CompletionSeenStore {
  private state = EMPTY;
  private listeners = new Set<() => void>();
  private epoch = 0;
  private users = 0;
  private unlisten: (() => void)[] = [];

  constructor(private readonly client: Client) {}
  get = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Follows the service while anything shows completions. */
  retain() {
    this.users += 1;
    if (this.users === 1) {
      this.unlisten = [
        this.client.onControl((control) => {
          if (control.type === "world_completion_seen_changed")
            void this.refresh();
        }),
        this.client.onStatus((status) => {
          // A reconnect may reach a restarted service, whose marks start
          // empty at revision 0: take its list whatever the revision.
          if (status === "connected") {
            this.epoch += 1;
            void this.refresh(true);
          }
          if (status === "disconnected")
            this.set({ ...this.state, verified: false });
        }),
      ];
      void this.refresh(true);
    }
    return () => {
      this.users -= 1;
      if (this.users) return;
      this.epoch += 1;
      for (const off of this.unlisten) off();
      this.unlisten = [];
    };
  }

  async refresh(resetRevision = false) {
    const epoch = this.epoch;
    try {
      this.accept(
        await this.client.call("world.completion_seen.list"),
        epoch,
        resetRevision,
      );
    } catch {
      if (epoch === this.epoch) this.set({ ...this.state, verified: false });
    }
  }

  /** The person checked this agent's finished work. */
  mark(agent: SeenAgent) {
    return this.mutate("world.completion_seen.mark", wireIdentity(agent));
  }

  /**
   * The agent has new work to check. Only a mark this browser already knew
   * of is cleared, never a newer one from another browser.
   */
  renew(agent: SeenAgent) {
    if (!this.state.identities.has(completionSeenIdentity(agent)))
      return Promise.resolve();
    return this.mutate("world.completion_seen.clear", {
      ...wireIdentity(agent),
      seen_revision: this.state.revision,
    });
  }

  private async mutate(method: string, params: Record<string, unknown>) {
    const epoch = this.epoch;
    try {
      this.accept(await this.client.call(method, params), epoch, false);
    } catch {
      // Presentation state: the next list or change notice corrects it.
      void this.refresh();
    }
  }

  private accept(value: unknown, epoch: number, resetRevision: boolean) {
    const next = parseCompletionSeen(value);
    if (
      !next ||
      epoch !== this.epoch ||
      (!resetRevision && next.revision < this.state.revision)
    )
      return;
    this.set({ ...next, verified: true });
  }

  private set(state: CompletionSeenState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
}

export const completionSeenStore = new CompletionSeenStore(bridge);

export function useCompletionSeen(store = completionSeenStore) {
  useEffect(() => store.retain(), [store]);
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
