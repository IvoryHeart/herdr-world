import { expect, test } from "bun:test";
import { runUsageProcess, type UsageProcess } from "./process";

function controlled(output: "stdout" | "stderr" | "hang", deferExit = false) {
  const exit = Promise.withResolvers<number>();
  let consumed = 0,
    killed = 0,
    cancelled = 0;
  const stream = (name: string) =>
    new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (name === output) {
            consumed += 64 * 1024;
            controller.enqueue(new Uint8Array(64 * 1024));
          }
        },
        cancel() {
          cancelled++;
        },
      },
      { highWaterMark: 0 },
    );
  const child: UsageProcess = {
    stdin: { end() {} },
    stdout: stream("stdout"),
    stderr: stream("stderr"),
    exited: exit.promise,
    kill() {
      killed++;
      if (!deferExit) exit.resolve(137);
    },
  };
  return {
    child,
    exit,
    consumed: () => consumed,
    killed: () => killed,
    cancelled: () => cancelled,
  };
}

for (const output of ["stdout", "stderr"] as const)
  test(`usage kills and reaps on the streaming ${output} bound`, async () => {
    const c = controlled(output);
    await expect(
      runUsageProcess(
        ["synthetic"],
        new AbortController().signal,
        () => c.child,
        () => {},
      ),
    ).rejects.toThrow("output limit");
    expect(c.consumed()).toBeLessThanOrEqual(
      (output === "stdout" ? 768 : 16) * 1024 + 64 * 1024,
    );
    expect(c.killed()).toBe(1);
    expect(c.cancelled()).toBe(2);
  });

test("usage cancellation settles only after the owned process is reaped", async () => {
  const c = controlled("hang", true),
    controller = new AbortController();
  let settled = false;
  const work = runUsageProcess(["synthetic"], controller.signal, () => c.child);
  void work.catch(() => {
    settled = true;
  });
  controller.abort();
  await Promise.resolve();
  await Promise.resolve();
  expect(c.killed()).toBe(1);
  expect(settled).toBe(false);
  c.exit.resolve(137);
  await expect(work).rejects.toThrow("cancelled");
  expect(c.cancelled()).toBe(2);
});

test("a nonzero child cannot retain open output streams", async () => {
  const c = controlled("hang");
  const work = runUsageProcess(
    ["synthetic"],
    new AbortController().signal,
    () => c.child,
  );
  c.exit.resolve(2);
  await expect(work).rejects.toThrow("failed");
  expect(c.killed()).toBe(1);
  expect(c.cancelled()).toBe(2);
});

test("the real process adapter bounds noisy output and kills a hanging child", async () => {
  let reaped = false;
  await expect(
    runUsageProcess(
      [
        "node",
        "-e",
        "process.stdout.write('x'.repeat(4194304));setInterval(()=>{},1000)",
      ],
      new AbortController().signal,
      (argv) => {
        const child = Bun.spawn(argv, {
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
        });
        return {
          stdin: child.stdin,
          stdout: child.stdout,
          stderr: child.stderr,
          kill: (signal) => child.kill(signal),
          exited: child.exited.then((code) => {
            reaped = true;
            return code;
          }),
        };
      },
    ),
  ).rejects.toThrow("output limit");
  expect(reaped).toBe(true);
});
