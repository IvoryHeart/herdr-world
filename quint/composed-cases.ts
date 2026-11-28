import { moveMismatches, moveWitnesses } from "./agent-move";
import { coreWitnesses } from "./herdr-core-runtime";
import { seenMismatches, seenWitnesses } from "./herdr-core-seen";
import type { Model } from "./traces";
import { writePathScenarios } from "./world-write-path";
import { identityScenarios } from "./agent-identity";

// Composed cases have dedicated replay/exploration runners.
export const composedCases = [
  {
    name: "connection-registry",
    witnesses: [],
    mismatches: ["registry.overlap"],
  },
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
  {
    name: "agent-move",
    witnesses: moveWitnesses,
    mismatches: moveMismatches,
  },
  { name: "ide-lifecycle", witnesses: [], mismatches: [] },
  {
    name: "world-write-path",
    witnesses: writePathScenarios,
    mismatches: writePathScenarios.map((s) => `write-path.${s}` as const),
  },
  {
    name: "agent-identity",
    witnesses: identityScenarios,
    mismatches: identityScenarios.map((s) => `agent-identity.${s}` as const),
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
