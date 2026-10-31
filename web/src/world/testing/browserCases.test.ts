import { expect, test } from "bun:test";
import {
  hostFilterCases,
  hostFilterGroup,
  hostFilterGroups,
  productionContextCases,
  productionContextGroup,
  productionContextGroups,
} from "./browserCases";

test("World suite splitting preserves every retained viewport/operation/view case exactly once", () => {
  expect(hostFilterCases).toHaveLength(120);
  expect(
    new Set(hostFilterCases.map((item) => JSON.stringify(item))).size,
  ).toBe(120);
  expect(
    hostFilterCases.filter((item) => item.operation === "spaces-notifications"),
  ).toEqual([
    { width: 1440, operation: "spaces-notifications", view: "spaces" },
    { width: 390, operation: "spaces-notifications", view: "spaces" },
  ]);
  expect(
    hostFilterCases.filter((item) => item.operation === "town-idle-draws"),
  ).toEqual([
    { width: 1440, operation: "town-idle-draws", view: "town" },
    { width: 390, operation: "town-idle-draws", view: "town" },
  ]);
  const assigned = hostFilterGroups.flatMap((group) =>
    hostFilterCases.filter((item) => hostFilterGroup(item) === group),
  );
  expect(assigned).toHaveLength(120);
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

test("headless lifecycle policies leave browser resource routing and rendering on both viewports", () => {
  const moved = new Set([
    "worktree-resource-retirement",
    "worktree-resource-disposal",
    "worktree-resource-closed-refresh",
    "worktree-resource-closed-retry",
    "worktree-resource-validation-failure",
  ]);
  expect(hostFilterCases.some(({ operation }) => moved.has(operation))).toBe(
    false,
  );
  for (const operation of [
    "worktree-files",
    "worktree-changes",
    "worktree-resource-rejection",
    "file-download-error",
    "file-mutation-interruption",
    "file-delete-retirement",
    "file-upload-retirement",
    "context-menu-pull-failure",
  ]) {
    const cases = hostFilterCases.filter(
      (item) => item.operation === operation,
    );
    expect(cases.map(({ width }) => width)).toEqual([1440, 390]);
    expect(cases.every((item) => hostFilterGroup(item) === "resources")).toBe(
      true,
    );
  }
});
