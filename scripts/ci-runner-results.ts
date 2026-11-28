import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const lanes = ["unit", "static", "security", "web"] as const;
type Lane = (typeof lanes)[number];
/** @internal Lane-receipt regression input. */
export type RunnerResults = { shard: number } & Record<Lane, string>;

/** @internal A combined runner's failure must never impersonate other lane verdicts. */
export function aggregateRunnerResults(rows: RunnerResults[], web: boolean) {
  assert.deepEqual(
    rows.map((row) => row.shard).sort(),
    [1, 2, 3, 4],
    "Missing or duplicate runner results",
  );
  const owned = (lane: Lane, shard: number) =>
    lane === "unit" ||
    (lane === "static" && shard > 1) ||
    (lane === "security" && shard === 4) ||
    (lane === "web" && web && shard < 3);
  return Object.fromEntries(
    lanes.map((lane) => {
      for (const row of rows) {
        assert(
          ["success", "failure", "cancelled", "skipped"].includes(row[lane]),
          "Invalid runner outcome",
        );
        if (!owned(lane, row.shard))
          assert.equal(row[lane], "skipped", "Unexpected runner lane");
      }
      const outcomes = rows
        .filter((row) => owned(lane, row.shard))
        .map((row) => row[lane]);
      return [
        lane,
        !outcomes.length
          ? "skipped"
          : outcomes.every((outcome) => outcome === "success")
            ? "success"
            : "failure",
      ];
    }),
  ) as Record<Lane, string>;
}

if (import.meta.main) {
  const [action, argument] = process.argv.slice(2);
  if (action === "record") {
    const shard = Number(argument);
    assert([1, 2, 3, 4].includes(shard), "Invalid runner shard");
    const result: RunnerResults = {
      shard,
      unit: process.env.UNIT_RESULT!,
      static: process.env.STATIC_RESULT!,
      security: process.env.SECURITY_RESULT!,
      web: process.env.WEB_RESULT!,
    };
    const directory = ".agents/delivery/runner-results";
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, `runner-${shard}.json`),
      JSON.stringify(result),
    );
    const summary = [
      "| Lane | Outcome |",
      "| --- | --- |",
      ...lanes.map((lane) => `| ${lane} | ${result[lane]} |`),
      "",
    ].join("\n");
    console.info(summary);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  } else {
    assert(
      action === "aggregate" && argument,
      "Expected runner result action and directory",
    );
    const rows = await Promise.all(
      [...new Bun.Glob("**/runner-*.json").scanSync({ cwd: argument })].map(
        async (path) =>
          JSON.parse(
            await Bun.file(join(argument, path)).text(),
          ) as RunnerResults,
      ),
    );
    const selection = JSON.parse(process.env.HERDR_CI_SELECTION!);
    const result = aggregateRunnerResults(rows, selection.web.length > 0);
    for (const [lane, outcome] of Object.entries(result)) {
      console.info(`${lane}: ${outcome}`);
      appendFileSync(process.env.GITHUB_OUTPUT!, `${lane}=${outcome}\n`);
    }
  }
}
