import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCoverage } from "./coverage";

test("folder loading preserves the merged view and permits independent slug additions", () => {
  const root = mkdtempSync(join(tmpdir(), "coverage-"));
  const directory = join(root, "verification/coverage");
  const write = (name: string, value: unknown) =>
    writeFileSync(join(directory, name), JSON.stringify(value));
  const header = { schemaVersion: 1, baseline: { source: "example" } };
  const area = { id: "Q01", owner: "server/src/example.ts" };
  try {
    mkdirSync(directory, { recursive: true });
    write("_meta.json", header);
    write("Q01.json", area);
    assert.deepEqual(readCoverage(root), { ...header, areas: [area] });
    const first = { id: "alpha-area", owner: "server/src/alpha.ts" };
    const second = { id: "beta-area", owner: "server/src/beta.ts" };
    // Each contributor adds only their own file, with no metadata/index edit.
    write("beta-area.json", second);
    write("alpha-area.json", first);
    assert.deepEqual(readCoverage(root), {
      ...header,
      areas: [area, first, second],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("malformed metadata, areas, duplicate/mismatched IDs and new numbered IDs fail closed", () => {
  const root = mkdtempSync(join(tmpdir(), "coverage-invalid-"));
  const directory = join(root, "verification/coverage");
  const write = (name: string, value: unknown) =>
    writeFileSync(join(directory, name), JSON.stringify(value));
  try {
    mkdirSync(directory, { recursive: true });
    expect(() => readCoverage(root)).toThrow();
    for (const bad of [null, [], { areas: [] }]) {
      write("_meta.json", bad);
      expect(() => readCoverage(root)).toThrow();
    }
    write("_meta.json", { schemaVersion: 1 });
    for (const bad of [
      null,
      [],
      {},
      { id: "../outside" },
      { id: "Q59" },
      { id: "other" },
    ]) {
      write("example.json", bad);
      expect(() => readCoverage(root)).toThrow();
    }
    write("example.json", { id: "example" });
    write("duplicate.json", { id: "example" });
    expect(() => readCoverage(root)).toThrow();
    rmSync(join(directory, "duplicate.json"));
    writeFileSync(join(directory, "example.json"), "{broken");
    expect(() => readCoverage(root)).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
