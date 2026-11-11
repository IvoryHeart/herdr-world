export {
  coreFaults,
  coreWitnesses,
  coreImplementationFaults,
} from "./herdr-core-cases";
import assert from "node:assert/strict";
import { observe } from "./observations";
import * as productionSubjects from "./herdr-core-subjects";
import { CoreWatchReplay, type Frame } from "./herdr-core-observe";
import type { CoreEventLine } from "../server/src/herdr-core/client";

/** The production modules a replay drives; mutant bundles replace them. */
export type CoreSubjects = typeof productionSubjects;
type ProductionMirror = InstanceType<CoreSubjects["CoreMirror"]>;

type Terminal = {
  alive: boolean;
  born: boolean;
  x: number;
  y: number;
  occupant: number;
};
type Event = {
  epoch: number;
  gen: number;
  seq: number;
  target: number;
  kind: string;
};
export type CoreState = {
  source: Terminal[];
  mirror: Terminal[];
  history: Terminal[][];
  queue: Event[];
  seq: number;
  cursor: number;
  epoch: number;
  generation: number;
  owner: number;
  connected: boolean;
  ready: boolean;
  running: boolean;
  changes: number;
  replaced: boolean;
  captured: boolean;
  leaseGen: number;
  leaseOwner: number;
  leaseEpoch: number;
  session: number;
  foreground: boolean;
  pending: boolean;
  queued: boolean;
  uncertain: boolean;
  attempts: number;
  delivered: number;
  admitted: boolean;
  dispatched: boolean;
  published: boolean;
  safe: boolean;
  /** Terminal 2 (index 1) dies with terminal 1 when core ends it (M7). */
  child: boolean;
  planned: boolean;
  confirmedChild: boolean;
  confirmedOccupant: number;
  killed: boolean;
  /** P4 worktree removal: the generation it was planned in, then its steps. */
  planGen: number;
  planOwner: number;
  planEpoch: number;
  tornDown: boolean;
  removed: boolean;
  lead: number;
  grid: number;
  watching: boolean;
  confirmed: boolean;
  frames: Frame[];
  credit: boolean;
  pendingGrid: number;
  backlog: boolean;
  stream: number;
  shown: number;
  misdrawn: boolean;
  typed: boolean;
  outputs: number;
};
export type CoreTraceState = {
  c: CoreState;
  op: string;
  target: number;
  family?: string;
};

const terminal = (): Terminal => ({
  alive: true,
  born: true,
  x: 0,
  y: 0,
  occupant: 0,
});

