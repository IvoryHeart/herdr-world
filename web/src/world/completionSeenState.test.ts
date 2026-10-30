import { describe, expect, test } from "bun:test";
import type { BridgeControlMsg, ConnectionStatus } from "../api";
import { handleCompletionSeenRpc } from "../../../server/src/rpc/completion-seen";
import { WorldCompletionSeenRegistry } from "../../../server/src/world/completion-seen";
import {
  CompletionSeenStore,
  completionSeenIdentity,
  parseCompletionSeen,
} from "./completionSeenState";

/** One World service, in memory, as every browser of it reaches it. */
function service() {
  const world = {
    registry: new WorldCompletionSeenRegistry(),
    controls: new Set<(control: BridgeControlMsg) => void>(),
    statuses: new Set<(status: ConnectionStatus) => void>(),
    generation: 7,
    /** Notices held back, as for a browser on a slow link. */
    held: null as BridgeControlMsg[] | null,
  };
  const call = async (method: string, params?: Record<string, unknown>) => {
    const reply = Promise.withResolvers<unknown>();
    await handleCompletionSeenRpc({
      id: "1",
      method,
      params,
      sendReply: ({ result }: { result?: unknown }) => {
        reply.resolve(result);
        return true;
      },
      sendError: (_kind: string, error: unknown) => reply.reject(error),
      services: {
        worldCompletionSeen: world.registry,
        publishCompletionSeenChanged: (revision: number) => {
          const control = {
            type: "world_completion_seen_changed" as const,
            revision,
          };
          if (world.held) world.held.push(control);
          else for (const listener of world.controls) listener(control);
        },
        connectionManager: {
          readyRuntimeLease: (id: string) =>
            id === "alpha"
              ? { generation: world.generation, isCurrent: () => true }
              : null,
        },
      },
    });
    return reply.promise;
  };
  const browser = () => {
    const store = new CompletionSeenStore({
      call,
      onControl(listener) {
        world.controls.add(listener);
        return () => world.controls.delete(listener);
      },
      onStatus(listener) {
        world.statuses.add(listener);
        return () => world.statuses.delete(listener);
      },
    });
    store.retain();
    return store;
  };
  /** The service restarts; every browser reconnects to an empty one. */
  const restart = () => {
    world.registry = new WorldCompletionSeenRegistry();
    for (const listener of world.statuses) listener("connected");
  };
  return { world, browser, restart };
}

const agent = (terminal: string, generation = 7) => ({
  currentTerminalRef: {
    connectionId: "alpha",
    generation,
    kind: "terminal" as const,
    nativeId: terminal,
    worldId: `alpha:${terminal}`,
  },
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("completion seen on the service", () => {
  test("a mark from one browser shows in every other browser", async () => {
    const { browser } = service();
    const phone = browser();
    const desktop = browser();
    await settle();

    await phone.mark(agent("t1"));
    await settle();

    const id = completionSeenIdentity(agent("t1"));
    expect(phone.get().identities.has(id)).toBe(true);
    expect(desktop.get().identities.has(id)).toBe(true);
    expect([...desktop.get().terminals]).toEqual(["t1"]);
    expect(desktop.get().revision).toBe(phone.get().revision);
  });

  test("a browser that saw new work late cannot erase a newer mark", async () => {
    const { world, browser } = service();
    const phone = browser();
    const desktop = browser();
    await settle();
    await phone.mark(agent("t1"));
    await settle();

    // The agent worked and finished again. The phone clears its old mark and
    // the person checks the new completion there, while the desktop has not
    // heard of either change yet.
    world.held = [];
    await phone.renew(agent("t1"));
    await phone.mark(agent("t1"));
    await desktop.renew(agent("t1"));
    const held = world.held;
    world.held = null;
    for (const control of held)
      for (const listener of world.controls) listener(control);
    await settle();

    const id = completionSeenIdentity(agent("t1"));
    expect(phone.get().identities.has(id)).toBe(true);
    expect(desktop.get().identities.has(id)).toBe(true);
    expect(desktop.get().revision).toBe(phone.get().revision);
  });

  test("renewing clears the mark in every browser", async () => {
    const { browser } = service();
    const phone = browser();
    const desktop = browser();
    await settle();
    await phone.mark(agent("t1"));
    await settle();

    await desktop.renew(agent("t1"));
    await settle();

    expect(phone.get().identities.size).toBe(0);
    expect(desktop.get().identities.size).toBe(0);
  });

  test("a service restart forgets every mark, as documented", async () => {
    const { browser, restart } = service();
    const phone = browser();
    const desktop = browser();
    await settle();
    await phone.mark(agent("t1"));
    await phone.mark(agent("t2"));
    await settle();
    expect(desktop.get().revision).toBe(2);

    restart();
    await settle();

    // The restarted service's revision starts again at 0.
    for (const store of [phone, desktop]) {
      expect(store.get().identities.size).toBe(0);
      expect(store.get().revision).toBe(0);
      expect(store.get().verified).toBe(true);
    }
  });

  test("marks belong to the current runtime generation", async () => {
    const { browser } = service();
    const phone = browser();
    await settle();

    await phone.mark(agent("t1", 6));
    await settle();

    expect(phone.get().identities.size).toBe(0);
  });

  test("lists drop malformed records", () => {
    expect(
      parseCompletionSeen({
        revision: 3,
        records: [
          {
            connection_id: "alpha",
            connection_generation: 7,
            terminal_id: "t1",
          },
          { connection_id: "", connection_generation: 7, terminal_id: "t2" },
          {
            connection_id: "alpha",
            connection_generation: "7",
            terminal_id: "t3",
          },
          null,
        ],
      }),
    ).toEqual({
      revision: 3,
      identities: new Set(['["alpha",7,"t1"]']),
      terminals: new Set(["t1"]),
    });
    expect(parseCompletionSeen({ revision: -1, records: [] })).toBeNull();
  });
});
