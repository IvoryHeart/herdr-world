import { replayRuntimeControl } from "./runtime-control";
import { replayBrowserPreparation } from "./browser-preparation";
import { replayRuntimeDrain } from "./runtime-drain";
import { randomUUID } from "node:crypto";
import { runSensitivity } from "./sensitivity";
import { replayChunkCredits } from "./chunk-credits";
import { replayChunkAssembly } from "./chunk-assembly";
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { withPrivateChecker } from "../../scripts/verification-checker";
import {
  assertVerificationInstalled,
  checkerHome,
  checkerJar,
  quintCli,
} from "../../scripts/verification-setup";
import checker from "../../tools/quint/checker.json";
import { runVerificationProcess } from "../../scripts/verification-process";
import {
  fingerprintInputs,
  validateEvidence,
  type VerificationManifest,
} from "../../scripts/verification-evidence";
import { replayRefresh, replayRuntime, replaySpaces } from "./replay";
import { loadTrace, type Model, type ReplayDomain } from "./traces";

const root = resolve(import.meta.dir, "../..");
const output = resolve(
  root,
  ".agents/verification/runs",
  new Date().toISOString().replaceAll(":", "-") + "-" + randomUUID(),
);
const artifacts = relative(root, output);
const cli = quintCli;
const cancellation = new AbortController();
const cases = [
  {
    name: "chunk-assembly",
    witnesses: [
      "completed",
      "cancelledDecode",
      "malformedRejected",
      "parallelCalls",
      "oldSocketIgnored",
    ],
    replay: replayChunkAssembly,
    mismatches: [
      "assembly.transport.epoch",
      "assembly.connected",
      "assembly.calls",
      "assembly.decode.starts",
      "assembly.parts",
      "assembly.decode.aborted",
      "assembly.outcome",
      "assembly.result",
    ],
  },
  {
    name: "chunk-credits",
    witnesses: [
      "capacityDenied",
      "wrongSocket",
      "wrongIndex",
      "duplicateWait",
      "retirementCancelled",
      "capacityReused",
    ],
    replay: replayChunkCredits,
    mismatches: [
      "credits.recognized",
      "credits.released",
      "credits.rejected",
      "credits.wait.state",
      "credits.wait.index",
      "credits.released.socket",
      "credits.released.request",
      "credits.released.index",
    ],
  },
  {
    name: "runtime-drain",
    witnesses: [
      "replacedDuringStart",
      "removedDuringStart",
      "shutdownDuringStart",
      "currentErrorDuringStart",
      "failedStart",
      "cleanupBeforeTransport",
      "transportBeforeCleanup",
      "failedDrain",
    ],
    replay: replayRuntimeDrain,
    mismatches: [
      "drain.ready.seen",
      "drain.state",
      "drain.generation",
      "drain.ready.lease",
      "drain.membership",
      "drain.background",
      "drain.constructions",
    ],
  },
  {
    name: "browser-preparation",
    witnesses: [
      "decodeInterrupted",
      "objectInterrupted",
      "admissionInterrupted",
      "siblingSurvives",
      "requestFailure",
      "priorityFollowup",
    ],
    replay: replayBrowserPreparation,
    mismatches: [
      "preparation.qualification.ids",
      "preparation.qualification.generation",
      "preparation.hint",
      "preparation.stage",
      "preparation.status",
      "preparation.revision",
      "preparation.issued",
      "preparation.catalogue",
      "preparation.owner",
      "preparation.generation",
      "preparation.actionable",
      "preparation.stale",
      "preparation.interruption.status",
    ],
  },
  {
    name: "runtime-control",
    witnesses: [
      "replaced",
      "removed",
      "failedCleanup",
      "stoppedAll",
      "currentFailure",
      "duplicate",
      "reentrantStart",
      "reentrantStop",
    ],
    replay: replayRuntimeControl,
    mismatches: [
      "control.state",
      "control.generation",
      "control.membership",
      "control.runtime.factory",
      "control.runtime.generation",
      "control.lease.current",
      "control.reentrant.start",
      "control.reentrant.stop",
      "control.reentrant.stop.calls",
      "control.duplicate.start",
      "control.duplicate.stop",
      "control.denied.start",
      "control.obsolete.context",
      "control.peer.constructed",
    ],
  },
  {
    name: "runtime-leases",
    witnesses: ["lateStart", "obsoleteCallback", "twoReady"],
    replay: replayRuntime,
    mismatches: [
      "runtime.state",
      "runtime.generation",
      "runtime.readyLease",
      "runtime.lease.current",
    ],
  },
  {
    name: "browser-refresh",
    witnesses: ["lateReply", "coalescedFollowup", "restored"],
    replay: replayRefresh,
    mismatches: [
      "refresh.status",
      "refresh.revision",
      "refresh.connections.count",
      "refresh.connection.id",
      "refresh.connection.generation",
      "refresh.connection.actionable",
    ],
  },
  {
    name: "space-admission",
    witnesses: ["mixedPriority", "allHosts"],
    replay: replaySpaces,
    mismatches: ["spaces.membership", "spaces.priority", "spaces.unique"],
  },
] as const;
type CommandResult = { code: number; ms: number; log: string; args: string[] };
const commands: CommandResult[] = [];

