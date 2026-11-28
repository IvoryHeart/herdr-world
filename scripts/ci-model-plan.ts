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
  | "controls-2"
  | "controls-3";

/** Stable identities keep unrelated models' evidence independent of scheduling. */
export const verificationJobs = verificationModels.flatMap((model) => {
  const parts: ModelPart[] =
    model === "ide-lifecycle"
      ? ["replay", "checks-1", "checks-2", "checks-3"]
      : model === "herdr-core-runtime"
        ? ["replay", "controls-1", "controls-2", "controls-3"]
        : ["full"];
  return parts.map((part) => ({ model, part, id: `${model}-${part}` }));
});

// Whole-part seconds from run 46147624726 (2026-11-28), including replay,
// controls and evidence publication. Checker-only estimates underpacked group 1.
// Stable part IDs remain cache owners, independent of runner grouping.
/** @internal */
export const modelPartSeconds = [
  82, 136, 113, 131, 100, 41, 208, 50, 81, 162, 68, 76, 47, 70, 54, 42, 60, 51,
  23, 24, 22, 20, 32, 26, 21, 74, 138,
];

/**
 * Peak cgroup memory (MiB) of each part when it ran alone, from the same run
 * 46077711273 (one part per job, page cache included, every JVM at -Xmx1G);
 * the three core control parts take that run's larger control peak.
 * @internal
 */
export const modelPartPeakMiB = [
  568, 2070, 1109, 1109, 1109, 415, 2017, 2025, 1774, 874, 614, 1397, 531, 443,
  843, 474, 435, 450, 435, 547, 581, 433, 442, 442, 434, 809, 350,
];

export const MODEL_GROUP_WORKERS = 4;

/** What one group's parts may hold at once: its cgroup's memory limit. */
/** Leave room for the group supervisor and variation outside model processes. @internal */
export const MODEL_GROUP_RESERVE_BYTES = 256 * 1024 * 1024;

/** Reserve 25% above the recorded peak, rounded up to 64 MiB. @internal */
export function modelPartMemoryBytes(index: number) {
  const peak = modelPartPeakMiB[index - 1]! * 2 ** 20;
  verificationJob(index);
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

export const MODEL_GROUP_MEMORY_MIB =
  (limits.memoryMaxBytes - MODEL_GROUP_RESERVE_BYTES) / 2 ** 20;

/**
 * The group's pool: up to four parts at once, in order, and the next part
 * starts only while the running parts' peaks plus its own fit the group's
 * memory (a part alone always starts). Returns the simulated wall time and
 * the largest sum of concurrent peaks. @internal
 */
export function simulateModelGroup(indices: readonly number[]) {
  for (const index of indices)
    assert(
      modelPartMemoryBytes(index) / 2 ** 20 <= MODEL_GROUP_MEMORY_MIB,
      "Model part exceeds group memory budget",
    );
  let now = 0;
  let maxMiB = 0;
  const running: Array<{ end: number; index: number }> = [];
  const queue = [...indices];
  const used = () =>
    running.reduce(
      (sum, part) => sum + modelPartMemoryBytes(part.index) / 2 ** 20,
      0,
    );
  while (queue.length || running.length) {
    while (
      queue.length &&
      running.length < MODEL_GROUP_WORKERS &&
      (!running.length ||
        used() + modelPartMemoryBytes(queue[0]!) / 2 ** 20 <=
          MODEL_GROUP_MEMORY_MIB)
    ) {
      const index = queue.shift()!;
      running.push({ end: now + modelPartSeconds[index - 1]!, index });
    }
    maxMiB = Math.max(maxMiB, used());
    running.sort((a, b) => a.end - b.end);
    now = running.shift()!.end;
  }
  return { seconds: now, maxMiB };
}

/**
 * Packed by peak memory and recorded time: the largest memory-time parts are
 * placed first, each into the group whose simulated pool then finishes
 * soonest, so heavy JVMs spread across runners instead of sharing one cgroup.
 * Each group runs its parts longest first. @internal
 */
export const verificationGroups = (() => {
  assert.equal(modelPartSeconds.length, verificationJobs.length);
  assert.equal(modelPartPeakMiB.length, verificationJobs.length);
  const longestFirst = (group: number[]) =>
    [...group].sort(
      (a, b) => modelPartSeconds[b - 1]! - modelPartSeconds[a - 1]! || a - b,
    );
  const groups = Array.from({ length: 4 }, () => [] as number[]);
  const weight = (index: number) =>
    modelPartPeakMiB[index - 1]! * modelPartSeconds[index - 1]!;
  for (const index of verificationJobs
    .map((_, i) => i + 1)
    .sort((a, b) => weight(b) - weight(a) || a - b)) {
    let best = 0;
    let soonest = Infinity;
    groups.forEach((group, candidate) => {
      const { seconds } = simulateModelGroup(longestFirst([...group, index]));
      const total = seconds + (candidate === 0 ? 18 : 0);
      if (total < soonest) {
        soonest = total;
        best = candidate;
      }
    });
    groups[best]!.push(index);
  }
  const load = (parts: number[], group: number) =>
    simulateModelGroup(longestFirst(parts)).seconds + (group === 0 ? 18 : 0);
  const score = (candidate: number[][]) => {
    const loads = candidate.map(load);
    return Math.max(...loads) * 1000 + Math.max(...loads) - Math.min(...loads);
  };
  for (;;) {
    let best = score(groups);
    let chosen: number[][] | undefined;
    for (let from = 0; from < groups.length; from++)
      for (const index of groups[from]!)
        for (let to = from + 1; to < groups.length; to++)
          for (const other of [undefined, ...groups[to]!]) {
            const candidate = groups.map((parts) => [...parts]);
            candidate[from] = candidate[from]!.filter((part) => part !== index);
            candidate[to] = candidate[to]!.filter((part) => part !== other);
            candidate[to]!.push(index);
            if (other !== undefined) candidate[from]!.push(other);
            const next = score(candidate);
            if (next < best) {
              best = next;
              chosen = candidate;
            }
          }
    if (!chosen) break;
    groups.splice(0, groups.length, ...chosen);
  }
  return groups.map(longestFirst);
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
