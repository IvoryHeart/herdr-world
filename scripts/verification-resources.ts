import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, watch } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { runVerificationProcess } from "./verification-process";
import limits from "../tools/quint/resources.json";
import { sanitizeDiagnostic } from "./verification-diagnostics";

export async function verifyResourceCancellation(
  root: string,
  system: boolean,
) {
  const directory = resolve(
    root,
    ".agents/verification/resources",
    `cancellation-${randomUUID()}`,
  );
  await mkdir(directory, { recursive: true });
  const ready = resolve(directory, "ready.json");
  const cancellation = new AbortController();
  const observer = new AbortController();
  const timer = setTimeout(
    () => observer.abort(new Error("Cancellation control did not start")),
    10000,
  );
  const events = watch(directory, { signal: observer.signal });
  const started = (async () => {
    for await (const event of events) {
      if (event.filename !== "ready.json") continue;
      const ids = JSON.parse(await readFile(ready, "utf8")) as number[];
      cancellation.abort(new Error("Synthetic constrained cancellation"));
      return ids;
    }
    throw new Error("Missing cancellation control readiness");
  })().then(
    (ids) => ({ ids }),
    (error) => ({ error }),
  );
  try {
    await assert.rejects(
      runConstrainedVerification(
        root,
        system,
        [
          process.execPath,
          "-e",
          'const child=Bun.spawn([process.execPath,"-e","setInterval(()=>{},1000)"],{stdin:"ignore",stdout:"ignore",stderr:"ignore"}); await Bun.write(process.argv[1]+".tmp",JSON.stringify([process.pid,child.pid])); const {rename}=await import("node:fs/promises"); await rename(process.argv[1]+".tmp",process.argv[1]); setInterval(()=>{},1000);',
          ready,
        ],
        {
          memoryMaxBytes: 128 * 1024 * 1024,
          cpuQuotaPercent: 200,
          timeoutMs: 15000,
        },
        cancellation.signal,
      ),
      (error: unknown) => error === cancellation.signal.reason,
    );
    const outcome = await started;
    if ("error" in outcome) throw outcome.error;
    assert(
      cancellation.signal.aborted,
      "Cancellation produced successful evidence",
    );
    for (const pid of outcome.ids) {
      assert(Number.isSafeInteger(pid) && pid > 0);
      assert.throws(
        () => process.kill(pid, 0),
        { code: "ESRCH" },
        "Constrained cancellation retained a descendant",
      );
    }
  } finally {
    clearTimeout(timer);
    observer.abort();
    cancellation.abort();
    await started;
  }
}

export function parseCgroupResources(
  peak: string,
  events: string,
  maximum: string,
) {
  const peakBytes = Number(peak.trim());
  const memoryMaxBytes = Number(maximum.trim());
  assert(
    Number.isSafeInteger(peakBytes) && peakBytes > 0,
    "Missing cgroup peak memory",
  );
  assert(
    Number.isSafeInteger(memoryMaxBytes) && memoryMaxBytes > 0,
    "Missing hard memory limit",
  );
  const fields = Object.fromEntries(
    events
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/)),
  );
  const oomKills = Number(fields.oom_kill);
  assert(
    Number.isSafeInteger(oomKills) && oomKills >= 0,
    "Missing OOM accounting",
  );
  return { peakBytes, memoryMaxBytes, oomKills };
}

