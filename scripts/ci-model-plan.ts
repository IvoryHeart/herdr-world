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
