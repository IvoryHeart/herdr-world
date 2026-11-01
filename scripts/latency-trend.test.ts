import { expect, test } from "bun:test";
import {
  parseMeasurements,
  trendReport,
  type Measurement,
} from "./latency-trend";

const run = (cpu: string, maxAckMs: number): Measurement => ({
  suite: "ProductionContexts",
  case: "town 1440px",
  cpu,
  metrics: { maxAckMs },
});

test("measurement lines parse and malformed records are left out", () => {
  expect(
    parseMeasurements(
      [
        JSON.stringify(run("Example CPU A", 300)),
        "",
        JSON.stringify({ suite: "missing metrics", case: "x" }),
      ].join("\n"),
    ),
  ).toEqual([run("Example CPU A", 300)]);
});

test("a run is compared only with main runs on the same CPU model", () => {
  const baseline = [
    run("Example CPU A", 300),
    run("Example CPU A", 320),
    run("Example CPU A", 310),
    // Slower hardware must not hide a regression on faster hardware.
    run("Example CPU B", 600),
    run("Example CPU B", 620),
  ];
  const report = trendReport([run("Example CPU A", 400)], baseline);
  expect(report).toContain("| 400 | 310 (3 runs) | +29% ▲ |");
  expect(report).toContain("1 value flagged.");
});

test("a short or absent baseline reports without flagging", () => {
  expect(trendReport([run("Example CPU A", 900)], [])).toContain(
    "| 900 | none yet |  |",
  );
  const short = trendReport(
    [run("Example CPU A", 900)],
    [run("Example CPU A", 300)],
  );
  expect(short).toContain("+200% |");
  expect(short).toContain("Nothing flagged.");
});
