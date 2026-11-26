import assert from "node:assert/strict";
import { herdrRuntimeFixture } from "../server/src/adapters/testing/runtime";
import type { ConnectionStatus } from "../server/src/connections/types";
import { composeWorldCommands } from "../server/src/service/world-commands";
import {
  parseWorldCommand,
  type WorldCommands as WorldCommandsType,
} from "../server/src/world/commands";
import { WorldSnapshotService } from "../server/src/world/snapshot";
import type {
  LedgerDocument,
  LedgerStore,
} from "../server/src/world/world-ledger";
import { WorldRuntimeStore } from "../web/src/world/runtimeStore";
import { inProgress, type WorldCommand } from "../web/src/world/worldReplica";

/**
 * Replay of the world-write-path scenarios (quint/world-write-path.qnt)
 * through the real pieces: the snapshot service's host epoch fence and one
 * ordered publication, World commands composed over it (the same composition
 * the service uses), and two browsers' replicas reading that publication.
 * The source of record is a synthetic Herdr host with one room; its reads
 * can be held to make them late, exactly like the model's startRead/applyRead.
 */

type Implementation = {
  WorldSnapshotService: typeof WorldSnapshotService;
  composeWorldCommands: typeof composeWorldCommands;
  WorldRuntimeStore: typeof WorldRuntimeStore;
};
const real: Implementation = {
  WorldSnapshotService,
  composeWorldCommands,
  WorldRuntimeStore,
};

const HOST = "synthetic-host";
const ROOM = "synthetic-room";

type HeldRead = { label: string; release(): void };

/** The source of record: one room name, changed by World or directly. */
function source() {
  const state = { label: "One", hold: false, reads: [] as HeldRead[] };
  const runtime = herdrRuntimeFixture({
    async call(method: string, params?: unknown) {
      if (method === "workspace.list") {
        // A read captures the source when it starts (the model's startRead).
        const label = state.label;
        if (state.hold) {
          let release!: () => void;
          const gate = new Promise<void>((done) => (release = done));
          state.reads.push({ label, release });
          await gate;
        }
        return { workspaces: [{ workspace_id: ROOM, label }] };
      }
      if (method === "workspace.rename") {
        state.label = String((params as { label: string }).label);
        return {};
      }
      if (method === "tab.list") return { tabs: [] };
      if (method === "pane.list") return { panes: [] };
      if (method === "agent.list") return { agents: [] };
      throw new Error(`unexpected method: ${method}`);
    },
  });
  return { state, runtime };
}

const status: ConnectionStatus = {
  id: HOST,
  label: "Synthetic host",
  source: "saved-profile",
  is_default: false,
  state: "ready",
  generation: 1,
};

/** World's durable ledger (in memory here): it outlives a restart. */
function ledgerStore(): LedgerStore & { document: LedgerDocument } {
  let next = 0;
  const store = {
    document: {
      version: 1,
      revision: 0,
      changes: [],
      asks: [],
      results: [],
    } as LedgerDocument,
    nextId: (kind: string) => `${kind}-${++next}`,
    get: () => store.document,
    ask: () => undefined,
    change: (id: string) => store.document.changes.find((c) => c.id === id),
    openAsks: () => ({ revision: store.document.revision, asks: [] }),
    update(change: (document: LedgerDocument) => void) {
      const document = structuredClone(store.document);
      change(document);
      document.revision += 1;
      store.document = document;
      return document.revision;
    },
  };
  return store;
}

