import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJUnit } from "./test-retry";
import { worldBrowserCasePlan } from "./world-browser-suites";
import timings from "./world-browser-timings.json";
import { expect, test } from "bun:test";
import {
  type CaseTimings,
  executeWorldBrowserCases,
  planWorldBrowserCases,
  worldCasePattern,
  worldCaseTestArgs,
  worldCaseConcurrency,
} from "./world-browser-cases";

test("individual cases from a heavy file occupy different workers", () => {
  const timings = { heavy: { a: 40, b: 35, c: 30 }, light: { a: 5 } };
  const plan = planWorldBrowserCases(["heavy", "light"], timings, 2, 2);
  expect(
    plan
      .flat()
      .map((queue) => queue.reduce((sum, task) => sum + task.seconds, 0)),
  ).toEqual([40, 35, 30, 5]);
  expect(plan.flat(2).filter((task) => task.file === "heavy")).toHaveLength(3);
  expect(plan).toEqual(
    planWorldBrowserCases(["heavy", "light"], timings, 2, 2),
  );
});

test("local case queues use available capacity without changing CI's default cap", async () => {
  const files = Array.from({ length: 18 }, (_, index) => `file-${index}`);
  const workers = files.map((file) => [
    { file, names: ["case"], remaining: true, seconds: 1 },
  ]);
  let active = 0,
    peak = 0;
  const seen: string[] = [];
  expect(
    await executeWorldBrowserCases(
      workers,
      files,
      async (task) => {
        active++;
        peak = Math.max(peak, active);
        seen.push(task.file);
        await Promise.resolve();
        active--;
        return 0;
      },
      4,
      18,
    ),
  ).toBe(0);
  expect(peak).toBe(4);
  expect(seen.sort()).toEqual([...files].sort());
  await expect(
    executeWorldBrowserCases(workers, files, async () => 0),
  ).rejects.toThrow("Too many");
});

test("known, new and renamed cases run exactly once, including colliding names in other files", () => {
  const timings = {
    a: { "x [brackets] $": 40, shared: 30, deleted: 20 },
    b: { shared: 10 },
    staleFile: { stale: 90 },
  };
  const tasks = planWorldBrowserCases(
    ["a", "b", "newFile"],
    timings,
    2,
    2,
  ).flat(2);
  for (const [file, names] of Object.entries({
    a: ["x [brackets] $", "shared", "shared\n", "new\ncase", "renamed"],
    b: ["shared", "new"],
    newFile: ["new"],
  })) {
    for (const name of names)
      expect(
        tasks.filter(
          (task) =>
            task.file === file &&
            new RegExp(worldCasePattern(task, timings)).test(name),
        ),
      ).toHaveLength(1);
    expect(
      tasks.filter((task) => task.file === file && task.remaining),
    ).toHaveLength(1);
  }
  expect(tasks.some((task) => task.file === "staleFile")).toBe(false);
});

test("invalid timing data and worker counts fail closed", () => {
  for (const value of [0, -1, NaN, Infinity])
    expect(() =>
      planWorldBrowserCases(["a"], { a: { case: value } }),
    ).toThrow();
  for (const count of [0, -1, 1.5]) {
    expect(() => planWorldBrowserCases([], {}, count)).toThrow();
    expect(() => planWorldBrowserCases([], {}, 1, count)).toThrow();
  }
  expect(() => planWorldBrowserCases(["a", "a"], {})).toThrow();
});

test("the six-runner case plan budgets two browsers below four minutes", () => {
  expect(worldBrowserCasePlan).toHaveLength(6);
  for (const workers of worldBrowserCasePlan) {
    expect(workers).toHaveLength(3);
    // List scheduling on two browsers costs at most half the recorded work
    // plus the longest case. Leave two minutes for setup and contention.
    const tasks = workers.flat();
    expect(
      tasks.reduce((sum, task) => sum + task.seconds, 0) / 2 +
        Math.max(
          ...tasks.flatMap((task) =>
            task.names.map(
              (name) => (timings.cases as CaseTimings)[task.file]![name]!,
            ),
          ),
        ),
    ).toBeLessThan(240);
  }
  for (const cases of Object.values(timings.cases))
    for (const seconds of Object.values(cases))
      expect(seconds).toBeLessThanOrEqual(50);
});

for (const negativeControl of [false, true])
  test(`Bun accepts stale timing rows and runs renamed cases once${negativeControl ? " while retaining an unmeasured violation" : ""}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "world-case-selectors-"));
    try {
      const files = ["a.test.ts", "b.test.ts"];
      await Bun.write(
        join(directory, files[0]!),
        'import {test} from "bun:test"; test("shared",()=>{}); test("escaped [$]",()=>{}); test("renamed",()=>{});' +
          (negativeControl
            ? 'test("unmeasured negative control",()=>{throw new Error("retained violation")});'
            : ""),
      );
      await Bun.write(
        join(directory, files[1]!),
        'import {test} from "bun:test"; test("shared",()=>{});',
      );
      const weights = {
        "a.test.ts": {
          "old name": 40,
          deleted: 30,
          shared: 20,
          "escaped [$]": 10,
        },
        "b.test.ts": { shared: 5 },
      };
      const observed: ReturnType<typeof parseJUnit> = [];
      let failures = 0;
      let emptyExactTasks = 0;
      for (const [index, task] of planWorldBrowserCases(files, weights, 1, 3)
        .flat(2)
        .entries()) {
        const output = join(directory, `${index}.xml`);
        const child = Bun.spawn(
          [
            process.execPath,
            fileURLToPath(new URL("./run-tests.ts", import.meta.url)),
            `./${task.file}`,
            ...worldCaseTestArgs(task, weights),
            "--retry-flaky=browser",
            `--flake-report=${join(directory, `${index}.flakes.json`)}`,
            "--reporter=junit",
            `--reporter-outfile=${output}`,
          ],
          { cwd: directory, stdout: "ignore", stderr: "ignore" },
        );
        const code = await child.exited;
        if (
          !task.remaining &&
          task.names.every((name) => ["old name", "deleted"].includes(name))
        ) {
          emptyExactTasks++;
          expect(code).toBe(0);
        }
        failures += code === 1 ? 1 : 0;
        expect([0, 1]).toContain(code);
        observed.push(
          ...parseJUnit(await Bun.file(output).text()).filter(
            (item) => item.status !== "skip",
          ),
        );
      }
      expect(emptyExactTasks).toBe(2);
      expect(
        observed.map((item) => `${item.file}#${item.name}`).sort(),
      ).toEqual([
        "a.test.ts#escaped [$]",
        "a.test.ts#renamed",
        "a.test.ts#shared",
        ...(negativeControl ? ["a.test.ts#unmeasured negative control"] : []),
        "b.test.ts#shared",
      ]);
      expect(failures).toBe(negativeControl ? 1 : 0);
      expect(
        observed
          .filter((item) => item.status === "fail")
          .map((item) => item.name),
      ).toEqual(negativeControl ? ["unmeasured negative control"] : []);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