// Replay adapter. The synthetic source, queue and delayed operation are
// simulated here; every mirror, cursor and readiness transition is decided by
// World's production CoreMirror, fed the same baseline, event, missed and
// heartbeat lines a core sends. Authority decisions (capture/dispatch/
// deliver) remain the design seam: see model.md "Production mapping".
export class CoreProtocolFake {
  state: CoreState = {
    source: [terminal(), { ...terminal(), alive: false, born: false }],
    mirror: [terminal(), { ...terminal(), alive: false, born: false }],
    history: [[terminal(), { ...terminal(), alive: false, born: false }]],
    queue: [],
    seq: 0,
    cursor: -1,
    epoch: 0,
    generation: 0,
    owner: 0,
    connected: false,
    ready: false,
    running: true,
    changes: 0,
    replaced: false,
    captured: false,
    leaseGen: -1,
    leaseOwner: -1,
    leaseEpoch: -1,
    session: -1,
    foreground: true,
    pending: false,
    queued: false,
    uncertain: false,
    attempts: 0,
    delivered: 0,
    admitted: false,
    dispatched: false,
    published: false,
    safe: true,
    child: false,
    planned: false,
    confirmedChild: false,
    confirmedOccupant: -1,
    killed: false,
    planGen: -1,
    planOwner: -1,
    planEpoch: -1,
    tornDown: false,
    removed: false,
    lead: -1,
    grid: 3,
    watching: false,
    confirmed: false,
    frames: [],
    credit: true,
    pendingGrid: -1,
    backlog: false,
    stream: 0,
    shown: -1,
    misdrawn: false,
    typed: false,
    outputs: 0,
  };
  /** What the person confirmed, as World's production plan named it. */
  private confirmation: Parameters<CoreSubjects["coreKillRefusal"]>[1] | null =
    null;
  /** World's watch of terminal 0 (observe family). */
  private readonly watcher: CoreWatchReplay;
  /** The current connection's subscription (fresh on every connect). */
  private latest: ProductionMirror | null = null;
  /** The last mirror that accepted a baseline: the facts World shows. */
  private facts: ProductionMirror | null = null;
  /** Whether the mirror's last cut or applied creation knew each terminal. */
  private known = [true, false];
  /** What each queued event carried when the source emitted it. */
  private readonly emitted = new Map<string, Terminal>();
  constructor(
    private readonly skipGate = false,
    private readonly eventBound = 2,
    private readonly subjects: CoreSubjects = productionSubjects,
  ) {
    this.watcher = new CoreWatchReplay(() => this.state, subjects);
  }
  private record(index: number, t: Terminal) {
    return {
      address: `t${index + 1}`,
      labels: { x: String(t.x), y: String(t.y) },
      // A kept replacement may reuse the pid; argv still tells them apart.
      argv: [t.occupant === 0 ? "agent" : "/bin/sh"],
      state: "live",
      pid: 100,
      reported: false,
      // Core records the parent at creation; it ends this child with it.
      ...(index === 1 && this.state.child
        ? { parent: "t1", die_with_parent: true }
        : {}),
    };
  }
  private snapshot() {
    return this.state.source.flatMap((t, index) =>
      t.alive ? [this.record(index, t)] : [],
    );
  }
  private line(e: Event): CoreEventLine {
    const address = `t${e.target + 1}`;
    const at = this.emitted.get(`${e.epoch}:${e.seq}`)!;
    const data =
      e.kind === "create"
        ? this.record(e.target, at)
        : e.kind === "remove"
          ? {}
          : { labels: { x: String(at.x), y: String(at.y) } };
    const type =
      e.kind === "create"
        ? "created"
        : e.kind === "remove"
          ? "removed"
          : "labels";
    return {
      method: "event",
      params: { seq: e.seq, type, terminal: address, data },
    };
  }
  /** Projects production observation onto the model's mirror/cursor/ready. */
  private sync() {
    const s = this.state;
    if (this.facts) {
      s.mirror = s.mirror.map((_, index) => {
        const found = this.facts!.terminal(`t${index + 1}`);
        if (found) {
          const labels = found.labels as Record<string, string>;
          return {
            alive: true,
            born: true,
            x: Number(labels.x),
            y: Number(labels.y),
            occupant: found.argv[0] === "agent" ? 0 : 1,
          };
        }
        // A removed terminal has no observable facts. Removal is permanent,
        // so once the mirror knew it, its retained values are the source's
        // final ones; a terminal it never knew is still unborn there.
        return this.known[index]
          ? { ...structuredClone(s.source[index]!), alive: false }
          : { alive: false, born: false, x: 0, y: 0, occupant: 0 };
      });
    }
    if (this.latest) s.cursor = this.latest.cursor;
    s.ready = s.connected && Boolean(this.latest?.actionable);
  }
  /**
   * World's view of this core through the production read model (Town,
   * Desk, Board and Needs you rows): the live addresses while the model is
   * ready, otherwise a refusal, so stale facts are never shown as current.
   */
  view(): string[] | "refused" {
    try {
      return this.subjects
        .coreReadModel({
          mirror: this.latest ?? new this.subjects.CoreMirror(),
          actionable: this.state.connected && Boolean(this.latest?.actionable),
          coreName: () => "core",
        })
        .panes.map((pane) => String(pane.pane_id));
    } catch {
      return "refused";
    }
  }
  private lease() {
    const s = this.state;
    return (
      s.connected &&
      s.ready &&
      s.owner === s.leaseOwner &&
      s.generation === s.leaseGen &&
      s.epoch === s.leaseEpoch
    );
  }
  private occupant() {
    const s = this.state;
    return s.source[0]!.alive && s.source[0]!.occupant === s.session;
  }
  private delta(items: Terminal[], target: number, kind: string) {
    const byId = new Map(
      items.map((value, id) => [id, structuredClone(value)]),
    );
    const item = byId.get(target)!;
    if (kind === "create")
      byId.set(target, { ...terminal(), occupant: item.occupant });
    else if (kind === "remove") item.alive = false;
    else if (kind === "x") item.x++;
    else if (kind === "y") item.y++;
    else assert.fail("unknown delta");
    return [...byId.values()];
  }
  apply(op: string, target = 0) {
    const s = this.state;
    switch (op) {
      case "init":
        return;
      case "connect":
        assert(!s.connected && s.generation < 2);
        s.connected = s.running;
        s.generation++;
        // Reconnect never keeps a cursor: a fresh subscription, unbaselined.
        this.latest = new this.subjects.CoreMirror();
        break;
      case "baseline":
        assert(s.connected && !s.ready);
        if (this.latest!.baseline(s.seq, this.snapshot())) {
          this.facts = this.latest;
          this.known = s.source.map((t) => t.born);
        }
        break;
      case "create":
      case "remove":
      case "x":
      case "y":
        assert(s.running && s.changes < this.eventBound);
        assert(
          op === "create" ? !s.source[target]!.born : s.source[target]!.alive,
        );
        s.source = this.delta(s.source, target, op);
        s.history.push(structuredClone(s.source));
        s.seq++;
        s.changes++;
        this.emitted.set(
          `${s.epoch}:${s.seq}`,
          structuredClone(s.source[target]!),
        );
        if (s.connected)
          s.queue.push({
            epoch: s.epoch,
            gen: s.generation,
            seq: s.seq,
            target,
            kind: op,
          });
        break;
      case "receive": {
        assert(s.connected && s.ready && s.queue.length > 0);
        const e = s.queue.shift()!;
        // An earlier connection's bytes never reach this subscription.
        if (e.epoch !== s.epoch || e.gen !== s.generation) break;
        if (
          this.latest!.apply(this.line(e)) === "applied" &&
          e.kind === "create"
        )
          this.known[e.target] = true;
        break;
      }
      case "missed":
        assert(s.connected && s.queue.length > 0);
        if (
          this.latest!.apply({
            method: "missed",
            params: { seq: s.seq, terminals: this.snapshot() as never },
          }) === "applied"
        ) {
          this.facts = this.latest;
          this.known = s.source.map((t) => t.born);
        }
        break;
      case "drop":
        assert(s.queue.length > 0);
        s.queue.shift();
        break;
      case "heartbeat":
        assert(s.connected && s.ready && s.seq > s.cursor);
        this.latest!.apply({ method: "heartbeat", params: { seq: s.seq } });
        break;
      case "disconnect":
        assert(s.connected);
        s.connected = false;
        this.latest?.retire("disconnected");
        s.uncertain ||= s.pending;
        this.watcher.endWatch();
        break;
      case "restart":
        assert(s.epoch === 0);
        s.epoch++;
        s.seq = 0;
        s.history = [structuredClone(s.source)];
        s.connected = false;
        this.latest?.retire("disconnected");
        s.uncertain ||= s.pending;
        this.watcher.endWatch();
        break;
      case "pane":
      case "output":
      case "watch":
      case "unwatch":
      case "stall":
      case "drain":
      case "frame":
      case "viewport":
        this.watcher.apply(op, target);
        break;
      case "absent":
        assert(s.generation === 0 && s.running);
        s.running = false;
        break;
      case "switchProfile":
        assert(s.owner === 0);
        s.owner = 1;
        break;
      case "replace":
        assert(s.source[0]!.alive && !s.replaced);
        s.source[0]!.occupant = 1;
        s.replaced = true;
        s.history[s.seq] = structuredClone(s.source);
        // The model abstracts the kept replacement's lost/restarted events as
        // a silent source change that withdraws readiness until fresh
        // acquisition; production detects it through the occupancy token.
        this.latest?.retire("divergence");
        break;
      case "capture":
        assert(s.ready && !s.captured && s.source[0]!.alive);
        s.captured = true;
        s.leaseGen = s.generation;
        s.leaseOwner = s.owner;
        s.leaseEpoch = s.epoch;
        s.session = s.source[0]!.occupant;
        s.admitted = true;
        break;
      case "loseForeground":
        assert(s.foreground);
        s.foreground = false;
        break;
      case "dispatch": {
        assert(s.captured && s.attempts === 0);
        // Drive the production recipient comparison as well as the original lease.
        const original = {
          ...this.record(0, { ...s.source[0]!, occupant: s.session }),
          remote: false,
          foreground: { pid: 101, name: "agent" },
        };
        const token = this.subjects.coreRecipientToken("core", original)!;
        const current = {
          ...this.record(0, s.source[0]!),
          remote: false,
          foreground: s.foreground ? { pid: 101, name: "agent" } : null,
        };
        const allowed =
          this.lease() &&
          this.occupant() &&
          this.subjects.coreRecipientChange(token, "core", current) === null;
        s.attempts = allowed ? 1 : 0;
        s.pending = allowed;
        s.queued = allowed;
        s.dispatched = allowed;
        break;
      }
      case "deliver":
        assert(s.queued);
        s.queued = false;
        if (this.skipGate || this.occupant()) s.delivered++;
        break;
      case "complete":
        assert(s.pending);
        s.pending = false;
        s.published = this.lease() && this.occupant();
        s.uncertain ||= !s.published;
        break;
      case "recover":
        assert(s.uncertain && s.ready);
        break;
      case "plan": {
        // World's production plan of what killing t1 ends, from its mirror.
        assert(s.ready && s.mirror[0]!.alive && !s.planned);
        const plan = this.subjects.coreKillPlan(
          "core",
          this.latest!.terminals(),
          ["t1"],
        );
        this.confirmation = {
          coreId: plan.coreId,
          terminals: [...plan.roots, ...plan.descendants].map((e) => ({
            address: e.address,
            pid: e.pid,
            occupant: e.occupant,
            remote: e.remote,
          })),
        };
        s.planned = true;
        s.planGen = s.generation;
        s.planOwner = s.owner;
        s.planEpoch = s.epoch;
        s.confirmedChild = plan.descendants.some((e) => e.address === "t2");
        s.confirmedOccupant =
          this.latest!.terminal("t1")?.argv?.[0] === "agent" ? 0 : 1;
        break;
      }
      case "kill": {
        // Planned again from the current observation; the production
        // refusal decides whether the kill is sent.
        assert(s.planned && !s.killed);
        const plan = this.subjects.coreKillPlan(
          "core",
          s.ready ? this.latest!.terminals() : [],
          ["t1"],
        );
        const allowed =
          s.ready &&
          plan.roots.length > 0 &&
          this.subjects.coreKillRefusal(plan, this.confirmation!) === null;
        if (!allowed) break;
        s.source[0]!.alive = false;
        if (s.child) s.source[1]!.alive = false;
        s.history[s.seq] = structuredClone(s.source);
        s.killed = true;
        // A silent source change, as in replace: World reacquires.
        this.latest?.retire("divergence");
        break;
      }
      case "teardown": {
        // removeCoreWorktree checks the confirmation with the production
        // plan and refusal (assertCoreKillConfirmed) before the hook runs.
        assert(s.planned && !s.killed && !s.tornDown);
        if (
          !s.ready ||
          !s.mirror[0]!.alive ||
          !s.connected ||
          s.generation !== s.planGen ||
          s.owner !== s.planOwner ||
          s.epoch !== s.planEpoch
        )
          break;
        const plan = this.subjects.coreKillPlan(
          "core",
          this.latest!.terminals(),
          ["t1"],
        );
        s.tornDown =
          plan.roots.length > 0 &&
          this.subjects.coreKillRefusal(plan, this.confirmation!) === null;
        break;
      }
      case "removeCheckout":
        // Removal follows the confirmed kill, under the planned generation.
        assert(s.tornDown && !s.removed);
        s.removed =
          s.killed &&
          s.connected &&
          s.generation === s.planGen &&
          s.owner === s.planOwner &&
          s.epoch === s.planEpoch;
        break;
      default:
        assert.fail(`unknown core action: ${op}`);
    }
    this.sync();
  }
}

