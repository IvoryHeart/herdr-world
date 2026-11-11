import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { decodeItf } from "./replay";
import { expectObservationMismatch } from "./observations";
import {
  coreFaults,
  coreWitnesses,
  coreImplementationFaults,
  replayCore,
  validateCoreTrace,
  type CoreSubjects,
  type CoreTraceState,
} from "./herdr-core-runtime";

/** Faults of the observe family, searched in its own simulation. */
const observeFaults: ReadonlySet<string> = new Set([
  "interactive-attach",
  "unconfirmed-accepted",
  "paint-before-resize",
  "stale-stream",
  "observer-input",
]);
type Harness = {
  root: string;
  output: string;
  artifacts: string;
  /** Bundles production subjects with one implementation fault. */
  mutate(fault: (typeof coreImplementationFaults)[number]): Promise<string>;
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
  // The observe family is sampled on its own, so adding it leaves the other
  // families' sampling (and their fault searches) exactly as before.
  const observeSource = source.replace("OBSERVE = false", "OBSERVE = true");
  assert.notEqual(observeSource, source, "observe switch missing");
  const observeModel = `${h.artifacts}/core-observe.qnt`;
  await writeFile(resolve(h.root, observeModel), materialize(observeSource));
  for (const seed of [42, 73, 103]) {
    const counts: Record<string, number> = {};
    for (const [prefix, path, traces] of [
      [`herdr-core-runtime-seed${seed}`, model, 500],
      [`herdr-core-observe-seed${seed}`, observeModel, 200],
    ] as const) {
      await h.command(prefix, [
        "run",
        path,
        "--main",
        "herdr_core_runtime",
        "--backend",
        "typescript",
        "--seed",
        String(seed),
        "--max-samples",
        String(traces),
        "--max-steps",
        "25",
        "--n-traces",
        String(traces),
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
      assert.equal(files.length, traces);
      for (const file of files) {
        const states = await load(resolve(h.output, file));
        allStates.push(states);
        for (const name of replayCore(states))
          counts[name] = (counts[name] ?? 0) + 1;
      }
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
      materialize(
        (observeFaults.has(fault) ? observeSource : source).replace(
          'FAULT = "none"',
          `FAULT = "${fault}"`,
        ),
      ),
    );
    await h.command(
      `core-${fault}-control`,
      [
        "verify",
        mutant,
        "--main",
        "herdr_core_runtime",
        "--backend",
        "tlc",
        "--invariant",
        "safety",
        "--verbosity",
        "1",
        "--out-itf",
        counterexample,
      ],
      true,
    );
    // TLC establishes the violation exhaustively; its backend emits no ITF.
    // Collect a concrete replay witness separately through the simulator.
    await h.command(
      `core-${fault}-trace`,
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
        "200000",
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
  // Production negative controls: each mutant CoreMirror must be rejected by
  // a valid model trace, through the same core.state observation. A receive
  // gap and an old kill plan after replacement are rare under the combined
  // worktree/send sampling, so search explicitly for both valid witnesses.
  const candidates = [...allStates];
  for (const [name, invariant, samples] of [
    ["receive-gap", "noReceiveGap", 20000],
    ["stale-kill", "noStaleKillAttempt", 200000],
  ] as const) {
    const witness = `${h.artifacts}/core-${name}-witness.itf.json`;
    await h.command(
      `core-${name}-witness`,
      [
        "run",
        model,
        "--main",
        "herdr_core_runtime",
        "--backend",
        "typescript",
        "--seed",
        "42",
        "--max-samples",
        String(samples),
        "--max-steps",
        "25",
        "--invariant",
        invariant,
        "--verbosity",
        "1",
        "--out-itf",
        witness,
      ],
      true,
    );
    const states = await load(resolve(h.root, witness));
    replayCore(states);
    candidates.unshift(states);
  }
  const implementationControls = [];
  for (const fault of coreImplementationFaults) {
    const subjects = (await import(await h.mutate(fault))) as CoreSubjects;
    let killed: { trace: number; observation: string } | null = null;
    for (const [index, states] of candidates.entries()) {
      try {
        replayCore(states, false, 2, subjects);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("observation" in error) ||
          !["core.state", "core.view"].includes(String(error.observation))
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
    name: "herdr-core-runtime",
    evidence:
      "production CoreMirror and read-model replay for ordering/recovery; authority decisions use the design seam",
    implementationControls,
    traces: allStates.length,
    sensitivityTraces: sensitivityFiles.length,
    replayWitnessesBySeed,
    controls,
    fixtureMutationDetected: fixtureControl,
  };
}