export async function runConstrainedVerification(
  root: string,
  system: boolean,
  command: string[],
  options: {
    memoryMaxBytes: number;
    cpuQuotaPercent: number;
    timeoutMs: number;
  },
  signal: AbortSignal,
  onBoundary?: (
    phase: "exited" | "cleanup",
    context: { directory: string },
  ) => void | Promise<void>,
) {
  assert(
    process.platform === "linux",
    "Constrained verification requires Linux cgroup v2 and systemd",
  );
  assert(
    Number.isSafeInteger(options.memoryMaxBytes) && options.memoryMaxBytes > 0,
  );
  assert(
    Number.isSafeInteger(options.cpuQuotaPercent) &&
      options.cpuQuotaPercent > 0,
  );
  const unit = `herdr-verification-${randomUUID()}.service`;
  const prefix = system ? ["sudo", "-n"] : [];
  const manager = system ? [] : ["--user"];
  const control = async (...args: string[]) => {
    const result = await runVerificationProcess(
      [...prefix, "systemctl", ...manager, ...args, unit],
      {
        cwd: root,
        timeoutMs: 15000,
      },
    );
    assert(
      result.code === 0 ||
        (args.includes("--property=ActiveState") &&
          result.code === 5 &&
          result.stdout.trim() === "inactive"),
      `systemctl ${args[0]} failed: ${result.stderr}`,
    );
    return result.stdout.trim();
  };
  const directory = resolve(
    root,
    ".agents/verification/resources",
    unit.replace(".service", ""),
  );
  await mkdir(directory, { recursive: true });
  const exitFile = resolve(directory, "exit-code.txt");
  let code: number | undefined;
  let failure: unknown;
  let tail = "";
  let evidence: ReturnType<typeof parseCgroupResources> | undefined;
  const watching = new AbortController();
  const timer = setTimeout(
    () => watching.abort(new Error("Constrained verification timed out")),
    options.timeoutMs,
  );
  const stopWatching = AbortSignal.any([signal, watching.signal]);
  const events = watch(directory, { signal: stopWatching });
  const completed = (async () => {
    for await (const event of events) {
      if (event.filename === "exit-code.txt")
        return Number((await readFile(exitFile, "utf8")).trim());
    }
    throw new Error("Resource supervisor did not publish an exit code");
  })().then(
    (value) => ({ value }),
    // Report why the watch stopped (the deadline or cancellation), not the
    // watcher's generic AbortError.
    (error) => ({ error: stopWatching.aborted ? stopWatching.reason : error }),
  );
  try {
    try {
      const result = await runVerificationProcess(
        [
          ...prefix,
          "systemd-run",
          ...manager,
          `--unit=${unit}`,
          `--working-directory=${root}`,
          `--setenv=PATH=${process.env.PATH ?? ""}`,
          `--setenv=RESOURCE_EXIT_FILE=${exitFile}`,
          ...(system
            ? [`--uid=${process.getuid!()}`, `--gid=${process.getgid!()}`]
            : []),
          "--property=MemoryAccounting=yes",
          `--property=MemoryMax=${options.memoryMaxBytes}`,
          `--property=StandardOutput=append:${resolve(directory, "worker.log")}`,
          `--property=StandardError=append:${resolve(directory, "worker.log")}`,
          "--property=MemorySwapMax=0",
          `--property=CPUQuota=${options.cpuQuotaPercent}%`,
          "--property=KillMode=control-group",
          "--property=TimeoutStopSec=10s",
          "--property=OOMPolicy=continue",
          // Only bounds a unit whose client died. It must outlive the client's
          // own deadline: a unit stopped at that same moment loses its control
          // group, and the timed-out run could then be neither measured nor
          // reported as a timeout.
          `--property=RuntimeMaxSec=${Math.ceil(options.timeoutMs / 1000) + 60}`,
          "--",
          "/bin/sh",
          "-c",
          '"$@"; result=$?; printf "%s\\n" "$result" > "$RESOURCE_EXIT_FILE.tmp"; mv "$RESOURCE_EXIT_FILE.tmp" "$RESOURCE_EXIT_FILE"; exec sleep infinity',
          "resource-supervisor",
          ...command,
        ],
        {
          cwd: root,
          signal,
          timeoutMs: 15000,
          graceMs: 10000,
        },
      );
      assert.equal(result.code, 0, "Resource supervisor failed");
      const outcome = await completed;
      if ("error" in outcome) throw outcome.error;
      code = outcome.value;
      assert(
        Number.isSafeInteger(code) && code >= 0 && code <= 255,
        "Missing child exit code",
      );
      await onBoundary?.("exited", { directory });
      tail = (await readFile(resolve(directory, "worker.log"), "utf8")).slice(
        -65536,
      );
    } catch (error) {
      failure = error;
    }
    // Read the service's own subtree, not the runner's lifetime-wide memory peak.
    const group = await control("show", "--property=ControlGroup", "--value");
    if (
      !/^\/[a-zA-Z0-9_.@/-]+$/.test(group) ||
      group.split("/").includes("..")
    ) {
      // Name the unit's end state and keep the earlier failure visible rather
      // than replacing it.
      const state = await control(
        "show",
        "--property=ActiveState,SubState,Result,ExecMainCode,ExecMainStatus",
      );
      const output = await readFile(resolve(directory, "worker.log"), "utf8")
        .then((log) => sanitizeDiagnostic(log.slice(-2000), root))
        .catch(() => "");
      throw new Error(
        `Invalid control group (${state.split("\n").join(", ")})${
          failure instanceof Error ? ` after: ${failure.message}` : ""
        }${output ? `\nUnit output:\n${output}` : ""}`,
      );
    }
    const base = resolve("/sys/fs/cgroup", `.${group}`);
    const [peak, events, maximum, swap, cpu] = await Promise.all([
      readFile(resolve(base, "memory.peak"), "utf8"),
      readFile(resolve(base, "memory.events"), "utf8"),
      readFile(resolve(base, "memory.max"), "utf8"),
      readFile(resolve(base, "memory.swap.max"), "utf8"),
      readFile(resolve(base, "cpu.max"), "utf8"),
    ]);
    evidence = parseCgroupResources(peak, events, maximum);
    assert.equal(
      evidence.memoryMaxBytes,
      options.memoryMaxBytes,
      "Requested memory limit not enforced",
    );
    assert.equal(swap.trim(), "0", "Swap limit not enforced");
    const [quota, period] = cpu.trim().split(/\s+/).map(Number);
    assert.equal(
      (quota! / period!) * 100,
      options.cpuQuotaPercent,
      "CPU quota not enforced",
    );
  } finally {
    clearTimeout(timer);
    watching.abort();
    await completed;
    // The service is separately owned by systemd: killing its client is insufficient.
    try {
      try {
        await onBoundary?.("cleanup", { directory });
      } finally {
        const before = await control(
          "show",
          "--property=ActiveState",
          "--value",
        );
        if (before !== "inactive" && before !== "failed") await control("stop");
        const state = await control(
          "show",
          "--property=ActiveState",
          "--value",
        );
        assert(
          state === "inactive" || state === "failed",
          "Constrained service did not drain",
        );
      }
    } finally {
      await writeFile(
        resolve(directory, "resources.json"),
        JSON.stringify(
          {
            schemaVersion: 1,
            limits: options,
            code,
            cancelled: signal.aborted,
            failure:
              failure instanceof Error
                ? sanitizeDiagnostic(failure.message, root)
                : undefined,
            manifest: tail
              .match(
                /evidence: (\.agents\/verification\/runs\/[a-zA-Z0-9_.-]+)/i,
              )?.[1]
              ?.concat("/manifest.json"),
            ...evidence,
          },
          null,
          2,
        ) + "\n",
      );
      // Existing per-case diagnostics retain sanitized checker failures. This log
      // contains only wrapper output; avoid exporting paths or command arguments.
      console.info(
        `Constrained verification: exit=${code ?? "interrupted"}, peak=${evidence?.peakBytes ?? "unavailable"}, OOM kills=${evidence?.oomKills ?? "unavailable"}`,
      );
    }
  }
  // Child completion is not the acceptance boundary: accounting, service drain
  // and retained diagnostics can all yield after it. Reject only after those
  // mandatory effects finish, including cancellation during the final write.
  signal.throwIfAborted();
  assert(evidence, "Missing constrained resource accounting");
  return { code, failure, evidence, directory };
}

