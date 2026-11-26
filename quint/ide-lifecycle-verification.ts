import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runVerificationPool } from "../scripts/verification-pool";
import {
  ideCounterexamples,
  ideSteps,
  replayIdeTrace,
  scriptedIdeModel,
} from "./ide-lifecycle";

type Harness = {
  root: string;
  output: string;
  artifacts: string;
  command(
    label: string,
    args: string[],
    expectedViolation?: boolean,
    signal?: AbortSignal,
  ): Promise<string>;
  mutate(fault: "ide-queue" | "ide-start-epoch"): Promise<string>;
  signal?: AbortSignal;
  /** Exhaustive checks run at once; CI gives this model a whole two-CPU shard. */
  controlWorkers?: number;
  withControlWorker?: (
    work: (signal?: AbortSignal) => Promise<void>,
    signal: AbortSignal,
  ) => Promise<void>;
};

const MODEL = "quint/ide-lifecycle.qnt";
const MAIN = "ide_lifecycle";

/** The model with constants or flags replaced, written beside the run. */
function variant(source: string, replacements: [string, string][]) {
  let text = source;
  for (const [from, to] of replacements) {
    assert.equal(text.split(from).length, 2, `model constant changed: ${from}`);
    text = text.replace(from, to);
  }
  return text;
}

/** One SSH folder, deeper: two faults per behaviour. */
const DEEP: [string, string][] = [
  ["pure val ACTIVE = Set(0, 1)", "pure val ACTIVE = Set(1)"],
  ["pure val MAX_FAULTS = 1", "pure val MAX_FAULTS = 2"],
];
/**
 * Deeper still for the controls, which stop at their first violation:
 * three faults and five clicks. Checked in full it takes minutes, too long
 * for the gate's per-command bound on a loaded machine.
 */
const CONTROL: [string, string][] = [
  ["pure val ACTIVE = Set(0, 1)", "pure val ACTIVE = Set(1)"],
  ["pure val MAX_FAULTS = 1", "pure val MAX_FAULTS = 3"],
  ["pure val MAX_CLICKS = 4", "pure val MAX_CLICKS = 5"],
];
/** Sampling needs no exhaustive bound: both folders, more of everything. */
const SAMPLED: [string, string][] = [
  ["pure val MAX_FAULTS = 1", "pure val MAX_FAULTS = 4"],
  ["pure val MAX_CLICKS = 4", "pure val MAX_CLICKS = 6"],
  ["pure val MAX_ATT = 2", "pure val MAX_ATT = 3"],
];
/** Longest control first (hosted CI, 2026-11-24), so a worker pool ends evenly. */
const FLAGS = [
  "OLD_QUEUE",
  "OLD_START_EPOCH",
  "OLD_STOP",
  "KEEP_ROUTES",
  "OLD_LIST",
  "STOP_TREE_ONLY",
  "NO_VOID",
  "LOST_IS_FAILED",
] as const;

/**
 * Exhaustive bounded exploration of the IDE server lifecycle, sampled
 * behaviours replayed through World's real IDE service, a broken copy of
 * the model per design decision, and the model's counterexamples replayed
 * against the fixed service and the unfixed one.
 */