test("Bun still rejects a complement task that matches no current cases", async () => {
  const directory = await mkdtemp(join(tmpdir(), "world-case-missing-"));
  try {
    const file = "missing.test.ts";
    await Bun.write(
      join(directory, file),
      'import {test} from "bun:test"; test("shared",()=>{});',
    );
    const weights = { [file]: { shared: 40, deleted: 30 } };
    const task = planWorldBrowserCases([file], weights, 1, 2)
      .flat(2)
      .find((task) => task.remaining)!;
    const selection = worldCaseTestArgs(task, weights);
    expect(selection).not.toContain("--pass-with-no-tests");
    const child = Bun.spawn(
      [
        process.execPath,
        fileURLToPath(new URL("./run-tests.ts", import.meta.url)),
        `./${file}`,
        ...selection,
        "--retry-flaky=browser",
        `--flake-report=${join(directory, "flakes.json")}`,
        "--reporter=junit",
        `--reporter-outfile=${join(directory, "missing.xml")}`,
      ],
      { cwd: directory, stdout: "ignore", stderr: "pipe" },
    );
    const stderr = new Response(child.stderr).text();
    expect(await child.exited).toBe(1);
    expect(await stderr).toContain("matched 0 tests");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("case workers stay bounded and a failed group does not hide later violations", async () => {
  const queues = ["a", "b", "c"].map((prefix) =>
    [1, 2].map((index) => ({
      file: `${prefix}${index}`,
      names: [],
      remaining: true,
      seconds: 1,
    })),
  );
  let active = 0,
    peak = 0;
  const seen: string[] = [];
  const result = await executeWorldBrowserCases(
    queues,
    queues.flat().map((task) => task.file),
    async (task) => {
      active++;
      peak = Math.max(peak, active);
      seen.push(task.file);
      await Promise.resolve();
      active--;
      return task.file.startsWith("a") ? 1 : 0;
    },
  );
  expect(result).toBe(1);
  expect(peak).toBe(3);
  expect(seen.sort()).toEqual(["a1", "a2", "b1", "b2", "c1", "c2"]);
});

for (const concurrency of [1, 2])
  test(`case workers honor scene isolation at concurrency ${concurrency}`, async () => {
    const queues = ["a", "b", "c"].map((prefix) =>
      [1, 2].map((index) => ({
        file: `${prefix}${index}`,
        names: [],
        remaining: true,
        seconds: 1,
      })),
    );
    let active = 0,
      peak = 0;
    const seen: string[] = [];
    const result = await executeWorldBrowserCases(
      queues,
      queues.flat().map((task) => task.file),
      async (task, worker, index) => {
        active++;
        peak = Math.max(peak, active);
        seen.push(`${worker}/${index}:${task.file}`);
        await Promise.resolve();
        active--;
        return task.file === "a1" ? 1 : 0;
      },
      concurrency,
    );
    expect(peak).toBe(concurrency);
    expect(result).toBe(1);
    expect(seen.sort()).toEqual([
      "0/0:a1",
      "0/1:a2",
      "1/0:b1",
      "1/1:b2",
      "2/0:c1",
      "2/1:c2",
    ]);
  });

test("a rejected case releases an isolated slot before reporting the error", async () => {
  const queues = ["a", "b", "c"].map((file) => [
    { file, names: [], remaining: true, seconds: 1 },
  ]);
  const seen: string[] = [];
  await expect(
    executeWorldBrowserCases(
      queues,
      ["a", "b", "c"],
      async (task) => {
        seen.push(task.file);
        if (task.file === "a") throw new Error("browser launch failed");
        return 1;
      },
      1,
    ),
  ).rejects.toThrow("browser launch failed");
  expect(seen).toEqual(["a", "b", "c"]);
});

test("World case concurrency honors both Bun argument forms and the worker cap", () => {
  expect(worldCaseConcurrency([])).toBe(3);
  expect(worldCaseConcurrency(["--parallel=1"])).toBe(1);
  expect(worldCaseConcurrency(["--parallel", "2"])).toBe(2);
  expect(worldCaseConcurrency(["--parallel=8"])).toBe(3);
  for (const args of [
    ["--parallel"],
    ["--parallel=0"],
    ["--parallel=-1"],
    ["--parallel=1.5"],
  ])
    expect(() => worldCaseConcurrency(args)).toThrow();
});
