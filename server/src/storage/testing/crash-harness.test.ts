import { expect, jest, mock, test } from "bun:test";
import {
  CrashTrace,
  defineCrashCase,
  runCrashProcess,
  type CrashChild,
  type CrashHooks,
  type CrashRun,
} from "./crash-harness";

function fakeChild(
  options: {
    marker?: string;
    stderrError?: Error;
    stdoutError?: Error;
    exitError?: Error;
    killError?: Error;
    stuckExit?: boolean;
  } = {},
) {
  const exit = Promise.withResolvers<number>();
  const killed = Promise.withResolvers<void>();
  const reading = Promise.withResolvers<void>();
  const stdout = new ReadableStream<Uint8Array<ArrayBuffer>>(
    {
      pull(controller) {
        reading.resolve();
        if (options.stdoutError) controller.error(options.stdoutError);
        else if (options.marker !== undefined) {
          controller.enqueue(new TextEncoder().encode(options.marker));
          controller.close();
        }
      },
    },
    { highWaterMark: 0 },
  );
  const stderr = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      if (options.stderrError) controller.error(options.stderrError);
      else controller.close();
    },
  });
  const kill = mock(() => {
    killed.resolve();
    if (options.exitError) exit.reject(options.exitError);
    else if (!options.stuckExit) exit.resolve(137);
    if (options.killError) throw options.killError;
  });
  const child: CrashChild = { stdout, stderr, kill, exited: exit.promise };
  return {
    child,
    stdout,
    kill,
    exit,
    killed: killed.promise,
    reading: reading.promise,
  };
}
function run(
  fake: ReturnType<typeof fakeChild>,
  trace = new CrashTrace("synthetic", undefined, () => {}),
  extra = {},
) {
  return runCrashProcess({
    command: ["synthetic"],
    cwd: "synthetic",
    phase: "after-commit",
    timeout: 15_000,
    marker: "after-commit",
    kill: true,
    trace,
    spawn: () => fake.child,
    ...extra,
  });
}