/** Live regression: a child that outlives its deadline is still measured and reported as a timeout. */
export async function verifyTimeoutAccounting(root: string, system: boolean) {
  const result = await runConstrainedVerification(
    root,
    system,
    ["sleep", "30"],
    {
      memoryMaxBytes: 128 * 1024 * 1024,
      cpuQuotaPercent: 200,
      timeoutMs: 1500,
    },
    new AbortController().signal,
  );
  assert(
    result.failure instanceof Error &&
      result.failure.message === "Constrained verification timed out",
    `Timeout reported as: ${String(result.failure)}`,
  );
  assert.equal(result.code, undefined, "Timed-out child reported an exit");
  assert(result.evidence.peakBytes > 0, "Timed-out run skipped accounting");
}

/** Deterministic live regression: zero-exit child, then cancellation at a held boundary. */
export async function verifyPostExitCancellation(
  root: string,
  system: boolean,
  boundary: "exited" | "cleanup",
) {
  const cancellation = new AbortController();
  const reason = new Error(
    `Synthetic post-exit cancellation during ${boundary}`,
  );
  const phases: string[] = [];
  let directory = "";
  await assert.rejects(
    runConstrainedVerification(
      root,
      system,
      [process.execPath, "-e", "process.exit(0)"],
      {
        memoryMaxBytes: 128 * 1024 * 1024,
        cpuQuotaPercent: 200,
        timeoutMs: 10000,
      },
      cancellation.signal,
      async (phase, context) => {
        phases.push(phase);
        directory = context.directory;
        if (phase === boundary) cancellation.abort(reason);
        await Promise.resolve();
      },
    ),
    (error: unknown) => error === reason,
    "Post-exit cancellation returned success",
  );
  assert.deepEqual(
    phases,
    ["exited", "cleanup"],
    "Cancellation skipped required cleanup",
  );
  const record = JSON.parse(
    await readFile(resolve(directory, "resources.json"), "utf8"),
  );
  assert.equal(
    record.code,
    0,
    "Regression did not reach successful child exit",
  );
  assert.equal(
    record.cancelled,
    true,
    "Cancellation absent from retained accounting",
  );
  assert.equal(record.oomKills, 0, "Unrelated OOM caused rejection");
  assert(record.peakBytes > 0, "Cancellation skipped accounting");
}