export function validateCoreTrace(
  value: unknown,
  eventBound = 2,
): asserts value is CoreTraceState[] {
  assert(Array.isArray(value) && value.length > 1, "empty core trace");
  const shape = new CoreProtocolFake().state;
  for (const [index, item] of value.entries()) {
    assert(item && typeof item === "object" && typeof item.op === "string");
    assert(
      [
        "init",
        "connect",
        "baseline",
        "create",
        "remove",
        "x",
        "y",
        "receive",
        "missed",
        "drop",
        "heartbeat",
        "disconnect",
        "restart",
        "absent",
        "switchProfile",
        "replace",
        "capture",
        "loseForeground",
        "dispatch",
        "deliver",
        "complete",
        "recover",
        "plan",
        "kill",
        "teardown",
        "removeCheckout",
        "pane",
        "output",
        "watch",
        "unwatch",
        "stall",
        "drain",
        "frame",
        "viewport",
      ].includes(item.op),
      "unknown core trace action",
    );
    assert(index === 0 ? item.op === "init" : item.op !== "init");
    assert(
      item.family === undefined ||
        ["ordering", "authority", "observe"].includes(item.family),
      "unknown core family",
    );
    assert(item.family === value[0].family, "core family changed");
    assert(
      item.target === 0 ||
        item.target === 1 ||
        (item.op === "pane" && item.target === 2),
    );
    assert(item.c && typeof item.c === "object");
    assert.deepEqual(Object.keys(item.c).sort(), Object.keys(shape).sort());
    for (const [key, initial] of Object.entries(shape)) {
      const field = item.c[key];
      if (typeof initial === "number")
        assert(Number.isSafeInteger(field) && field >= -1 && field <= 3);
      else if (typeof initial === "boolean") assert(typeof field === "boolean");
      else assert(Array.isArray(field));
    }
    for (const group of [item.c.source, item.c.mirror, ...item.c.history]) {
      assert(Array.isArray(group) && group.length === 2);
      for (const t of group) {
        assert(
          t && typeof t.alive === "boolean" && typeof t.born === "boolean",
        );
        assert.deepEqual(Object.keys(t).sort(), [
          "alive",
          "born",
          "occupant",
          "x",
          "y",
        ]);
        for (const key of ["x", "y", "occupant"])
          assert(
            Number.isSafeInteger(t[key]) &&
              t[key] >= 0 &&
              // A stale-after-missed mutant can apply each source delta twice.
              // Admit its counterexample so production replay, not parsing,
              // rejects it. Source history retains its exact event bound.
              t[key] <=
                (group === item.c.mirror && key !== "occupant"
                  ? 2 * eventBound
                  : eventBound),
          );
      }
    }
    for (const frame of item.c.frames) {
      assert.deepEqual(Object.keys(frame).sort(), ["grid", "kind", "stream"]);
      assert(["resize", "data"].includes(frame.kind));
      assert(
        Number.isSafeInteger(frame.grid) && frame.grid >= 0 && frame.grid <= 3,
      );
      assert(
        Number.isSafeInteger(frame.stream) &&
          frame.stream >= 0 &&
          frame.stream <= 2,
      );
    }
    for (const event of item.c.queue) {
      assert.deepEqual(Object.keys(event).sort(), [
        "epoch",
        "gen",
        "kind",
        "seq",
        "target",
      ]);
      assert(["create", "remove", "x", "y"].includes(event.kind));
      assert(event.target === 0 || event.target === 1);
      for (const key of ["epoch", "gen", "seq", "target"])
        assert(
          Number.isSafeInteger(event[key]) &&
            event[key] >= 0 &&
            event[key] <= eventBound,
        );
    }
  }
}

