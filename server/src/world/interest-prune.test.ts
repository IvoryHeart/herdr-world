import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { interestKey } from "../../../shared/interest";
import {
  ConnectionManager,
  type ConnectionRuntime,
} from "../connections/manager";
import { BoardStore } from "./board-store";
import {
  closesTerminals,
  pruneGoneInterest,
  reconcileReadyInterest,
} from "./interest-prune";

let root: string;
let path: string;
beforeEach(() => {
  root = join(tmpdir(), `interest-${crypto.randomUUID()}`);
  mkdirSync(join(root, "boards"), { recursive: true });
  path = join(root, "boards", "board.json");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const muted = interestKey("conn-a", "term_1");
const focused = interestKey("conn-a", "term_2");
const elsewhere = interestKey("conn-b", "term_1");

function seeded() {
  const store = new BoardStore(path);
  store.patch([
    { op: "interest.set", key: muted, interest: "muted" },
    { op: "interest.set", key: focused, interest: "focused" },
    { op: "interest.set", key: elsewhere, interest: "muted" },
  ]);
  return store;
}

const host = (
  listing: unknown,
  options: { current?: () => boolean; fail?: boolean } = {},
) => {
  const revisions: number[] = [];
  return {
    revisions,
    call: async () => {
      if (options.fail) throw new Error("host unreachable");
      return listing;
    },
    isCurrent: options.current ?? (() => true),
    changed: (revision: number) => revisions.push(revision),
  };
};

describe("agent interest", () => {
  test("is set, cleared to watching and persisted per terminal", () => {
    const store = seeded();
    store.patch([{ op: "interest.set", key: focused, interest: null }]);
    expect(new BoardStore(path).get().layout.interest).toEqual({
      [muted]: "muted",
      [elsewhere]: "muted",
    });
    expect(() =>
      store.patch([
        { op: "interest.set", key: muted, interest: "loud" as "muted" },
      ]),
    ).toThrow("interest");
  });

  test("a board saved before interest loads with every agent watched", () => {
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        revision: 3,
        layout: { anchors: {}, offsets: {}, pinned: {}, folded: [] },
        notes: [],
        strings: [],
      }),
    );
    expect(new BoardStore(path).get().layout.interest).toEqual({});
  });

  test("a fresh listing from the live host drops only that host's gone terminals", async () => {
    const store = seeded();
    const live = host({ panes: [{ pane_id: "w1:p2", terminal_id: "term_2" }] });
    await pruneGoneInterest(store, "conn-a", live);
    expect(store.get().layout.interest).toEqual({
      [focused]: "focused",
      [elsewhere]: "muted",
    });
    expect(live.revisions).toEqual([store.get().revision]);
    expect(JSON.parse(readFileSync(path, "utf8")).layout.interest).toEqual(
      store.get().layout.interest,
    );
  });

  test("a failed, stale or incomplete listing keeps every record", async () => {
    const store = seeded();
    const before = store.get();
    const gone = { panes: [] };
    for (const attempt of [
      host(gone, { fail: true }),
      host(gone, { current: () => false }),
      host({ panes: [{ pane_id: "w1:p2" }] }),
      host({ error: "unsupported" }),
    ]) {
      await pruneGoneInterest(store, "conn-a", attempt);
      expect(attempt.revisions).toEqual([]);
    }
    expect(store.get()).toEqual(before);
  });

  test("a host with no records is not asked", async () => {
    const store = new BoardStore(path);
    let asked = false;
    await pruneGoneInterest(store, "conn-a", {
      ...host({ panes: [] }),
      call: async () => {
        asked = true;
        return { panes: [] };
      },
    });
    expect(asked).toBe(false);
  });

  test("a listing cannot prune interest added or edited after it began", async () => {
    for (const ops of [
      [
        {
          op: "interest.set" as const,
          key: interestKey("conn-a", "term_new"),
          interest: "focused" as const,
        },
      ],
      [
        {
          op: "interest.set" as const,
          key: muted,
          interest: "focused" as const,
        },
      ],
      [
        { op: "interest.set" as const, key: muted, interest: null },
        { op: "interest.set" as const, key: muted, interest: "muted" as const },
      ],
    ]) {
      const store = seeded();
      const reply = Promise.withResolvers<unknown>();
      const fresh = Promise.withResolvers<unknown>();
      const retried = Promise.withResolvers<void>();
      let calls = 0;
      const live = {
        ...host(null),
        call: () => {
          if (++calls === 1) return reply.promise;
          retried.resolve();
          return fresh.promise;
        },
      };
      const pruning = pruneGoneInterest(store, "conn-a", live);
      store.patch(ops);
      const edited = store.get();
      reply.resolve({ panes: [{ terminal_id: "term_2" }] });
      await retried.promise;
      expect(store.get()).toEqual(edited);
      fresh.resolve({
        panes: ["term_1", "term_2", "term_new"].map((terminal_id) => ({
          terminal_id,
        })),
      });
      await pruning;
      expect(store.get()).toEqual(edited);
      expect(calls).toBe(2);
      expect(live.revisions).toEqual([]);
    }
  });

  test("startup and reconnect reconcile a close missed while disconnected", async () => {
    const store = seeded();
    let terminals = ["term_2"];
    let listings = 0;
    let reconciliation = Promise.resolve();
    type Runtime = ConnectionRuntime & { herdr: { call(): Promise<unknown> } };
    const manager = new ConnectionManager<Runtime>("conn-a", (status) => {
      if (status.state === "ready")
        reconciliation = reconcileReadyInterest(
          store,
          manager.readyRuntimeLease(status.id),
          () => {},
        );
    });
    const identity = {
      id: "conn-a",
      label: "Example",
      source: "test" as const,
    };
    manager.register({
      identity,
      createRuntime: () => ({
        identity,
        startTransport: async () => {},
        startBackground: () => {},
        stop: async () => {},
        herdr: {
          call: async () => {
            listings += 1;
            return { panes: terminals.map((terminal_id) => ({ terminal_id })) };
          },
        },
      }),
    });
    try {
      await manager.start("conn-a");
      await reconciliation;
      expect(store.get().layout.interest).toEqual({
        [focused]: "focused",
        [elsewhere]: "muted",
      });
      await manager.stop("conn-a");
      terminals = [];
      expect(store.get().layout.interest[focused]).toBe("focused");
      await manager.start("conn-a");
      await reconciliation;
      expect(store.get().layout.interest).toEqual({ [elsewhere]: "muted" });
      expect(listings).toBe(2);
    } finally {
      await manager.stopAll();
    }
  });

  test("reconnect retries after a concurrent edit on another host", async () => {
    const store = seeded();
    const older = Promise.withResolvers<unknown>();
    let calls = 0;
    const reconciliation = reconcileReadyInterest(
      store,
      {
        connectionId: "conn-a",
        isCurrent: () => true,
        runtime: {
          herdr: {
            call: async () => {
              calls += 1;
              return calls === 1 ? older.promise : { panes: [] };
            },
          },
        },
      },
      () => {},
    );
    const newer = interestKey("conn-b", "term_live");
    store.patch([{ op: "interest.set", key: newer, interest: "muted" }]);
    older.resolve({ panes: [] });
    await reconciliation;
    expect(calls).toBe(2);
    expect(store.get().layout.interest).toEqual({
      [elsewhere]: "muted",
      [newer]: "muted",
    });
    expect(Object.values(store.get().layout.interest)).not.toContain("focused");
  });

  test("closing a pane, tab or workspace triggers a check; other events do not", () => {
    expect(closesTerminals("pane_closed")).toBe(true);
    expect(closesTerminals("tab.closed")).toBe(true);
    expect(closesTerminals("workspace_closed")).toBe(true);
    expect(closesTerminals("pane_agent_status_changed")).toBe(false);
    expect(closesTerminals(null)).toBe(false);
  });
});
