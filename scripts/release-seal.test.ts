import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CONTRACT_JOBS, SEAL_FILE, checkSeal, writeSeal } from "./release-seal";

type Job = {
  needs?: string[];
  if?: string;
  outputs?: Record<string, string>;
  steps?: any[];
};
const workflow = (name: string) =>
  (
    Bun.YAML.parse(readFileSync(`.github/workflows/${name}`, "utf8")) as {
      jobs: Record<string, Job>;
    }
  ).jobs;

/**
 * Evaluate a job-level `if:` the way Actions does for the clauses our
 * workflows use, given the results of the job's needs in a run that was not
 * cancelled. An unknown clause fails the test rather than guessing.
 */
function runsJob(condition: string, needs: Record<string, string>) {
  const body = condition.replace(/^\$\{\{\s*/, "").replace(/\s*\}\}$/, "");
  return body.split("&&").every((raw) => {
    const clause = raw.trim();
    if (clause === "!cancelled()" || clause === "always()") return true;
    if (clause === "!failure()")
      return !Object.values(needs).includes("failure");
    if (clause === "success()")
      return Object.values(needs).every((r) => r === "success");
    const match = /^needs\.([\w-]+)\.result == '(\w+)'$/.exec(clause);
    if (!match) throw new Error(`Unknown condition clause: ${clause}`);
    return needs[match[1]!] === match[2];
  });
}

const allSucceeded = () =>
  Object.fromEntries(CONTRACT_JOBS.map((job) => [job, "success"]));

test("the seal job needs every contract job of the release candidate", () => {
  const jobs = workflow("release-candidate.yml");
  const contract = Object.keys(jobs).filter((name) => name !== "verify");
  expect(([...CONTRACT_JOBS] as string[]).sort()).toEqual(contract.sort());
  expect([...(jobs.verify!.needs ?? [])].sort()).toEqual(contract.sort());
});

test("the seal waits for every contract job to succeed, not merely not fail", () => {
  const verify = workflow("release-candidate.yml").verify!;
  // The condition that sealed while darwin-arm64's walk was cancelled.
  expect(
    runsJob("${{ !cancelled() && !failure() }}", {
      ...allSucceeded(),
      "release-walk": "cancelled",
    }),
  ).toBe(true);
  expect(runsJob(verify.if!, allSucceeded())).toBe(true);
  for (const job of CONTRACT_JOBS)
    for (const result of ["cancelled", "skipped", "failure"])
      expect(runsJob(verify.if!, { ...allSucceeded(), [job]: result })).toBe(
        false,
      );
});

test("the seal step records the run's needs before the bundle uploads", () => {
  const steps = workflow("release-candidate.yml").verify!.steps!;
  const record = steps.findIndex(
    (step) => step.run === "bun scripts/release-seal.ts write candidate",
  );
  const upload = steps.findIndex((step) => step.id === "bundle");
  expect(record).toBeGreaterThan(-1);
  expect(record).toBeLessThan(upload);
  expect(steps[record].env.NEEDS).toBe("${{ toJSON(needs) }}");
});

test("Release reuses retained bytes only after their seal checks out", () => {
  const validate = workflow("release.yml").validate!;
  expect(validate.outputs!.retained).toBe(
    "${{ steps.retained.outcome == 'success' && steps.seal.outcome == 'success' }}",
  );
  const seal = validate.steps!.find((step) => step.id === "seal");
  expect(seal.run).toBe("bun scripts/release-seal.ts check candidate");
  expect(seal.if).toBe("steps.retained.outcome == 'success'");
});

test("a seal is written only for a fully green run and checked on reuse", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-seal-"));
  const run = { id: "101", attempt: "2" };
  const needs = (results: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(results).map(([job, result]) => [job, { result }]),
    );
  try {
    expect(() => checkSeal(dir, "101")).toThrow("no seal record");
    expect(() =>
      writeSeal(
        dir,
        needs({ ...allSucceeded(), "release-walk": "cancelled" }),
        run,
      ),
    ).toThrow("release-walk=cancelled");
    const partial = needs(allSucceeded());
    delete partial["homebrew-smoke"];
    expect(() => writeSeal(dir, partial, run)).toThrow(
      "homebrew-smoke=missing",
    );
    expect(() => checkSeal(dir, "101")).toThrow("no seal record");

    writeSeal(dir, needs(allSucceeded()), run);
    expect(checkSeal(dir, "101").run_attempt).toBe("2");
    expect(() => checkSeal(dir, "202")).toThrow("belongs to run 101");

    const seal = JSON.parse(readFileSync(join(dir, SEAL_FILE), "utf8"));
    seal.jobs.package = "cancelled";
    writeFileSync(join(dir, SEAL_FILE), JSON.stringify(seal));
    expect(() => checkSeal(dir, "101")).toThrow("package=cancelled");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
