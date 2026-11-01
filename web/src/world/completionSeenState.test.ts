import { describe, expect, test } from "bun:test";
import type { BridgeControlMsg, ConnectionStatus } from "../api";
import { handleCompletionSeenRpc } from "../../../server/src/rpc/completion-seen";
import { createTerminalMarks } from "../../../server/src/world/terminal-marks";
import {
  CompletionSeenStore,
  checkedAgentKeys,
  completionSeenIdentity,
  parseCompletionSeen,
  type CompletionSeenState,
} from "./completionSeenState";
import { nextTownFinished, withTownFinished } from "./town/townFinished";
import type { HerdrOfficeProjection } from "./herdrOfficeProjection";

/** One World service, in memory, as every browser of it reaches it. */
function service() {
  const controls = new Set<(control: BridgeControlMsg) => void>();
  const statuses = new Set<(status: ConnectionStatus) => void>();
  const start = () =>
    createTerminalMarks(
      () => (revision) => {
        for (const listener of controls)
          listener({ type: "world_completion_seen_changed", revision });
      },
      () => {},
    );
  let marks = start();
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
        worldCompletionSeen: marks.worldCompletionSeen,
        publishCompletionSeenChanged: marks.publishCompletionSeenChanged,
        connectionManager: {
          readyRuntimeLease: (id: string) =>
            id === "alpha" ? { generation: 7, isCurrent: () => true } : null,
        },
      },
    });
    return reply.promise;
  };
  /** Opens a browser and resolves once it holds the service's list. */
  const browser = async () => {
    const store = new CompletionSeenStore({
      call,
      onControl(listener) {
        controls.add(listener);
        return () => controls.delete(listener);
      },
      onStatus(listener) {
        statuses.add(listener);
        return () => statuses.delete(listener);
      },
    });
    const ready = until(store, (state) => state.verified);
    store.retain();
    await ready;
    return store;
  };
  /** A fresh host read reports this terminal's agent status. */
  const hostRead = (terminal: string, status: string) =>
    marks.observe(
      "alpha",
      7,
      [{ pane_id: `p-${terminal}`, terminal_id: terminal, agent: "codex" }],
      Date.now(),
      [
        {
          pane_id: `p-${terminal}`,
          terminal_id: terminal,
          agent_status: status,
        },
      ],
    );
  /** The projection restarts unresolved; every browser first sees an empty list. */
  const restart = () => {
    marks = start();
    for (const listener of statuses) listener("connected");
  };
  return { browser, hostRead, restart };
}

/** Resolves on the store's first state that satisfies `ready`. */
function until(
  store: CompletionSeenStore,
  ready: (state: CompletionSeenState) => boolean,
) {
  const reached = Promise.withResolvers<CompletionSeenState>();
  if (ready(store.get())) reached.resolve(store.get());
  const off = store.subscribe(() => {
    if (ready(store.get())) reached.resolve(store.get());
  });
  return reached.promise.finally(off);
}

const agent = (terminal: string, generation = 7) => ({
  key: `agent-${terminal}`,
  currentTerminalRef: {
    connectionId: "alpha",
    generation,
    kind: "terminal" as const,
    nativeId: terminal,
    worldId: `alpha:${terminal}`,
  },
});
const checked = (store: CompletionSeenStore, terminal: string) =>
  store.get().identities.has(completionSeenIdentity(agent(terminal)));

describe("completion seen on the service", () => {
  test("a mark from one browser shows in every other browser", async () => {
    const { browser } = service();
    const phone = await browser();
    const desktop = await browser();

    const seen = until(desktop, (state) => state.revision === 1);
    await phone.mark(agent("t1"));
    await seen;

    expect(checked(phone, "t1")).toBe(true);
    expect(checked(desktop, "t1")).toBe(true);
    expect([...desktop.get().terminals]).toEqual(["t1"]);
  });

  test("a late read of the checked completion keeps the check, in either order", async () => {
    const { browser, hostRead } = service();
    const phone = await browser();
    const desktop = await browser();

    // The read that shows the finish arrives after the check...
    await phone.mark(agent("t1"));
    hostRead("t1", "idle");
    // ...or before it.
    hostRead("t2", "idle");
    await phone.mark(agent("t2"));
    await until(desktop, (state) => state.revision === 2);

    for (const store of [phone, desktop]) {
      expect(checked(store, "t1")).toBe(true);
      expect(checked(store, "t2")).toBe(true);
    }
  });

  test("new work ends the check in every browser, and a check while busy is ignored", async () => {
    const { browser, hostRead } = service();
    const phone = await browser();
    const desktop = await browser();
    await phone.mark(agent("t1"));
    await until(desktop, (state) => state.revision === 1);

    const ended = until(desktop, (state) => state.revision === 2);
    hostRead("t1", "working");
    await ended;
    expect(checked(phone, "t1")).toBe(false);
    expect(checked(desktop, "t1")).toBe(false);

    // A browser still showing the old finish cannot check the new work.
    await desktop.mark(agent("t1"));
    expect(checked(desktop, "t1")).toBe(false);
    hostRead("t1", "blocked");
    hostRead("t1", "idle");
    await desktop.mark(agent("t1"));
    expect(checked(desktop, "t1")).toBe(true);
  });

  test("reconnect accepts an empty revision-zero unresolved service projection", async () => {
    const { browser, restart } = service();
    const phone = await browser();
    const desktop = await browser();
    await phone.mark(agent("t1"));
    await phone.mark(agent("t2"));
    await until(desktop, (state) => state.revision === 2);

    const phoneEmpty = until(phone, (state) => state.revision === 0);
    const desktopEmpty = until(desktop, (state) => state.revision === 0);
    restart();
    // The restarted service's revision starts again at 0.
    for (const state of await Promise.all([phoneEmpty, desktopEmpty])) {
      expect(state.identities.size).toBe(0);
      expect(state.verified).toBe(true);
    }
  });

  test("marks belong to the current runtime generation", async () => {
    const { browser } = service();
    const phone = await browser();

    await phone.mark(agent("t1", 6));

    expect(phone.get().identities.size).toBe(0);
  });

  test("Town on two devices agrees on an inferred finish checked on one", async () => {
    const { browser, restart } = service();
    const devices = await Promise.all([browser(), browser()]);
    const [phone, desktop] = devices;
    // Both saw the agent go from working to idle, so both infer a finish.
    const town = devices.map(
      () =>
        nextTownFinished(
          new Map([["agent-t1", "working"]]),
          [{ key: "agent-t1", semanticStatus: "idle" as const }],
          new Set<string>(),
        ).finished,
    );
    const shown = () =>
      devices.map((store, index) =>
        presented(town[index]!, checkedAgentKeys(store.get(), office.roster)),
      );
    expect(shown()).toEqual(["done", "done"]);

    const seen = until(desktop!, (state) => state.revision === 1);
    await phone!.mark(agent("t1"));
    await seen;
    expect(shown()).toEqual(["idle", "idle"]);

    // After a restart the finish is unchecked again on both.
    const emptied = devices.map((store) =>
      until(store, (state) => state.revision === 0),
    );
    restart();
    await Promise.all(emptied);
    expect(shown()).toEqual(["done", "done"]);
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

const office = {
  rooms: [],
  receptions: [],
  barAgents: [],
  roster: [{ agent: { ...agent("t1"), semanticStatus: "idle" } }],
} as unknown as HerdrOfficeProjection;

/** How Town presents the agent for these finishes and checks. */
function presented(finished: ReadonlySet<string>, checks: ReadonlySet<string>) {
  return withTownFinished(office, finished, checks).roster[0]!.agent
    .semanticStatus;
}
