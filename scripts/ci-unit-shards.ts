import assert from "node:assert/strict";
import timings from "./ci-unit-timings.json";

/** @internal */
export const UNIT_SHARDS = 4;
export const UNIT_PARALLEL = 4;
// Account for build setup when packing file work (four files run together).
const BUILD_SECONDS = 25;
const UNMEASURED_SECONDS = 1;

// These suites read the real built web assets. Keep them on the first runner.
// The clean, build-free shards in CI also guard this boundary as tests evolve.
/** @internal */
export const unitBuildSuites: readonly string[] = [
  "server/src/http/auth-process.test.ts",
  "server/src/http/auth-world-process.test.ts",
  "server/src/http/static-files.test.ts",
];

export function unitNeedsBuild(files: readonly string[]): boolean {
  return files.some((file) => unitBuildSuites.includes(file));
}

/** Selected files only; unknown/new suites still run with a conservative weight. */
export function unitTestShards(
  files: readonly string[],
  seconds: Readonly<Record<string, number>> = Object.fromEntries(
    Object.entries(timings.files).map(([file, milliseconds]) => [
      file,
      milliseconds / 1000,
    ]),
  ),
): string[][] {
  assert(new Set(files).size === files.length, "Duplicate unit suite");
  const weight = (file: string) => {
    const value = seconds[file] ?? UNMEASURED_SECONDS;
    assert(
      Number.isFinite(value) && value >= 0,
      `Invalid unit timing: ${file}`,
    );
    return Math.max(value, 0.001);
  };
  const ordered = [...files].sort(
    (a, b) => weight(b) - weight(a) || a.localeCompare(b),
  );
  const shards: string[][] = Array.from({ length: UNIT_SHARDS }, () => []);
  const loads = Array<number>(UNIT_SHARDS).fill(0);
  for (const file of ordered.filter((file) => unitBuildSuites.includes(file))) {
    shards[0]!.push(file);
    loads[0]! += weight(file);
  }
  if (shards[0]!.length) loads[0]! += BUILD_SECONDS * UNIT_PARALLEL;
  for (const file of ordered.filter(
    (file) => !unitBuildSuites.includes(file),
  )) {
    const index = loads.indexOf(Math.min(...loads));
    shards[index]!.push(file);
    loads[index]! += weight(file);
  }
  return shards.map((shard) =>
    shard.sort((a, b) => weight(b) - weight(a) || a.localeCompare(b)),
  );
}
