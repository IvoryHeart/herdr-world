import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  identityScenarios,
  replayAgentIdentity,
  replayAgentIdentityScenarios,
  type IdentityScenario,
} from "./agent-identity";
import type { ImplementationFault } from "./implementationMutation";

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
const productionControls: [ImplementationFault, IdentityScenario][] = [
  ["primary", "duplicateBindsNothing"],
  ["identity-end", "emptyConversationEndsOnClose"],
  ["identity-conflict", "sameConversationTwiceConflicts"],
];

/**
 * World agent identity: model scenarios, bounded random simulation of the
 * safety invariant, one model control checked by TLC (an away agent silently
 * re-bound by its conversation), and replay of every scenario through the real writer,
 * agent store and agent records, with three production mutants rejected.
 */
export async function runAgentIdentityVerification(h: Harness) {
  const started = performance.now();
  const model = "quint/agent-identity.qnt";
  await h.command("agent-identity-types", ["typecheck", model]);
  const scenarios = await h.command("agent-identity-scenarios", [
    "test",
    model,
    "--backend",
    "typescript",
  ]);
  assert.match(scenarios, /7 passing/, "identity scenarios did not all pass");
  for (const seed of SEEDS) {
    const log = await h.command(`agent-identity-seed${seed}`, [
      "run",
      model,
      "--main",
      "agent_identity",
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
    ]);
    assert.match(log, /No violation found/, `seed ${seed} found a violation`);
  }
  // Model control: a hand-started terminal re-binds the away agent.
  const source = await readFile(resolve(h.root, model), "utf8");
  const guard = "pure val BROKEN = false";
  assert.equal(source.split(guard).length, 2, "BROKEN control changed");
  const file = "agent-identity-broken.qnt";
  await writeFile(
    resolve(h.output, file),
    source.replace(guard, "pure val BROKEN = true"),
  );
  // Breadth-first TLC finds its shortest counterexample in seconds; random
  // samples rarely reach the nine steps it needs.
  await h.command(
    "agent-identity-broken-control",
    [
      "verify",
      `${h.artifacts}/${file}`,
      "--main",
      "agent_identity",
      "--backend",
      "tlc",
      "--invariant",
      "safety",
      "--verbosity",
      "3",
    ],
    true,
  );
  const controls = ["model-broken"];
  const replays = await replayAgentIdentityScenarios();
  assert.equal(replays.length, identityScenarios.length);
  for (const [fault, scenario] of productionControls) {
    const mutant = (await import(await h.mutate(fault))) as {
      replayAgentIdentity: typeof replayAgentIdentity;
    };
    await assert.rejects(
      () => mutant.replayAgentIdentity(scenario),
      new RegExp(`agent-identity\\.${scenario}`),
      `production control ${fault} survived`,
    );
    controls.push(`implementation-${fault}`);
  }
  return {
    name: "agent-identity",
    safety: "pass",
    scenarios: 7,
    replayedScenarios: identityScenarios.length,
    traces: SEEDS.length * SAMPLES,
    seeds: SEEDS,
    controls,
    sampling:
      "bounded random simulation (3 agents, 3 terminals, 2 conversations, 30 steps); not exhaustive",
    elapsedSeconds: (performance.now() - started) / 1000,
  };
}
