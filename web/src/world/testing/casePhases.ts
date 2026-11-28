import { appendFileSync } from "node:fs";

/**
 * Phase marks for one browser case. When the World runner names a phases
 * file (HERDR_WORLD_TEST_PHASES), each finished case appends one JSON line
 * with the seconds spent in every phase since the previous mark; the runner
 * turns them into the job summary table (scripts/world-case-phases.ts).
 */
export function casePhases(name: string) {
  const began = performance.now();
  let last = began;
  const phases: [string, number][] = [];
  return {
    mark(phase: string) {
      const now = performance.now();
      phases.push([phase, Math.round(now - last) / 1000]);
      last = now;
    },
    /** Records the rest as `last`, including after a failure. */
    done(lastPhase = "teardown") {
      const file = Bun.env.HERDR_WORLD_TEST_PHASES;
      this.mark(lastPhase);
      if (!file) return;
      appendFileSync(
        file,
        `${JSON.stringify({
          case: name,
          seconds: Math.round(performance.now() - began) / 1000,
          phases,
        })}\n`,
      );
    },
  };
}
