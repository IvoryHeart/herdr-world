import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { casePhases } from "./casePhases";

const saved = Bun.env.HERDR_WORLD_TEST_PHASES;
afterEach(() => {
  if (saved === undefined) delete Bun.env.HERDR_WORLD_TEST_PHASES;
  else Bun.env.HERDR_WORLD_TEST_PHASES = saved;
});

test("a finished case appends its phases when the runner names a file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "case-phases-"));
  try {
    const file = join(dir, "phases.jsonl");
    Bun.env.HERDR_WORLD_TEST_PHASES = file;
    const phases = casePhases("a case");
    phases.mark("chrome");
    phases.mark("scene");
    phases.done();
    casePhases("another").done("failed");
    const lines = (await readFile(file, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines.map((line) => line.case)).toEqual(["a case", "another"]);
    expect(lines[0].phases.map(([phase]: [string, number]) => phase)).toEqual([
      "chrome",
      "scene",
      "teardown",
    ]);
    expect(lines[1].phases.map(([phase]: [string, number]) => phase)).toEqual([
      "failed",
    ]);
    for (const line of lines) {
      const sum = line.phases.reduce(
        (total: number, [, seconds]: [string, number]) => total + seconds,
        0,
      );
      expect(Math.abs(sum - line.seconds)).toBeLessThan(0.01);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("without a phases file nothing is written", () => {
  delete Bun.env.HERDR_WORLD_TEST_PHASES;
  expect(() => casePhases("quiet").done()).not.toThrow();
});