test("a real marker precedes forced death and every reader/timer is released", async () => {
  jest.useFakeTimers();
  const fake = fakeChild({ marker: "after-commit\n" });
  try {
    await run(fake);
    expect(fake.kill).toHaveBeenCalledWith("SIGKILL");
    expect(fake.stdout.locked).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});
test.each(["stderr", "stdout", "exit", "kill"] as const)(
  "rejected %s preserves error and unconditional cleanup",
  async (phase) => {
    jest.useFakeTimers();
    const failure = new Error(`synthetic ${phase} failure`);
    const fake = fakeChild({
      marker: "after-commit\n",
      [`${phase}Error`]: failure,
    });
    try {
      await expect(run(fake)).rejects.toBe(failure);
      expect(fake.kill).toHaveBeenCalledWith("SIGKILL");
      expect(fake.stdout.locked).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  },
);
test("a missing marker fails at the child budget, kills/reaps, and releases pending reads", async () => {
  jest.useFakeTimers();
  const fake = fakeChild();
  try {
    const result = run(fake);
    await fake.reading;
    jest.advanceTimersByTime(15_000);
    await expect(result).rejects.toThrow(
      "after-commit timed out after 15000ms",
    );
    expect(fake.kill).toHaveBeenCalledWith("SIGKILL");
    expect(fake.stdout.locked).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});
test("a child that will not exit cannot hold cleanup or its stdout reader forever", async () => {
  jest.useFakeTimers();
  const fake = fakeChild({ marker: "after-commit\n", stuckExit: true });
  try {
    const result = run(fake);
    await fake.killed;
    jest.advanceTimersByTime(5_000);
    await expect(result).rejects.toThrow(
      "after-commit cleanup timed out after 5000ms",
    );
    expect(fake.stdout.locked).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});
test("natural drain checks clean exit without killing an already complete process", async () => {
  const fake = fakeChild({ marker: "drained\n" });
  fake.exit.resolve(0);
  await run(fake, undefined, {
    marker: "drained",
    kill: false,
    checkExit: true,
  });
  expect(fake.kill).not.toHaveBeenCalled();
  expect(fake.stdout.locked).toBe(false);
});
test("failed kill remains the cause when reaping also reaches its cleanup bound", async () => {
  jest.useFakeTimers();
  const failure = new Error("synthetic kill failure");
  const fake = fakeChild({
    marker: "after-commit\n",
    stuckExit: true,
    killError: failure,
  });
  try {
    const result = run(fake).catch((error: unknown) => error);
    await fake.killed;
    jest.advanceTimersByTime(5_000);
    const error = (await result) as AggregateError;
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.cause).toBe(failure);
    expect(String(error.errors[1])).toContain("cleanup timed out after 5000ms");
    expect(fake.stdout.locked).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});
test("capture drains whole stdout and preserves stderr for recovery assertions", async () => {
  const fake = fakeChild({ marker: '{"state":"refused"}\n' });
  fake.exit.resolve(0);
  const result = await run(fake, undefined, { marker: undefined, kill: false });
  expect(result).toEqual({
    code: 0,
    output: '{"state":"refused"}\n',
    error: "",
  });
  expect(fake.stdout.locked).toBe(false);
});
test("captured recovery JSON preserves UTF-8 across process output chunks", async () => {
  const output = '{"answer":"Synthetic 🐏"}\n';
  const bytes = new TextEncoder().encode(output);
  const split = bytes.indexOf(0xf0) + 2;
  const stdout = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(bytes.subarray(0, split));
      controller.enqueue(bytes.subarray(split));
      controller.close();
    },
  });
  const fake = fakeChild({ marker: "" });
  fake.exit.resolve(0);
  const result = await run(
    { ...fake, stdout, child: { ...fake.child, stdout } },
    undefined,
    { marker: undefined, kill: false },
  );
  expect(result.output).toBe(output);
  expect(stdout.locked).toBe(false);
});
test("wrong marker and early EOF remain failures after bounded cleanup", async () => {
  const wrong = fakeChild({ marker: "wrong\n" });
  await expect(run(wrong)).rejects.toThrow();
  expect(wrong.stdout.locked).toBe(false);
  const early = fakeChild({ marker: "" });
  await expect(run(early)).rejects.toThrow("Fixture ended before after-commit");
  expect(early.stdout.locked).toBe(false);
});
test("an original marker failure stays the cause when stderr cleanup also fails", async () => {
  const failure = new Error("synthetic stderr failure");
  const fake = fakeChild({ marker: "wrong\n", stderrError: failure });
  let error: unknown;
  try {
    await run(fake);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(AggregateError);
  const combined = error as AggregateError;
  expect(combined.cause).toBe(combined.errors[0]);
  expect(combined.errors[1]).toBe(failure);
  expect(fake.stdout.locked).toBe(false);
});
test("compile failures include compile timing without replacing the stream error", async () => {
  const logs: string[] = [],
    failure = new Error("synthetic compile stderr failure");
  const trace = new CrashTrace("compile control", undefined, (line) =>
    logs.push(line),
  );
  const fake = fakeChild({ marker: "", stderrError: failure });
  fake.exit.resolve(1);
  await expect(
    trace.measure("compile", () =>
      run(fake, trace, { phase: "compile", marker: undefined, kill: false }),
    ),
  ).rejects.toBe(failure);
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain("compile failed; compile=");
  for (const phase of ["spawn", "marker", "kill", "reopen"])
    expect(logs[0]).toContain(`${phase}=`);
});

function registration(trace: CrashTrace) {
  const hooks: { body: () => Promise<void>; timeout: number }[] = [];
  let body!: () => Promise<void>,
    timeout = 0,
    finish!: () => void;
  const port: CrashHooks = {
    describe: (_name, operation) => operation(),
    beforeAll: (operation, budget) =>
      hooks.push({ body: operation, timeout: budget! }),
    afterAll: (operation) => {
      finish = operation;
    },
    test: (_name, operation, budget) => {
      body = operation;
      timeout = budget;
    },
  };
  const run: CrashRun = {
    trace,
    reopen: (operation) => trace.measure("reopen", operation),
    until: async () => {},
    capture: async () => ({ code: 0, output: "", error: "" }),
  };
  return {
    hooks,
    port,
    run,
    body: () => body(),
    timeout: () => timeout,
    finish: () => finish(),
  };
}
test.each([5_000, 30_000, 60_000])(
  "setup cannot consume the configured %d recovery budget",
  async (budget) => {
    let now = 0;
    const trace = new CrashTrace(
      "synthetic",
      () => now,
      () => {},
    );
    const registered = registration(trace);
    defineCrashCase(
      "case",
      registered.run,
      {
        prepare: () => {
          now += 4_999;
          return "prepared";
        },
        crash: async () => {
          now += 15_001;
        },
        recover: async (value) => {
          expect(value).toBe("prepared");
          now += budget - 1;
        },
        recoveryTimeout: budget,
      },
      15_000,
      registered.port,
    );
    expect(registered.hooks.map((hook) => hook.timeout)).toEqual([
      5_000, 20_000,
    ]);
    for (const hook of registered.hooks) {
      const start = now;
      await hook.body();
      expect(now - start).toBeLessThan(hook.timeout);
    }
    const start = now;
    await registered.body();
    expect(now - start).toBe(budget - 1);
    expect(registered.timeout()).toBe(budget);
    registered.finish();
  },
);
test("two-child setup and answer process budgets retain their separate bounds", () => {
  const trace = new CrashTrace("synthetic", undefined, () => {});
  for (const [children, childBudget, setupBudget] of [
    [2, 15_000, 40_000],
    [1, 30_000, 35_000],
  ]) {
    const registered = registration(trace);
    defineCrashCase(
      "case",
      registered.run,
      {
        prepare: () => {},
        crash: async () => {},
        recover: async () => {},
        children,
      },
      childBudget!,
      registered.port,
    );
    expect(registered.hooks[1]!.timeout).toBe(setupBudget!);
  }
});
test("recovery failure keeps its identity and emits every phase timing only once", async () => {
  let now = 0;
  const logs: string[] = [],
    compilation = new CrashTrace(
      "compile",
      () => now,
      (line) => logs.push(line),
    );
  await compilation.measure("compile", () => {
    now += 7;
  });
  const trace = new CrashTrace(
    "synthetic",
    () => now,
    (line) => logs.push(line),
    compilation,
  );
  const registered = registration(trace),
    failure = new Error("synthetic recovery assertion");
  defineCrashCase(
    "case",
    registered.run,
    {
      prepare: () => {},
      crash: async () => {
        for (const phase of ["spawn", "marker", "kill"] as const)
          await trace.measure(phase, () => {
            now += 2;
          });
      },
      recover: async (_value, run) =>
        run.reopen(() => {
          now += 3;
          throw failure;
        }),
    },
    15_000,
    registered.port,
  );
  for (const hook of registered.hooks) await hook.body();
  await expect(registered.body()).rejects.toBe(failure);
  registered.finish();
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain(
    "compile=7.0ms spawn=2.0ms marker=2.0ms kill=2.0ms reopen=3.0ms",
  );
});
test("native callback timeout reports an in-progress reopen at finalization", async () => {
  const logs: string[] = [];
  const trace = new CrashTrace(
    "synthetic",
    () => 1,
    (line) => logs.push(line),
  );
  const registered = registration(trace),
    pending = Promise.withResolvers<void>();
  defineCrashCase(
    "case",
    registered.run,
    {
      prepare: () => {},
      crash: async () => {},
      recover: (_value, run) => run.reopen(() => pending.promise),
    },
    15_000,
    registered.port,
  );
  for (const hook of registered.hooks) await hook.body();
  const operation = registered.body();
  registered.finish();
  expect(logs[0]).toContain("recovery did not complete");
  expect(logs[0]).toContain("reopen=0.0ms(pending)");
  pending.resolve();
  await operation;
});
