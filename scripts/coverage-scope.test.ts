import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  coverageChangesRequireModels,
  readCoverageScope,
} from "./coverage-scope";

const alternative = {
  id: "Q41",
  owner: "scripts/",
  status: "alternative-evidence",
  partialEvidence: { models: [] },
  existingTests: ["scripts/example.test.ts"],
};
const model = {
  id: "Q01",
  owner: "server/src/example.ts",
  status: "modeled",
  partialEvidence: { models: ["quint/example.qnt"] },
};
const inventory = { schemaVersion: 1, areas: [alternative, model] };

test("only model-free coverage edits can skip models, including removals and status transitions", () => {
  expect(coverageChangesRequireModels(inventory, inventory)).toBe(false);
  expect(
    coverageChangesRequireModels(inventory, {
      ...inventory,
      areas: [
        { ...alternative, existingTests: ["scripts/another.test.ts"] },
        model,
      ],
    }),
  ).toBe(false);
  expect(
    coverageChangesRequireModels(inventory, { ...inventory, areas: [model] }),
  ).toBe(false);
  expect(
    coverageChangesRequireModels(inventory, {
      ...inventory,
      areas: [alternative],
    }),
  ).toBe(true);
  expect(
    coverageChangesRequireModels(inventory, {
      ...inventory,
      areas: [
        alternative,
        {
          ...model,
          status: "alternative-evidence",
          partialEvidence: { models: [] },
        },
      ],
    }),
  ).toBe(true);
  expect(
    coverageChangesRequireModels(inventory, {
      ...inventory,
      areas: [
        { ...alternative, partialEvidence: { models: ["quint/example.qnt"] } },
        model,
      ],
    }),
  ).toBe(true);
  expect(
    coverageChangesRequireModels(inventory, { ...inventory, schemaVersion: 2 }),
  ).toBe(true);
  expect(
    coverageChangesRequireModels(inventory, {
      ...inventory,
      areas: [alternative, alternative, model],
    }),
  ).toBe(true);
});

test.each(["legacy", "folder"])(
  "repository scope compares %s baselines and fails closed",
  (format) => {
    const root = mkdtempSync(join(tmpdir(), "coverage-scope-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    const directory = join(root, "verification/coverage");
    const write = ({
      areas,
      ...header
    }: Parameters<typeof coverageChangesRequireModels>[0]) => {
      rmSync(directory, { recursive: true, force: true });
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "_meta.json"), JSON.stringify(header));
      for (const area of areas)
        writeFileSync(join(directory, `${area.id}.json`), JSON.stringify(area));
    };
    try {
      git("init", "-q");
      git("config", "user.name", "Example");
      git("config", "user.email", "example@example.invalid");
      mkdirSync(join(root, "verification"));
      if (format === "legacy")
        writeFileSync(
          join(root, "verification/coverage.json"),
          JSON.stringify(inventory),
        );
      else write(inventory);
      git("add", ".");
      git("commit", "-qm", "base");
      const base = git("rev-parse", "HEAD");
      rmSync(join(root, "verification/coverage.json"), { force: true });
      write(inventory);
      const scope = readCoverageScope(root, base);
      expect(scope.owns("scripts/example.ts")).toBe(true);
      expect(scope.models("scripts/example.ts")).toBe(false);
      expect(scope.models("server/src/example.ts")).toBe(true);
      expect(scope.models("verification/coverage/Q41.json")).toBe(false);
      write({
        ...inventory,
        areas: [
          { ...alternative, existingTests: ["scripts/new.test.ts"] },
          model,
        ],
      });
      expect(
        readCoverageScope(root, base).models("verification/coverage/Q41.json"),
      ).toBe(false);
      write({
        ...inventory,
        areas: [{ ...alternative, owner: "scripts/moved/" }, model],
      });
      expect(
        readCoverageScope(root, base).models("verification/coverage/Q41.json"),
      ).toBe(true);
      write({ ...inventory, schemaVersion: 2 });
      expect(
        readCoverageScope(root, base).models(
          "verification/coverage/_meta.json",
        ),
      ).toBe(true);
      write({ ...inventory, areas: [alternative] });
      expect(
        readCoverageScope(root, base).models("verification/coverage/Q41.json"),
      ).toBe(true);
      expect(
        readCoverageScope(root, "missing-synthetic-ref").models(
          "verification/coverage/Q41.json",
        ),
      ).toBe(true);
      // A present but malformed base inventory also requires the complete gate.
      writeFileSync(join(directory, "_meta.json"), "{broken");
      git("add", ".");
      git("commit", "-qm", "malformed baseline");
      const malformed = git("rev-parse", "HEAD");
      write(inventory);
      expect(
        readCoverageScope(root, malformed).models(
          "verification/coverage/Q01.json",
        ),
      ).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
