import assert from "node:assert/strict";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { checkerHome, checkerJar } from "./verification-setup";
import {
  runVerificationProcess,
  VerificationProcessError,
} from "./verification-process";

/** The kernel's ephemeral port range, from which port-0 binds are drawn. */
export function ephemeralPortRange(
  read: () => string = () =>
    readFileSync("/proc/sys/net/ipv4/ip_local_port_range", "utf8"),
): [number, number] {
  try {
    const [low, high] = read().trim().split(/\s+/).map(Number);
    if (Number.isInteger(low) && Number.isInteger(high)) return [low!, high!];
  } catch {}
  // macOS and Windows default to the IANA dynamic range.
  return [49152, 65535];
}

const canBind = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = createServer();
    socket.once("error", () => resolve(false));
    // The address Apalache binds, so a free probe means it can bind too.
    socket.listen(port, "0.0.0.0", () => socket.close(() => resolve(true)));
  });

/**
 * A free port for the checker, chosen below the ephemeral range. Apalache
 * takes a port number, not a socket, so it binds about a second after we
 * choose; a port taken from the ephemeral range could meanwhile go to any
 * process binding port 0 (a browser, a test server, another worker). Below
 * that range only a process asking for that exact number can collide, and
 * each worker starts its search at its own offset.
 */
export async function privateCheckerPort(
  options: {
    range?: [number, number];
    free?: (port: number) => Promise<boolean>;
    start?: number;
  } = {},
) {
  const [ephemeralLow] = options.range ?? ephemeralPortRange();
  const low = 10_000;
  const span = Math.max(1, ephemeralLow - low);
  const free = options.free ?? canBind;
  const start = options.start ?? (process.pid * 7919) % span;
  for (let step = 0; step < Math.min(span, 1000); step++) {
    const port = low + ((start + step) % span);
    if (await free(port)) return port;
  }
  throw new Error("No free private checker port below the ephemeral range");
}

type CheckerOptions = {
  launch?: (port: number, temporary: string) => string[];
  readiness?: (port: number, pid: number, signal: AbortSignal) => Promise<void>;
  /** The first candidate port; defaults to privateCheckerPort(). */
  port?: () => Promise<number>;
};

/** The checker could not bind its port: another process took it first. */
export class CheckerPortTaken extends Error {
  constructor(readonly port: number) {
    super(`Owned checker could not bind port ${port}: it is in use`);
  }
}

const CHECKER_PORT_ATTEMPTS = 3;

function untilAborted<T>(operation: Promise<T>, signal: AbortSignal) {
  return Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    }),
  ]);
}

/**
 * Start a verified, owned server before giving Quint its endpoint. When the
 * checker reports that its port was taken, start it again on the next free
 * port and say so; any other failure is final.
 */
export async function withPrivateChecker<T>(
  temporary: string,
  signal: AbortSignal,
  execute: (port: number, signal: AbortSignal) => Promise<T>,
  diagnostic?: (text: string) => void,
  options: CheckerOptions = {},
) {
  let port = await (options.port ?? privateCheckerPort)();
  for (let attempt = 1; ; attempt++) {
    try {
      return await runPrivateChecker(
        port,
        temporary,
        signal,
        execute,
        diagnostic,
        options,
      );
    } catch (error) {
      if (!(error instanceof CheckerPortTaken)) throw error;
      if (attempt >= CHECKER_PORT_ATTEMPTS) throw error;
      const next = await privateCheckerPort({ start: port - 10_000 + 1 });
      const notice = `[checker] port ${port} was taken before the checker bound it; starting it on port ${next}`;
      console.warn(notice);
      diagnostic?.(`${notice}\n`);
      port = next;
    }
  }
}

async function runPrivateChecker<T>(
  port: number,
  temporary: string,
  signal: AbortSignal,
  execute: (port: number, signal: AbortSignal) => Promise<T>,
  diagnostic: ((text: string) => void) | undefined,
  options: CheckerOptions,
) {
  const control = new AbortController();
  const combined = AbortSignal.any([control.signal, signal]);
  let retiring = false;
  let failure: unknown;
  let startup = "";
  let readyResolve!: () => void;
  let readyReject!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const daemonTemp = resolve(temporary, "daemon");
  await mkdir(daemonTemp, { recursive: true });
  let daemonPid = 0;
  const daemon = runVerificationProcess(
    options.launch?.(port, daemonTemp) ?? [
      "java",
      "-Xmx1G",
      "-Xss16M",
      `-Djava.io.tmpdir=${daemonTemp}`,
      "-jar",
      checkerJar,
      "server",
      `--port=${port}`,
    ],
    {
      onStart: (pid) => {
        daemonPid = pid;
        // Readiness is the probe's actual connection to this daemon, not the
        // checker's "running" line, which it prints before binding.
        readyResolve();
      },
      cwd: temporary,
      timeoutMs: 240_000,
      signal: combined,
      env: {
        ...process.env,
        QUINT_HOME: checkerHome,
        APALACHE_JAR: checkerJar,
        JVM_ARGS: "-Xmx1G -Xss16M",
        JVM_GC_ARGS: "",
        TMPDIR: daemonTemp,
        TMP: daemonTemp,
        TEMP: daemonTemp,
      },
      onOutput: (text) => {
        diagnostic?.(text);
        startup = (startup + text).slice(-65536);
        if (
          failure === undefined &&
          /Failed to bind|already in use/.test(startup)
        ) {
          failure = new CheckerPortTaken(port);
          readyReject(failure);
          control.abort();
        }
      },
    },
  )
    .then(() => {
      if (!retiring) {
        failure ??= new Error("Owned checker server exited unexpectedly");
        readyReject(failure);
        control.abort();
      }
    })
    .catch((error) => {
      if (
        retiring &&
        error instanceof VerificationProcessError &&
        error.reason === "aborted"
      )
        return;
      failure ??= error;
      readyReject(failure);
      control.abort();
    });
  let result!: T;
  let operationFailure: unknown;
  try {
    await ready;
    assert(daemonPid > 0);
    // A daemon that fails while readiness is pending ends the wait at once.
    if (options.readiness)
      await untilAborted(
        options.readiness(port, daemonPid, combined),
        combined,
      );
    else {
      const probe = await runVerificationProcess(
        [
          "node",
          "--max-old-space-size=512",
          resolve(import.meta.dir, "verification-checker-ready.mjs"),
          String(port),
          String(daemonPid),
        ],
        {
          cwd: temporary,
          timeoutMs: 35_000,
          signal: combined,
          onOutput: diagnostic,
        },
      );
      assert.equal(
        probe.code,
        0,
        "Owned checker protocol readiness failed; see checker diagnostics",
      );
    }
    combined.throwIfAborted();
    result = await execute(port, combined);
  } catch (error) {
    operationFailure = error;
  } finally {
    retiring = true;
    control.abort();
    await daemon;
  }
  if (failure !== undefined) throw failure;
  if (operationFailure !== undefined) throw operationFailure;
  signal.throwIfAborted();
  return result;
}
