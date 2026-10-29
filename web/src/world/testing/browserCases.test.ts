import { expect, test } from "bun:test";
import {
  hostFilterCases,
  hostFilterGroup,
  hostFilterGroups,
  productionContextCases,
  productionContextGroup,
  productionContextGroups,
} from "./browserCases";

test("World suite splitting preserves every original viewport/operation/view case exactly once", () => {
  expect(hostFilterCases).toHaveLength(130);
  expect(
    new Set(hostFilterCases.map((item) => JSON.stringify(item))).size,
  ).toBe(130);
  expect(
    hostFilterCases.filter((item) => item.operation === "spaces-notifications"),
  ).toEqual([
    { width: 1440, operation: "spaces-notifications", view: "spaces" },
    { width: 390, operation: "spaces-notifications", view: "spaces" },
  ]);
  expect(
    hostFilterCases.filter((item) => item.operation === "desk-reveal"),
  ).toEqual([
    { width: 390, height: 844, operation: "desk-reveal", view: "desk" },
    { width: 1512, height: 982, operation: "desk-reveal", view: "desk" },
    { width: 1280, height: 1440, operation: "desk-reveal", view: "desk" },
    { width: 2560, height: 1440, operation: "desk-reveal", view: "desk" },
    { width: 1440, height: 2560, operation: "desk-reveal", view: "desk" },
  ]);
  const assigned = hostFilterGroups.flatMap((group) =>
    hostFilterCases.filter((item) => hostFilterGroup(item) === group),
  );
  expect(assigned).toHaveLength(130);
  expect(new Set(assigned)).toEqual(new Set(hostFilterCases));
  for (const group of hostFilterGroups)
    expect(assigned.some((item) => hostFilterGroup(item) === group)).toBe(true);
});

test("production workload splitting preserves all twelve view/entry/viewport cases, including Town and Board", () => {
  expect(productionContextCases).toHaveLength(12);
  expect(
    new Set(productionContextCases.map((item) => JSON.stringify(item))).size,
  ).toBe(12);
  const assigned = productionContextGroups.flatMap((group) =>
    productionContextCases.filter(
      (item) => productionContextGroup(item) === group,
    ),
  );
  expect(assigned).toHaveLength(12);
  expect(new Set(assigned)).toEqual(new Set(productionContextCases));
});
