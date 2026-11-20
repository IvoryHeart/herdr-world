import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decodeItf } from "./replay";
import { replayTapLockSchedule, tapBoundaries } from "./claude-tap-lock";

type Harness = {
  root: string;
  output: string;
  artifacts: string;
  command(
    label: string,
    args: string[],
    expectedViolation?: boolean,
  ): Promise<string>;
  mutate(): Promise<string>;
};

/** Exhaustive finite exploration plus real filesystem replay of every schedule. */
export async function runTapLockVerification(h: Harness) {
  const started = performance.now();
  const model = "quint/claude-tap-lock.qnt";
  await h.command("claude-tap-lock-types", ["typecheck", model]);
  const verification = await h.command("claude-tap-lock-verification", [
    "verify",
    model,
    "--backend",
    "tlc",
    "--invariant",
    "safety",
    "--verbosity",
    "3",
  ]);
  assert.match(verification, /No violation found/);
  const load = async (file: string) => {
    const itf = JSON.parse(await readFile(resolve(h.output, file), "utf8"));
    const states = decodeItf(itf.states);
    assert(Array.isArray(states) && states.length > 1);
    for (const state of states) {
      assert(
        Number.isInteger(state.boundary) &&
          state.boundary >= 0 &&
          state.boundary <= 3,
      );
      assert(typeof state.stopped === "boolean");
      assert(Number.isInteger(state.pc) && state.pc >= 0 && state.pc <= 6);
      assert(
        Array.isArray(state.commits) &&
          state.commits.every(Number.isSafeInteger),
      );
      assert.equal(state.boundary, states[0]!.boundary);
      assert.equal(state.stopped, states[0]!.stopped);
    }
    return states;
  };
  const actual = new Map<string, number[]>();
  const replayWitnessesBySeed: Record<string, string[]> = {};
  for (const seed of [42, 73, 103]) {
    const prefix = `claude-tap-lock-seed${seed}`;
    await h.command(prefix, [
      "run",
      model,
      "--backend",
      "typescript",
      "--seed",
      String(seed),
      "--max-samples",
      "100",
      "--max-steps",
      "25",
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
      const states = await load(file);
      const last = states.at(-1)!;
      assert.equal(last.pc, 6, "tap schedule did not finish");
      const boundary = tapBoundaries[last.boundary]!;
      const key = `${boundary}/${last.stopped ? "dead" : "live"}`;
      if (!actual.has(key))
        actual.set(key, replayTapLockSchedule(boundary, last.stopped).commits);
      assert.deepEqual(actual.get(key), last.commits, `tap.commits: ${key}`);
      witnessed.add(key);
    }
    assert.equal(witnessed.size, 8, `missing seed-${seed} tap schedule`);
    replayWitnessesBySeed[seed] = [...witnessed].sort();
  }
  // Retain the audit's age-stealing counterexample as a sensitivity control.
  const fault = "claude-tap-lock-steal.qnt";
  const source = await readFile(resolve(h.root, model), "utf8");
  assert(source.includes("STEAL_LIVE = false"));
  await writeFile(
    resolve(h.output, fault),
    source.replace("STEAL_LIVE = false", "STEAL_LIVE = true"),
  );
  const counterexample = "claude-tap-lock-steal.itf.json";
  await h.command(
    "claude-tap-lock-steal-control",
    [
      "verify",
      `${h.artifacts}/${fault}`,
      "--main",
      "claude_tap_lock",
      "--backend",
      "tlc",
      "--invariant",
      "safety",
      "--verbosity",
      "3",
      "--out-itf",
      `${h.artifacts}/${counterexample}`,
    ],
    true,
  );
  // TLC retains its native diagnostic; simulation exports the replayable ITF.
  await h.command(
    "claude-tap-lock-steal-replay",
    [
      "run",
      `${h.artifacts}/${fault}`,
      "--main",
      "claude_tap_lock",
      "--backend",
      "typescript",
      "--seed",
      "42",
      "--max-samples",
      "100",
      "--max-steps",
      "25",
      "--invariant",
      "safety",
      "--verbosity",
      "1",
      "--out-itf",
      `${h.artifacts}/${counterexample}`,
    ],
    true,
  );
  const bad = (await load(counterexample)).at(-1)!;
  assert(
    bad.commits.some(
      (value: number, i: number) => i > 0 && value < bad.commits[i - 1],
    ),
  );
  const positive = actual.get(`${tapBoundaries[bad.boundary]}/live`)!;
  assert.notDeepEqual(
    positive.slice(0, bad.commits.length),
    bad.commits,
    "unsafe model trace must diverge from production",
  );
  const mutant = await import(await h.mutate());
  const mutated = replayTapLockSchedule(
    "commit",
    false,
    mutant.claudeStatusLineTap,
  ).commits;
  assert.deepEqual(
    mutated,
    [20, 23, 22, 23],
    "unsafe-reclamation production control survived",
  );
  return {
    name: "claude-tap-lock",
    safety: "pass",
    schedules: actual.size,
    traces: 300,
    replayWitnessesBySeed,
    controls: ["model-live-steal", "implementation-live-steal"],
    elapsedSeconds: (performance.now() - started) / 1000,
  };
}
