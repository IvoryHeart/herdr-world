import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ImplementationFault } from "./implementationMutation";
import {
  replayWritePath,
  replayWritePathScenarios,
  writePathScenarios,
  type WritePathScenario,
} from "./world-write-path";

type Harness = {
  root: string;
  output: string;
  artifacts: string;
  command(
    label: string,
    args: string[],
    expectedViolation?: boolean,
  ): Promise<string>;
  mutate(fault?: ImplementationFault): Promise<string>;
};

const SEEDS = [42, 73, 103];
const SAMPLES = 2000;

/** Each production fault and the scenario that must reject it. */
const productionControls: [ImplementationFault, WritePathScenario][] = [
  ["primary", "sourceChangeAfterCommandWins"],
  ["write-cas", "compareAndSet"],
  ["write-settle-publish", "outcomeWhenValueUnchanged"],
];

/**
 * The World write path: model scenarios, bounded random simulation of the
 * safety invariant, two model controls, and replay of every scenario through
 * the real snapshot fence, World commands and browser replica, with three
 * production mutants rejected.
 */
export async function runWritePathVerification(h: Harness) {
  const started = performance.now();
  const model = "quint/world-write-path.qnt";
  await h.command("world-write-path-types", ["typecheck", model]);
  const scenarios = await h.command("world-write-path-scenarios", [
    "test",
    model,
    "--backend",
    "typescript",
  ]);
  assert.match(scenarios, /9 passing/, "write-path scenarios did not all pass");
  const simulate = (
    label: string,
    path: string,
    seed: number,
    broken = false,
  ) =>
    h.command(
      label,
      [
        "run",
        path,
        "--main",
        "world_write_path",
        "--backend",
        "typescript",
        "--seed",
        String(seed),
        "--max-samples",
        String(SAMPLES),
        "--max-steps",
        "30",
        "--invariant",
        "safety",
        "--verbosity",
        "1",
      ],
      broken,
    );
  for (const seed of SEEDS) {
    const log = await simulate(`world-write-path-seed${seed}`, model, seed);
    assert.match(log, /No violation found/, `seed ${seed} found a violation`);
  }
  // Model controls: an unfenced World and one without compare-and-set.
  const source = await readFile(resolve(h.root, model), "utf8");
  const controls: string[] = [];
  for (const flag of ["FENCED", "CAS"]) {
    const guard = `pure val ${flag} = true`;
    assert.equal(source.split(guard).length, 2, `${flag} control changed`);
    const file = `world-write-path-${flag.toLowerCase()}.qnt`;
    await writeFile(
      resolve(h.output, file),
      source.replace(guard, `pure val ${flag} = false`),
    );
    await simulate(
      `world-write-path-${flag.toLowerCase()}-control`,
      `${h.artifacts}/${file}`,
      42,
      true,
    );
    controls.push(`model-${flag.toLowerCase()}`);
  }
  const replays = await replayWritePathScenarios();
  assert.equal(replays.length, writePathScenarios.length);
  for (const [fault, scenario] of productionControls) {
    const mutant = (await import(await h.mutate(fault))) as {
      replayWritePath: typeof replayWritePath;
    };
    await assert.rejects(
      () => mutant.replayWritePath(scenario),
      new RegExp(`write-path\\.${scenario}`),
      `production control ${fault} survived`,
    );
    controls.push(`implementation-${fault}`);
  }
  return {
    name: "world-write-path",
    safety: "pass",
    scenarios: 9,
    replayedScenarios: writePathScenarios.length,
    traces: SEEDS.length * SAMPLES,
    seeds: SEEDS,
    controls,
    sampling:
      "bounded random simulation (2 browsers, 3 values, 4 source versions, 1 restart); not exhaustive",
    elapsedSeconds: (performance.now() - started) / 1000,
  };
}
