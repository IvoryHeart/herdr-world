import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const coverageDirectory = "verification/coverage";
const legacyPath = "verification/coverage.json";
export const isCoveragePath = (path: string) =>
  path === legacyPath || /^verification\/coverage\/[^/]+\.json$/.test(path);

export type CoverageArea = {
  id: string;
  area: string;
  owner: string;
  requirement: string;
  properties: string;
  assessment: string;
  existingTests: string[];
  acceptedDelivery: string;
  status: string;
  remaining: string;
  requiredChecks: string[];
  partialEvidence?: {
    models: string[];
    contracts: string[];
    tests?: string[];
    checks: string[];
    review: string;
  };
  supplementalContracts?: {
    requirement: string;
    contract: string;
    owners: string[];
    tests: string[];
  }[];
  [key: string]: unknown;
};
export type Coverage = {
  schemaVersion: number;
  areas: CoverageArea[];
  [key: string]: unknown;
};

/** Deterministic merged view, from this worktree or an immutable Git revision. */
export function readCoverage(root: string, ref?: string): Coverage {
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  const read = (path: string) =>
    JSON.parse(
      ref
        ? git("show", `${ref}:${path}`)
        : readFileSync(join(root, path), "utf8"),
    );
  let files: string[];
  if (ref) {
    try {
      files = git("ls-tree", "--name-only", `${ref}:${coverageDirectory}`)
        .trim()
        .split("\n")
        .filter(Boolean);
    } catch {
      // A PR that crosses the migration still compares against its old baseline.
      return read(legacyPath) as Coverage;
    }
  } else files = readdirSync(join(root, coverageDirectory));
  const metadata = read(`${coverageDirectory}/_meta.json`);
  if (
    !metadata ||
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    "areas" in metadata
  )
    throw new Error("Coverage _meta.json must contain shared fields only");
  const ids = new Set<string>();
  const areas = files
    .filter((file) => file.endsWith(".json") && file !== "_meta.json")
    .sort()
    .map((file) => {
      const area = read(`${coverageDirectory}/${file}`) as CoverageArea;
      // Q01–Q58 are retained; all new areas use independent slug IDs.
      if (
        !area ||
        typeof area.id !== "string" ||
        !/^(?:Q(?:0[1-9]|[1-4][0-9]|5[0-8])|[a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/.test(
          area.id,
        ) ||
        ids.has(area.id) ||
        file !== `${area.id}.json`
      )
        throw new Error(
          `Invalid, duplicate or mismatched coverage ID in ${file}`,
        );
      ids.add(area.id);
      return area;
    });
  return { ...metadata, areas };
}
