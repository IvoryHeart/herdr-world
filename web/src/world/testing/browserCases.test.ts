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
  expect(hostFilterCases).toHaveLength(155);
  expect(
    new Set(hostFilterCases.map((item) => JSON.stringify(item))).size,
  ).toBe(155);
  const assigned = hostFilterGroups.flatMap((group) =>
    hostFilterCases.filter((item) => hostFilterGroup(item) === group),
  );
  expect(assigned).toHaveLength(155);
  expect(new Set(assigned)).toEqual(new Set(hostFilterCases));
  for (const group of hostFilterGroups)
    expect(assigned.some((item) => hostFilterGroup(item) === group)).toBe(true);
});

test("production workload splitting preserves all fourteen original view/entry/viewport cases", () => {
  expect(productionContextCases).toHaveLength(14);
  expect(
    new Set(productionContextCases.map((item) => JSON.stringify(item))).size,
  ).toBe(14);
  const assigned = productionContextGroups.flatMap((group) =>
    productionContextCases.filter(
      (item) => productionContextGroup(item) === group,
    ),
  );
  expect(assigned).toHaveLength(14);
  expect(new Set(assigned)).toEqual(new Set(productionContextCases));
});
