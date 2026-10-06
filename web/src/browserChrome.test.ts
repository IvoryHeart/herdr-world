import { expect, jest, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  stopChrome,
  waitForBrowserFixture,
  waitForChromePort,
  withBrowserDeadline,
} from "./browserChrome";

test("cold Chrome startup does not consume the fixture deadline", async () => {
  jest.useFakeTimers();
  try {
    const page = Promise.withResolvers<void>();
    const result = Promise.withResolvers<number>();
    const observed = waitForBrowserFixture(
      page.promise,
      result.promise,
      new Promise<never>(() => {}),
      "Fixture",
      10_000,
    );
    jest.advanceTimersByTime(31_000);
    page.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(9_999);
    result.resolve(42);
    expect(await observed).toBe(42);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

test.each(["startup", "fixture"])(
  "browser %s remains bounded",
  async (phase) => {
    jest.useFakeTimers();
    try {
      const page = Promise.withResolvers<void>();
      const observed = waitForBrowserFixture(
        page.promise,
        new Promise(() => {}),
        new Promise<never>(() => {}),
        "Fixture",
        30_000,
      );
      if (phase === "fixture") page.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(phase === "startup" ? 35_000 : 30_000);
      await expect(observed).rejects.toThrow(
        phase === "startup"
          ? "Fixture browser startup timed out after 35000ms"
          : "Fixture timed out after 30000ms",
      );
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  },
);

test.each(["startup", "fixture"])(
  "Chrome exit during %s preserves errors and clears timers",
  async (phase) => {
    jest.useFakeTimers();
    try {
      const page = Promise.withResolvers<void>();
      const exited = Promise.withResolvers<never>();
      const observed = waitForBrowserFixture(
        page.promise,
        new Promise(() => {}),
        exited.promise,
        "Fixture",
        30_000,
      );
      if (phase === "fixture") page.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      const error = new Error("Browser exited before the result");
      exited.reject(error);
      await expect(observed).rejects.toBe(error);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  },
);

test("browser deadlines preserve results and errors and clear their timers", async () => {
  jest.useFakeTimers();
  try {
    expect(await withBrowserDeadline(Promise.resolve(42), "CDP reply")).toBe(
      42,
    );
    const error = new Error("CDP disconnected");
    await expect(
      withBrowserDeadline(Promise.reject(error), "CDP reply"),
    ).rejects.toBe(error);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

test("a missing CDP reply fails within its deadline", async () => {
  jest.useFakeTimers();
  try {
    const result = withBrowserDeadline(
      new Promise(() => {}),
      "CDP Runtime.evaluate",
    );
    jest.advanceTimersByTime(10_000);
    await expect(result).rejects.toThrow(
      "CDP Runtime.evaluate timed out after 10000ms",
    );
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

test("Chrome teardown exits cleanly and force-stops a stuck process", async () => {
  jest.useFakeTimers();
  const kill = mock(() => {});
  try {
    await stopChrome(undefined);
    await stopChrome({ kill, exited: Promise.resolve(0) });
    expect(kill).toHaveBeenCalledWith("SIGTERM");
    expect(kill).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);

    const exit = Promise.withResolvers<number>();
    const result = stopChrome({ kill, exited: exit.promise });
    jest.advanceTimersByTime(2_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(kill).toHaveBeenLastCalledWith("SIGKILL");
    exit.resolve(0);
    await result;
    expect(jest.getTimerCount()).toBe(0);

    const stuck = stopChrome({ kill, exited: new Promise(() => {}) });
    jest.advanceTimersByTime(2_000);
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(2_000);
    await expect(stuck).rejects.toThrow(
      "Chrome forced exit timed out after 2000ms",
    );
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

test("Chrome readiness tolerates slow startup and an incomplete port file", async () => {
  const profile = mkdtempSync(join(tmpdir(), "chrome-startup-test-"));
  const portFile = join(profile, "DevToolsActivePort");
  jest.useFakeTimers();
  try {
    const ready = waitForChromePort(
      { exitCode: null },
      profile,
      join(profile, "stderr"),
    );
    jest.advanceTimersByTime(6000);
    await Promise.resolve();
    writeFileSync(portFile, "9222\n");
    jest.advanceTimersByTime(25);
    await Promise.resolve();
    writeFileSync(portFile, "9222\n/devtools/browser/test");
    jest.advanceTimersByTime(25);
    expect(await ready).toBe("9222");
  } finally {
    jest.useRealTimers();
    rmSync(profile, { recursive: true, force: true });
  }
});

test.each(["exit", "timeout"])(
  "Chrome startup %s includes stderr instead of a missing-file error",
  async (failure) => {
    const profile = mkdtempSync(join(tmpdir(), "chrome-startup-test-"));
    const errorOutput = join(profile, "stderr");
    writeFileSync(errorOutput, "browser startup diagnostic");
    jest.useFakeTimers();
    try {
      const child = { exitCode: null as number | null };
      const ready = waitForChromePort(child, profile, errorOutput);
      if (failure === "exit") child.exitCode = 1;
      jest.advanceTimersByTime(failure === "exit" ? 25 : 20000);
      await expect(ready).rejects.toThrow(
        failure === "exit"
          ? "Chrome exited during startup (1)\nbrowser startup diagnostic"
          : "Chrome did not expose its debugging endpoint within 20 seconds\nbrowser startup diagnostic",
      );
    } finally {
      jest.useRealTimers();
      rmSync(profile, { recursive: true, force: true });
    }
  },
);
