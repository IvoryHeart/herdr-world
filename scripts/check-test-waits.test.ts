import { expect, test } from "bun:test";
import {
  compare,
  formatAllowlist,
  lowered,
  parseAllowlist,
  scanFiles,
  scanSource,
  TEST_FILE,
  timingSwitchesOutsideTests,
} from "./check-test-waits";

const lines = (text: string) => scanSource("a.test.ts", text).pauses;

test("fixed sleeps count: Bun.sleep, resolving timers and timers/promises", () => {
  expect(
    lines(`import { setTimeout as wait } from "node:timers/promises";
await Bun.sleep(50);
Bun.sleepSync(20);
await new Promise((resolve) => setTimeout(resolve, 100));
await new Promise((r) => setTimeout(() => r(undefined), 30));
await new Promise((ok) => { setTimeout(() => { ok(); }, 30); });
await new Promise((wake) => globalThis.setTimeout(wake, 40));
await wait(25);
await Bun.sleep(delay);`),
  ).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
});

test("yields, failure bounds, real timers and short poll ticks do not count", () => {
  expect(
    lines(`await Bun.sleep(0);
await new Promise((resolve) => setTimeout(resolve));
await new Promise((_, reject) => setTimeout(() => reject(new Error("late")), 5000));
setTimeout(() => store.flush(), 100);
await Promise.race([work, Bun.sleep(5000).then(() => "late")]);
await Promise.race([work, new Promise((resolve) => setTimeout(resolve, 1000))]);
for (let i = 0; i < 100 && !done; i++) await Bun.sleep(5);
while (!ready()) await new Promise((resolve) => setTimeout(resolve, 10));`),
  ).toEqual([]);
});

test("a slow poll tick counts once per loop, where the loop is", () => {
  expect(
    lines(`for (let i = 0; i < 100 && !done; i++) await Bun.sleep(50);
while (!ready()) await new Promise((resolve) => setTimeout(resolve, 11));`),
  ).toEqual([1, 2]);
});

test("a pausing helper counts at each call, not at its definition", () => {
  const text = `const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
async function calm() { await settle(); }
function sleep(ms) { return Bun.sleep(ms); }
async function waitFor(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await sleep(5); }
}
await settle();
await calm();
await sleep(80);
await sleep(0);
await waitFor(() => true);
for (;;) await sleep(3);`;
  expect(lines(text)).toEqual([7, 8, 9]);
});

test("a pausing helper handed on as a value counts where it is defined", () => {
  expect(
    lines(`function harness() {
  const settle = () => Bun.sleep(40);
  return { settle };
}`),
  ).toEqual([2]);
});

test("helpers imported from another test file count in the importer", () => {
  const files = new Map([
    [
      "web/src/testing/pause.ts",
      `export const settle = () => Bun.sleep(30);
export async function calm() { await settle(); }
export const quick = () => Promise.resolve();`,
    ],
    [
      "web/src/a.test.ts",
      `import { calm, quick, settle } from "./testing/pause";
await settle();
await calm();
await quick();`,
    ],
    [
      "web/src/b.test.ts",
      `import { calm as relax } from "./testing/pause";
export const gently = () => relax();`,
    ],
    [
      "web/src/c.test.ts",
      `import { gently } from "./b.test";\nawait gently();`,
    ],
  ]);
  const result = scanFiles(files);
  expect(result.get("web/src/testing/pause.ts")).toEqual([]);
  expect(result.get("web/src/a.test.ts")).toEqual([2, 3]);
  expect(result.get("web/src/b.test.ts")).toEqual([]);
  expect(result.get("web/src/c.test.ts")).toEqual([2]);
});

test("test files include fixtures and testing folders but not product code", () => {
  for (const path of [
    "web/src/a.test.ts",
    "web/src/a.browser.tsx",
    "web/src/a.browser.test.ts",
    "web/src/a.fixture.ts",
    "web/src/a.cases.ts",
    "web/src/a.browserMock.ts",
    "server/src/service/testing/services.ts",
  ])
    expect(TEST_FILE.test(path)).toBe(true);
  for (const path of ["web/src/store.ts", "server/src/testingMode.ts"])
    expect(TEST_FILE.test(path)).toBe(false);
});

test("a count above the allowlist fails; below it asks to lower the entry", () => {
  const allowed = { "a.test.ts": { pauses: 2, reason: "pending" } };
  expect(compare(new Map([["a.test.ts", [1, 2]]]), allowed)).toEqual([]);
  expect(compare(new Map([["a.test.ts", [1, 2, 3]]]), allowed)[0]).toContain(
    "3 fixed sleep(s) (lines 1, 2, 3), allowlist 2",
  );
  expect(compare(new Map([["a.test.ts", [1]]]), allowed)[0]).toContain(
    "lower it",
  );
  expect(compare(new Map([["b.test.ts", [4]]]), allowed)).toHaveLength(2);
});

test("the allowlist only shrinks against its base", () => {
  const current = new Map([
    ["a.test.ts", [1, 2]],
    ["b.test.ts", [1]],
  ]);
  const allowed = {
    "a.test.ts": { pauses: 2, reason: "pending" },
    "b.test.ts": { pauses: 1, reason: "pending" },
  };
  expect(compare(current, allowed, allowed)).toEqual([]);
  const problems = compare(current, allowed, {
    "a.test.ts": { pauses: 1, reason: "pending" },
  });
  expect(problems).toHaveLength(2);
  for (const problem of problems) expect(problem).toContain("only shrink");
});

test("--update lowers entries and drops fixed files, never raises", () => {
  const allowed = {
    "a.test.ts": { pauses: 3, reason: "pending" },
    "b.test.ts": { pauses: 1, reason: "wall time" },
  };
  expect(
    lowered(
      new Map([
        ["a.test.ts", [1, 2, 3, 4]],
        ["b.test.ts", []],
      ]),
      allowed,
    ),
  ).toEqual({ "a.test.ts": { pauses: 3, reason: "pending" } });
  expect(parseAllowlist(formatAllowlist(lowered(new Map(), allowed)))).toEqual(
    {},
  );
});

test("every entry needs a positive count and a one-line reason", () => {
  for (const entry of [
    { pauses: 0, reason: "x" },
    { pauses: 1, reason: "" },
    { pauses: 1, reason: "two\nlines" },
    { pauses: 1.5, reason: "x" },
  ])
    expect(() =>
      parseAllowlist(formatAllowlist({ "a.test.ts": entry })),
    ).toThrow("one-line reason");
});

test("only test code may import the test-timing switch", () => {
  const files = new Map([
    ["shared/timings.ts", "export function setTimingsForTests() {}"],
    [
      "shared/testing/timings.ts",
      `import { setTimingsForTests } from "../timings";`,
    ],
    [
      "web/src/store.ts",
      `import { setTimingsForTests, timing } from "../../shared/timings";`,
    ],
  ]);
  expect(timingSwitchesOutsideTests(files)).toEqual([
    "web/src/store.ts:1: only test code and the test service launcher may switch product timings (setTimingsForTests).",
  ]);
});
