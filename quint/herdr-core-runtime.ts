import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { decodeItf } from "./replay";
import { observe, expectObservationMismatch } from "./observations";

export const coreFaults = [
  "keep-cursor",
  "stale-after-missed",
  "replay-write",
  "same-core-stale",
  "profile-fallback",
  "lost-delta",
  "gap-admitted",
  "not-ready",
  "stale-session",
  "ungated-queue",
  "heartbeat-ignored",
] as const;
export const coreWitnesses: readonly string[] = [
  "orderedDelta",
  "missedCut",
  "gapRetired",
  "reconnected",
  "replacementFenced",
  "queueFenced",
  "existingOnly",
];
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
  pending: boolean;
  queued: boolean;
  uncertain: boolean;
  attempts: number;
  delivered: number;
  admitted: boolean;
  dispatched: boolean;
  published: boolean;
  safe: boolean;
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

// In-process protocol fake for the design seam. It is deliberately not a core
// provider or live-core conformance claim. The model uses lists/history cuts;
// the fake applies delta commands and retains an immutable original recipient.
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
    pending: false,
    queued: false,
    uncertain: false,
    attempts: 0,
    delivered: 0,
    admitted: false,
    dispatched: false,
    published: false,
    safe: true,
  };
  constructor(
    private readonly skipGate = false,
    private readonly eventBound = 2,
  ) {}
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
        s.ready = false;
        s.generation++;
        s.cursor = -1;
        break;
      case "baseline":
        assert(s.connected && !s.ready);
        s.mirror = structuredClone(s.source);
        s.cursor = s.seq;
        s.ready = true;
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
        if (e.epoch !== s.epoch || e.gen !== s.generation || e.seq <= s.cursor)
          break;
        if (e.seq !== s.cursor + 1) {
          s.ready = false;
          break;
        }
        s.mirror = this.delta(s.mirror, e.target, e.kind);
        s.cursor = e.seq;
        break;
      }
      case "missed":
        assert(s.connected && s.queue.length > 0);
        s.mirror = structuredClone(s.source);
        s.cursor = s.seq;
        s.ready = true;
        break;
      case "drop":
        assert(s.queue.length > 0);
        s.queue.shift();
        break;
      case "heartbeat":
        assert(s.connected && s.ready && s.seq > s.cursor);
        s.ready = false;
        break;
      case "disconnect":
        assert(s.connected);
        s.connected = false;
        s.ready = false;
        s.uncertain ||= s.pending;
        break;
      case "restart":
        assert(s.epoch === 0);
        s.epoch++;
        s.seq = 0;
        s.history = [structuredClone(s.source)];
        s.connected = false;
        s.ready = false;
        s.uncertain ||= s.pending;
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
        s.ready = false;
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
      case "dispatch": {
        assert(s.captured && s.attempts === 0);
        const allowed = this.lease() && this.occupant();
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
      default:
        assert.fail(`unknown core action: ${op}`);
    }
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
        "dispatch",
        "deliver",
        "complete",
        "recover",
      ].includes(item.op),
      "unknown core trace action",
    );
    assert(index === 0 ? item.op === "init" : item.op !== "init");
    assert(
      item.family === undefined ||
        ["ordering", "authority"].includes(item.family),
      "unknown core family",
    );
    assert(item.family === value[0].family, "core family changed");
    assert(item.target === 0 || item.target === 1);
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
            Number.isSafeInteger(t[key]) && t[key] >= 0 && t[key] <= eventBound,
          );
      }
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

export function replayCore(
  states: CoreTraceState[],
  skipGate = false,
  eventBound = 2,
) {
  validateCoreTrace(states, eventBound);
  const fake = new CoreProtocolFake(
    skipGate,
    states[0]!.family === "authority" ? 1 : eventBound,
  );
  const witnesses = new Set<string>();
  for (const state of states) {
    fake.apply(state.op, state.target);
    observe("core.state", fake.state, state.c, state.op);
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
  }
  return witnesses;
}

