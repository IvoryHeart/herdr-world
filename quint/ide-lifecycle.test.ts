import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  decodeIdeItf,
  ideCounterexamples,
  scriptedIdeModel,
} from "./ide-lifecycle";
import { mutateImplementation } from "./implementationMutation";
import { validateTrace } from "./traces";

const root = resolve(import.meta.dir, "..");
const output = mkdtempSync(join(tmpdir(), "ide-lifecycle-"));
afterAll(() => rmSync(output, { recursive: true, force: true }));

test("ITF values decode to plain numbers, sets, tuples and maps", () => {
  expect(
    decodeIdeItf({
      n: { "#bigint": "3" },
      s: { "#set": [{ "#bigint": "1" }] },
      t: { "#tup": [{ "#bigint": "0" }, { "#bigint": "2" }] },
      m: { "#map": [[{ "#bigint": "1" }, "running"]] },
    }),
  ).toEqual({ n: 3, s: [1], t: [0, 2], m: new Map([[1, "running"]]) });
});

test("a recorded behaviour drives the model one step at a time", () => {
  const source = readFileSync(resolve(root, "quint/ide-lifecycle.qnt"), "utf8");
  const scripted = scriptedIdeModel(source, [
    ...ideCounterexamples["queued-open"].ops,
    { name: "restart", slot: -1, arg: "1" },
    { name: "poll", slot: -1, arg: "refresh" },
  ]);
  expect(scripted.startsWith(source.slice(0, source.lastIndexOf("}")))).toBe(
    true,
  );
  expect(scripted).toContain("all { witnessAt == 0, open(1) },");
  expect(scripted).toContain("all { witnessAt == 2, loseAs(1, false) },");
  expect(scripted).toContain("all { witnessAt == 5, removeConn },");
  expect(scripted).toContain(
    "all { witnessAt == 13, restartAs(false, true) },",
  );
  expect(scripted).toContain("all { witnessAt == 14, poll(true) },");
});

test("each counterexample names a flag the model has and a fix World has", async () => {
  const source = readFileSync(resolve(root, "quint/ide-lifecycle.qnt"), "utf8");
  for (const witness of Object.values(ideCounterexamples)) {
    expect(source.split(`pure val ${witness.flag} = false`)).toHaveLength(2);
    // The mutation asserts its target occurs exactly once and bundles the
    // adapter with the fix taken back out.
    const path = await mutateImplementation("ide-lifecycle", witness.fault, {
      root,
      output,
    });
    const mutant = await import(path);
    expect(typeof mutant.replayIdeTrace).toBe("function");
  }
});

test("sampled IDE traces go through the dedicated replay", () => {
  expect(() => validateTrace("ide-lifecycle", [])).toThrow(
    "dedicated replay validator",
  );
});
