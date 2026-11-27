import assert from "node:assert/strict";
import { verificationModels } from "../quint/models";

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
