import assert from "node:assert/strict";
import { resolve } from "node:path";

assert.equal(
  process.argv.length,
  2,
  "The canonical gate accepts no filters; use the focused development runner instead",
);

// Relay cancellation to the runner, which drains its individually owned checker
// and replay process groups. Individual commands and the complete run are bounded.
const child = Bun.spawn(
  [process.execPath, resolve(import.meta.dir, "../experiments/quint/run.ts")],
  {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);
let cancelled = false;
let force: ReturnType<typeof setTimeout> | undefined;
const stop = () => {
  cancelled = true;
  child.kill("SIGTERM");
  force ??= setTimeout(() => child.kill("SIGKILL"), 10_000);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const timer = setTimeout(stop, 15 * 60_000);
try {
  const code = await child.exited;
  process.exitCode = cancelled ? 1 : code;
} finally {
  clearTimeout(timer);
  clearTimeout(force);
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}
