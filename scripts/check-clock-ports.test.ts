import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clockEntries, checkClockPorts } from "./check-clock-ports";
import { expect, test } from "bun:test";
import { compareClocks, directTimeCalls } from "./check-clock-ports";

test("clock guard distinguishes native scheduling from injected ports and text", () => {
  expect(
    directTimeCalls(
      "web/src/feature.ts",
      `
    Date.now(); performance.now(); window.setTimeout(run, 1); setInterval(run, 2);
    globalThis.requestAnimationFrame(run); window['setTimeout'](run, 1);
    clock.now(); ports.clock.now(); clock.setTimeout(run, 1); scheduler.setInterval(run, 1);
    // Date.now();
    const text = "setTimeout(resolve, 50)";
  `,
    ),
  ).toEqual({
    "Date.now": 1,
    "performance.now": 1,
    setTimeout: 2,
    setInterval: 1,
    requestAnimationFrame: 1,
  });
  expect(directTimeCalls("web/src/clock.ts", "Date.now()")).toEqual({});
});

test("counts are exact and cannot move between operations or grow after adoption", () => {
  const entries = (counts: Record<string, number>) => ({
    "web/src/a.ts": { counts, reason: "legacy" },
  });
  const base = entries({ setTimeout: 2 });
  expect(
    compareClocks(entries({ setTimeout: 1 }), entries({ setTimeout: 1 }), base),
  ).toEqual([]);
  expect(
    compareClocks(
      entries({ setTimeout: 2 }),
      base,
      entries({ setTimeout: 1 }),
    ).join(" "),
  ).toContain("only shrink");
  expect(compareClocks(entries({ setInterval: 2 }), base).length).toBe(2);
  expect(compareClocks({}, base).join(" ")).toContain("lower the allowlist");
});

test("native time in executable HTML is checked while inert JSON stays data", () => {
  expect(
    directTimeCalls(
      "server/src/page.ts",
      'const html = "<script>Date.now(); setTimeout(work, 1)</script><script type=application/json>{}</script>";',
    ),
  ).toEqual({ "Date.now": 1, setTimeout: 1 });
});

test("native callback defaults, qualified globals and timer aliases cannot hide time", () => {
  const source = `
    import {setTimeout as pause} from "node:timers/promises";
    const wall = Date.now;
    function read(now = Date.now) { return now(); }
    Date.now(); window.performance.now.bind(window.performance);
    const later = globalThis["setTimeout"]; setTimeout(work, 2); await pause(1);
    const callbacks = [requestAnimationFrame, self.setInterval];
    new Date(); new Date(at); Date();
  `;
  expect(directTimeCalls("server/src/time.ts", source)).toEqual({
    "Date.now": 3,
    "performance.now": 1,
    setTimeout: 3,
    requestAnimationFrame: 1,
    setInterval: 1,
    "new Date": 1,
    "Date()": 1,
  });
  expect(
    directTimeCalls(
      "web/src/port-consumer.ts",
      "const {setTimeout} = clock; type Timer = typeof globalThis.setTimeout; const local = clock.setTimeout;",
    ),
  ).toEqual({});
});

test("first adoption cannot bless a newly introduced native scheduler", () => {
  const root = mkdtempSync(join(tmpdir(), "clock-adoption-"));
  const path = "web/src/legacy.ts";
  const before = "export const read = Date.now();";
  try {
    mkdirSync(join(root, "web/src"), { recursive: true });
    mkdirSync(join(root, "scripts"));
    const git = (...args: string[]) =>
      expect(
        Bun.spawnSync(["git", "-C", root, ...args], {
          stdout: "ignore",
          stderr: "ignore",
        }).exitCode,
      ).toBe(0);
    git("init", "--quiet", "--initial-branch=fixture");
    writeFileSync(join(root, path), before);
    git("add", path);
    git(
      "-c",
      "user.name=Synthetic Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    );
    const allowance = (source: string) => {
      const files = new Map([[path, source]]);
      writeFileSync(
        join(root, "scripts/clock-ports-allowlist.json"),
        JSON.stringify({ version: 1, files: clockEntries(files) }),
      );
      return files;
    };
    expect(checkClockPorts(root, allowance(before), false, "HEAD")).toEqual([]);
    const after = before + " setTimeout(work, 10);";
    writeFileSync(join(root, path), after);
    expect(
      checkClockPorts(root, allowance(after), false, "HEAD").join(" "),
    ).toContain("only shrink");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
