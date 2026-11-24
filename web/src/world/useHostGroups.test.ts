import { expect, test } from "bun:test";
import type { WorldHost } from "../worldHosts";
import { sameHostGrouping } from "./useHostGroups";

const host = (id: string, details: Partial<WorldHost> = {}): WorldHost => ({
  id,
  label: id,
  runtime: "herdr",
  state: "ready",
  generation: 1,
  endpoint: id,
  machine: "local",
  ...details,
});

test("a runtime's state or generation leaves its grouping unchanged", () => {
  const before = [host("tui"), host("core", { runtime: "herdr-core" })];
  const after = [
    host("tui", { generation: 8, state: "reconnecting" }),
    host("core", { runtime: "herdr-core" }),
  ];
  expect(sameHostGrouping(before, after)).toBe(true);
});

test("a renamed, moved, added or removed runtime regroups", () => {
  const before = [host("tui"), host("core")];
  expect(
    sameHostGrouping(before, [host("tui", { label: "x" }), host("core")]),
  ).toBe(false);
  expect(
    sameHostGrouping(before, [host("tui"), host("core", { machine: "ssh:a" })]),
  ).toBe(false);
  expect(sameHostGrouping(before, [host("tui")])).toBe(false);
  expect(sameHostGrouping(before, [host("core"), host("tui")])).toBe(false);
});
