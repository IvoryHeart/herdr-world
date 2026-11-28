import { expect, test } from "bun:test";
import {
  compare,
  formatAllowlist,
  lowered,
  parseAllowlist,
  scanFiles,
  scanSource,
  timingSwitchesOutsideTests,
} from "./check-test-waits";
import {
  CLOCK_MODULES,
  compareProductionClock,
  directClockUses,
  formatClockAllowlist,
  loweredClock,
  parseClockAllowlist,
  productionClockFile,
  scanProductionClock,
} from "./production-clock";
import { TEST_FILE } from "./source-ast";

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

test("a short tick in a loop that only counts, iterates or watches the clock is a pause", () => {
  expect(
    lines(`for (let i = 0; i < 100; i++) await Bun.sleep(5);
for (let i = 0; i < cases.length; i += 1) await Bun.sleep(5);
for (const x of cases) await Bun.sleep(5);
while (Date.now() < deadline) await Bun.sleep(5);
for (;;) await Bun.sleep(5);
for (let n = 0; n < 9; n++) { if (n === 3) continue; await Bun.sleep(5); }
for (const x of xs) { for (;;) { if (x.ready) break; } await Bun.sleep(5); }`),
  ).toEqual([1, 2, 3, 4, 5, 6, 7]);
});

test("a short tick polls when the loop's condition or a conditional exit reads state", () => {
  expect(
    lines(`while (count < 2) await Bun.sleep(5);
do { await Bun.sleep(5); } while (!state.ready);
for (const _ of attempts) { if (await check()) break; await Bun.sleep(5); }
while (Date.now() < deadline) { if (seen.length) return; await Bun.sleep(5); }
for (;;) { try { await fetch(url); return; } catch { await Bun.sleep(5); } }
for (;;) { await new Promise((resolve) => setTimeout(resolve, 5)); if (done) break; }
for (let i = 0; i < 50; i++) { if (host.firstChild) return; await act(async () => Bun.sleep(5)); }`),
  ).toEqual([]);
});

test("a sleep loop with no condition it waits on is a pause", () => {
  expect(
    lines(`for (let i=0; i<100; i=i+1) await Bun.sleep(5);
const started=Date.now(); while (Date.now()-started<500) await Bun.sleep(5);
for (let i=0;i<100;i++) { try { await Bun.sleep(5); if (i===99) break; } catch {} }
const deadline = performance.now() + 500; while (performance.now() < deadline) await Bun.sleep(5);
let n = 0; while (n < 100) { n = n + 1; await Bun.sleep(5); }
for (let i = 0; i < 100; i = 1 + i) await Bun.sleep(5);
for (;;) { try { await Bun.sleep(5); break; } catch {} }
const settle = () => Bun.sleep(5);
for (;;) { try { await settle(); return; } catch {} await Bun.sleep(5); }`),
  ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 9]);
});

test("a sleep loop that checks a real condition every iteration polls", () => {
  expect(
    lines(`const started=Date.now(); while (!server.ready && Date.now()-started<500) await Bun.sleep(5);
for (let i=0; i<100; i=i+1) { if (await check()) break; await Bun.sleep(5); }
for (let i=0;i<100;i++) { try { await fetch(url); break; } catch {} await Bun.sleep(5); }
for (let i=0;i<100;i++) { try { await Bun.sleep(5); if (i===99 || seen.length) break; } catch {} }`),
  ).toEqual([]);
});

test("a callback declared in a loop runs later, outside the loop", () => {
  expect(
    lines(`for (const x of cases) test("case", async () => { await Bun.sleep(5); });
while (!ready()) { emitter.on("tick", () => Bun.sleep(5)); await Bun.sleep(5); }
for (const x of cases) { function later() { return Bun.sleep(5); } later(); }`),
  ).toEqual([1, 2, 3, 3]);
});

