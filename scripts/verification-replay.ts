import { replayRuntimeControl } from "../experiments/quint/runtime-control";
import { replayBrowserPreparation } from "../experiments/quint/browser-preparation";
import { replayRuntimeDrain } from "../experiments/quint/runtime-drain";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  replayRefresh,
  replayRuntime,
  replaySpaces,
} from "../experiments/quint/replay";
import {
  expectObservationMismatch,
  isObservationMismatch,
} from "../experiments/quint/observations";
import { loadTrace, type Model } from "../experiments/quint/traces";

type ReplayRequest = {
  model: Model;
  files: string[];
  mode: "positive" | "mutation" | "counterexample";
  allowed: string[];
  mutant?: string;
};

async function replay(request: ReplayRequest, resultPath: string) {
  assert(
    [
      "runtime-leases",
      "runtime-drain",
      "runtime-control",
      "browser-preparation",
      "browser-refresh",
      "space-admission",
    ].includes(request.model),
  );
  assert(request.files.length > 0 && request.allowed.length > 0);
  const exports = request.mutant ? await import(request.mutant) : null;
  const execute = (states: Awaited<ReturnType<typeof loadTrace>>) => {
    if (request.model === "runtime-drain")
      return replayRuntimeDrain(states, exports?.ConnectionManager);
    if (request.model === "browser-preparation")
      return replayBrowserPreparation(states, exports?.WorldRuntimeStore);
    if (request.model === "runtime-control")
      return replayRuntimeControl(states, exports?.ConnectionManager);
    if (request.model === "runtime-leases")
      return replayRuntime(states, exports?.ConnectionManager);
    if (request.model === "browser-refresh")
      return replayRefresh(states, exports?.WorldRuntimeStore);
    return replaySpaces(states, exports?.admitWorldSpaces);
  };
  const witnesses: Record<string, number> = {};
  let steps = 0;
  for (const file of request.files) {
    // Trace/codec failures occur outside the expected observation rejection.
    const states = await loadTrace(file, request.model);
    if (request.mode === "counterexample") {
      const mismatch = await expectObservationMismatch(
        () => execute(states),
        request.allowed,
      );
      await writeFile(
        resultPath,
        JSON.stringify({
          kind: "negative",
          trace: basename(file),
          observation: mismatch.observation,
        }),
      );
      return;
    }
    try {
      const observed = await execute(states);
      for (const name of observed) witnesses[name] = (witnesses[name] ?? 0) + 1;
      steps += states.length - 1;
    } catch (error) {
      if (
        request.mode !== "mutation" ||
        !isObservationMismatch(error, request.allowed)
      )
        throw error;
      await writeFile(
        resultPath,
        JSON.stringify({
          kind: "negative",
          trace: basename(file),
          observation: error.observation,
        }),
      );
      return;
    }
  }
  if (request.mode !== "positive")
    throw new Error("No expected mutation observation was rejected");
  await writeFile(
    resultPath,
    JSON.stringify({
      kind: "positive",
      traces: request.files.length,
      steps,
      witnesses,
    }),
  );
}

if (import.meta.main) {
  const request = JSON.parse(
    await readFile(process.argv[2]!, "utf8"),
  ) as ReplayRequest;
  await replay(request, process.argv[3]!);
}
