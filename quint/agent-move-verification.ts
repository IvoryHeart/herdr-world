import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  moveMismatches,
  moveWitnesses,
  replayMove,
  validateMoveTrace,
  type MoveState,
} from "./agent-move";
import {
  expectObservationMismatch,
  isObservationMismatch,
} from "./observations";
import { decodeItf } from "./replay";

/** Model faults: each must violate safety and diverge from production. */
export const moveModelFaults = [
  "no-recheck",
  "fallback",
  "assume-alive",
  "unnamed-start",
] as const;
/** Production faults in server/src/world/agent-move.ts. */
export const moveImplementationFaults = [
  "primary",
  "move-assume-alive",
] as const;

type Harness = {
  root: string;
  output: string;
  artifacts: string;
  command(
    label: string,
    args: string[],
    expectedViolation?: boolean,
  ): Promise<string>;
  mutate(fault: (typeof moveImplementationFaults)[number]): Promise<string>;
};

const SEED_TRACES = 1000;

/**
 * TLC explores every bounded move; three sampled seeds replay through the
 * real moveAgentAcross; model and production faults must be rejected.
 */
export async function runMoveVerification(h: Harness) {
  const started = performance.now();
  const model = "quint/agent-move.qnt";
  const source = await readFile(resolve(h.root, model), "utf8");
  const load = async (path: string) => {
    const itf = JSON.parse(await readFile(path, "utf8"));
    return validateMoveTrace(decodeItf(itf.states));
  };
  await h.command("agent-move-types", ["typecheck", model]);
  const verification = await h.command("agent-move-verification", [
    "verify",
    model,
    "--main",
    "agent_move",
    "--backend",
    "tlc",
    "--invariant",
    "safety",
    "--verbosity",
    "3",
  ]);
  assert.match(verification, /No violation found/);
  const replayWitnessesBySeed: Record<string, Record<string, number>> = {};
  const traces: MoveState[][] = [];
  for (const seed of [42, 73, 103]) {
    const prefix = `agent-move-seed${seed}`;
    await h.command(prefix, [
      "run",
      model,
      "--main",
      "agent_move",
      "--backend",
      "typescript",
      "--seed",
      String(seed),
      "--max-samples",
      String(SEED_TRACES),
      "--max-steps",
      "8",
      "--n-traces",
      String(SEED_TRACES),
      "--invariant",
      "safety",
      "--verbosity",
      "1",
      "--out-itf",
      `${h.artifacts}/${prefix}_{seq}.itf.json`,
      "--witnesses",
      ...moveWitnesses,
    ]);
    const files = (await readdir(h.output)).filter(
      (file) => file.startsWith(`${prefix}_`) && file.endsWith(".itf.json"),
    );
    assert.equal(files.length, SEED_TRACES);
    const counts: Record<string, number> = {};
    for (const file of files) {
      const trace = await load(resolve(h.output, file));
      traces.push(trace);
      for (const name of await replayMove(trace))
        counts[name] = (counts[name] ?? 0) + 1;
    }
    for (const witness of moveWitnesses)
      assert(
        (counts[witness] ?? 0) > 0,
        `missing move replay witness ${seed}/${witness}`,
      );
    replayWitnessesBySeed[seed] = counts;
  }
  const controls = [];
  for (const fault of moveModelFaults) {
    const mutant = `${h.artifacts}/agent-move-${fault}.qnt`;
    const counterexample = `${h.artifacts}/agent-move-${fault}.itf.json`;
    assert(source.includes('FAULT = "none"'));
    await writeFile(
      resolve(h.root, mutant),
      source.replace('FAULT = "none"', `FAULT = "${fault}"`),
    );
    await h.command(
      `agent-move-${fault}-control`,
      [
        "run",
        mutant,
        "--main",
        "agent_move",
        "--backend",
        "typescript",
        "--seed",
        "42",
        "--max-samples",
        "10000",
        "--max-steps",
        "8",
        "--invariant",
        "safety",
        "--verbosity",
        "1",
        "--out-itf",
        counterexample,
      ],
      true,
    );
    const trace = await load(resolve(h.root, counterexample));
    const mismatch = await expectObservationMismatch(
      () => replayMove(trace),
      moveMismatches,
    );
    controls.push({ fault, observation: mismatch.observation });
  }
  // Production faults must be rejected by some valid sampled trace.
  const implementationControls = [];
  for (const fault of moveImplementationFaults) {
    const mutant = await import(await h.mutate(fault));
    let killed: { trace: number; observation: string } | null = null;
    for (const [index, trace] of traces.entries()) {
      try {
        await replayMove(trace, mutant.moveAgentAcross);
      } catch (error) {
        if (!isObservationMismatch(error, moveMismatches)) throw error;
        killed = { trace: index, observation: error.observation };
        break;
      }
    }
    assert(killed, `production mutant ${fault} survived every trace`);
    implementationControls.push({ fault, ...killed });
  }
  return {
    name: "agent-move",
    safety: "pass",
    evidence:
      "production moveAgentAcross replayed through every sampled trace with scripted, generation-fenced sides",
    traces: traces.length,
    replayWitnessesBySeed,
    controls,
    implementationControls,
    elapsedSeconds: (performance.now() - started) / 1000,
  };
}