if (import.meta.main) {
  assert(
    process.argv.length === 2 ||
      (process.argv.length === 3 && process.argv[2] === "--system"),
    "Resource gate accepts no model filters",
  );
  const root = resolve(import.meta.dir, "..");
  const cancellation = new AbortController();
  const stop = () =>
    cancellation.abort(new Error("Constrained verification cancelled"));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    // Prove the hard limit can actually kill an over-budget descendant before
    // accepting a successful constrained canonical run.
    const control = await runConstrainedVerification(
      root,
      process.argv[2] === "--system",
      [
        process.execPath,
        "-e",
        "const blocks=[]; setInterval(()=>blocks.push(Buffer.alloc(16*1024*1024,1)),10)",
      ],
      {
        memoryMaxBytes: 64 * 1024 * 1024,
        cpuQuotaPercent: 200,
        timeoutMs: 10000,
      },
      cancellation.signal,
    );
    if (control.failure) throw control.failure;
    assert(
      control.evidence.oomKills > 0 && control.code !== 0,
      "Memory limit control did not kill the over-budget process",
    );
    await verifyResourceCancellation(root, process.argv[2] === "--system");
    const regressions = await runVerificationProcess(
      [process.execPath, "test", "scripts/verification-resources.live.test.ts"],
      {
        cwd: root,
        timeoutMs: 45000,
        env: {
          ...process.env,
          HERDR_RESOURCE_MANAGER:
            process.argv[2] === "--system" ? "system" : "user",
        },
        signal: cancellation.signal,
      },
    );
    assert.equal(
      regressions.code,
      0,
      `Post-exit cancellation regression failed: ${regressions.stderr}`,
    );
    const result = await runConstrainedVerification(
      root,
      process.argv[2] === "--system",
      [process.execPath, "run", "verification:check"],
      limits,
      cancellation.signal,
    );
    if (result.failure) throw result.failure;
    assert.equal(result.code, 0, "Constrained canonical verification failed");
    assert.equal(
      result.evidence.oomKills,
      0,
      "Canonical verification exceeded its memory limit",
    );
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
