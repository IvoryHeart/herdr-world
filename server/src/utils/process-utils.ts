import { trackSshProcess } from "../bridge/ssh-metrics";
import { runSshCommand } from "../bridge/ssh-sessions";
export class ProcessExitError extends Error {
  declare readonly exitCode: number;
  declare readonly stdout: string;
  declare readonly stderr: string;

  constructor(
    command: string,
    exitCode: number,
    stdout: string,
    stderr: string,
  ) {
    super(`${command} exited ${exitCode}: ${stderr.trim() || stdout.trim()}`);
    this.name = "ProcessExitError";
    // Retain structured exit facts without adding captured output to JSON logs.
    Object.defineProperties(this, {
      exitCode: { value: exitCode },
      stdout: { value: stdout },
      stderr: { value: stderr },
    });
  }
}

export async function runProcess(
  argv: string[],
  input?: string,
  options: { timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  const { code, stdout, stderr } =
    options.timeoutMs !== undefined && input === undefined
      ? await runProcessWithCodeTimeout(argv, options.timeoutMs)
      : await runProcessWithCode(argv, input);
  if (code !== 0) {
    throw new ProcessExitError(argv[0]!, code, stdout, stderr);
  }
  return { stdout, stderr };
}

export async function runProcessWithCode(
  argv: string[],
  input?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return runSshCommand(argv, (argv, _remainingMs, signal) =>
    spawnWithCode(argv, input, signal),
  );
}

async function spawnWithCode(
  argv: string[],
  input?: string,
  signal?: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string }> {
  signal?.throwIfAborted();
  const proc = Bun.spawn(argv, {
    signal,
    killSignal: "SIGKILL",
    stdin: input === undefined ? "ignore" : Buffer.from(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderrText = new Response(proc.stderr).text();
  trackSshProcess(argv, proc.exited, stderrText);
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    stderrText,
  ]);
  return { code, stdout, stderr };
}

export async function runProcessWithCodeTimeout(
  argv: string[],
  timeoutMs: number,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return runSshCommand(
    argv,
    (argv, remainingMs, signal) =>
      spawnWithCodeTimeout(argv, remainingMs ?? timeoutMs, options, signal),
    { timeoutMs },
  );
}

async function spawnWithCodeTimeout(
  argv: string[],
  timeoutMs: number,
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
  signal?: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string }> {
  signal?.throwIfAborted();
  const proc = Bun.spawn(argv, {
    signal,
    killSignal: "SIGKILL",
    ...options,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderrText = new Response(proc.stderr).text();
  trackSshProcess(argv, proc.exited, stderrText);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const output = Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    stderrText,
  ]).then(([code, stdout, stderr]) => {
    if (timer) clearTimeout(timer);
    return { code, stdout, stderr };
  });
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {}
      reject(new Error(`${argv[0]} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([output, timeout]);
}

export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
