import { writeSync } from "node:fs";
import { effectFixture, OWNER } from "./fixture";
import type { EffectRecovery } from "../../storage/world-protocol";

export function runCrashFixture(
  root: string,
  recovery: EffectRecovery,
  mode: string,
) {
  const stopAt = (phase: string): never => {
    writeSync(1, phase + "\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    throw new Error("Crash checkpoint resumed");
  };
  const fixture = effectFixture(root, recovery, {
    commit: (phase) => {
      if (phase === mode) stopAt(phase);
    },
    checkpoint: async (phase, entry) => {
      if (
        (mode === "cancel-before" && phase === "claimed") ||
        (mode === "cancel-after" && phase === "after-source")
      ) {
        await fixture.store.transition({
          action: "cancel",
          id: entry.id,
          actor: OWNER,
          reason: "Owner cancelled the fixture",
        });
        stopAt("cancelled");
      }
      if (phase === mode) stopAt(phase);
    },
  });
  if (mode === "permanent") fixture.set("permanent", "1");
  return fixture.runner.run(fixture.id).then(() => stopAt("completed"));
}
if (import.meta.main) {
  const [root, recovery, mode] = process.argv.slice(2);
  if (!root || !recovery || !mode)
    throw new Error("crash fixture requires root, recovery and mode");
  await runCrashFixture(root, recovery as EffectRecovery, mode);
}
