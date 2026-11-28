import { describe, expect, test } from "bun:test";
import {
  BROWSER_FILE_LIMIT_MS,
  FILE_LIMIT_ENV,
  fileLimitMs,
  fileWatchdog,
  LIVE_FILE_LIMIT_MS,
  UNIT_FILE_LIMIT_MS,
} from "./test-file-timeout";

describe("per-file test limit", () => {
  test("chooses the limit by file kind, or the configured one", () => {
    const read = (source: string) => () => source;
    expect(fileLimitMs("a.test.ts", {}, read("plain"))).toBe(
      UNIT_FILE_LIMIT_MS,
    );
    expect(
      fileLimitMs("b.test.ts", {}, read('import "../testing/sharedChrome"')),
    ).toBe(BROWSER_FILE_LIMIT_MS);
    expect(
      fileLimitMs("c.test.ts", {}, read("// @world-browser-suite\n")),
    ).toBe(BROWSER_FILE_LIMIT_MS);
    expect(fileLimitMs("d.live.test.ts", {}, read(""))).toBe(
      LIVE_FILE_LIMIT_MS,
    );
    expect(
      fileLimitMs("e.test.ts", { [FILE_LIMIT_ENV]: "1500" }, read("")),
    ).toBe(1500);
    expect(() =>
      fileLimitMs("f.test.ts", { [FILE_LIMIT_ENV]: "soon" }, read("")),
    ).toThrow(FILE_LIMIT_ENV);
  });

  test("stops a file that runs over and names it; a finished file re-arms for the next", () => {
    let file = "web/src/one.test.ts";
    const pending = new Map<number, { run: () => void; ms: number }>();
    let id = 0;
    const stops: string[] = [];
    const watchdog = fileWatchdog({
      current: () => file,
      limitFor: () => 1000,
      timers: {
        setTimeout: (run, ms) => {
          pending.set(++id, { run, ms });
          return id as never;
        },
        clearTimeout: (timer) => pending.delete(timer as unknown as number),
      },
      stop: (message) => stops.push(message),
    });
    watchdog.start();
    expect([...pending.values()].map((timer) => timer.ms)).toEqual([1000]);
    watchdog.finish();
    // Only the newest timer stays armed.
    expect(pending.size).toBe(1);
    file = "web/src/two.test.ts";
    watchdog.start();
    expect(pending.size).toBe(1);
    [...pending.values()][0]!.run();
    expect(stops).toEqual([
      "[test-file-timeout] web/src/two.test.ts ran over its 1 s file limit; stopping its test process",
    ]);
    watchdog.finish();
    [...pending.values()][0]!.run();
    expect(stops[1]).toContain(
      "web/src/two.test.ts (or the file loading after it) ran over",
    );
  });
});