test("every pausing line counts: a helper's pause and each call of it", () => {
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
while (!done()) await sleep(3);`;
  expect(lines(text)).toEqual([1, 2, 7, 8, 9]);
});

test("a timer that settles through a frame callback is a pause", () => {
  expect(
    lines(`const settle = (ms = 0) =>
  new Promise((resolve) =>
    setTimeout(() => requestAnimationFrame(() => resolve(undefined)), ms),
  );
await settle(700);
await new Promise((r) => setTimeout(() => reject(new Error("late")), 50));`),
  ).toEqual([5]);
});

test("a new sleep inside a helper that already pauses still counts", () => {
  const before = `async function run() {
  await Bun.sleep(50);
  for (const width of [390, 1300]) await settle();
}
const settle = () => Bun.sleep(80);
run();`;
  expect(lines(before)).toEqual([2, 3, 5, 6]);
  expect(
    lines(
      before.replace(
        "await Bun.sleep(50);",
        "await Bun.sleep(50);\n  await settle();",
      ),
    ),
  ).toEqual([2, 3, 4, 6, 7]);
});

test("a helper's pause set by a parameter counts at each call by its argument", () => {
  expect(
    lines(`function nap(label, ms = 40) { return Bun.sleep(ms); }
await nap("yield", 0);
await nap("pause", 30);
await nap("default");
while (!ready()) await nap("tick", 5);
for (const x of cases) await nap("fixed", 5);`),
  ).toEqual([3, 4, 6]);
});

test("a pausing helper handed on as a value counts where it is defined", () => {
  expect(
    lines(`function harness() {
  const settle = () => Bun.sleep(40);
  const sleep = (ms) => Bun.sleep(ms);
  return { settle, advance: sleep };
}`),
  ).toEqual([2, 3]);
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
  expect(result.get("web/src/testing/pause.ts")).toEqual([1, 2]);
  expect(result.get("web/src/a.test.ts")).toEqual([2, 3]);
  expect(result.get("web/src/b.test.ts")).toEqual([2]);
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

test("production clock: direct reads and timers count outside the clock modules", () => {
  expect(
    directClockUses(
      "web/src/a.ts",
      `const at = Date.now();
const started = performance.now();
setTimeout(run, 10);
window.setInterval(run, 100);
globalThis.setTimeout(run);
clock.setTimeout(run, 10);
scheduler.schedule(run, 10);
const later = new Date(at);
const name = "setTimeout";`,
    ),
  ).toEqual([1, 2, 3, 4, 5]);
  for (const path of CLOCK_MODULES)
    expect(productionClockFile(path)).toBe(false);
  for (const path of [
    "web/src/a.test.ts",
    "web/src/world/testing/fixture.ts",
    "web/src/a.browser.tsx",
    "scripts/tool.ts",
    "web/src/types.d.ts",
  ])
    expect(productionClockFile(path)).toBe(false);
  expect(productionClockFile("server/src/world/snapshot.ts")).toBe(true);
  expect([
    ...scanProductionClock(
      new Map([
        ["web/src/clock.ts", "export const now = () => Date.now();"],
        ["web/src/a.test.ts", "Date.now();"],
        ["web/src/b.ts", "Date.now(); performance.now();"],
      ]),
    ),
  ]).toEqual([["web/src/b.ts", [1, 1]]]);
});

test("production clock allowlist: new uses fail, counts only shrink", () => {
  const current = new Map([
    ["web/src/a.ts", [3, 9]],
    ["web/src/b.ts", [1]],
  ]);
  const allowed = { "web/src/a.ts": 2, "web/src/c.ts": 1 };
  const problems = compareProductionClock(current, allowed, {
    "web/src/a.ts": 1,
  });
  expect(problems.some((p) => p.startsWith("web/src/b.ts: 1 direct"))).toBe(
    true,
  );
  expect(problems.some((p) => p.startsWith("web/src/c.ts: no direct"))).toBe(
    true,
  );
  expect(
    problems.some((p) => p.includes("may only shrink (base 1, now 2)")),
  ).toBe(true);
  expect(
    compareProductionClock(new Map([["web/src/a.ts", [3]]]), {
      "web/src/a.ts": 2,
    }),
  ).toEqual([
    "web/src/a.ts: 1 direct clock or timer use(s), allowlist 2: lower it (bun scripts/check-test-waits.ts --update).",
  ]);
  expect(
    compareProductionClock(current, { "web/src/a.ts": 2, "web/src/b.ts": 1 }),
  ).toEqual([]);
  expect(loweredClock(new Map([["web/src/a.ts", [3]]]), allowed)).toEqual({
    "web/src/a.ts": 1,
  });
  expect(
    parseClockAllowlist(formatClockAllowlist({ "web/src/a.ts": 2 })),
  ).toEqual({
    "web/src/a.ts": 2,
  });
  for (const files of [{ "web/src/a.ts": 0 }, { "web/src/a.ts": 1.5 }])
    expect(() =>
      parseClockAllowlist(JSON.stringify({ version: 1, files })),
    ).toThrow();
});
