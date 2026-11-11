import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decodeItf } from "./replay";
import { expectObservationMismatch, observe } from "./observations";
import * as productionSubjects from "./herdr-core-seen-subjects";
import type { CoreShared } from "../web/src/world/coreShared";
import type { CoreMirrorTerminal } from "../server/src/herdr-core/mirror";

/**
 * Shared seen (plan M9, `quint/herdr-core-seen.qnt`): replay drives the
 * production browser rule (`CoreSeenSharer`, once per turn per foreground
 * look) and the production service rule (`seenToShare`, decided label,
 * raise-only, never past core's turn) through every sampled model trace.
 */
export type SeenSubjects = typeof productionSubjects;

export type SeenState = {
  turn: number;
  label: number;
  looking: boolean;
  front: boolean;
  stale: boolean;
  looked: number;
  pending: number;
  expect: number;
  unread: boolean;
  refused: boolean;
  blind: boolean;
  lowered: boolean;
  overUnread: boolean;
  hidden: boolean;
  writes: number;
};
export type SeenTraceState = { op: string; s: SeenState };

export const seenWitnesses = [
  "sharedTurn",
  "unreadKept",
  "lookedAgain",
  "hiddenQuiet",
  "flickerQuiet",
  "refusedMoved",
  "lostWrite",
] as const;
/** Model faults; each must violate safety and diverge from production. */
export const seenFaults = [
  "forget-look",
  "hidden-look",
  "stale-look",
  "blind-write",
  "unchecked-write",
] as const;
/** Production faults; each must be rejected by a valid model trace. */
export const seenImplementationFaults = [
  "seen-forget-look",
  "seen-hidden-look",
  "seen-stale-look",
  "seen-blind-write",
] as const;
export const seenMismatches = ["seen.decision", "seen.dispatch"] as const;

const ACTIONS = [
  "init",
  "endTurn",
  "look",
  "leave",
  "background",
  "foreground",
  "flicker",
  "refresh",
  "dispatch",
  "lose",
  "appUnread",
  "appSeen",
] as const;
const BOOLEANS = [
  "looking",
  "front",
  "stale",
  "unread",
  "refused",
  "blind",
  "lowered",
  "overUnread",
  "hidden",
] as const;
const INTEGERS = [
  "turn",
  "label",
  "looked",
  "pending",
  "expect",
  "writes",
] as const;

export function validateSeenTrace(
  value: unknown,
  turnBound = 2,
): asserts value is SeenTraceState[] {
  assert(Array.isArray(value) && value.length > 1, "empty seen trace");
  for (const [index, item] of value.entries()) {
    assert(item && typeof item === "object", "invalid seen state");
    const { op, s } = item as { op: unknown; s: unknown };
    assert(
      typeof op === "string" &&
        (ACTIONS as readonly string[]).includes(op) &&
        (index === 0) === (op === "init"),
      "unknown seen action",
    );
    assert(s && typeof s === "object", "invalid seen record");
    const record = s as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(record).sort(),
      [...BOOLEANS, ...INTEGERS].sort(),
      "seen record shape",
    );
    for (const key of BOOLEANS) assert(typeof record[key] === "boolean");
    for (const key of INTEGERS)
      assert(
        Number.isSafeInteger(record[key]) &&
          (record[key] as number) >= -1 &&
          (record[key] as number) <= turnBound,
        `seen ${key} out of domain`,
      );
  }
}

