import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every job of release-candidate.yml that the seal depends on. The seal job
 * needs each one directly, so its `needs` context carries every result.
 * @internal
 */
export const CONTRACT_JOBS = [
  "validate",
  "package",
  "release-walk",
  "archives",
  "npm-stage",
  "npm-smoke",
  "homebrew-formula",
  "homebrew-smoke",
] as const;

/** @internal */
export const SEAL_FILE = "seal.json";

type Needs = Record<string, { result?: string }>;
type Seal = {
  run_id: string;
  run_attempt: string;
  jobs: Record<string, string>;
};

/** Names of contract jobs whose result is not exactly `success`. */
function unfinished(results: Record<string, string | undefined>) {
  return CONTRACT_JOBS.filter((job) => results[job] !== "success").map(
    (job) => `${job}=${results[job] ?? "missing"}`,
  );
}

/**
 * Record the contract job results in the sealed bundle, refusing unless every
 * contract job succeeded. Cancelled or skipped is not success.
 * @internal
 */
export function writeSeal(
  dir: string,
  needs: Needs,
  run: { id: string; attempt: string },
) {
  const jobs = Object.fromEntries(
    CONTRACT_JOBS.map((job) => [job, needs[job]?.result ?? "missing"]),
  );
  const bad = unfinished(jobs);
  if (bad.length)
    throw new Error(
      `Refusing to seal: not every contract job succeeded (${bad.join(", ")})`,
    );
  const seal: Seal = { run_id: run.id, run_attempt: run.attempt, jobs };
  writeFileSync(join(dir, SEAL_FILE), `${JSON.stringify(seal, null, 2)}\n`);
  return seal;
}

/**
 * Accept retained bytes only when their seal came from this run and records
 * every contract job as succeeded. A seal written before this file existed
 * has no record, so those bytes are rebuilt and retested.
 * @internal
 */
export function checkSeal(dir: string, runId: string) {
  let seal: Seal;
  try {
    seal = JSON.parse(readFileSync(join(dir, SEAL_FILE), "utf8"));
  } catch {
    throw new Error("Retained bytes carry no seal record");
  }
  if (String(seal.run_id) !== runId)
    throw new Error(
      `Retained seal belongs to run ${seal.run_id}, not ${runId}`,
    );
  const bad = unfinished(seal.jobs ?? {});
  if (bad.length)
    throw new Error(
      `Retained seal has contract jobs that did not succeed (${bad.join(", ")})`,
    );
  return seal;
}

if (import.meta.main) {
  const [command, dir] = process.argv.slice(2);
  try {
    if (command === "write" && dir)
      writeSeal(dir, JSON.parse(process.env.NEEDS ?? "{}"), {
        id: process.env.GITHUB_RUN_ID ?? "",
        attempt: process.env.GITHUB_RUN_ATTEMPT ?? "",
      });
    else if (command === "check" && dir)
      checkSeal(dir, process.env.GITHUB_RUN_ID ?? "");
    else throw new Error("usage: release-seal.ts write|check <dir>");
  } catch (error) {
    const message = (error as Error).message;
    console.error(
      command === "check"
        ? `::warning::${message}; building and testing the tagged bytes again.`
        : `::error::${message}.`,
    );
    process.exitCode = 1;
  }
}