/** The model's view: its mirror's live terminals, only while ready. */
function expectedView(c: CoreState): string[] | "refused" {
  return c.ready
    ? c.mirror.flatMap((t, index) => (t.alive ? [`t${index + 1}`] : []))
    : "refused";
}

export function replayCore(
  states: CoreTraceState[],
  skipGate = false,
  eventBound = 2,
  subjects: CoreSubjects = productionSubjects,
) {
  validateCoreTrace(states, eventBound);
  const fake = new CoreProtocolFake(
    skipGate,
    states[0]!.family === "authority" ? 1 : eventBound,
    subjects,
  );
  const witnesses = new Set<string>();
  // An environment choice, like the family: whether terminal 2 is a child.
  fake.state.child = states[0]!.c.child === true;
  for (const state of states) {
    fake.apply(state.op, state.target);
    observe("core.state", fake.state, state.c, state.op);
    observe("core.view", fake.view(), expectedView(state.c), state.op);
    const c = fake.state;
    if (state.op === "receive" && c.ready && c.cursor > 0)
      witnesses.add("orderedDelta");
    if (state.op === "missed") witnesses.add("missedCut");
    if (["heartbeat", "receive"].includes(state.op) && !c.ready)
      witnesses.add("gapRetired");
    if (state.op === "baseline" && c.generation === 2 && c.ready)
      witnesses.add("reconnected");
    if (state.op === "dispatch" && c.replaced && c.attempts === 0)
      witnesses.add("replacementFenced");
    if (state.op === "deliver" && c.replaced && c.delivered === 0)
      witnesses.add("queueFenced");
    if (state.op === "connect" && !c.running && !c.connected)
      witnesses.add("existingOnly");
    if (state.op === "kill" && c.killed && c.child && c.confirmedChild)
      witnesses.add("cascadeConfirmed");
    if (
      state.op === "kill" &&
      !c.killed &&
      c.child &&
      c.mirror[1]!.alive &&
      !c.confirmedChild
    )
      witnesses.add("unconfirmedCascadeRefused");
    if (
      state.op === "frame" &&
      c.watching &&
      c.shown >= 0 &&
      c.shown === c.grid
    )
      witnesses.add("watchAdopted");
    if (state.op === "watch" && c.watching && c.lead < 0)
      witnesses.add("observerAlone");
    if (state.op === "frame" && c.watching && c.shown === 2 && c.changes > 1)
      witnesses.add("headlessFollowed");
    if (state.op === "drain" && c.frames.length > 0)
      witnesses.add("stallReleased");
    if (state.op === "watch" && !c.watching)
      witnesses.add("unconfirmedRefused");
    if (state.op === "removeCheckout" && c.removed)
      witnesses.add("worktreeRemoved");
    if (state.op === "teardown" && !c.tornDown && c.ready)
      witnesses.add("teardownFenced");
  }
  return witnesses;
}