type ImplementationFault =
  | "primary"
  | "catalogue"
  | "retired-owner"
  | "selected-hint"
  | "credit-index"
  | "qualified-generation"
  | "chunk-index";
async function implementationMutation(
  name: Model,
  fault: ImplementationFault = "primary",
) {
  const allowed: Partial<Record<Model, readonly ImplementationFault[]>> = {
    "browser-refresh": ["primary", "catalogue"],
    "browser-preparation": [
      "primary",
      "retired-owner",
      "selected-hint",
      "qualified-generation",
    ],
    "chunk-credits": ["primary", "credit-index"],
    "chunk-assembly": ["primary", "chunk-index"],
  };
  assert(
    (allowed[name] ?? ["primary"]).includes(fault),
    "Unsupported model/fault combination",
  );
  const owner =
    name === "chunk-assembly"
      ? "web/src/api.ts"
      : name === "chunk-credits"
        ? "server/src/bridge/world-snapshot-admission.ts"
        : name === "runtime-leases" ||
            name === "runtime-control" ||
            name === "runtime-drain"
          ? "server/src/connections/manager.ts"
          : name === "browser-refresh" || name === "browser-preparation"
            ? "web/src/world/runtimeStore.ts"
            : "web/src/world/spaceAdmission.ts";
  const original = await readFile(resolve(root, owner), "utf8");
  let contents: string;
  if (name === "chunk-assembly") {
    if (fault === "chunk-index") {
      const guard = "chunk.index !== (pending.chunks?.parts.length ?? 0)";
      assert.equal(
        original.split(guard).length,
        2,
        "assembly index guard changed",
      );
      contents = original.replace(guard, "false");
    } else {
      const guard =
        "ws.onmessage = (ev) => {\n      if (this.ws !== ws) return;";
      assert.equal(
        original.split(guard).length,
        2,
        "old-socket receive guard changed",
      );
      contents = original.replace(guard, "ws.onmessage = (ev) => {");
    }
  } else if (name === "chunk-credits") {
    if (fault === "credit-index") {
      const guard = "if (waiting && waiting.index === admitted.index) {";
      assert.equal(
        original.split(guard).length,
        2,
        "credit index guard changed",
      );
      contents = original.replace(guard, "if (waiting) {");
    } else {
      const storage = "new WeakMap<object, Map<string, Transfer>>()";
      const guard = "this.sockets.get(socket)?.get(admitted.id)";
      assert.equal(original.split(storage).length, 2);
      assert.equal(original.split(guard).length, 2);
      contents = original
        .replace(storage, "new Map<object, Map<string, Transfer>>()")
        .replace(
          guard,
          "[...this.sockets.values()].map(transfers => transfers.get(admitted.id)).find(transfer => transfer?.waiting?.index === admitted.index)",
        );
    }
  } else if (name === "runtime-drain") {
    const guard = "if (!this.isCurrent(entry, generation, runtime)) {";
    assert.equal(
      original.split(guard).length,
      3,
      "retired start guard changed",
    );
    contents = original.replaceAll(guard, "if (false) {");
  } else if (name === "runtime-leases" || name === "runtime-control") {
    const guard =
      'entry.state === "ready" && this.isCurrent(entry, generation, runtime)';
    assert.equal(
      original.split(guard).length,
      2,
      "lease mutation target changed",
    );
    contents = original.replace(guard, 'entry.state === "ready"');
  } else if (name === "browser-refresh" || name === "browser-preparation") {
    if (fault === "qualified-generation") {
      const guard =
        ".connection(connection.connectionId, connection.generation)";
      assert.equal(
        original.split(guard).length,
        2,
        "qualified generation target changed",
      );
      contents = original.replace(
        guard,
        ".connection(connection.connectionId)",
      );
    } else if (fault === "selected-hint") {
      const guard = "selected_connection_id: this.selectedConnectionId";
      assert.equal(
        original.split(guard).length,
        2,
        "selected hint target changed",
      );
      contents = original.replace(
        guard,
        'selected_connection_id: "synthetic-unowned"',
      );
    } else if (fault === "retired-owner") {
      const guard =
        "this.client\n              .connection(connection.connectionId, connection.generation)\n              .isCurrent()";
      assert.equal(
        original.split(guard).length,
        2,
        "owner revalidation target changed",
      );
      contents = original.replace(guard, "true");
    } else if (fault === "catalogue") {
      const getter = "get = () => this.state;";
      assert.equal(
        original.split(getter).length,
        2,
        "catalogue mutation target changed",
      );
      contents = original.replace(
        getter,
        "get = () => ({ ...this.state, connections: [] });",
      );
    } else {
      assert(original.includes("observationEpoch !== this.observationEpoch"));
      assert(original.includes("observationEpoch === this.observationEpoch"));
      contents = original
        .replaceAll("observationEpoch !== this.observationEpoch", "false")
        .replaceAll("observationEpoch === this.observationEpoch", "true");
    }
  } else {
    const guard = "const admitted = ordered.filter(relevant).slice(0, bound);";
    assert.equal(
      original.split(guard).length,
      2,
      "allocator mutation target changed",
    );
    contents = original.replace(
      guard,
      `return ordered.slice(0, bound);\n${guard}`,
    );
  }
  // Substitute exactly one source module in an ignored bundle. Never mutate the
  // checkout or put faulty code in the application dependency graph.
  let substituted = false;
  const bundle = await Bun.build({
    entrypoints: [resolve(root, owner)],
    target: "bun",
    plugins: [
      {
        name: "quint-negative-control",
        setup(build) {
          build.onLoad({ filter: /\.ts$/ }, (args) => {
            if (args.path !== resolve(root, owner)) return;
            substituted = true;
            return { contents, loader: "ts" };
          });
        },
      },
    ],
  });
  assert(
    bundle.success && substituted,
    "implementation mutation bundle failed",
  );
  const path = resolve(output, `${name}-${fault}-implementation-mutant.mjs`);
  await writeFile(path, await bundle.outputs[0]!.text());
  return path;
}

