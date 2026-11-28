import { expect, test } from "bun:test";
import { checkerProcess } from "./testing/verification-process.fixture";
import {
  runVerificationProcess,
  VerificationProcessError,
} from "./verification-process";

const unixTest = process.platform === "win32" ? test.skip : test;

unixTest("bounded checker commands preserve output and status", async () => {
  const process = checkerProcess();
  const running = runVerificationProcess(
    ["synthetic-checker"],
    { timeoutMs: 2000 },
    process.ports,
  );
  process.output("synthetic-output\n");
  process.error("synthetic-error\n");
  process.clock.advance(1999);
  process.finish(7);
  const result = await running;
  expect(result.code).toBe(7);
  expect(result.stdout.trim()).toBe("synthetic-output");
  expect(result.stderr.trim()).toBe("synthetic-error");
  expect(result.elapsedMs).toBe(1999);
  expect(result.maxRSSBytes).toBe(1024);
  expect(process.clock.pending).toBe(0);
});

unixTest("timeout drains a SIGTERM-resistant checker grandchild", async () => {
  const process = checkerProcess();
  let port = 0;
  const running = runVerificationProcess(
    ["synthetic-checker"],
    {
      timeoutMs: 500,
      graceMs: 50,
      onOutput: (text) => {
        port = Number(text.trim());
      },
    },
    process.ports,
  );
  void running.catch(() => {});
  process.output("12345\n");
  // The parent exits, but a resistant grandchild still owns its pipes.
  process.exit(0);
  process.clock.advance(499);
  expect(process.signals).toEqual([]);
  process.clock.advance(1);
  expect(process.signals).toEqual(["SIGTERM"]);
  expect(process.alive()).toBe(true);
  process.clock.advance(49);
  expect(process.alive()).toBe(true);
  process.clock.advance(1);
  await expect(running).rejects.toMatchObject({ reason: "timeout" });
  expect(port).toBeGreaterThan(0);
  expect(process.signals).toEqual(["SIGTERM", "SIGKILL"]);
  expect(process.alive()).toBe(false);
  expect(process.clock.pending).toBe(0);
});

unixTest(
  "abort drains the owned command without crediting cancellation as success",
  async () => {
    const process = checkerProcess();
    const controller = new AbortController();
    const running = runVerificationProcess(
      ["synthetic-checker"],
      {
        timeoutMs: 2000,
        signal: controller.signal,
        graceMs: 20,
        onOutput: () => controller.abort(),
      },
      process.ports,
    );
    void running.catch(() => {});
    process.output("ready");
    await process.terminated;
    process.clock.advance(20);
    await expect(running).rejects.toMatchObject({ reason: "aborted" });
    expect(process.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(process.clock.pending).toBe(0);
  },
);

unixTest("observer errors and excessive output fail the command", async () => {
  const failure = new Error("synthetic observer failure");
  const process = checkerProcess();
  const running = runVerificationProcess(
    ["synthetic-checker"],
    {
      timeoutMs: 2000,
      graceMs: 20,
      onOutput: () => {
        throw failure;
      },
    },
    process.ports,
  );
  void running.catch(() => {});
  process.output("ready");
  await process.terminated;
  process.clock.advance(20);
  await expect(running).rejects.toBe(failure);
  const excessive = checkerProcess();
  const limited = runVerificationProcess(
    ["synthetic-checker"],
    {
      timeoutMs: 2000,
      graceMs: 20,
      maxOutputBytes: 100,
    },
    excessive.ports,
  );
  void limited.catch(() => {});
  excessive.output("x".repeat(4096));
  await excessive.terminated;
  excessive.clock.advance(20);
  await expect(limited).rejects.toBeInstanceOf(VerificationProcessError);
  expect(excessive.signals).toEqual(["SIGTERM", "SIGKILL"]);
  expect(excessive.clock.pending).toBe(0);
});
