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
  expect(hostFilterCases).toHaveLength(125);
  expect(
    new Set(hostFilterCases.map((item) => JSON.stringify(item))).size,
  ).toBe(125);
  expect(
    hostFilterCases.filter((item) => item.operation === "spaces-notifications"),
  ).toEqual([
    { width: 1440, operation: "spaces-notifications", view: "spaces" },
    { width: 390, operation: "spaces-notifications", view: "spaces" },
  ]);
  const assigned = hostFilterGroups.flatMap((group) =>
    hostFilterCases.filter((item) => hostFilterGroup(item) === group),
  );
  expect(assigned).toHaveLength(125);
  expect(new Set(assigned)).toEqual(new Set(hostFilterCases));
  for (const group of hostFilterGroups)
    expect(assigned.some((item) => hostFilterGroup(item) === group)).toBe(true);
});

test("production workload splitting preserves the twelve original cases and four maximum-scale comparisons", () => {
  expect(
    productionContextCases.filter((item) => item.entry !== "maximum-scale"),
  ).toEqual([
    ...[
      { view: "uncertain", entry: "typing" },
      { view: "uncertain", entry: "fallback" },
      { view: "uncertain", entry: "popup" },
      { view: "board", entry: "" },
      { view: "town", entry: "" },
      { view: "town", entry: "animated" },
    ].flatMap((item) => [1440, 390].map((width) => ({ ...item, width }))),
  ]);
  expect(
    productionContextCases.filter((item) => item.entry === "maximum-scale"),
  ).toEqual([
    { view: "board", entry: "maximum-scale", width: 1440 },
    { view: "board", entry: "maximum-scale", width: 390 },
    { view: "town", entry: "maximum-scale", width: 1440 },
    { view: "town", entry: "maximum-scale", width: 390 },
  ]);
  expect(productionContextCases).toHaveLength(16);
  expect(
    new Set(productionContextCases.map((item) => JSON.stringify(item))).size,
  ).toBe(16);
  const assigned = productionContextGroups.flatMap((group) =>
    productionContextCases.filter(
      (item) => productionContextGroup(item) === group,
    ),
  );
  expect(assigned).toHaveLength(16);
  expect(new Set(assigned)).toEqual(new Set(productionContextCases));
});
