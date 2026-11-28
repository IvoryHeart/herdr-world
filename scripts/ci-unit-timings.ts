import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseJUnit } from "./test-retry";

/** File-level JUnit times include suite setup, unlike summing individual cases. @internal */
export function junitFileTimings(xml: string): Record<string, number> {
  parseJUnit(xml); // Require a complete report before accepting any timings.
  const times: Record<string, number> = {};
  let depth = 0;
  for (const match of xml.matchAll(/<testsuite\b([^>]*)>|<\/testsuite>/g)) {
    if (match[1] === undefined) {
      assert(--depth >= 0, "Unbalanced JUnit suites");
      continue;
    }
    // Bun nests describe suites inside each file's measured time.
    if (depth++ > 0) continue;
    const attributes = match[1]!;
    const file = /\bfile="([^"]+)"/.exec(attributes)?.[1];
    const value = /\btime="([^"]+)"/.exec(attributes)?.[1];
    assert(
      file &&
        /^(scripts|web|server|shared|quint|tools|verification)\/.+\.test\.[cm]?[jt]sx?$/.test(
          file,
        ) &&
        !file.split("/").includes(".."),
      "Invalid JUnit timing file",
    );
    const seconds = Number(value);
    assert(
      value !== undefined && Number.isFinite(seconds) && seconds >= 0,
      `Invalid JUnit time: ${file}`,
    );
    times[file] = (times[file] ?? 0) + seconds;
  }
  assert(depth === 0, "Unbalanced JUnit suites");
  assert(Object.keys(times).length, "Missing file timings");
  return times;
}

if (import.meta.main) {
  const paths = process.argv.slice(2);
  assert(paths.length, "Pass unit JUnit files to record timings");
  const samples = new Map<string, number[]>();
  for (const path of paths)
    for (const [file, seconds] of Object.entries(
      junitFileTimings(readFileSync(path, "utf8")),
    ))
      samples.set(file, [...(samples.get(file) ?? []), seconds]);
  const medians = Object.fromEntries(
    [...samples]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, values]) => {
        values.sort((a, b) => a - b);
        const mid = Math.floor(values.length / 2);
        const median =
          values.length % 2
            ? values[mid]!
            : (values[mid - 1]! + values[mid]!) / 2;
        return [file, Math.max(1, Math.round(median * 1000))];
      }),
  );
  console.info(JSON.stringify({ version: 1, files: medians }, null, 2));
}
