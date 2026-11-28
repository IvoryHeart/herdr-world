import assert from "node:assert/strict";
import { join } from "node:path";
import { parseJUnit } from "./test-retry";
import type { CaseTimings } from "./world-browser-cases";

/** Refresh only passing observations; retries use the slower retained sample. @internal */
export function junitCaseTimings(reports: string[]): CaseTimings {
  const result: CaseTimings = {};
  for (const xml of reports) {
    const cases = parseJUnit(xml);
    const tags = [
      ...xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>[\s\S]*?<\/testcase>)/g),
    ];
    for (const [index, item] of cases.entries()) {
      if (item.status !== "pass") continue;
      assert(
        /^web\/src\/world\/.+\.test\.tsx?$/.test(item.file) &&
          !item.file.split("/").includes(".."),
        "Unexpected JUnit file",
      );
      const seconds = Number(/\btime="([^"]+)"/.exec(tags[index]![1]!)?.[1]);
      assert(
        Number.isFinite(seconds) && seconds >= 0,
        "Invalid JUnit duration",
      );
      const file = (result[item.file] ??= {});
      file[item.name] = Math.max(file[item.name] ?? 0.001, seconds);
    }
  }
  assert(Object.keys(result).length, "No passing World cases in JUnit");
  return Object.fromEntries(
    Object.entries(result)
      .sort()
      .map(([file, cases]) => [
        file,
        Object.fromEntries(Object.entries(cases).sort()),
      ]),
  );
}

if (import.meta.main) {
  const [directory, run] = process.argv.slice(2);
  assert(
    directory &&
      /^https:\/\/github\.com\/IvoryHeart\/herdr-world\/actions\/runs\/\d+$/.test(
        run ?? "",
      ),
    "Usage: bun scripts/refresh-world-browser-timings.ts <downloaded-artifacts> <run-url>",
  );
  const reports: string[] = [];
  for await (const path of new Bun.Glob("**/world-shard-*.xml").scan({
    cwd: directory,
  }))
    reports.push(await Bun.file(join(directory, path)).text());
  const cases = junitCaseTimings(reports);
  const { worldBrowserSuites } = await import("./world-browser-suites");
  assert(
    worldBrowserSuites.every((file) => cases[file]),
    "Refresh requires JUnit for every World suite; download a complete successful CI run",
  );
  await Bun.write(
    new URL("./world-browser-timings.json", import.meta.url),
    JSON.stringify(
      {
        sourceRun: run,
        units: "seconds per JUnit case; setup outside cases is excluded",
        cases,
        seconds: Object.fromEntries(
          Object.entries(cases).map(([file, names]) => [
            file.replace("web/src/world/", "").replace(/\.test\.tsx?$/, ""),
            Object.values(names).reduce((sum, seconds) => sum + seconds, 0),
          ]),
        ),
      },
      null,
      2,
    ) + "\n",
  );
  console.info(
    `Refreshed ${Object.values(cases).reduce((sum, file) => sum + Object.keys(file).length, 0)} World case timings`,
  );
}
