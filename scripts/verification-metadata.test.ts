import { expect, test } from "bun:test";
import { runVerificationMetadata } from "./verification-process";

const unixTest = process.platform === "win32" ? test.skip : test;

/** A deadline clock the test advances; nothing waits in real time. */
function manualTimers() {
  let now = 0;
  const due: Array<{ at: number; run: () => void }> = [];
  return {
    timers: {
      setTimeout(run: () => void, ms: number) {
        const timer = { at: now + ms, run };
        due.push(timer);
        return timer;
      },
      clearTimeout(timer: unknown) {
        const index = due.indexOf(timer as (typeof due)[number]);
        if (index >= 0) due.splice(index, 1);
      },
    },
    advance(ms: number) {
      now += ms;
      for (const timer of due.filter((timer) => timer.at <= now)) {
        due.splice(due.indexOf(timer), 1);
        timer.run();
      }
    },
  };
}

/** A metadata command that answers only when the test signals it. */
function heldMetadata(clock: ReturnType<typeof manualTimers>) {
  let pid = 0;
  let ready!: () => void;
  const started = new Promise<void>((resolve) => (ready = resolve));
  const result = runVerificationMetadata(
    [
      process.execPath,
      "-e",
      'const hold = setInterval(() => {}, 1 << 30); process.on("SIGUSR2", () => { clearInterval(hold); console.log("synthetic-node-version"); console.error("synthetic-java-version"); }); console.error("ready");',
    ],
    {
      timers: clock.timers,
      onStart: (child) => (pid = child),
      onOutput: (text) => text.includes("ready") && ready(),
    },
  );
  return { result, started, answer: () => process.kill(pid, "SIGUSR2") };
}

unixTest(
  "cold metadata startup can exceed five seconds and retain its identity",
  async () => {
    const clock = manualTimers();
    const command = heldMetadata(clock);
    await command.started;
    clock.advance(5_500);
    command.answer();
    const result = await command.result;
    expect(result.stdout.trim()).toBe("synthetic-node-version");
    expect(result.stderr.trim()).toBe("ready\nsynthetic-java-version");
  },
);

unixTest(
  "metadata startup still stops at its thirty-second deadline",
  async () => {
    const clock = manualTimers();
    const command = heldMetadata(clock);
    await command.started;
    clock.advance(29_999);
    const outcome = command.result.then(
      () => "answered",
      (error: Error) => error.message,
    );
    clock.advance(1);
    expect(await outcome).toContain("Verification command timed out");
  },
);
