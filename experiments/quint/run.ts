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
import { loadTrace, type Model } from "./traces";

const root = resolve(import.meta.dir, "../..");
const output = resolve(
  root,
  ".agents/verification/runs",
  new Date().toISOString().replaceAll(":", "-"),
);
const artifacts = relative(root, output);
const cli = quintCli;
const cancellation = new AbortController();
const cases = [
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

async function implementationMutation(name: Model, droppedCatalogue = false) {
  const owner =
    name === "runtime-leases"
      ? "server/src/connections/manager.ts"
      : name === "browser-refresh"
        ? "web/src/world/runtimeStore.ts"
        : "web/src/world/spaceAdmission.ts";
  const original = await readFile(resolve(root, owner), "utf8");
  let contents: string;
  if (name === "runtime-leases") {
    const guard =
      'entry.state === "ready" && this.isCurrent(entry, generation, runtime)';
    assert.equal(
      original.split(guard).length,
      2,
      "lease mutation target changed",
    );
    contents = original.replace(guard, 'entry.state === "ready"');
  } else if (name === "browser-refresh") {
    if (droppedCatalogue) {
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
  const path = resolve(
    output,
    `${name}${droppedCatalogue ? "-dropped-catalogue" : ""}-implementation-mutant.mjs`,
  );
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
  const invoke = (commandArgs: string[], signal = cancellation.signal) =>
    runVerificationProcess(["node", cli, ...commandArgs], {
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
      signal,
    });
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
  ).finally(() => rm(temporary, { recursive: true, force: true }));
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
    args: ["replay", request.model, request.mode],
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
    trace: string;
    observation: string;
  };
}

export async function runReviewedQuintModels() {
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
    for (const item of cases) {
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
        "100",
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
      const files = (await readdir(output))
        .filter((file) =>
          new RegExp(`^${item.name}_\\d+\\.itf\\.json$`).test(file),
        )
        .sort();
      assert.equal(files.length, 100, "trace count changed");
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
        const droppedBundle = await implementationMutation(item.name, true);
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
        replayWitnesses,
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
    console.log(
      "All three finite models verified; generated production replays and negative controls passed.",
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
        seeds: [42],
        maxSteps: 25,
        samples: 500,
        replayTraces: 100,
      },
      commands: commands.map((command) => ({
        ...command,
        label: command.log.replace(/\.log$/, ""),
        elapsedMs: command.ms,
      })),
      results,
      complete: true,
    };
    await validateEvidence(root, manifest, cases.length);
    await writeFile(
      resolve(output, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}

if (import.meta.main) await runReviewedQuintModels();
