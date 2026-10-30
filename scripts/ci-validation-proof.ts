import type { ValidationSelection } from "./validation-scope";

export type ValidationProof = { mode: string; selection: ValidationSelection };
export const VALIDATION_PROOF_PREFIX = "[delivery-proof] ";

/** Accept exactly one machine-readable record from the successful delivery job. */
export function validationProofFromLog(
  log: string,
): ValidationProof | undefined {
  const records = log
    .split("\n")
    .map((line) => line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, ""))
    .filter((line) => line.startsWith(VALIDATION_PROOF_PREFIX));
  if (records.length !== 1) return undefined;
  try {
    const proof = JSON.parse(
      records[0]!.slice(VALIDATION_PROOF_PREFIX.length),
    ) as ValidationProof;
    const scope = proof?.selection;
    if (
      !["full", "scoped", "tooling", "docs", "reuse"].includes(proof?.mode) ||
      !scope ||
      typeof scope.reason !== "string"
    )
      return undefined;
    if (
      ![
        scope.full,
        scope.tooling,
        scope.documentation,
        scope.verification,
        scope.packaging,
      ].every((value) => typeof value === "boolean")
    )
      return undefined;
    if (
      ![scope.unit, scope.world, scope.web].every(
        (paths) =>
          Array.isArray(paths) &&
          paths.every((path) => typeof path === "string"),
      )
    )
      return undefined;
    if (
      !Array.isArray(scope.worldShards) ||
      !scope.worldShards.every(
        (index) => Number.isInteger(index) && index >= 1 && index <= 6,
      )
    )
      return undefined;
    return proof;
  } catch {
    return undefined;
  }
}

/** Array order determines test sharding, so it is part of the proof. */
export function sameValidationSelection(
  left: ValidationSelection,
  right: ValidationSelection,
): boolean {
  return (
    JSON.stringify(left, Object.keys(left).sort()) ===
    JSON.stringify(right, Object.keys(right).sort())
  );
}
