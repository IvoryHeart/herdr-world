import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorldLedger } from "../storage/world-storage";
import { systemClock, systemScheduler } from "../service/ports";
import { PersistentTerminalMarks } from "./persistent-terminal-marks";
import { WorldDeskRegistry } from "./desk-state";
import { WorldWatchlistRegistry } from "./watchlist";
import { WorldCompletionSeenRegistry } from "./completion-seen";
import { deskSessionFingerprint } from "./desk-observation";
import { handleDeskRpc } from "../rpc/desk";
import { handleCompletionSeenRpc } from "../rpc/completion-seen";
import { handleWorldRpc } from "../rpc/world";
import { WorldDeskStore } from "../../../web/src/world/deskStateStore";
import { WorldWatchlistStore } from "../../../web/src/world/watchlistStore";
import { CompletionSeenStore } from "../../../web/src/world/completionSeenState";
import type { BridgeControlMsg } from "../../../web/src/api";

const roots: string[] = [],
  closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const session = (value = "session-a") => ({
  source: "herdr:codex",
  agent: "codex",
  kind: "id",
  value,
});
const pane = (value = "session-a") => ({
  pane_id: "pane-a",
  terminal_id: "terminal-a",
  agent: "codex",
  agent_session: session(value),
  agent_status: "idle",
  state_change_seq: 4,
});
async function fixture(root?: string, generation = 1) {
  if (!root) {
    root = mkdtempSync(join(tmpdir(), "persistent-marks-"));
    roots.push(root);
  }
  const store = await openWorldLedger(
    { database: join(root, "world.sqlite"), ledger: join(root, "ledger.json") },
    { clock: systemClock, scheduler: systemScheduler },
  );
  const registries = {
    desk: new WorldDeskRegistry(),
    watchlist: new WorldWatchlistRegistry(),
    seen: new WorldCompletionSeenRegistry(),
  };
  let panes: Record<string, unknown>[] = [pane()],
    current = true,
    time = 1000;
  const controls = new Set<(control: BridgeControlMsg) => void>();
  const notices: string[] = [];
  const noticeRevisions: {
    type: string;
    revision: number;
    connectionId?: string;
    generation?: number;
  }[] = [];
  const hosts = new Map<
    string,
    { generation: number; current: boolean; panes: Record<string, unknown>[] }
  >();
  let held:
    | {
        entered: ReturnType<typeof Promise.withResolvers<void>>;
        release: ReturnType<typeof Promise.withResolvers<void>>;
      }
    | undefined;
  const lease = (connectionId = "alpha") => {
    const host = hosts.get(connectionId),
      capturedGeneration = host?.generation ?? generation;
    return {
      generation: capturedGeneration,
      isCurrent: () =>
        host ? host.current && host.generation === capturedGeneration : current,
      runtime: {
        herdr: {
          call: async () => {
            const captured = structuredClone(host?.panes ?? panes),
              pending = held;
            held = undefined;
            if (pending) {
              pending.entered.resolve();
              await pending.release.promise;
            }
            return { panes: captured };
          },
        },
      },
    };
  };
  const marks = new PersistentTerminalMarks({
    storage: store.terminalMarks,
    incarnation: "synthetic-incarnation",
    registries,
    lease,
    now: () => ++time,
    failed: (error) => {
      throw error;
    },
    changed(kind, revision, connectionId, generation) {
      const type =
        kind === "desk"
          ? "world_desk_changed"
          : kind === "watchlist"
            ? "world_watchlist_changed"
            : "world_completion_seen_changed";
      notices.push(type);
      noticeRevisions.push({ type, revision, connectionId, generation });
      for (const listener of controls) listener({ type, revision });
    },
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await marks.close();
    await store.close();
  };
  closers.push(close);
  const identity = {
    connection_id: "alpha",
    connection_generation: generation,
    terminal_id: "terminal-a",
  };
  const deskIdentity = {
    ...identity,
    agent_session_fingerprint: deskSessionFingerprint(session()),
  };
  const observe = () => marks.observe("alpha", generation, panes, ++time);
  const services = {
    persistentMarks: marks,
    worldDesk: registries.desk,
    worldWatchlist: registries.watchlist,
    worldCompletionSeen: registries.seen,
    publishDeskChanged() {},
    publishWatchlistChanged() {},
    publishCompletionSeenChanged() {},
    connectionManager: { readyRuntimeLease: lease },
  };
  const call = async (method: string, params?: Record<string, unknown>) => {
    let value: unknown, failure: unknown;
    const rpc = {
      id: "synthetic-request",
      method,
      params,
      services,
      sendReply: ({ result }: { result?: unknown }) => {
        value = result;
        return true;
      },
      sendError: (_context: string, error: unknown) => {
        failure = error;
      },
    };
    if (method.startsWith("world.desk.")) await handleDeskRpc(rpc as any);
    else if (method.startsWith("world.completion_seen."))
      await handleCompletionSeenRpc(rpc);
    else await handleWorldRpc(rpc as any);
    if (failure) throw failure;
    return value;
  };
  const client = {
    call,
    onControl(listener: (control: BridgeControlMsg) => void) {
      controls.add(listener);
      return () => {
        controls.delete(listener);
      };
    },
    onStatus() {
      return () => {};
    },
  };
  const seed = () =>
    marks.mutate(identity, (draft) => {
      draft.desk.mark(deskIdentity, "stop-a", true, ++time);
      draft.desk.open(deskIdentity, ++time);
      draft.watchlist.pin({ ...identity, label: "Synthetic watch" });
      draft.seen.mark(identity);
    });
  return {
    root,
    store,
    marks,
    registries,
    identity,
    deskIdentity,
    seed,
    observe,
    close,
    client,
    notices,
    noticeRevisions,
    hosts,
    setCurrent(value: boolean) {
      current = value;
    },
    observeHost(connectionId: string) {
      const host = hosts.get(connectionId)!;
      return marks.observe(connectionId, host.generation, host.panes, ++time);
    },
    seedHost(connectionId: string) {
      const host = hosts.get(connectionId)!,
        owner = {
          ...identity,
          connection_id: connectionId,
          connection_generation: host.generation,
        };
      const agent = {
        ...owner,
        agent_session_fingerprint: deskSessionFingerprint(
          host.panes[0]!.agent_session,
        ),
      };
      return marks.mutate(agent, (draft) => {
        draft.desk.mark(agent, "stop-a", true, ++time);
        draft.desk.open(agent, ++time);
        draft.watchlist.pin({ ...owner, label: "Synthetic watch" });
        draft.seen.mark(owner);
      });
    },
    advance(ms: number) {
      time += ms;
    },
    holdRead() {
      const pending = {
        entered: Promise.withResolvers<void>(),
        release: Promise.withResolvers<void>(),
      };
      held = pending;
      return pending;
    },
    setPanes: (value: Record<string, unknown>[]) => {
      panes = value;
    },
    retire: () => {
      current = false;
      marks.retire("alpha", generation + 1);
    },
  };
}
test("all three records survive SQLite reopening unresolved, then attach to the same evidence in a new generation", async () => {
  const first = await fixture();
  await first.seed();
  const rows = first.store.terminalMarks.list();
  expect(rows).toHaveLength(3);
  await first.close();
  const second = await fixture(first.root, 7);
  expect(second.registries.desk.list().records).toEqual([]);
  expect(second.registries.watchlist.list().records).toEqual([]);
  expect(second.registries.seen.list().records).toEqual([]);
  await second.observe();
  expect(
    second.store.terminalMarks
      .list()
      .map((row) => row.id)
      .sort(),
  ).toEqual(rows.map((row) => row.id).sort());
  expect(second.registries.desk.list().records[0]).toMatchObject({
    reviewed_stop: "stop-a",
    connection_generation: 7,
  });
  expect(second.registries.desk.list().records[0]!.opened_at).not.toBeNull();
  expect(
    second.registries.watchlist.list().records[0]!.connection_generation,
  ).toBe(7);
  expect(second.registries.seen.list().records[0]!.connection_generation).toBe(
    7,
  );
});
for (const duplicate of ["pane", "terminal", "session"] as const)
  test(`ambiguous ${duplicate} never attaches or deletes a saved record`, async () => {
    const f = await fixture();
    await f.seed();
    f.setPanes([
      pane(),
      {
        ...pane(),
        pane_id: duplicate === "pane" ? "pane-a" : "pane-b",
        terminal_id: duplicate === "terminal" ? "terminal-a" : "terminal-b",
        agent_session:
          duplicate === "session" ? session() : session("session-b"),
      },
    ]);
    await f.observe();
    expect(f.registries.watchlist.list().records).toEqual([]);
    expect(f.registries.desk.list().records).toEqual([]);
    expect(f.registries.seen.list().records).toEqual([]);
    expect(f.store.terminalMarks.list()).toHaveLength(3);
    await expect(f.seed()).rejects.toThrow("ambiguous");
    f.setPanes([pane()]);
    await f.observe();
    expect(f.registries.watchlist.list().records).toHaveLength(1);
    expect(f.registries.desk.list().records[0]!.reviewed_stop).toBe("stop-a");
  });
test("complete absence and reused native pane clear records; labels never attach", async () => {
  const f = await fixture();
  await f.seed();
  f.setPanes([{ ...pane(), terminal_id: "replacement-terminal" }]);
  await f.observe();
  expect(f.store.terminalMarks.list()).toEqual([]);
  expect(f.registries.desk.list().records).toEqual([]);
  await f.close();
  const again = await fixture(f.root);
  await again.observe();
  expect(again.store.terminalMarks.list()).toEqual([]);
});
test("a positive session replacement ends Desk and seen, while a watch follows its terminal move", async () => {
  const f = await fixture();
  await f.seed();
  const watch = f.store.terminalMarks
    .list()
    .find((row) => row.kind === "watchlist")!;
  f.setPanes([{ ...pane("session-b"), pane_id: "moved-pane" }]);
  await f.observe();
  expect(f.registries.desk.list().records).toEqual([]);
  expect(f.registries.seen.list().records).toEqual([]);
  expect(f.registries.watchlist.list().records).toHaveLength(1);
  expect(f.store.terminalMarks.list()).toMatchObject([
    { id: watch.id, binding: { native_id: "moved-pane" } },
  ]);
});
test("fresh busy evidence or later completion sequence ends seen, including work missed during a restart", async () => {
  const f = await fixture();
  await f.seed();
  f.setPanes([{ ...pane(), agent_status: "working", state_change_seq: 5 }]);
  await f.observe();
  expect(f.registries.seen.list().records).toEqual([]);
  await f.marks.mutate(f.identity, (draft) => {
    draft.seen.mark(f.identity);
  });
  expect(f.registries.seen.list().records).toEqual([]);
  f.setPanes([pane()]);
  await f.seed();
  await f.close();
  const again = await fixture(f.root, 2);
  again.setPanes([{ ...pane(), state_change_seq: 8 }]);
  await again.observe();
  expect(again.registries.seen.list().records).toEqual([]);
  expect(
    again.registries.desk.list().records[0]!.observed_stop_id,
  ).not.toBeNull();
});
test("two browser clients share real RPC changes and exact Undo over SQLite", async () => {
  const f = await fixture();
  const desks = [new WorldDeskStore(f.client), new WorldDeskStore(f.client)];
  const watches = [
    new WorldWatchlistStore(f.client),
    new WorldWatchlistStore(f.client),
  ];
  const seen = [
    new CompletionSeenStore(f.client),
    new CompletionSeenStore(f.client),
  ];
  for (const store of desks) store.start();
  for (const store of watches) store.start();
  const releases = seen.map((store) => store.retain());
  await Promise.all(desks.map((store) => store.refresh()));
  try {
    await f.seed();
    await Promise.all(desks.map((store) => store.refresh()));
    // Refreshes caused by the synchronous notices finish before the RPC barrier.
    await f.client.call("world.desk.get");
    for (const store of desks)
      expect(store.get().records[0]!.reviewed_stop).toBe("stop-a");
    for (const store of watches) expect(store.get().records).toHaveLength(1);
    for (const store of seen)
      expect(store.get().terminals.has("terminal-a")).toBe(true);
    await desks[0]!.mutate("world.desk.review", f.deskIdentity, {
      stop_id: "stop-b",
      reviewed: true,
    });
    await desks[1]!.mutate("world.desk.review", f.deskIdentity, {
      stop_id: "stop-a",
      reviewed: false,
    });
    await Promise.all(desks.map((store) => store.refresh()));
    for (const store of desks)
      expect(store.get().records[0]!.reviewed_stop).toBe("stop-b");
    await f.client.call("world.watchlist.unpin", f.identity);
    await f.client.call("world.desk.get");
    for (const store of watches) expect(store.get().records).toEqual([]);
    f.setPanes([{ ...pane(), agent_status: "working", state_change_seq: 5 }]);
    await f.observe();
    await f.client.call("world.desk.get");
    for (const store of seen) expect(store.get().terminals.size).toBe(0);
  } finally {
    for (const store of desks) store.stop();
    for (const store of watches) store.stop();
    for (const release of releases) release();
  }
});
test("retirement hides saved records without deleting their continuity evidence", async () => {
  const f = await fixture();
  await f.seed();
  f.retire();
  expect(f.registries.watchlist.list().records).toEqual([]);
  expect(f.store.terminalMarks.list()).toHaveLength(3);
  await expect(f.seed()).rejects.toThrow("unavailable");
});

test("a storage acknowledgement arriving after retirement never publishes its old projection", async () => {
  const f = await fixture(),
    entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const put = f.store.terminalMarks.put;
  f.store.terminalMarks.put = async (input) => {
    const row = await put(input);
    entered.resolve();
    await release.promise;
    return row;
  };
  const pending = f.marks.mutate(f.identity, (draft) => {
    draft.desk.mark(f.deskIdentity, "stop-a", true, 1000);
  });
  await entered.promise;
  expect(f.registries.desk.list().records).toEqual([]);
  expect(f.notices).toEqual([]);
  f.retire();
  release.resolve();
  await expect(pending).rejects.toThrow("retired");
  expect(f.registries.desk.list().records).toEqual([]);
  expect(f.registries.watchlist.list().records).toEqual([]);
  expect(f.notices).toEqual([]);
  expect(f.store.terminalMarks.list()).toHaveLength(1);
});
test("a refused write publishes nothing and cannot poison the next admitted mutation", async () => {
  const f = await fixture(),
    put = f.store.terminalMarks.put;
  f.store.terminalMarks.put = async () => {
    throw new Error("synthetic storage refusal");
  };
  await expect(f.seed()).rejects.toThrow("synthetic storage refusal");
  expect(f.notices).toEqual([]);
  expect(f.store.terminalMarks.list()).toEqual([]);
  expect(f.registries.desk.list().records).toEqual([]);
  f.store.terminalMarks.put = put;
  await f.seed();
  expect(f.store.terminalMarks.list()).toHaveLength(3);
});
test("a lower native sequence cannot erase a newer checked completion", async () => {
  const f = await fixture();
  await f.seed();
  f.setPanes([{ ...pane(), agent_status: "working", state_change_seq: 2 }]);
  await f.observe();
  expect(f.registries.seen.list().records).toHaveLength(1);
  expect(
    f.store.terminalMarks.list().find((row) => row.kind === "completion-seen")
      ?.body.stateChangeSeq,
  ).toBe(4);
});
test("unknown session evidence binds to the terminal and unchanged fresh lists do no writes", async () => {
  const f = await fixture();
  f.setPanes([{ ...pane(), agent_session: null }]);
  await f.marks.mutate(f.identity, (draft) => {
    draft.desk.mark(
      { ...f.identity, agent_session_fingerprint: null },
      "unknown-stop",
      true,
      1000,
    );
    draft.seen.mark(f.identity);
  });
  const before = f.store.terminalMarks.list();
  expect(
    before.every((row) => row.binding.evidence.session === undefined),
  ).toBe(true);
  await f.observe();
  expect(f.store.terminalMarks.list()).toEqual(before);
});

test("the 40 recent-open bound is durable across sources, including equal-time actions", async () => {
  const f = await fixture();
  for (let index = 0; index < 41; index++) {
    const identity = { ...f.deskIdentity, connection_id: `source-${index}` };
    await f.marks.mutate(identity, (draft) => {
      draft.desk.open(identity, 1000);
    });
  }
  expect(f.registries.desk.list().records).toHaveLength(40);
  expect(f.store.terminalMarks.list()).toHaveLength(40);
  expect(
    f.store.terminalMarks
      .list()
      .some((row) => row.binding.instance === "source-0"),
  ).toBe(false);
  expect(
    f.store.terminalMarks
      .list()
      .some((row) => row.binding.instance === "source-40"),
  ).toBe(true);
  await f.close();
  const again = await fixture(f.root, 2);
  expect(
    again.store.terminalMarks
      .list()
      .filter((row) => row.body.opened_at !== null),
  ).toHaveLength(40);
});

for (const replacement of [false, true])
  test(`native admission ${replacement ? "refuses a replaced then restored session" : "accepts same-session observations"}`, async () => {
    const f = await fixture();
    await f.seed();
    const held = f.holdRead();
    const pending = f.marks.mutate(f.deskIdentity, (draft) => {
      draft.desk.mark(f.deskIdentity, "late-stop", true, 2000);
    });
    await held.entered.promise;
    if (replacement) f.setPanes([pane("session-b")]);
    const first = f.observe();
    f.setPanes([pane()]);
    const second = f.observe();
    held.release.resolve();
    const outcome = await pending.then(
      () => "accepted",
      () => "refused",
    );
    await Promise.all([first, second]);
    expect(outcome).toBe(replacement ? "refused" : "accepted");
    expect(
      f.registries.desk
        .list()
        .records.some((record) => record.reviewed_stop === "late-stop"),
    ).toBe(!replacement);
  });

test("Desk display expiry commits without a new source read and retains the review stop across restart", async () => {
  const f = await fixture();
  await f.seed();
  f.setPanes([{ ...pane(), agent_status: "working", state_change_seq: 5 }]);
  await f.observe();
  f.setPanes([{ ...pane(), state_change_seq: 6 }]);
  await f.observe();
  const stop = f.registries.desk.list().records[0]!.observed_stop_id;
  expect(stop).not.toBeNull();
  f.advance(13 * 60 * 60_000);
  await f.client.call("world.desk.get");
  expect(f.registries.desk.list().records[0]).toMatchObject({
    reviewed_stop: "stop-a",
    stopped_at: null,
    observed_stop_id: stop,
  });
  await f.close();
  const again = await fixture(f.root);
  expect(
    again.store.terminalMarks.list().find((row) => row.kind === "desk")!.body,
  ).toMatchObject({
    reviewed_stop: "stop-a",
    stopped_at: null,
    observed_stop_id: stop,
  });
});
test("Unpin cannot restore another watch when its storage reply crosses a disconnect", async () => {
  const f = await fixture(),
    other = { ...f.identity, terminal_id: "terminal-b" };
  f.setPanes([
    pane(),
    { ...pane("session-b"), pane_id: "pane-b", terminal_id: "terminal-b" },
  ]);
  await f.seed();
  await f.marks.mutate(other, (draft) => {
    draft.watchlist.pin({ ...other, label: "Other watch" });
  });
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>(),
    remove = f.store.terminalMarks.remove;
  f.store.terminalMarks.remove = async (id, revision) => {
    await remove(id, revision);
    entered.resolve();
    await release.promise;
  };
  const pending = f.marks.unpin(f.identity);
  await entered.promise;
  f.marks.retire("alpha", 1, false);
  release.resolve();
  await pending;
  expect(f.registries.watchlist.list().records).toEqual([]);
  expect(
    f.store.terminalMarks.list().filter((row) => row.kind === "watchlist"),
  ).toHaveLength(1);
});
test("display expiry cannot restore its old projection after a disconnect", async () => {
  const f = await fixture();
  await f.seed();
  f.setPanes([{ ...pane(), agent_status: "working", state_change_seq: 5 }]);
  await f.observe();
  f.setPanes([{ ...pane(), state_change_seq: 6 }]);
  await f.observe();
  f.advance(13 * 60 * 60_000);
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>(),
    expire = f.store.terminalMarks.expire;
  f.store.terminalMarks.expire = async (at) => {
    await expire(at);
    entered.resolve();
    await release.promise;
  };
  const pending = f.marks.expire();
  await entered.promise;
  f.marks.retire("alpha", 1, false);
  release.resolve();
  await pending;
  expect(f.registries.desk.list().records).toEqual([]);
});
test("a background write admitted before a disconnect waits for a new verification", async () => {
  const f = await fixture();
  await f.seed();
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>(),
    put = f.store.terminalMarks.put;
  f.store.terminalMarks.put = async (input) => {
    const row = await put(input);
    entered.resolve();
    await release.promise;
    return row;
  };
  f.setPanes([{ ...pane(), state_change_seq: 6 }]);
  const observing = f.observe();
  await entered.promise;
  f.marks.retire("alpha", 1, false);
  f.marks.retire("alpha", 1, true);
  release.resolve();
  await observing;
  expect(f.registries.desk.list().records).toEqual([]);
  f.store.terminalMarks.put = put;
  await f.observe();
  expect(f.registries.desk.list().records[0]!.reviewed_stop).toBe("stop-a");
});

for (const replacement of [false, true])
  test(`publication preserves another connection's ${replacement ? "replacement" : "disconnect"} and monotonic notices`, async () => {
    const f = await fixture();
    const beta = {
      generation: 1,
      current: true,
      panes: [pane()] as Record<string, unknown>[],
    };
    f.hosts.set("beta", beta);
    await f.seedHost("beta");
    await f.seed();
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>(),
      put = f.store.terminalMarks.put;
    f.store.terminalMarks.put = async (input) => {
      const row = await put(input);
      entered.resolve();
      await release.promise;
      return row;
    };
    const pending = f.marks.mutate(f.deskIdentity, (draft) => {
      draft.desk.mark(f.deskIdentity, "next-alpha-stop", true, 2000);
    });
    await entered.promise;
    if (replacement) {
      beta.generation = 2;
      beta.panes = [pane("session-b")];
    } else beta.current = false;
    f.marks.retire("beta", beta.generation, replacement);
    release.resolve();
    await pending;
    for (const registry of [
      f.registries.desk,
      f.registries.watchlist,
      f.registries.seen,
    ])
      expect(
        registry
          .list()
          .records.some((record) => record.connection_id === "beta"),
      ).toBe(false);
    expect(
      f.store.terminalMarks
        .list()
        .filter((row) => row.binding.instance === "beta"),
    ).toHaveLength(3);
    for (const type of new Set(f.notices)) {
      const revisions = f.noticeRevisions
        .filter((notice) => notice.type === type)
        .map((notice) => notice.revision);
      expect(
        revisions.every(
          (revision, index) => index === 0 || revision > revisions[index - 1]!,
        ),
      ).toBe(true);
    }
  });
test("global open trimming does not reattach a connection retired during another source's commit", async () => {
  const f = await fixture(),
    beta = {
      generation: 1,
      current: true,
      panes: [pane()] as Record<string, unknown>[],
    };
  f.hosts.set("beta", beta);
  await f.seedHost("beta");
  for (let index = 0; index < 39; index++) {
    const identity = { ...f.deskIdentity, connection_id: `source-${index}` };
    await f.marks.mutate(identity, (draft) => {
      draft.desk.open(identity, 2000 + index);
    });
  }
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>(),
    put = f.store.terminalMarks.put;
  f.store.terminalMarks.put = async (input) => {
    const row = await put(input);
    entered.resolve();
    await release.promise;
    return row;
  };
  const pending = f.marks.mutate(f.deskIdentity, (draft) => {
    draft.desk.open(f.deskIdentity, 3000);
  });
  await entered.promise;
  beta.current = false;
  f.marks.retire("beta", 1, false);
  release.resolve();
  await pending;
  for (const registry of [
    f.registries.desk,
    f.registries.watchlist,
    f.registries.seen,
  ])
    expect(
      registry.list().records.some((record) => record.connection_id === "beta"),
    ).toBe(false);
  expect(
    f.store.terminalMarks
      .list()
      .filter((row) => row.kind === "desk" && row.body.opened_at != null),
  ).toHaveLength(40);
  expect(
    f.store.terminalMarks
      .list()
      .find((row) => row.kind === "desk" && row.binding.instance === "beta")
      ?.body,
  ).toMatchObject({ reviewed_stop: "stop-a", opened_at: null });
  f.store.terminalMarks.put = put;
  beta.current = true;
  await f.observeHost("beta");
  expect(
    f.registries.desk
      .list()
      .records.find((record) => record.connection_id === "beta"),
  ).toMatchObject({ reviewed_stop: "stop-a", opened_at: null });
});
for (const kind of ["unknown Desk", "completion"] as const)
  test(`pending ${kind} RPC refuses replacement followed by the original ownership`, async () => {
    const f = await fixture();
    const initial =
      kind === "unknown Desk" ? { ...pane(), agent_session: null } : pane();
    f.setPanes([initial]);
    await f.observe();
    const held = f.holdRead();
    const pending =
      kind === "unknown Desk"
        ? f.client.call("world.desk.review", {
            ...f.identity,
            agent_session_fingerprint: null,
            reviewed: true,
            stop_id: "stale-unknown-stop",
          })
        : f.client.call("world.completion_seen.mark", f.identity);
    await held.entered.promise;
    f.setPanes([pane("replacement-session")]);
    const replacement = f.observe();
    f.setPanes([initial]);
    const restored = f.observe();
    held.release.resolve();
    const outcome = await pending.then(
      () => "accepted",
      () => "refused",
    );
    await Promise.all([replacement, restored]);
    expect(outcome).toBe("refused");
    expect(
      f.registries.desk
        .list()
        .records.some(
          (record) => record.reviewed_stop === "stale-unknown-stop",
        ),
    ).toBe(false);
  });
test("a terminal-scoped watch admission may span an agent-session replacement", async () => {
  const f = await fixture();
  await f.observe();
  const held = f.holdRead();
  const pending = f.client.call("world.watchlist.pin", {
    ...f.identity,
    label: "Terminal watch",
  });
  await held.entered.promise;
  f.setPanes([pane("replacement-session")]);
  const observing = f.observe();
  held.release.resolve();
  await pending;
  await observing;
  expect(f.registries.watchlist.list().records).toHaveLength(1);
});
test("exact Unpin removes a disconnected saved capture and it cannot return after reconnect or restart", async () => {
  const f = await fixture();
  const reply = (await f.client.call("world.watchlist.pin", {
    ...f.identity,
    label: "Saved watch",
  })) as { records: Record<string, unknown>[] };
  const capture = reply.records[0]!;
  f.setCurrent(false);
  f.marks.retire("alpha", 1, false);
  await f.client.call("world.watchlist.unpin", capture);
  expect(
    f.store.terminalMarks.list().filter((row) => row.kind === "watchlist"),
  ).toEqual([]);
  f.setCurrent(true);
  await f.observe();
  expect(f.registries.watchlist.list().records).toEqual([]);
  await f.close();
  const again = await fixture(f.root);
  await again.observe();
  expect(again.registries.watchlist.list().records).toEqual([]);
});
test("unavailable Unpin releases the global watch capacity", async () => {
  const f = await fixture();
  for (let index = 0; index < 128; index++)
    await f.client.call("world.watchlist.pin", {
      ...f.identity,
      connection_id: `source-${index}`,
      label: "Saved watch",
    });
  f.marks.retire("source-0", 1, false);
  await f.client.call("world.watchlist.unpin", {
    ...f.identity,
    connection_id: "source-0",
  });
  expect(
    f.store.terminalMarks.list().filter((row) => row.kind === "watchlist"),
  ).toHaveLength(127);
  await f.client.call("world.watchlist.pin", {
    ...f.identity,
    connection_id: "new-source",
    label: "Replacement capacity",
  });
  expect(
    f.store.terminalMarks.list().filter((row) => row.kind === "watchlist"),
  ).toHaveLength(128);
});
for (const generation of [1, 2])
  test(`an older watch capture cannot remove its replacement in generation ${generation}`, async () => {
    const f = await fixture();
    const first = (await f.client.call("world.watchlist.pin", {
      ...f.identity,
      label: "First",
    })) as { records: Record<string, unknown>[] };
    const old = first.records[0]!;
    await f.client.call("world.watchlist.unpin", old);
    f.hosts.set("alpha", { generation, current: true, panes: [pane()] });
    f.marks.retire("alpha", generation, true);
    const second = (await f.client.call("world.watchlist.pin", {
      ...f.identity,
      connection_generation: generation,
      label: "Second",
    })) as { records: Record<string, unknown>[] };
    const current = second.records[0]!;
    expect(typeof old.watch_id).toBe("string");
    expect(current.watch_id).not.toBe(old.watch_id);
    await f.client.call("world.watchlist.unpin", old);
    await f.client.call("world.watchlist.unpin", f.identity);
    expect(
      f.store.terminalMarks
        .list()
        .filter((row) => row.kind === "watchlist")
        .map((row) => row.id),
    ).toEqual([current.watch_id as string]);
    await f.client.call("world.watchlist.unpin", current);
    expect(
      f.store.terminalMarks.list().filter((row) => row.kind === "watchlist"),
    ).toEqual([]);
  });
test("an exact watch ID removes an unresolved restart capture without source access", async () => {
  const first = await fixture();
  const reply = (await first.client.call("world.watchlist.pin", {
    ...first.identity,
    label: "Saved watch",
  })) as { records: Record<string, unknown>[] };
  const capture = reply.records[0]!;
  await first.close();
  const again = await fixture(first.root);
  again.setCurrent(false);
  expect(again.registries.watchlist.list().records).toEqual([]);
  await again.client.call("world.watchlist.unpin", capture);
  expect(again.store.terminalMarks.list()).toEqual([]);
  again.setCurrent(true);
  await again.observe();
  expect(again.registries.watchlist.list().records).toEqual([]);
});

for (const mode of ["watch ID", "legacy capture"] as const)
  test(`old ${mode} removes the same watch reattached in generation 2 from both clients`, async () => {
    const f = await fixture();
    const clients = [
      new WorldWatchlistStore(f.client),
      new WorldWatchlistStore(f.client),
    ];
    for (const client of clients) client.start();
    try {
      await Promise.all(clients.map((client) => client.refresh()));
      const pinned = (await f.client.call("world.watchlist.pin", {
        ...f.identity,
        label: "Continuous watch",
      })) as { records: Record<string, unknown>[] };
      const capture = pinned.records[0]!;
      f.hosts.set("alpha", { generation: 2, current: true, panes: [pane()] });
      f.marks.retire("alpha", 2, true);
      await f.observeHost("alpha");
      await Promise.all(clients.map((client) => client.refresh()));
      for (const client of clients)
        expect(client.get().records).toMatchObject([
          { generation: 2, watchId: capture.watch_id },
        ]);
      const result = (await f.client.call(
        "world.watchlist.unpin",
        mode === "watch ID" ? capture : f.identity,
      )) as { records: unknown[]; changed: boolean };
      expect(result.changed).toBe(true);
      expect(result.records).toEqual([]);
      expect(
        f.store.terminalMarks.list().filter((row) => row.kind === "watchlist"),
      ).toEqual([]);
      expect(await f.client.call("world.watchlist.list")).toMatchObject({
        records: [],
      });
      await Promise.all(clients.map((client) => client.refresh()));
      for (const client of clients)
        expect(client.get()).toMatchObject({ records: [], verified: true });
      const notice = f.noticeRevisions
        .filter((notice) => notice.type === "world_watchlist_changed")
        .at(-1)!;
      expect(notice).toMatchObject({ connectionId: "alpha", generation: 2 });
      await f.observeHost("alpha");
      expect(f.registries.watchlist.list().records).toEqual([]);
    } finally {
      for (const client of clients) client.stop();
    }
  });
