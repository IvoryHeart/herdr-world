import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runVerificationProcess } from "./verification-process";
import { loadTrace } from "../experiments/quint/traces";
import { replayRefresh } from "../experiments/quint/replay";
import { expectObservationMismatch } from "../experiments/quint/observations";

/** Validate retained or downloaded artifacts, including actual counterexample replay. */
export async function validateDiagnosticControl(directory: string) {
  const index = JSON.parse(
    await readFile(resolve(directory, "index.json"), "utf8"),
  );
  assert.equal(index.label, "browser-refresh-counterexample-replay");
  assert(index.bytes <= index.limits.totalBytes);
  assert(
    index.retained.includes("commands.json") &&
      index.retained.includes("run.failure.json"),
  );
  assert(
    !index.retained.some((name: string) =>
      /\.mjs$|node_modules|temporary/.test(name),
    ),
  );
  const metadata = JSON.parse(
    await readFile(
      resolve(directory, `${index.label}-result.json.failure.json`),
      "utf8",
    ),
  );
  assert.equal(metadata.model, "browser-refresh");
  assert.equal(metadata.observation, "refresh.status");
  assert(index.retained.includes(metadata.trace));
  const trace = await loadTrace(
    resolve(directory, metadata.trace),
    "browser-refresh",
  );
  await expectObservationMismatch(
    () => replayRefresh(trace),
    [metadata.observation],
  );
  const progress = JSON.parse(
    await readFile(resolve(directory, "commands.json"), "utf8"),
  );
  assert(
    progress.length > 0 &&
      progress.some((command: { code: number }) => command.code !== 0),
  );
  console.info(
    "Retained failed candidate identifies browser-refresh/refresh.status and its trace reproduces the mismatch.",
  );
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 2 && args[0] === "--validate"));
  if (args.length) await validateDiagnosticControl(resolve(args[1]!));
  else {
    const root = resolve(import.meta.dir, "..");
    const result = await runVerificationProcess(
      [
        process.execPath,
        resolve(root, "experiments/quint/run.ts"),
        "--diagnostic-control",
      ],
      { cwd: root, timeoutMs: 120_000 },
    );
    assert.notEqual(
      result.code,
      0,
      "Intentional failing candidate unexpectedly passed",
    );
    const match = result.stderr.match(
      /Diagnostics: (\.agents\/verification\/diagnostics\/[a-zA-Z0-9_.-]+)/,
    );
    assert(match, "Failing candidate did not retain diagnostics");
    await validateDiagnosticControl(resolve(root, match[1]!));
  }
}
