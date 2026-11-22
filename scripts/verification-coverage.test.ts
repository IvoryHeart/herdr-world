import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readCoverage } from "./coverage";

const root = resolve(import.meta.dir, "..");
const coverage = readCoverage(root);

test("all reviewed inventory areas have explicit existing evidence and coverage decisions", () => {
  expect(coverage.schemaVersion).toBe(1);
  expect(coverage.areas.length).toBeGreaterThanOrEqual(43);
  expect(new Set(coverage.areas.map((area) => area.id)).size).toBe(
    coverage.areas.length,
  );
  for (const area of coverage.areas) {
    expect([
      "pending",
      "modeled",
      "shared-model",
      "alternative-evidence",
    ]).toContain(area.status);
    expect(area.area.length).toBeGreaterThan(0);
    expect(area.properties.length).toBeGreaterThan(0);
    expect(area.assessment.length).toBeGreaterThan(0);
    expect(area.existingTests.length).toBeGreaterThan(0);
    expect(area.acceptedDelivery).toMatch(
      /^https:\/\/github\.com\/IvoryHeart\/herdr-world\/pull\/\d+$/,
    );
    for (const path of [
      area.owner,
      area.requirement,
      ...area.existingTests,
      ...(area.supplementalContracts ?? []).flatMap((contract) => [
        contract.requirement,
        contract.contract,
        ...contract.owners,
        ...contract.tests,
      ]),
    ]) {
      expect(path.startsWith("/") || path.split("/").includes("..")).toBe(
        false,
      );
      expect(existsSync(resolve(root, path))).toBe(true);
    }
    expect(area.requiredChecks).toContain("bun run check");
    if (area.status !== "pending") {
      expect("partialEvidence" in area).toBe(true);
      if ("partialEvidence" in area) {
        const evidence = area.partialEvidence as {
          models: string[];
          contracts: string[];
          tests?: string[];
          checks: string[];
          review: string;
        };
        expect(evidence.contracts.length).toBeGreaterThan(0);
        expect(evidence.checks.length).toBeGreaterThan(0);
        expect(evidence.review.length).toBeGreaterThan(0);
        if (area.status === "modeled" || area.status === "shared-model")
          expect(evidence.models.length).toBeGreaterThan(0);
        for (const path of [
          ...evidence.models,
          ...evidence.contracts,
          ...(evidence.tests ?? []),
        ]) {
          expect(path.startsWith("/") || path.split("/").includes("..")).toBe(
            false,
          );
          expect(existsSync(resolve(root, path))).toBe(true);
        }
      }
    }
    if (area.status === "pending")
      expect(area.remaining.length).toBeGreaterThan(0);
  }
});

// Opt-in migration proof against an immutable pre-split blob, without a second
// inventory or shared checksum that future area PRs would have to update.
const baseline = process.env.COVERAGE_MIGRATION_BASELINE;
test.skipIf(!baseline)(
  "merged folder equals the pre-split coverage.json content",
  () => {
    expect(coverage).toEqual(JSON.parse(readFileSync(baseline!, "utf8")));
  },
);