/** One World service incarnation over the source. */
function service(
  impl: Implementation,
  src: ReturnType<typeof source>,
  incarnation: string,
  ledger: LedgerStore,
) {
  const snapshots = new impl.WorldSnapshotService(
    {
      list: () => [status],
      readyRuntimeLease: () => ({
        connectionId: HOST,
        generation: 1,
        runtime: src.runtime,
        isCurrent: () => true,
      }),
    },
    // A fixed clock: a read stays fresh until World invalidates it.
    () => 1_000,
    undefined,
    // A short response deadline: a browser read during a held host read
    // answers from the published cache, as it does after the real deadline.
    10,
    undefined,
    undefined,
    undefined,
    incarnation,
  );
  const lease = {
    connectionId: HOST,
    generation: 1,
    runtime: src.runtime,
    isCurrent: () => true,
  };
  const commands: WorldCommandsType = impl.composeWorldCommands({
    now: () => 1_000,
    connectionManager: {
      has: (id: string) => id === HOST,
      readyRuntimeLease: (id: string) => (id === HOST ? lease : null),
    } as never,
    core: () => undefined,
    snapshots: snapshots as never,
    ledger: () => ledger,
    invalidate: (id) => snapshots.invalidate(id),
    publish: () => undefined,
    log: () => undefined,
  });
  snapshots.publishWith(() => ({
    commands: commands.published(),
    ui_settings: { ui: {}, revision: 0 },
  }));
  return { snapshots, commands, incarnation };
}

/** A browser: one replica every view in it reads. */
function browser(
  impl: Implementation,
  world: () => ReturnType<typeof service>,
) {
  const store = new impl.WorldRuntimeStore(
    {
      async call(method: string, params?: unknown) {
        assert.equal(method, "world.snapshot");
        const current = world();
        const reply = current.snapshots.observation.reply(
          await current.snapshots.snapshot(
            (params ?? {}) as Record<string, unknown>,
          ),
        );
        // Over the wire.
        return JSON.parse(JSON.stringify(reply));
      },
      onControl: () => () => undefined,
      onStatus: () => () => undefined,
    } as never,
    async () => undefined,
  );
  const outcomes: Array<WorldCommand | null> = [];
  /** What the views in this browser draw for the room (Town and Board alike). */
  const shows = () =>
    store.get().connections[0]?.snapshot?.workspaces[0]?.label;
  return { store, outcomes, shows };
}

let ids = 0;

/** The browser's rename through World (web/src/world/worldCommands.ts). */
async function rename(
  b: ReturnType<typeof browser>,
  world: ReturnType<typeof service>,
  value: string,
) {
  const command: WorldCommand = {
    id: `synthetic-${++ids}`,
    entity: {
      kind: "room",
      connection_id: HOST,
      generation: 1,
      room_id: ROOM,
    },
    field: "name",
    expected: b.shows()!,
    value,
    state: "accepted",
  };
  const held = b.store.holdPending(command, (outcome) =>
    b.outcomes.push(outcome),
  );
  try {
    const { id, entity, field, expected } = command;
    const answer = await world.commands.submit(
      parseWorldCommand({ id, entity, field, expected, value }),
    );
    if (inProgress(answer as WorldCommand)) held.answered();
    else {
      held.release();
      b.outcomes.push(answer as WorldCommand);
    }
  } catch (error) {
    held.release();
    b.outcomes.push({ ...command, state: "refused", detail: String(error) });
  }
}

/** Let held promise chains run. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((done) => setTimeout(done, 0));
};

function scene(impl: Implementation) {
  const src = source();
  const ledger = ledgerStore();
  let world = service(impl, src, "synthetic-incarnation-1", ledger);
  const one = browser(impl, () => world);
  const two = browser(impl, () => world);
  return {
    src,
    one,
    two,
    world: () => world,
    ledger,
    restart() {
      world = service(impl, src, "synthetic-incarnation-2", ledger);
    },
    /** World's own value for the room (newest admitted read). */
    worldValue: () =>
      world.snapshots.rooms(HOST, 1)?.[0]?.label as string | undefined,
    command: () => world.commands.published().at(-1),
    async catchUp() {
      await one.store.refresh();
      await two.store.refresh();
    },
  };
}

export const writePathScenarios = [
  "lateReadIsDiscarded",
  "sourceChangeAfterCommandWins",
  "observedHoldsUntilAdopted",
  "compareAndSet",
  "outcomeWhenValueUnchanged",
  "pendingSharedInBrowser",
  "restartRecovery",
] as const;
export type WritePathScenario = (typeof writePathScenarios)[number];

