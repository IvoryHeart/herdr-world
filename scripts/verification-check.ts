import assert from "node:assert/strict";
import { resolve } from "node:path";
import { runParallelVerification } from "./verification-parallel";
import execution from "../tools/quint/execution.json";

assert.equal(
  process.argv.length,
  2,
  "The canonical gate accepts no filters; use the focused development runner instead",
);
const cancellation = new AbortController();
const stop = () =>
  cancellation.abort(new Error("Complete verification cancelled"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const timer = setTimeout(stop, execution.runTimeoutMs);
try {
  await runParallelVerification(
    resolve(import.meta.dir, ".."),
    cancellation.signal,
  );
} finally {
  clearTimeout(timer);
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}