type Harness = {
  root: string;
  output: string;
  artifacts: string;
  command(
    label: string,
    args: string[],
    expectedViolation?: boolean,
  ): Promise<string>;
};
export async function runCoreVerification(h: Harness) {
  const model = "quint/herdr-core-runtime.qnt";
  const source = await readFile(resolve(h.root, model), "utf8");
  const materialize = (text: string) =>
    text.replaceAll(
      'from "./',
      `from "${relative(h.output, resolve(h.root, "quint"))}/`,
    );
  const load = async (path: string, eventBound = 2) => {
    const itf = JSON.parse(await readFile(path, "utf8"));
    const states = decodeItf(itf.states);
    validateCoreTrace(states, eventBound);
    return states;
  };
  await h.command("herdr-core-runtime-types", ["typecheck", model]);
  const quotient = `${h.artifacts}/core-quotient.qnt`;
  await writeFile(
    resolve(h.root, quotient),
    materialize(source.replace("CHECKING = false", "CHECKING = true")),
  );
  const verification = await h.command("herdr-core-runtime-verification", [
    "verify",
    quotient,
    "--main",
    "herdr_core_runtime",
    "--backend",
    "tlc",
    "--invariant",
    "safety",
    "--verbosity",
    "3",
  ]);
  assert.match(
    verification,
    /No violation found/,
    "core exploration did not complete",
  );
  const replayWitnessesBySeed: Record<string, Record<string, number>> = {};
  const allStates: CoreTraceState[][] = [];
  for (const seed of [42, 73, 103]) {
    const prefix = `herdr-core-runtime-seed${seed}`;
    await h.command(prefix, [
      "run",
      model,
      "--backend",
      "typescript",
      "--seed",
      String(seed),
      "--max-samples",
      "500",
      "--max-steps",
      "25",
      "--n-traces",
      "500",
      "--invariant",
      "safety",
      "--verbosity",
      "1",
      "--out-itf",
      `${h.artifacts}/${prefix}_{seq}.itf.json`,
      "--witnesses",
      ...coreWitnesses,
    ]);
    const files = (await readdir(h.output)).filter(
      (file) => file.startsWith(`${prefix}_`) && file.endsWith(".itf.json"),
    );
    assert.equal(files.length, 500);
    const counts: Record<string, number> = {};
    for (const file of files) {
      const states = await load(resolve(h.output, file));
      allStates.push(states);
      for (const name of replayCore(states))
        counts[name] = (counts[name] ?? 0) + 1;
    }
    for (const witness of coreWitnesses)
      assert(
        (counts[witness] ?? 0) > 0,
        `missing core replay witness ${seed}/${witness}`,
      );
    replayWitnessesBySeed[seed] = counts;
  }
  const controls = [];
  for (const fault of coreFaults) {
    const mutant = `${h.artifacts}/core-${fault}.qnt`;
    const counterexample = `${h.artifacts}/core-${fault}.itf.json`;
    await writeFile(
      resolve(h.root, mutant),
      materialize(source.replace('FAULT = "none"', `FAULT = "${fault}"`)),
    );
    await h.command(
      `core-${fault}-control`,
      [
        "run",
        mutant,
        "--main",
        "herdr_core_runtime",
        "--backend",
        "typescript",
        "--seed",
        "42",
        "--max-samples",
        "10000",
        "--max-steps",
        "25",
        "--invariant",
        "safety",
        "--verbosity",
        "1",
        "--out-itf",
        counterexample,
      ],
      true,
    );
    const states = await load(resolve(h.root, counterexample));
    const mismatch = await expectObservationMismatch(
      () => replayCore(states),
      ["core.state"],
    );
    controls.push({ fault, observation: mismatch.observation });
  }
  const sensitivityModel = `${h.artifacts}/core-larger.qnt`;
  await writeFile(
    resolve(h.root, sensitivityModel),
    materialize(source.replace("EVENT_BOUND = 2", "EVENT_BOUND = 3")),
  );
  await h.command("core-larger-sensitivity", [
    "run",
    sensitivityModel,
    "--main",
    "herdr_core_runtime",
    "--backend",
    "typescript",
    "--seed",
    "103",
    "--max-samples",
    "500",
    "--max-steps",
    "25",
    "--n-traces",
    "100",
    "--invariant",
    "safety",
    "--verbosity",
    "1",
    "--out-itf",
    `${h.artifacts}/core-larger_{seq}.itf.json`,
  ]);
  const sensitivityFiles = (await readdir(h.output)).filter((file) =>
    /^core-larger_\d+\.itf\.json$/.test(file),
  );
  assert.equal(sensitivityFiles.length, 100);
  for (const file of sensitivityFiles)
    replayCore(await load(resolve(h.output, file), 3), false, 3);
  let fixtureControl = false;
  for (const states of allStates) {
    try {
      replayCore(states, true);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("observation" in error) ||
        error.observation !== "core.state"
      )
        throw error;
      fixtureControl = true;
      break;
    }
  }
  assert(fixtureControl, "ungated fake input must diverge on a valid trace");
  return {
    name: "herdr-core-runtime",
    evidence: "design-contract; in-process fake, no production core provider",
    traces: allStates.length,
    sensitivityTraces: sensitivityFiles.length,
    replayWitnessesBySeed,
    controls,
    fixtureMutationDetected: fixtureControl,
  };
}