/** Replay one model scenario; throws `write-path.<scenario>` on divergence. */
export async function replayWritePath(
  scenario: WritePathScenario,
  impl: Implementation = real,
) {
  const s = scene(impl);
  const check = (condition: unknown, what: string) =>
    assert(condition, `write-path.${scenario}: ${what}`);
  // init: World has read the source and both browsers show it.
  await s.world().snapshots.snapshot();
  await s.catchUp();
  check(s.one.shows() === "One" && s.two.shows() === "One", "initial value");

  if (scenario === "lateReadIsDiscarded") {
    // startRead: a read begins before the command and is held.
    s.src.state.hold = true;
    s.world().snapshots.invalidate(HOST);
    const late = s.world().snapshots.snapshot();
    await settle();
    check(s.src.state.reads.length === 1, "late read started");
    // issue, sourceApply, ack: the command is sent and acknowledged; World
    // reads again on its own (a second held read).
    await rename(s.one, s.world(), "Two");
    await settle();
    check(s.one.shows() === "Two" && s.two.shows() === "One", "pending shown");
    // applyRead of the late read: discarded, nothing settles.
    s.src.state.reads.shift()!.release();
    await late;
    await settle();
    check(s.worldValue() === "One", "late read not applied");
    check(s.command()?.state === "sent", "late read settled the command");
    await s.one.store.refresh();
    check(s.one.shows() === "Two", "pending value flashed back");
    // The read World started after the acknowledgement settles it.
    s.src.state.hold = false;
    for (const read of s.src.state.reads.splice(0)) read.release();
    await settle();
    await s.world().snapshots.snapshot();
    check(s.worldValue() === "Two", "post-acknowledgement read applied");
    check(s.command()?.state === "observed", "command observed");
    await s.catchUp();
    check(s.one.shows() === "Two" && s.two.shows() === "Two", "converged");
    check(
      s.one.outcomes.length === 1 && s.one.outcomes[0]?.state === "observed",
      "outcome delivered",
    );
  }

  if (scenario === "sourceChangeAfterCommandWins") {
    s.src.state.hold = true;
    await rename(s.one, s.world(), "Two");
    await settle();
    // externalWrite + deliverEvent: someone renames at the source.
    s.src.state.label = "Three";
    s.world().snapshots.invalidate(HOST);
    // The read World started at the acknowledgement saw "Two": it is late.
    for (const read of s.src.state.reads.splice(0)) read.release();
    await settle();
    check(s.command()?.state === "sent", "pre-change read settled");
    s.src.state.hold = false;
    await s.world().snapshots.snapshot();
    check(s.worldValue() === "Three", "source change observed");
    check(
      s.command()?.state === "observed" && s.command()?.observed === "Three",
      "outcome names the source's value",
    );
    await s.catchUp();
    check(s.one.shows() === "Three" && s.two.shows() === "Three", "converged");
  }

  if (scenario === "observedHoldsUntilAdopted") {
    await rename(s.one, s.world(), "Two");
    await settle();
    await s.world().snapshots.snapshot();
    check(s.command()?.state === "observed", "settled");
    // Browser one has not read the settling revision yet: still pending.
    check(
      s.one.shows() === "Two" && s.two.shows() === "One",
      "held until read",
    );
    check(s.one.outcomes.length === 0, "outcome before revision");
    await s.catchUp();
    check(s.one.shows() === "Two" && s.two.shows() === "Two", "adopted");
    check(s.one.outcomes[0]?.state === "observed", "outcome delivered");
  }

  if (scenario === "compareAndSet") {
    s.src.state.hold = true;
    await rename(s.one, s.world(), "Two");
    await settle();
    // Browser two has not seen "Two": World refuses and sends nothing.
    const before = s.src.state.label;
    await rename(s.two, s.world(), "Three");
    check(s.two.outcomes[0]?.state === "refused", "stale expected value sent");
    check(s.src.state.label === before, "refused command reached the source");
    check(s.two.shows() === "One", "refused value shown");
    s.src.state.hold = false;
    for (const read of s.src.state.reads.splice(0)) read.release();
    await settle();
    await s.world().snapshots.snapshot();
    await s.catchUp();
    // Having seen "Two", browser two's change goes through.
    await rename(s.two, s.world(), "Three");
    await settle();
    await s.world().snapshots.snapshot();
    await s.catchUp();
    check(s.src.state.label === "Three", "admitted command not sent");
    check(s.one.shows() === "Three" && s.two.shows() === "Three", "converged");
  }

  if (scenario === "outcomeWhenValueUnchanged") {
    s.src.state.hold = true;
    await rename(s.one, s.world(), "Two");
    await settle();
    // Someone puts the old name back before World reads (late for World's
    // own post-acknowledgement read).
    s.src.state.label = "One";
    s.world().snapshots.invalidate(HOST);
    for (const read of s.src.state.reads.splice(0)) read.release();
    await settle();
    // The read that settles it is held; meanwhile World answers from what
    // it published.
    const before = await s.world().snapshots.snapshot();
    check(s.src.state.reads.length === 1, "settling read started");
    check(s.command()?.state === "sent", "settled before its read");
    s.src.state.hold = false;
    s.src.state.reads.shift()!.release();
    await settle();
    const after = await s.world().snapshots.snapshot();
    check(s.worldValue() === "One", "value unchanged");
    check(
      s.command()?.state === "observed" && s.command()?.observed === "One",
      "outcome settled",
    );
    // The settle published a new revision although the value is unchanged.
    check(after.revision > before.revision, "settle published no revision");
    await s.one.store.refresh();
    check(
      s.one.outcomes.length === 1 && s.one.outcomes[0]?.observed === "One",
      "outcome not delivered",
    );
    check(s.one.shows() === "One", "source value shown");
  }

  if (scenario === "pendingSharedInBrowser") {
    s.src.state.hold = true;
    await rename(s.one, s.world(), "Two");
    await settle();
    // Every view in browser one reads the same replica: two independent
    // readers of it (Town and Board subscribe the same store) both see it.
    const town = s.one.store.get();
    const board = s.one.store.get();
    check(town === board, "views read different replicas");
    check(s.one.shows() === "Two", "pending not shown");
    // Browser two learns the command is in progress from World's publication.
    await s.two.store.refresh();
    check(s.two.shows() === "Two", "published pending not shown");
    s.src.state.hold = false;
    for (const read of s.src.state.reads.splice(0)) read.release();
    await settle();
    await s.world().snapshots.snapshot();
    await s.catchUp();
    check(s.one.shows() === "Two" && s.two.shows() === "Two", "converged");
  }

  if (scenario === "restartRecovery") {
    s.src.state.hold = true;
    await rename(s.one, s.world(), "Two");
    await settle();
    // The accepted command was recorded before World sent it.
    const recorded = () =>
      s.ledger.document.changes.map((change) => change.world_command?.state);
    check(recorded().join() === "accepted", "accepted command not recorded");
    // World restarts before it reads the outcome: the command is lost, and
    // so are the old World's reads in flight (the model's reads' = Set()).
    s.src.state.reads.splice(0);
    s.src.state.hold = false;
    s.restart();
    await s.world().snapshots.snapshot();
    await s.catchUp();
    // The browser drops its pending value and says the outcome is unknown:
    // the new World's recovered record tells it so (uncertain).
    check(
      s.one.outcomes.length === 1 &&
        s.one.outcomes[0]?.state === "uncertain" &&
        s.one.outcomes[0].detail ===
          "World restarted before it saw the result.",
      "restart not reported",
    );
    // The new World settles the recorded command as uncertain (the model's
    // lost command) and records that outcome in the same ledger record.
    check(
      s
        .world()
        .commands.published()
        .map((command) => command.state)
        .join() === "uncertain",
      "lost command not settled as uncertain",
    );
    check(recorded().join() === "uncertain", "restart outcome not recorded");
    // The new World read the source again: the change that landed shows.
    check(s.worldValue() === "Two", "source not read again");
    check(s.one.shows() === "Two" && s.two.shows() === "Two", "converged");
  }
  return { scenario, shows: [s.one.shows(), s.two.shows()] };
}

export async function replayWritePathScenarios(impl: Implementation = real) {
  const results = [];
  for (const scenario of writePathScenarios)
    results.push(await replayWritePath(scenario, impl));
  return results;
}
