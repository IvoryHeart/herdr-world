import { coreWitnesses } from "./herdr-core-runtime";
import { seenMismatches, seenWitnesses } from "./herdr-core-seen";
import type { Model } from "./traces";

// These cases own dedicated exploration and production-replay runners.
export const composedCases = [
  { name: "claude-tap-lock", witnesses: [], mismatches: [] },
  {
    name: "herdr-core-runtime",
    witnesses: coreWitnesses,
    mismatches: ["core.state"],
  },
  {
    name: "herdr-core-seen",
    witnesses: seenWitnesses,
    mismatches: seenMismatches,
  },
] as const;

export function replayTracesPerSeed(name: Model) {
  if (name === "effect-recovery") return 500;
  return [
    "binding-resolution",
    "browser-preparation",
    "chunk-credits",
    "creation-flow",
  ].includes(name)
    ? 500
    : 100;
}