export async function runIdeLifecycleVerification(h: Harness) {
  const started = performance.now();
  const source = await readFile(resolve(h.root, MODEL), "utf8");
  const write = async (name: string, text: string) => {
    await writeFile(resolve(h.output, name), text);
    return `${h.artifacts}/${name}`;
  };
  const verify = (
    label: string,
    path: string,
    broken: boolean,
    signal?: AbortSignal,
  ) =>
    h.command(
      label,
      [
        "verify",
        path,
        ...(path === MODEL ? [] : ["--main", MAIN]),
        "--backend",
        "tlc",
        "--invariant",
        "safety",
        "--verbosity",
        "3",
      ],
      broken,
      signal,
    );
  await h.command("ide-lifecycle-types", ["typecheck", MODEL]);

  // Every exhaustive TLC check is independent and single-threaded. CI runs
  // them two at a time on this model's own shard, longest first, so the
  // model fits its shard deadline on slower runners (#1346); local pools
  // keep one at a time. Each design decision turned back must break the
  // model; the default and deep variants must not.
  const deep = await write("ide-lifecycle-deep.qnt", variant(source, DEEP));
  const deepSource = variant(source, CONTROL);
  const checks: { label: string; path: string; broken: boolean }[] = [
    { label: "ide-lifecycle-verification", path: MODEL, broken: false },
    { label: "ide-lifecycle-deep", path: deep, broken: false },
  ];
  for (const flag of FLAGS)
    checks.push({
      label: `ide-lifecycle-${flag}`,
      path: await write(
        `ide-lifecycle-${flag}.qnt`,
        variant(deepSource, [
          [`pure val ${flag} = false`, `pure val ${flag} = true`],
        ]),
      ),
      broken: true,
    });
  await runVerificationPool(
    checks,
    h.controlWorkers ?? 1,
    h.signal ?? new AbortController().signal,
    async ({ label, path, broken }, signal) => {
      const log = await verify(label, path, broken, signal);
      if (!broken) assert.match(log, /No violation found/, label);
    },
    h.withControlWorker,
  );
  const controls = FLAGS.map((flag) => `model-${flag}`);

  const sampled = await write(
    "ide-lifecycle-sampled.qnt",
    variant(source, SAMPLED),
  );
  const replayWitnessesBySeed: Record<string, string[]> = {};
  let traces = 0;
  for (const seed of [42, 73, 103]) {
    const prefix = `ide-lifecycle-seed${seed}`;
    await h.command(prefix, [
      "run",
      sampled,
      "--main",
      MAIN,
      "--backend",
      "typescript",
      "--seed",
      String(seed),
      "--max-samples",
      "100",
      "--max-steps",
      "30",
      "--n-traces",
      "100",
      "--invariant",
      "safety",
      "--verbosity",
      "1",
      "--out-itf",
      `${h.artifacts}/${prefix}_{seq}.itf.json`,
    ]);
    const files = (await readdir(h.output)).filter(
      (file) => file.startsWith(`${prefix}_`) && file.endsWith(".itf.json"),
    );
    assert.equal(files.length, 100);
    const witnessed = new Set<string>();
    for (const file of files) {
      const steps = ideSteps(
        JSON.parse(await readFile(resolve(h.output, file), "utf8")),
      );
      await replayIdeTrace(steps);
      for (const step of steps.slice(1))
        witnessed.add(`${step.op.name}${step.op.arg ? `:${step.op.arg}` : ""}`);
      traces++;
    }
    for (const needed of [
      "open",
      "stop",
      "reply:started",
      "reply:stopped",
      "lose:dead",
      "listReply:pending",
      "request:stream",
      "removeConn",
      "reconnect",
      "restart:01",
    ])
      assert(witnessed.has(needed), `seed ${seed} never replayed ${needed}`);
    replayWitnessesBySeed[seed] = [...witnessed].sort();
  }

  // The counterexamples the model found in the first design, kept as
  // witnesses: the fixed service departs from each where the fix acts;
  // the service with that fix taken back follows it to the violation.
  for (const [name, witness] of Object.entries(ideCounterexamples)) {
    const path = await write(
      `ide-lifecycle-${name}-witness.qnt`,
      scriptedIdeModel(
        variant(deepSource, [
          [
            `pure val ${witness.flag} = false`,
            `pure val ${witness.flag} = true`,
          ],
        ]),
        witness.ops,
      ),
    );
    const itf = `ide-lifecycle-${name}-witness.itf.json`;
    await h.command(
      `ide-lifecycle-${name}-witness`,
      [
        "run",
        path,
        "--main",
        MAIN,
        "--init",
        "witnessInit",
        "--step",
        "witnessStep",
        "--backend",
        "typescript",
        "--max-samples",
        "1",
        "--max-steps",
        String(witness.ops.length),
        "--invariant",
        "safety",
        "--verbosity",
        "1",
        "--out-itf",
        `${h.artifacts}/${itf}`,
      ],
      true,
    );
    const steps = ideSteps(
      JSON.parse(await readFile(resolve(h.output, itf), "utf8")),
    );
    assert.equal(
      steps.length,
      witness.ops.length + 1,
      `${name} witness cut short`,
    );
    await assert.rejects(
      replayIdeTrace(steps),
      `the fixed service followed the ${name} counterexample`,
    );
    const mutant = await import(await h.mutate(witness.fault));
    await mutant.replayIdeTrace(steps);
    controls.push(`witness-${name}`, `implementation-${witness.fault}`);
  }
  return {
    name: "ide-lifecycle",
    safety: "pass",
    schedules: traces,
    traces,
    replayWitnessesBySeed,
    controls,
    elapsedSeconds: (performance.now() - started) / 1000,
  };
}
