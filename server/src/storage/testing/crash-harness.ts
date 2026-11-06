import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnCrashChild } from "./crash-child";

type Phase = "compile" | "spawn" | "marker" | "kill" | "reopen";
export type CrashChild = Pick<
  Bun.Subprocess<"ignore", "pipe", "pipe">,
  "stdout" | "stderr" | "kill" | "exited"
>;
const cleanupTimeout = 5_000;

export class CrashTrace {
  readonly events: { phase: Phase; start: number; end?: number }[] = [];
  private reported = false;
  constructor(
    readonly label: string,
    private readonly now = () => performance.now(),
    private readonly log = (line: string) => console.error(line),
    private readonly compilation?: CrashTrace,
  ) {}
  async measure<T>(phase: Phase, operation: () => T | Promise<T>): Promise<T> {
    const event = {
      phase,
      start: this.now(),
      end: undefined as number | undefined,
    };
    this.events.push(event);
    try {
      return await operation();
    } finally {
      event.end = this.now();
    }
  }
  report(reason: string) {
    if (this.reported) return;
    this.reported = true;
    const events = [...(this.compilation?.events ?? []), ...this.events];
    const timings = (["compile", "spawn", "marker", "kill", "reopen"] as const)
      .map((phase) => {
        const spans = events.filter((event) => event.phase === phase);
        return `${phase}=${spans.length ? spans.map((event) => `${((event.end ?? this.now()) - event.start).toFixed(1)}ms${event.end === undefined ? "(pending)" : ""}`).join(",") : "not-reached"}`;
      })
      .join(" ");
    this.log(`[crash-fixture] ${this.label}: ${reason}; ${timings}`);
  }
}

async function bounded<T>(
  operation: Promise<T>,
  milliseconds: number,
  label: string,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${milliseconds}ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Own only the supplied child; every exit path attempts kill/reap and releases IO. */
export async function runCrashProcess(options: {
  command: string[];
  cwd: string;
  trace: CrashTrace;
  phase: string;
  timeout: number;
  marker?: string;
  kill?: boolean;
  checkExit?: boolean;
  spawn?: () => CrashChild;
}) {
  const { trace, phase } = options;
  const child = await trace.measure(
    "spawn",
    () => options.spawn?.() ?? spawnCrashChild(options.command, options.cwd),
  );
  const reader = child.stdout.getReader();
  // Observe rejection immediately, even while stdout or process exit is pending.
  const errors = new Response(child.stderr).text().then(
    (text) => ({ text, error: undefined as unknown }),
    (error: unknown) => ({ text: "", error }),
  );
  let output = "",
    code: number | undefined;
  const decoder = new TextDecoder();
  let failed = false,
    failure: unknown;
  let timedOut = false;
  const deadline = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    timedOut = true;
    deadline.reject(
      new Error(`Crash fixture ${phase} timed out after ${options.timeout}ms`),
    );
  }, options.timeout);
  try {
    await Promise.race([
      (async () => {
        const read = async () => {
          while (options.marker === undefined || !output.includes("\n")) {
            const part = await reader.read();
            if (part.done) {
              output += decoder.decode();
              if (options.marker !== undefined) {
                const stderr = await errors;
                if (stderr.error !== undefined) throw stderr.error;
                throw new Error(
                  `Fixture ended before ${phase}: ${stderr.text}`,
                );
              }
              break;
            }
            output += decoder.decode(part.value, { stream: true });
          }
        };
        if (options.marker === undefined) await read();
        else {
          await trace.measure("marker", read);
          expect(output.trim()).toBe(options.marker);
        }
        if (!options.kill)
          code = await trace.measure("kill", () => child.exited);
      })(),
      deadline.promise,
    ]);
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    let killError: unknown;
    try {
      await trace.measure("kill", () =>
        bounded(
          (async () => {
            try {
              if (options.kill || failed || timedOut) child.kill("SIGKILL");
            } catch (error) {
              killError = error;
            }
            code = await child.exited;
            const stderr = await errors;
            if (killError !== undefined) throw killError;
            if (stderr.error !== undefined) throw stderr.error;
          })(),
          cleanupTimeout,
          `Crash fixture ${phase} cleanup`,
        ),
      );
    } catch (error) {
      const cleanupError =
        killError !== undefined && error !== killError
          ? new AggregateError(
              [killError, error],
              `Crash fixture ${phase} kill and cleanup failed`,
              { cause: killError },
            )
          : error;
      failure =
        failed && cleanupError !== failure
          ? new AggregateError(
              [failure, cleanupError],
              `Crash fixture ${phase} and cleanup failed`,
              { cause: failure },
            )
          : cleanupError;
      failed = true;
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
    }
  }
  if (failed) {
    trace.report(`${phase} failed`);
    throw failure;
  }
  if (options.checkExit) expect(code).toBe(0);
  return { code, output, error: (await errors).text };
}