/** The model's transitions in TypeScript, to build traces in unit tests. */
export function seenStep(
  s: SeenState,
  op: (typeof ACTIONS)[number],
  fault: (typeof seenFaults)[number] | "none" = "none",
): SeenState | null {
  const is = (name: string) => fault === name;
  const next = { ...s, refused: false };
  switch (op) {
    case "endTurn":
      return s.turn < 2 ? { ...next, turn: s.turn + 1, unread: false } : null;
    case "look":
      return s.looking ? null : { ...next, looking: true };
    case "leave":
      return s.looking
        ? { ...next, looking: false, looked: -1, unread: false }
        : null;
    case "background":
      return s.front
        ? { ...next, front: false, looked: -1, unread: false }
        : null;
    case "foreground":
      return s.front ? null : { ...next, front: true };
    case "flicker":
      return { ...next, stale: !s.stale };
    case "refresh": {
      if (s.pending >= 0) return null;
      const active =
        s.looking &&
        (s.front || is("hidden-look")) &&
        (!s.stale || is("stale-look"));
      const decide = active && (s.looked !== s.turn || is("forget-look"));
      const write = decide && s.label < s.turn;
      return {
        ...next,
        looked: decide ? s.turn : s.looked,
        pending: write ? s.turn : -1,
        expect: write ? s.label : -1,
        overUnread: s.overUnread || (write && s.unread),
        hidden: s.hidden || (write && !(s.looking && s.front && !s.stale)),
      };
    }
    case "dispatch": {
      if (s.pending < 0) return null;
      const matches =
        s.label === s.expect || is("blind-write") || is("unchecked-write");
      const raise =
        (s.pending > s.label || is("unchecked-write")) && s.pending <= s.turn;
      const ok = matches && raise;
      return {
        ...next,
        pending: -1,
        expect: -1,
        refused: !ok,
        label: ok ? s.pending : s.label,
        blind: s.blind || (ok && s.label !== s.expect),
        lowered: s.lowered || (ok && s.pending < s.label),
        writes: ok && s.writes < 2 ? s.writes + 1 : s.writes,
      };
    }
    case "lose":
      return s.pending >= 0 ? { ...next, pending: -1, expect: -1 } : null;
    case "appUnread":
      return s.turn > 0 && s.label === s.turn
        ? {
            ...next,
            label: s.turn - 1,
            unread: s.unread || s.looked === s.turn,
          }
        : null;
    case "appSeen":
      return s.label < s.turn
        ? { ...next, label: s.turn, unread: false }
        : null;
    default:
      return null;
  }
}

export const seenInitial: SeenState = {
  turn: 0,
  label: -1,
  looking: false,
  front: true,
  stale: false,
  looked: -1,
  pending: -1,
  expect: -1,
  unread: false,
  refused: false,
  blind: false,
  lowered: false,
  overUnread: false,
  hidden: false,
  writes: 0,
};

const label = (value: number) => (value < 0 ? null : value);

/** What a browser draws for the model's agent. */
function drawn(s: SeenState): CoreShared {
  return {
    connectionId: "fixture-core",
    generation: 1,
    terminal: "t1",
    turn: s.turn,
    seen: label(s.label),
    favourite: false,
    stale: s.stale,
  };
}

/** The service's ordered observation of the model's agent. */
function observed(s: SeenState): CoreMirrorTerminal {
  return {
    address: "t1",
    state: "live",
    remote: false,
    status: { state: "idle" },
    turn: s.turn,
    labels: s.label < 0 ? {} : { "herdr.seen": String(s.label) },
  } as unknown as CoreMirrorTerminal;
}

/**
 * Replays one trace through production code. The browser updates on every
 * step that can end a look (as `useCoreSeen` does on unmount, blur and
 * visibility change) and on the model's refresh; the service decides each
 * dispatch from the observation before it.
 */
export function replaySeen(
  states: SeenTraceState[],
  subjects: SeenSubjects = productionSubjects,
  turnBound = 2,
) {
  validateSeenTrace(states, turnBound);
  observe("seen.decision", states[0]!.s, seenInitial, "init");
  const sharer = new subjects.CoreSeenSharer(async () => {});
  let pending: CoreShared | null = null;
  const witnesses = new Set<string>();
  for (let index = 1; index < states.length; index++) {
    const before = states[index - 1]!.s;
    const { op, s } = states[index]!;
    const update = () => sharer.update(s.looking ? [drawn(s)] : [], s.front);
    if (op === "refresh") {
      const writes = update();
      observe(
        "seen.decision",
        writes.map((write) => [write.turn, write.seen ?? -1]),
        s.pending >= 0 ? [[s.pending, s.expect]] : [],
        `${index}:${op}`,
      );
      pending = writes[0] ?? null;
    } else if (op === "leave" || op === "background") {
      observe("seen.decision", update(), [], `${index}:${op}`);
    } else if (op === "dispatch") {
      assert(pending, "dispatch without a decided write");
      const change = subjects.seenToShare(
        observed(before),
        pending.turn,
        pending.seen,
      );
      const written = change ? Number(change["herdr.seen" as never]) : null;
      observe(
        "seen.dispatch",
        { label: written ?? before.label, refused: written === null },
        { label: s.label, refused: s.refused },
        `${index}:${op}`,
      );
      pending = null;
    } else if (op === "lose") pending = null;
    if (op === "dispatch" && !s.refused) witnesses.add("sharedTurn");
    if (op === "dispatch" && s.refused) witnesses.add("refusedMoved");
    if (op === "lose") witnesses.add("lostWrite");
    if (s.writes >= 2) witnesses.add("lookedAgain");
    if (op === "refresh" && s.looking && s.label < s.turn) {
      if (!s.front) witnesses.add("hiddenQuiet");
      else if (s.stale) witnesses.add("flickerQuiet");
    }
    if (op === "refresh" && s.unread && s.looking && s.front && s.pending < 0)
      witnesses.add("unreadKept");
  }
  return witnesses;
}