async function command(
  label: string,
  args: string[],
  expectedViolation = false,
) {
  const started = performance.now();
  const executionArgs = args.map((arg) =>
    arg.startsWith("experiments/") || arg.startsWith(".agents/")
      ? resolve(root, arg)
      : arg,
  );
  const temporary = resolve(output, `temporary-${label}`);
  await mkdir(temporary, { recursive: true });
  let partialLog = "";
  const invoke = (commandArgs: string[], signal = cancellation.signal) =>
    runVerificationProcess(
      ["node", "--max-old-space-size=512", cli, ...commandArgs],
      {
        cwd: output,
        env: {
          ...process.env,
          QUINT_HOME: checkerHome,
          APALACHE_JAR: checkerJar,
          JVM_ARGS: "-Xmx1G -Xss16M",
          JVM_GC_ARGS: "",
          TMPDIR: temporary,
          TMP: temporary,
          TEMP: temporary,
        },
        timeoutMs: 240_000,
        onOutput: (text) => {
          partialLog += text.replaceAll(root, "<checkout>");
        },
        signal,
      },
    );
  const { stdout, stderr, code } = await (args[0] === "verify"
    ? withPrivateChecker(temporary, cancellation.signal, (port, signal) =>
        invoke(
          [
            ...executionArgs,
            "--apalache-version",
            checker.version,
            "--server-endpoint",
            `127.0.0.1:${port}`,
            "--tlc-config",
            resolve(root, "tools/quint/tlc.json"),
          ],
          signal,
        ),
      )
    : invoke(executionArgs)
  )
    .catch(async (error) => {
      await writeFile(resolve(output, `${label}.log`), partialLog);
      await writeFile(
        resolve(output, `${label}.failure.json`),
        JSON.stringify({
          complete: false,
          reason:
            error instanceof Error ? error.message : "unknown tool failure",
        }),
      );
      throw error;
    })
    .finally(() => rm(temporary, { recursive: true, force: true }));
  const log = `${stdout}\n${stderr}`.replaceAll(root, "<checkout>");
  await writeFile(resolve(output, `${label}.log`), log);
  const result = {
    code,
    ms: Math.round(performance.now() - started),
    log: `${label}.log`,
    args,
  };
  commands.push(result);
  await writeFile(
    resolve(output, "commands.json"),
    JSON.stringify(commands, null, 2),
  );
  if (expectedViolation) {
    assert.notEqual(code, 0, `${label}: faulty model unexpectedly passed`);
    assert.match(
      log,
      /Invariant violated|invariant.*violat/i,
      `${label}: failed without invariant counterexample`,
    );
  } else {
    assert.equal(code, 0, `${label} failed; see ${result.log}`);
  }
  return log;
}