export type CrashRun = {
  trace: CrashTrace;
  until(
    command: string[],
    directory: string,
    phase: string,
    options?: {
      marker?: string;
      kill?: boolean;
      checkExit?: boolean;
    },
  ): Promise<void>;
  reopen<T>(operation: () => T | Promise<T>): Promise<T>;
  capture(
    command: string[],
    timeout: number,
  ): ReturnType<typeof runCrashProcess>;
};
type CrashCase<T> = {
  prepare: (run: CrashRun) => T | Promise<T>;
  crash: (value: T, run: CrashRun) => Promise<void>;
  recover: (value: T, run: CrashRun) => Promise<void>;
  recoveryTimeout?: number;
  children?: number;
};
export type CrashHooks = {
  describe(name: string, body: () => void): unknown;
  beforeAll(body: () => Promise<void>, timeout?: number): unknown;
  afterAll(body: () => void): unknown;
  test(name: string, body: () => Promise<void>, timeout: number): unknown;
};

export function defineCrashCase<T>(
  name: string,
  run: CrashRun,
  options: CrashCase<T>,
  childTimeout: number,
  hooks: CrashHooks = { describe, beforeAll, afterAll, test },
) {
  hooks.describe(name, () => {
    let value: T;
    let active: string | undefined;
    const guarded = async (phase: string, operation: () => Promise<void>) => {
      active = phase;
      try {
        await operation();
      } catch (error) {
        run.trace.report(`${phase} failed`);
        throw error;
      } finally {
        active = undefined;
      }
    };
    hooks.beforeAll(
      () =>
        guarded("prepare", async () => {
          value = await options.prepare(run);
        }),
      5_000,
    );
    hooks.beforeAll(
      () => guarded("crash setup", () => options.crash(value, run)),
      (options.children ?? 1) * (childTimeout + cleanupTimeout),
    );
    hooks.test(
      "recovery",
      () => guarded("recovery", () => options.recover(value, run)),
      options.recoveryTimeout ?? 5_000,
    );
    // Bun's native test/hook timeout does not reject the callback's own promise.
    hooks.afterAll(() => {
      if (active) run.trace.report(`${active} did not complete`);
    });
  });
}

export function createCrashFixture(options: {
  name: string;
  source: string;
  entry: string;
  worker: string;
  compileTimeout?: number;
  childTimeout?: number;
}) {
  const root = mkdtempSync(join(tmpdir(), `${options.name}-crash-`));
  const cwd = join(root, "standalone");
  const executable = (name: string) =>
    process.platform === "win32" ? `${name}.exe` : name;
  const binary = join(cwd, executable(options.name));
  const compilation = new CrashTrace(options.name);
  const children = new Set<CrashChild>();
  const spawn = (command: string[]): CrashChild => {
    const child = spawnCrashChild(command, cwd);
    children.add(child);
    void child.exited.then(
      () => children.delete(child),
      () => {},
    );
    return child;
  };
  mkdirSync(cwd);
  const compileTimeout = options.compileTimeout ?? 60_000;
  beforeAll(async () => {
    try {
      await compilation.measure("compile", async () => {
        const build = join(root, executable("build"));
        const result = await runCrashProcess({
          command: [],
          cwd,
          trace: compilation,
          phase: "compile",
          timeout: compileTimeout,
          spawn: () =>
            spawn([
              process.execPath,
              "build",
              "--compile",
              "--minify",
              "--sourcemap",
              "--no-compile-autoload-dotenv",
              "--no-compile-autoload-bunfig",
              options.entry,
              options.worker,
              "--outfile",
              build,
            ]),
        });
        if (result.code !== 0)
          throw new Error(
            `Compiled ${options.name} fixture failed: ${result.error}`,
          );
        copyFileSync(build, binary);
      });
    } catch (error) {
      compilation.report("compile failed");
      throw error;
    }
  }, compileTimeout + cleanupTimeout);
  afterAll(async () => {
    if (compilation.events.some((event) => event.end === undefined))
      compilation.report("compile did not complete");
    try {
      await Promise.all(
        [...children].map((child) =>
          bounded(
            (async () => {
              try {
                child.kill("SIGKILL");
              } finally {
                await child.exited;
              }
            })(),
            cleanupTimeout,
            "Crash fixture final cleanup",
          ),
        ),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  return {
    root,
    cwd,
    command: (compiled: boolean) =>
      compiled ? [binary] : [process.execPath, resolve(options.source)],
    test<T>(name: string, testCase: CrashCase<T>) {
      const trace = new CrashTrace(name, undefined, undefined, compilation);
      const childTimeout = options.childTimeout ?? 15_000;
      const run: CrashRun = {
        trace,
        reopen: (operation) => trace.measure("reopen", operation),
        until: async (command, directory, phase, settings = {}) => {
          await runCrashProcess({
            command: [],
            cwd,
            phase,
            trace,
            timeout: childTimeout,
            marker: settings.marker ?? phase,
            kill: settings.kill ?? true,
            checkExit: settings.checkExit,
            spawn: () => spawn([...command, directory, phase]),
          });
        },
        capture: (command, timeout) =>
          trace.measure("reopen", () =>
            runCrashProcess({
              command: [],
              cwd,
              phase: "recovery process",
              trace,
              timeout,
              spawn: () => spawn(command),
            }),
          ),
      };
      defineCrashCase(name, run, testCase, childTimeout);
    },
  };
}
