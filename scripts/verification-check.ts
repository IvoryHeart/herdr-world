import { resolve } from "node:path";

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
const stop = () => child.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const timer = setTimeout(stop, 15 * 60_000);
const force = setTimeout(() => child.kill("SIGKILL"), 15 * 60_000 + 10_000);
try {
  process.exitCode = await child.exited;
} finally {
  clearTimeout(timer);
  clearTimeout(force);
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}
