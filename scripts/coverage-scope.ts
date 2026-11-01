import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

type Area = {
  [key: string]: unknown;
  id?: string;
  owner?: string;
  status?: string;
  partialEvidence?: { models?: string[] };
};
type Coverage = { areas: Area[]; [key: string]: unknown };
const modeled = (area: Area) =>
  area.status !== "alternative-evidence" ||
  !Array.isArray(area.partialEvidence?.models) ||
  area.partialEvidence.models.length > 0;
const matches = (owner: string | undefined, path: string) =>
  !!owner && (owner.endsWith("/") ? path.startsWith(owner) : path === owner);

/** Only explicitly model-free inventory changes may skip the model gate. */
export function coverageChangesRequireModels(
  before: Coverage,
  after: Coverage,
): boolean {
  const { areas: oldAreas, ...oldHeader } = before;
  const { areas: newAreas, ...newHeader } = after;
  if (JSON.stringify(oldHeader) !== JSON.stringify(newHeader)) return true;
  const ids = new Set([...oldAreas, ...newAreas].map((area) => area.id));
  for (const id of ids) {
    const old = oldAreas.find((area) => area.id === id);
    const next = newAreas.find((area) => area.id === id);
    if (
      !id ||
      oldAreas.filter((area) => area.id === id).length > 1 ||
      newAreas.filter((area) => area.id === id).length > 1
    )
      return true;
    if (
      JSON.stringify(old) !== JSON.stringify(next) &&
      ((old && modeled(old)) || (next && modeled(next)))
    )
      return true;
  }
  return false;
}

export function readCoverageScope(root: string, base?: string) {
  const coverage = JSON.parse(
    readFileSync(join(root, "verification/coverage.json"), "utf8"),
  ) as Coverage;
  let inventoryModels = true;
  if (base) {
    try {
      const old = JSON.parse(
        execFileSync("git", ["show", `${base}:verification/coverage.json`], {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
      ) as Coverage;
      inventoryModels = coverageChangesRequireModels(old, coverage);
    } catch {
      /* Missing or malformed baseline requires the full model gate. */
    }
  }
  return {
    owns: (path: string) =>
      coverage.areas.some((area) => matches(area.owner, path)),
    models: (path: string) =>
      path === "verification/coverage.json"
        ? inventoryModels
        : coverage.areas.some(
            (area) => matches(area.owner, path) && modeled(area),
          ),
  };
}
