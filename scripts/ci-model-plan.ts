import assert from "node:assert/strict";
import { verificationModels } from "../quint/models";
import limits from "../tools/quint/model-resources.json";

type ModelPart =
  | "full"
  | "replay"
  | "checks-1"
  | "checks-2"
  | "checks-3"
  | "controls-1"
  | "controls-2";

/** Stable identities keep unrelated models' evidence independent of scheduling. */
export const verificationJobs = verificationModels.flatMap((model) => {
  const parts: ModelPart[] =
    model === "ide-lifecycle"
      ? ["replay", "checks-1", "checks-2", "checks-3"]
      : model === "herdr-core-runtime"
        ? ["replay", "controls-1", "controls-2"]
        : ["full"];
  return parts.map((part) => ({ model, part, id: `${model}-${part}` }));
});

// Resource-step seconds from clean main run 46077711273 (2026-11-27).
// Stable part IDs remain cache owners, independent of runner grouping.
/** @internal */
export const modelPartSeconds = [
  31, 108, 188, 115, 32, 119, 56, 96, 94, 39, 89, 21, 42, 25, 27, 23, 19, 12,
  15, 15, 11, 28, 19, 15, 31, 60,
];

export const MODEL_GROUP_WORKERS = 4;

// Payload-subtree memory.peak receipts for the same 26 parts in clean main
// run 46077711273 (4 GiB, four CPUs, TLC CI settings). This is a scheduling
// estimate, not an enforced per-part limit; the group's cgroup is authoritative.
const modelPartPeakBytes: Record<string, number> = {
  "effect-recovery-full": 595853312,
  "herdr-core-runtime-replay": 2170728448,
  "herdr-core-runtime-controls-1": 1163272192,
  "herdr-core-runtime-controls-2": 1072832512,
  "ide-lifecycle-replay": 434843648,
  "ide-lifecycle-checks-1": 2115325952,
  "ide-lifecycle-checks-2": 2123612160,
  "ide-lifecycle-checks-3": 1860026368,
  "space-admission-full": 916516864,
  "browser-preparation-full": 643796992,
  "observation-base-full": 1464483840,
  "binding-resolution-full": 556380160,
  "browser-refresh-full": 464560128,
  "chunk-credits-full": 883912704,
  "runtime-leases-full": 496537600,
  "runtime-control-full": 455790592,
  "runtime-drain-full": 472162304,
  "ranger-recovery-full": 455716864,
  "creation-flow-full": 573370368,
  "chunk-assembly-full": 609583104,
  "ranger-authority-full": 453795840,
  "herdr-core-seen-full": 463532032,
  "connection-registry-full": 462962688,
  "claude-tap-lock-full": 455413760,
  "agent-move-full": 848261120,
  "world-write-path-full": 366862336,
};

/** Leave room for the group supervisor and variation outside model processes. @internal */
export const MODEL_GROUP_RESERVE_BYTES = 256 * 1024 * 1024;

/** Reserve 25% above the recorded peak, rounded up to 64 MiB. @internal */
export function modelPartMemoryBytes(index: number) {
  const { id } = verificationJob(index);
  const peak = modelPartPeakBytes[id]!;
  assert(Number.isSafeInteger(peak) && peak > 0, "Missing model memory peak");
  const quantum = 64 * 1024 * 1024;
  return Math.ceil((peak * 1.25) / quantum) * quantum;
}

/**
 * Time-packed runner groups execute memory-bounded waves. Wait for a whole
 * wave to drain before admitting the next: a newly freed worker slot alone
 * does not imply that another part's peak fits. Cache misses are repacked.
 * @internal
 */
export function modelGroupWaves(indices: readonly number[]) {
  assert.equal(new Set(indices).size, indices.length, "Duplicate model part");
  const waves: number[][] = [];
  const memory: number[] = [];
  for (const index of indices) modelPartMemoryBytes(index);
  for (const index of [...indices].sort(
    (a, b) => modelPartSeconds[b - 1]! - modelPartSeconds[a - 1]!,
  )) {
    const bytes = modelPartMemoryBytes(index);
    const budget = limits.memoryMaxBytes - MODEL_GROUP_RESERVE_BYTES;
    assert(bytes <= budget, "Model part exceeds group memory budget");
    const wave = waves.findIndex(
      (parts, i) =>
        parts.length < MODEL_GROUP_WORKERS && memory[i]! + bytes <= budget,
    );
    if (wave < 0) {
      waves.push([index]);
      memory.push(bytes);
    } else {
      waves[wave]!.push(index);
      memory[wave]! += bytes;
    }
  }
  return waves;
}

/** Longest first, balanced by recorded work across four runner groups. @internal */
export const verificationGroups = (() => {
  assert.equal(modelPartSeconds.length, verificationJobs.length);
  const groups = Array.from({ length: 4 }, () => [] as number[]);
  const loads = groups.map(() => 0);
  for (const index of verificationJobs
    .map((_, index) => index)
    .sort((a, b) => modelPartSeconds[b]! - modelPartSeconds[a]!)) {
    const group = loads.indexOf(Math.min(...loads));
    groups[group]!.push(index + 1);
    loads[group]! += modelPartSeconds[index]!;
  }
  return groups;
})();

export function verificationGroup(index: number) {
  assert(
    Number.isInteger(index) && index >= 1 && index <= verificationGroups.length,
    "Invalid verification group",
  );
  return verificationGroups[index - 1]!;
}

export function verificationJob(index: number) {
  assert(
    Number.isInteger(index) && index >= 1 && index <= verificationJobs.length,
    "Invalid verification shard",
  );
  return verificationJobs[index - 1]!;
}

export function modelPartScope(index: number) {
  const { model, part } = verificationJob(index);
  return {
    kind: "focused" as const,
    models: [model],
    ...(part === "full" ? {} : { part }),
  };
}
