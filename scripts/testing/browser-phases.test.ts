import { expect, test } from "bun:test";
import { browserPhasesTable } from "./browser-phases";

test("every context retains measured phase columns, with absent work left blank", () => {
  const rows = [
    {
      url: "http://fixture.example.test/?case=quick",
      totalMs: 1000,
      waitMs: 0,
      firstFrameMs: 12,
    },
    {
      url: "http://fixture.example.test/?case=slow",
      totalMs: 2000,
      assertionsMs: 2,
    },
  ];
  const table = browserPhasesTable(rows);
  expect(table).toContain(
    "launch | queue | context | pageLoad | firstFrame | wait | assertions | teardown | total",
  );
  expect(table.indexOf("case=slow")).toBeLessThan(table.indexOf("case=quick"));
  expect(table).toContain("0.012 | 0.000");
  expect(table).toContain("0.002");
  expect(rows[0]!.url).toContain("quick");
  expect(browserPhasesTable([])).toBe("");
});