type Harness = {
  root: string;
  output: string;
  artifacts: string;
  /** Bundles production subjects with one implementation fault. */
  mutate(fault: (typeof seenImplementationFaults)[number]): Promise<string>;
  command(
    label: string,
    args: string[],
    expectedViolation?: boolean,
  ): Promise<string>;
};

export async function runSeenVerification(h: Harness) {
  const model = "quint/herdr-core-seen.qnt";
  const source = await readFile(resolve(h.root, model), "utf8");
  const load = async (path: string, turnBound = 2) => {
    const itf = JSON.parse(await readFile(path, "utf8"));
    const states = decodeItf(itf.states);
    validateSeenTrace(states, turnBound);
    return states;
  };
  await h.command("herdr-core-seen-types", ["typecheck", model]);
  const verification = await h.command("herdr-core-seen-verification", [
    "verify",
    model,
    "--main",
    "herdr_core_seen",
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
    "seen exploration did not complete",
  );
  const replayWitnessesBySeed: Record<string, Record<string, number>> = {};
  const allStates: SeenTraceState[][] = [];
  for (const seed of [42, 73, 103]) {
    const prefix = `herdr-core-seen-seed${seed}`;
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
      ...seenWitnesses,
    ]);
    const files = (await readdir(h.output)).filter(
      (file) => file.startsWith(`${prefix}_`) && file.endsWith(".itf.json"),
    );
    assert.equal(files.length, 500);
    const counts: Record<string, number> = {};
    for (const file of files) {
      const states = await load(resolve(h.output, file));
      allStates.push(states);
      for (const name of replaySeen(states))
        counts[name] = (counts[name] ?? 0) + 1;
    }
    for (const witness of seenWitnesses)
      assert(
        (counts[witness] ?? 0) > 0,
        `missing seen replay witness ${seed}/${witness}`,
      );
    replayWitnessesBySeed[seed] = counts;
  }
  const controls = [];
  for (const fault of seenFaults) {
    const mutant = `${h.artifacts}/seen-${fault}.qnt`;
    const counterexample = `${h.artifacts}/seen-${fault}.itf.json`;
    await writeFile(
      resolve(h.root, mutant),
      source.replace('FAULT = "none"', `FAULT = "${fault}"`),
    );
    await h.command(
      `seen-${fault}-control`,
      [
        "run",
        mutant,
        "--main",
        "herdr_core_seen",
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
      () => replaySeen(states),
      seenMismatches,
    );
    controls.push({ fault, observation: mismatch.observation });
  }
  const sensitivityModel = `${h.artifacts}/seen-larger.qnt`;
  await writeFile(
    resolve(h.root, sensitivityModel),
    source.replace("TURN_BOUND = 2", "TURN_BOUND = 3"),
  );
  await h.command("seen-larger-sensitivity", [
    "run",
    sensitivityModel,
    "--main",
    "herdr_core_seen",
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
    `${h.artifacts}/seen-larger_{seq}.itf.json`,
  ]);
  const sensitivityFiles = (await readdir(h.output)).filter((file) =>
    /^seen-larger_\d+\.itf\.json$/.test(file),
  );
  assert.equal(sensitivityFiles.length, 100);
  for (const file of sensitivityFiles)
    replaySeen(await load(resolve(h.output, file), 3), productionSubjects, 3);
  // Production negative controls: each mutant must be rejected by a valid
  // model trace through a named observation.
  const implementationControls = [];
  for (const fault of seenImplementationFaults) {
    const subjects = (await import(await h.mutate(fault))) as SeenSubjects;
    let killed: { trace: number; observation: string } | null = null;
    for (const [index, states] of allStates.entries()) {
      try {
        replaySeen(states, subjects);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("observation" in error) ||
          !(seenMismatches as readonly string[]).includes(
            String(error.observation),
          )
        )
          throw error;
        killed = { trace: index, observation: String(error.observation) };
        break;
      }
    }
    assert(killed, `production mutant ${fault} survived every trace`);
    implementationControls.push({ fault, ...killed });
  }
  return {
    name: "herdr-core-seen",
    evidence:
      "production CoreSeenSharer (browser look rule) and seenToShare (service write rule) replayed through every sampled trace",
    implementationControls,
    traces: allStates.length,
    sensitivityTraces: sensitivityFiles.length,
    replayWitnessesBySeed,
    controls,
  };
}
