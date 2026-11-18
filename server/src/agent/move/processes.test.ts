import { expect, test } from "bun:test";
import { assertNoBackground, moveProcesses } from "./processes";
const idle =
  "10 1 10 /usr/bin/node /opt/example/codex.js\n11 10 10 /opt/bin/codex\n20 1 20 unrelated";
test("an idle harness wrapper and its binary are allowed", () => {
  expect(assertNoBackground(moveProcesses(idle), 10, "codex")).toEqual([
    10, 11,
  ]);
});
test.each([
  "12 11 10 bash",
  "12 11 12 pytest",
  "12 11 12 sh\n13 12 13 worker",
  "12 11 10 node server.js",
  "12 11 12 codex resume other",
])(
  "background descendants refuse even in a separate process group: %s",
  (work) => {
    expect(() =>
      assertNoBackground(moveProcesses(idle + "\n" + work), 10, "codex"),
    ).toThrow("background work");
  },
);
test("unknown and incomplete process evidence refuses", () => {
  expect(() => moveProcesses("broken")).toThrow();
  expect(() => moveProcesses("")).toThrow();
  expect(() => assertNoBackground(moveProcesses(idle), 90, "claude")).toThrow(
    "identify",
  );
});
