import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { warmChrome } from "./chrome-warmup";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function fakeChrome(script: string) {
  const dir = mkdtempSync(join(tmpdir(), "fake-chrome-"));
  dirs.push(dir);
  const path = join(dir, "chrome");
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
  return path;
}

test("the warm-up waits for the first launch and reports how long it took", async () => {
  const logs: string[] = [];
  const seconds = await warmChrome(fakeChrome("sleep 0.3"), {
    log: (message) => logs.push(message),
  });
  expect(seconds).toBeGreaterThanOrEqual(0.3);
  expect(logs).toEqual([
    expect.stringMatching(
      /^\[chrome-warmup\] first Chrome launch took \d+\.\ds$/,
    ),
  ]);
});

test("a failing, hanging or missing Chrome is reported, never thrown", async () => {
  const logs: string[] = [];
  const log = (message: string) => logs.push(message);
  expect(await warmChrome(fakeChrome("exit 3"), { log })).toBeUndefined();
  expect(
    await warmChrome(fakeChrome("sleep 30"), { log, timeoutMs: 200 }),
  ).toBeUndefined();
  expect(
    await warmChrome(join(tmpdir(), "no-such-chrome-binary"), { log }),
  ).toBeUndefined();
  expect(logs[0]).toMatch(/^\[chrome-warmup\] Chrome exited 3 after /);
  expect(logs[1]).toMatch(/^\[chrome-warmup\] Chrome exited (137|null) after /);
  expect(logs[2]).toMatch(/^\[chrome-warmup\] could not start Chrome/);
});
