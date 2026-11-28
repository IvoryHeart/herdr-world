import { expect, test } from "bun:test";
import { casePhasesTable, parseCasePhases } from "./world-case-phases";

test("the job summary lists every case slowest first with its phases", () => {
  const cases = parseCasePhases(
    [
      JSON.stringify({
        case: "Town 390x844",
        seconds: 12.34,
        phases: [
          ["chrome", 1.2],
          ["load", 0.5],
          ["scene", 10],
          ["teardown", 0.64],
        ],
      }),
      "",
      JSON.stringify({
        case: "Hosts | narrow",
        seconds: 30,
        phases: [
          ["setup", 2],
          ["scene", 27],
          ["teardown", 1],
        ],
      }),
    ].join("\n"),
  );
  const table = casePhasesTable("shard-1-of-6", cases);
  expect(table.split("\n")).toEqual([
    "### World case phases (shard-1-of-6)",
    "",
    "| Case | Seconds | chrome | load | scene | teardown | setup |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    "| Hosts \\| narrow | 30.0 |  |  | 27.0 | 1.0 | 2.0 |",
    "| Town 390x844 | 12.3 | 1.2 | 0.5 | 10.0 | 0.6 |  |",
    "",
  ]);
  expect(casePhasesTable("none", [])).toBe("");
});