async function replayWorker(
  label: string,
  request: {
    model: Model;
    files: string[];
    mode: "positive" | "mutation" | "counterexample";
    allowed: readonly string[];
    mutant?: string;
    domain?: ReplayDomain;
    reverseRegistration?: boolean;
    spaceOrder?: number[];
  },
) {
  const input = resolve(output, `${label}-request.json`);
  const resultPath = resolve(output, `${label}-result.json`);
  await writeFile(input, JSON.stringify(request));
  const temporary = resolve(output, `temporary-${label}`);
  await mkdir(temporary, { recursive: true });
  const result = await runVerificationProcess(
    [
      process.execPath,
      resolve(root, "scripts/verification-replay.ts"),
      input,
      resultPath,
    ],
    {
      cwd: root,
      timeoutMs: 30_000,
      signal: cancellation.signal,
      env: {
        ...process.env,
        TMPDIR: temporary,
        TMP: temporary,
        TEMP: temporary,
      },
    },
  ).finally(() => rm(temporary, { recursive: true, force: true }));
  await writeFile(
    resolve(output, `${label}.log`),
    `${result.stdout}\n${result.stderr}`.replaceAll(root, "<checkout>"),
  );
  commands.push({
    code: result.code,
    ms: result.elapsedMs,
    log: `${label}.log`,
    args: [
      "replay",
      request.model,
      request.mode,
      JSON.stringify({
        domain: request.domain,
        reverseRegistration: request.reverseRegistration,
        spaceOrder: request.spaceOrder,
      }),
    ],
  });
  assert.equal(result.code, 0, `Replay worker ${label} failed; see its log`);
  const value = JSON.parse(await readFile(resultPath, "utf8"));
  if (request.mode === "positive") {
    assert(
      value.kind === "positive" &&
        value.traces === request.files.length &&
        Number.isSafeInteger(value.steps) &&
        value.steps > 0,
    );
  } else {
    assert(
      value.kind === "negative" &&
        request.allowed.includes(value.observation) &&
        request.files.some((file) => file.endsWith(value.trace)),
    );
  }
  return value as {
    kind: string;
    traces: number;
    steps: number;
    witnesses: Record<string, number>;
    witnessesBySeed: Record<string, Record<string, number>>;
    trace: string;
    observation: string;
  };
}

