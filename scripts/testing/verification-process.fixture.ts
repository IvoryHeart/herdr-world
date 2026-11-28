import type { VerificationProcessPorts } from "../verification-process";
import { ManualClock } from "./manual-clock";

/** A resistant process group keeps its pipes open after its parent exits. */
export function checkerProcess() {
  const clock = new ManualClock();
  const exit = Promise.withResolvers<number>();
  const terminated = Promise.withResolvers<void>();
  const signals: (NodeJS.Signals | 0)[] = [];
  let stdout!: ReadableStreamDefaultController<Uint8Array>;
  let stderr!: ReadableStreamDefaultController<Uint8Array>;
  let alive = true;
  const child = {
    pid: 42,
    exited: exit.promise,
    stdout: new ReadableStream<Uint8Array>({
      start: (controller) => {
        stdout = controller;
      },
    }),
    stderr: new ReadableStream<Uint8Array>({
      start: (controller) => {
        stderr = controller;
      },
    }),
    resourceUsage: () => ({ maxRSS: 1024 }),
  };
  const ports: VerificationProcessPorts = {
    clock,
    scheduler: clock,
    spawn: () => child,
    signalGroup(pid, signal) {
      if (pid !== child.pid) throw new Error("wrong process group");
      signals.push(signal);
      if (!alive) return false;
      if (signal === "SIGTERM") terminated.resolve();
      if (signal === "SIGKILL") {
        alive = false;
        stdout.close();
        stderr.close();
        exit.resolve(137);
      }
      return true;
    },
  };
  return {
    clock,
    ports,
    signals,
    terminated: terminated.promise,
    output: (text: string) => stdout.enqueue(new TextEncoder().encode(text)),
    error: (text: string) => stderr.enqueue(new TextEncoder().encode(text)),
    exit: (code: number) => exit.resolve(code),
    finish(code: number) {
      alive = false;
      stdout.close();
      stderr.close();
      exit.resolve(code);
    },
    alive: () => alive,
  };
}
