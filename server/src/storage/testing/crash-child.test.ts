import { expect, mock, test } from "bun:test";
import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawnCrashChild } from "./crash-child";

function processDouble() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: mock(() => true),
  });
  const createProcess = mock(() => child) as unknown as typeof spawn;
  return { child, createProcess };
}

test("crash children wait for stdio close after process exit before releasing fixture ownership", async () => {
  const { child, createProcess } = processDouble();
  const process = spawnCrashChild(
    ["synthetic", "argument"],
    "synthetic-root",
    createProcess,
  );
  let complete = false;
  void process.exited.then(() => {
    complete = true;
  });
  child.emit("exit", 0, null);
  await Promise.resolve();
  expect(complete).toBe(false);
  child.stdout.end();
  child.stderr.end();
  child.emit("close", 0, null);
  expect(await process.exited).toBe(0);
  expect(complete).toBe(true);
  process.kill("SIGKILL");
  expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  expect(createProcess).toHaveBeenCalledWith("synthetic", ["argument"], {
    cwd: "synthetic-root",
    stdio: ["ignore", "pipe", "pipe"],
  });
});

test("crash child startup errors and signal exits cannot report a clean exit", async () => {
  const failed = processDouble();
  const failure = new Error("synthetic spawn failure");
  const process = spawnCrashChild(
    ["synthetic"],
    "synthetic-root",
    failed.createProcess,
  );
  const outcome = process.exited.catch((error: unknown) => error);
  failed.child.emit("error", failure);
  expect(await outcome).toBe(failure);
  const killed = processDouble();
  const other = spawnCrashChild(
    ["synthetic"],
    "synthetic-root",
    killed.createProcess,
  );
  killed.child.emit("close", null, "SIGKILL");
  expect(await other.exited).not.toBe(0);
});