export async function runReviewedQuintModels(
  requestedModels: readonly Model[] = cases.map((item) => item.name),
) {
  assert(
    requestedModels.length > 0 &&
      new Set(requestedModels).size === requestedModels.length &&
      requestedModels.every((name) => cases.some((item) => item.name === name)),
    "Unknown or duplicate model selection",
  );
  const runCases = cases.filter((item) => requestedModels.includes(item.name));
  const abort = () => cancellation.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    const tools = await assertVerificationInstalled();
    const nodeVersion = await runVerificationProcess(["node", "--version"], {
      timeoutMs: 5000,
    });
    const javaVersion = await runVerificationProcess(["java", "-version"], {
      timeoutMs: 5000,
    });
    assert.equal(nodeVersion.code, 0);
    assert.equal(javaVersion.code, 0);
    const revision = await runVerificationProcess(
      ["git", "rev-parse", "HEAD"],
      { cwd: root, timeoutMs: 5000 },
    );
    assert.equal(revision.code, 0);
    const tracked = await runVerificationProcess(["git", "ls-files", "-z"], {
      cwd: root,
      timeoutMs: 5000,
    });
    assert.equal(tracked.code, 0);
    const inputs = await fingerprintInputs(
      root,
      tracked.stdout.split("\0").filter(Boolean),
    );
    await mkdir(output, { recursive: true });
    await writeFile(
      resolve(output, "manifest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          complete: false,
          sourceRevision: revision.stdout.trim(),
          sourceInputs: inputs,
          tools,
          results: [],
        },
        null,
        2,
      ),
    );
    const version = await command("version", ["--version"]);
    assert.equal(
      version.trim(),
      "0.33.0",
      "spike requires pinned Quint 0.33.0",
    );
    const results = [];
    for (const item of runCases) {
      const traceCount = ["browser-preparation", "chunk-credits"].includes(
        item.name,
      )
        ? 500
        : 100;
      const model = `experiments/quint/${item.name}.qnt`;
      await command(`${item.name}-types`, ["typecheck", model]);
      const simulation = await command(`${item.name}-simulation`, [
        "run",
        model,
        "--backend",
        "typescript",
        "--seed",
        "42",
        "--max-samples",
        "500",
        "--max-steps",
        "25",
        "--n-traces",
        String(traceCount),
        "--invariant",
        "safety",
        "--verbosity",
        "1",
        "--out-itf",
        `${artifacts}/${item.name}_{seq}.itf.json`,
        "--witnesses",
        ...item.witnesses,
      ]);
      const witnessCounts: Record<string, number> = {};
      for (const witness of item.witnesses) {
        const match = simulation.match(
          new RegExp(`${witness} was witnessed in (\\d+) trace`),
        );
        assert(match && Number(match[1]) > 0, `missing witness ${witness}`);
        witnessCounts[witness] = Number(match[1]);
      }
      const verification = await command(`${item.name}-verification`, [
        "verify",
        model,
        "--backend",
        "tlc",
        "--invariant",
        "safety",
        "--verbosity",
        "3",
        ...(item.name === "space-admission"
          ? ["--init", "allConfigurations", "--step", "hold"]
          : []),
      ]);
      assert.match(
        verification,
        /No violation found/,
        "verification did not report success",
      );
      const witnessesBySeed: Record<string, Record<string, number>> = {
        "42": witnessCounts,
      };
      for (const seed of [73, 103]) {
        const sampled = await command(`${item.name}-seed-${seed}`, [
          "run",
          model,
          "--backend",
          "typescript",
          "--seed",
          String(seed),
          "--max-samples",
          "500",
          "--max-steps",
          "25",
          "--n-traces",
          String(traceCount),
          "--invariant",
          "safety",
          "--verbosity",
          "1",
          "--out-itf",
          `${artifacts}/${item.name}-seed${seed}_{seq}.itf.json`,
          "--witnesses",
          ...item.witnesses,
        ]);
        witnessesBySeed[String(seed)] = {};
        for (const witness of item.witnesses) {
          const match = sampled.match(
            new RegExp(`${witness} was witnessed in (\\d+) trace`),
          );
          assert(
            match && Number(match[1]) > 0,
            `missing seed-${seed} witness ${witness}`,
          );
          witnessesBySeed[String(seed)]![witness] = Number(match[1]);
        }
      }
      const files = (await readdir(output))
        .filter((file) =>
          new RegExp(
            `^${item.name}(?:-seed(?:73|103))?_\\d+\\.itf\\.json$`,
          ).test(file),
        )
        .sort();
      assert.equal(files.length, 3 * traceCount, "trace count changed");
      const replayStarted = performance.now();
      const originalReplay = await replayWorker(
        `${item.name}-production-replay`,
        {
          model: item.name,
          files: files.map((file) => resolve(output, file)),
          mode: "positive",
          allowed: item.mismatches,
        },
      );
      const replayWitnesses = originalReplay.witnesses;
      const steps = originalReplay.steps;
      for (const seed of [42, 73, 103])
        for (const witness of item.witnesses)
          assert(
            (originalReplay.witnessesBySeed[String(seed)]?.[witness] ?? 0) > 0,
            `missing seed-${seed} actual replay witness ${witness}`,
          );
      for (const name of item.witnesses)
        assert(
          replayWitnesses[name]! > 0,
          `missing actual replay witness ${name}`,
        );
      const replayMs = Math.round(performance.now() - replayStarted);
      let exhaustiveConfigurations: number | null = null;
      if (item.name === "space-admission") {
        const path = `${artifacts}/space-admission-exhaustive.itf.json`;
        await command("space-admission-exhaustive", [
          "run",
          model,
          "--step",
          "enumerate",
          "--backend",
          "typescript",
          "--seed",
          "42",
          "--max-samples",
          "1",
          "--max-steps",
          "5103",
          "--invariant",
          "safety",
          "--verbosity",
          "1",
          "--out-itf",
          path,
        ]);
        const states = await loadTrace(resolve(root, path), item.name);
        assert.equal(states.length, 5104, "exhaustive trace is incomplete");
        const configurations = states
          .slice(1)
          .map((state) =>
            JSON.stringify([
              state.bound,
              [...state.present].sort(),
              [...state.relevant].sort(),
            ]),
          );
        assert.equal(
          new Set(configurations).size,
          5103,
          "exhaustive configurations repeat",
        );
        await replayWorker("space-admission-exhaustive-replay", {
          model: item.name,
          files: [resolve(root, path)],
          mode: "positive",
          allowed: item.mismatches,
        });
        exhaustiveConfigurations = configurations.length;
      }
      const mutantBundle = await implementationMutation(item.name);
      const killed = await replayWorker(`${item.name}-implementation-control`, {
        model: item.name,
        files: files.map((file) => resolve(output, file)),
        mode: "mutation",
        allowed: item.mismatches,
        mutant: mutantBundle,
      });
      const killingTrace = killed.trace;
      const killingObservation = killed.observation;
      let droppedCatalogueControl = null;
      if (item.name === "browser-refresh") {
        const droppedBundle = await implementationMutation(
          item.name,
          "catalogue",
        );
        const result = await replayWorker(
          "browser-refresh-dropped-catalogue-control",
          {
            model: item.name,
            files: files.map((file) => resolve(output, file)),
            mode: "mutation",
            allowed: ["refresh.connections.count"],
            mutant: droppedBundle,
          },
        );
        droppedCatalogueControl = {
          trace: result.trace,
          observation: result.observation,
        };
      }
      let retiredOwnerControl = null;
      if (item.name === "browser-preparation") {
        const retiredBundle = await implementationMutation(
          item.name,
          "retired-owner",
        );
        const result = await replayWorker(
          "browser-preparation-retired-owner-control",
          {
            model: item.name,
            files: files.map((file) => resolve(output, file)),
            mode: "mutation",
            allowed: ["preparation.actionable"],
            mutant: retiredBundle,
          },
        );
        retiredOwnerControl = {
          trace: result.trace,
          observation: result.observation,
        };
      }
      let selectedHintControl = null;
      if (item.name === "browser-preparation") {
        const hintBundle = await implementationMutation(
          item.name,
          "selected-hint",
        );
        const result = await replayWorker(
          "browser-preparation-selected-hint-control",
          {
            model: item.name,
            files: files.map((file) => resolve(output, file)),
            mode: "mutation",
            allowed: ["preparation.hint"],
            mutant: hintBundle,
          },
        );
        selectedHintControl = {
          trace: result.trace,
          observation: result.observation,
        };
      }
      let creditIndexControl = null;
      if (item.name === "chunk-credits") {
        const bundle = await implementationMutation(item.name, "credit-index");
        const result = await replayWorker("chunk-credits-index-control", {
          model: item.name,
          files: files.map((file) => resolve(output, file)),
          mode: "mutation",
          allowed: ["credits.released"],
          mutant: bundle,
        });
        creditIndexControl = {
          trace: result.trace,
          observation: result.observation,
        };
      }
      let qualifiedGenerationControl = null;
      if (item.name === "browser-preparation") {
        const bundle = await implementationMutation(
          item.name,
          "qualified-generation",
        );
        const result = await replayWorker(
          "browser-preparation-qualified-generation-control",
          {
            model: item.name,
            files: files.map((file) => resolve(output, file)),
            mode: "mutation",
            allowed: ["preparation.qualification.generation"],
            mutant: bundle,
          },
        );
        qualifiedGenerationControl = {
          trace: result.trace,
          observation: result.observation,
        };
      }
      let assemblyIndexControl = null;
      if (item.name === "chunk-assembly") {
        const bundle = await implementationMutation(item.name, "chunk-index");
        const result = await replayWorker("chunk-assembly-index-control", {
          model: item.name,
          files: files.map((file) => resolve(output, file)),
          mode: "mutation",
          allowed: ["assembly.outcome", "assembly.decode.starts"],
          mutant: bundle,
        });
        assemblyIndexControl = {
          trace: result.trace,
          observation: result.observation,
        };
      }
      const original = await readFile(resolve(root, model), "utf8");
      assert(original.includes("pure val BROKEN = false"));
      const mutant = `${artifacts}/${item.name}-mutant.qnt`;
      await writeFile(
        resolve(root, mutant),
        original.replace("pure val BROKEN = false", "pure val BROKEN = true"),
      );
      const moduleName = item.name.replaceAll("-", "_");
      const counterexample = `${artifacts}/${item.name}-counterexample.itf.json`;
      await command(
        `${item.name}-negative-control`,
        [
          "run",
          mutant,
          "--main",
          moduleName,
          "--backend",
          "typescript",
          "--seed",
          "42",
          "--max-samples",
          "500",
          "--max-steps",
          "25",
          "--invariant",
          "safety",
          "--verbosity",
          "1",
          "--out-itf",
          counterexample,
        ],
        true,
      );
      // The real implementation must also reject the mutant model's expectations.
      // This checks that the adapter compares results, rather than merely executing.
      // Decode/validate before the expected mismatch check. Codec, malformed-action,
      // adapter and cleanup failures must abort rather than count as conformance evidence.
      const counterexampleMismatch = await replayWorker(
        `${item.name}-counterexample-replay`,
        {
          model: item.name,
          files: [resolve(root, counterexample)],
          mode: "counterexample",
          allowed: item.mismatches,
        },
      );
      const result = {
        name: item.name,
        witnesses: witnessCounts,
        witnessesBySeed,
        replayWitnesses,
        replayWitnessesBySeed: originalReplay.witnessesBySeed,
        traces: files.length,
        steps,
        replayMs,
        modelMutationDetected: true,
        divergentTraceRejected: true,
        implementationMutationDetected: true,
        killingTrace,
        killingObservation,
        counterexampleObservation: counterexampleMismatch.observation,
        ...(droppedCatalogueControl ? { droppedCatalogueControl } : {}),
        ...(retiredOwnerControl ? { retiredOwnerControl } : {}),
        ...(selectedHintControl ? { selectedHintControl } : {}),
        ...(creditIndexControl ? { creditIndexControl } : {}),
        ...(qualifiedGenerationControl ? { qualifiedGenerationControl } : {}),
        ...(assemblyIndexControl ? { assemblyIndexControl } : {}),
        ...(exhaustiveConfigurations !== null
          ? { exhaustiveConfigurations }
          : {}),
      };
      results.push(result);
      await writeFile(
        resolve(output, "results.json"),
        JSON.stringify(
          { version: "0.33.0", seed: 42, samples: 500, maxSteps: 25, results },
          null,
          2,
        ),
      );
      console.log(JSON.stringify(result));
    }
    const sensitivity = await runSensitivity({
      root,
      output,
      artifacts,
      command,
      replayWorker,
      mutation: implementationMutation,
      cases: runCases,
    });
    await writeFile(
      resolve(output, "sensitivity.json"),
      JSON.stringify(sensitivity, null, 2),
    );
    console.log(
      "All selected finite models verified; generated production replays and negative controls passed.",
    );
    console.log(`Evidence: ${artifacts}`);

    const manifest: VerificationManifest = {
      schemaVersion: 1,
      sourceRevision: revision.stdout.trim(),
      sourceInputs: inputs,
      tools: {
        ...tools,
        node: nodeVersion.stdout.trim(),
        java: javaVersion.stderr.trim().split("\n")[0]!,
        bun: Bun.version,
      },
      settings: {
        backend: "tlc",
        seeds: [42, 73, 103],
        maxSteps: 25,
        samples: 500,
        replayTraces: 500,
      },
      commands: commands.map((command) => ({
        ...command,
        label: command.log.replace(/\.log$/, ""),
        elapsedMs: command.ms,
      })),
      results: results.map((result) => ({
        ...result,
        sensitivity: sensitivity.filter(
          (item) => (item as { name: string }).name === result.name,
        ),
      })),
      complete: true,
    };
    await validateEvidence(root, manifest, runCases.length);
    await writeFile(
      resolve(output, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  assert(
    args.length === 0 || (args.length === 2 && args[0] === "--case"),
    "Use --case <model> for focused development checks",
  );
  await runReviewedQuintModels(args.length ? [args[1] as Model] : undefined);
}
