import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { checkerHome, checkerJar } from "./verification-setup";
import {
  runVerificationProcess,
  VerificationProcessError,
} from "./verification-process";

/** Start a verified, owned server before giving Quint its endpoint. */
export async function withPrivateChecker<T>(
  temporary: string,
  signal: AbortSignal,
  execute: (port: number, signal: AbortSignal) => Promise<T>,
  diagnostic?: (text: string) => void,
  options: {
    launch?: (port: number, temporary: string) => string[];
    readiness?: (
      port: number,
      pid: number,
      signal: AbortSignal,
    ) => Promise<void>;
  } = {},
) {
  const port = await new Promise<number>((resolve, reject) => {
    const socket = createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      if (!address || typeof address === "string")
        throw new Error("Missing private checker endpoint");
      socket.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
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
        if (startup.includes(`The Apalache server is running on port ${port}.`))
          readyResolve();
      },
    },
  )
    .then(() => {
      if (!retiring) {
        failure = new Error("Owned checker server exited unexpectedly");
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
      failure = error;
      readyReject(error);
      control.abort();
    });
  let result!: T;
  let operationFailure: unknown;
  try {
    await ready;
    assert(daemonPid > 0);
    if (options.readiness) await options.readiness(port, daemonPid, combined);
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
