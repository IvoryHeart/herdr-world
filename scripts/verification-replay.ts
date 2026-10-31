import { replayObservationBase } from "../quint/observation-base";
import { replayRuntimeControl } from "../quint/runtime-control";
import { replayBrowserPreparation } from "../quint/browser-preparation";
import { replayRuntimeDrain } from "../quint/runtime-drain";
import { replayChunkCredits } from "../quint/chunk-credits";
import { replayChunkAssembly } from "../quint/chunk-assembly";
import { replayCreationFlow } from "../quint/creation-flow";
import { replayRangerAuthority } from "../quint/ranger-authority";
import { replayRangerRecovery } from "../quint/ranger-recovery";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { replayRefresh, replayRuntime, replaySpaces } from "../quint/replay";
import {
  expectObservationMismatch,
  isObservationMismatch,
} from "../quint/observations";
import { loadTrace, type Model, type ReplayDomain } from "../quint/traces";

type ReplayRequest = {
  model: Model;
  files: string[];
  mode: "positive" | "mutation" | "counterexample";
  allowed: string[];
  mutant?: string;
  domain?: ReplayDomain;
  reverseRegistration?: boolean;
  spaceOrder?: number[];
};

let activeTrace: string | undefined;
async function replay(request: ReplayRequest, resultPath: string) {
  assert(
    [
      "runtime-leases",
      "ranger-recovery",
      "ranger-authority",
      "creation-flow",
      "chunk-assembly",
      "chunk-credits",
      "runtime-drain",
      "runtime-control",
      "observation-base",
      "browser-preparation",
      "browser-refresh",
      "space-admission",
    ].includes(request.model),
  );
  assert(request.files.length > 0 && request.allowed.length > 0);
  if (request.spaceOrder)
    assert(
      request.spaceOrder.length === 6 &&
        new Set(request.spaceOrder).size === 6 &&
        request.spaceOrder.every(
          (id) => Number.isInteger(id) && id >= 0 && id <= 5,
        ),
      "invalid allocation order",
    );
  assert(
    request.reverseRegistration === undefined ||
      typeof request.reverseRegistration === "boolean",
  );
  const exports = request.mutant ? await import(request.mutant) : null;
  const execute = (states: Awaited<ReturnType<typeof loadTrace>>) => {
    if (request.model === "observation-base")
      return replayObservationBase(
        states,
        exports?.WorldRuntimeStore,
        exports?.WorldObservation,
      );
    if (request.model === "ranger-recovery")
      return replayRangerRecovery(states, exports?.openTaskStorage);
    if (request.model === "ranger-authority")
      return replayRangerAuthority(states, exports?.prepareAssistantAction);
    if (request.model === "creation-flow")
      return replayCreationFlow(states, exports ?? undefined);
    if (request.model === "chunk-assembly")
      return replayChunkAssembly(states, exports?.Bridge);
    if (request.model === "chunk-credits")
      return replayChunkCredits(states, exports?.WorldSnapshotAdmission);
    if (request.model === "runtime-drain")
      return replayRuntimeDrain(states, exports?.ConnectionManager);
    if (request.model === "browser-preparation")
      return replayBrowserPreparation(states, exports?.WorldRuntimeStore);
    if (request.model === "runtime-control")
      return replayRuntimeControl(states, exports?.ConnectionManager);
    if (request.model === "runtime-leases")
      return replayRuntime(
        states,
        exports?.ConnectionManager,
        request.reverseRegistration,
      );
    if (request.model === "browser-refresh")
      return replayRefresh(states, exports?.WorldRuntimeStore);
    return replaySpaces(states, exports?.admitWorldSpaces, request.spaceOrder);
  };
  const witnesses: Record<string, number> = {};
  const witnessesBySeed: Record<string, Record<string, number>> = {};
  let steps = 0;
  for (const file of request.files) {
    activeTrace = file;
    // Trace/codec failures occur outside the expected observation rejection.
    const states = await loadTrace(file, request.model, request.domain);
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
      const seed = basename(file).match(/-seed(\d+)_/)?.[1] ?? "42";
      const counts = (witnessesBySeed[seed] ??= {});
      for (const name of observed) {
        witnesses[name] = (witnesses[name] ?? 0) + 1;
        counts[name] = (counts[name] ?? 0) + 1;
      }
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
      witnessesBySeed,
    }),
  );
}

if (import.meta.main) {
  const request = JSON.parse(
    await readFile(process.argv[2]!, "utf8"),
  ) as ReplayRequest;
  try {
    await replay(request, process.argv[3]!);
  } catch (error) {
    await writeFile(
      process.argv[3]! + ".failure.json",
      JSON.stringify({
        model: request.model,
        trace: activeTrace ? basename(activeTrace) : null,
        observation:
          error instanceof Error && "observation" in error
            ? error.observation
            : null,
        reason:
          error instanceof Error ? error.message : "Unknown replay failure",
      }),
    );
    throw error;
  }
}
