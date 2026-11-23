import { expect, test } from "bun:test";
import { navigatorHostGroups } from "./navigatorGroups";
import type { WorldTreeHost } from "./treeProjection";

const host = (id: string, runtime?: "herdr-core") =>
  ({
    source: {
      id: `host:${id}`,
      connectionId: id,
      label: id,
      connection: runtime ? { runtime } : {},
    },
    spaces: [],
  }) as unknown as WorldTreeHost;

const hosts = [host("tui"), host("remote"), host("core", "herdr-core")];
const machineOf: Record<string, string> = {
  tui: "local",
  core: "local",
  remote: "ssh:dev.example.test",
};

test("one per machine: a machine's runtimes share one heading, each named by its runtime", () => {
  const groups = navigatorHostGroups(hosts, (id) => ({
    key: machineOf[id]!,
    label: id === "remote" ? "remote" : "tui",
  }));
  expect(
    groups.map((group) => [
      group.key,
      group.label,
      group.members.map(({ source }) => source.connectionId),
      [...group.tags.values()],
    ]),
  ).toEqual([
    ["local", "tui", ["tui", "core"], ["Herdr TUI", "herdr-core"]],
    ["ssh:dev.example.test", "remote", ["remote"], []],
  ]);
});

test("one per runtime: every runtime stands alone, as before", () => {
  const groups = navigatorHostGroups(hosts, (id) => ({
    key: `runtime:${id}`,
    label: id,
  }));
  expect(groups.map((group) => group.members.length)).toEqual([1, 1, 1]);
  // A host the catalogue does not list (yet) stands alone too.
  expect(navigatorHostGroups(hosts, () => undefined)).toHaveLength(3);
});

test("two runtimes of one kind on a machine are told apart by name", () => {
  const groups = navigatorHostGroups(
    [host("a", "herdr-core"), host("b", "herdr-core")],
    () => ({ key: "local", label: "a" }),
  );
  expect([...groups[0]!.tags.values()]).toEqual([
    "herdr-core · a",
    "herdr-core · b",
  ]);
});
