import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { ConnectionManager } from "../../server/src/connections/manager";
import type { WorldRuntimeStore } from "../../web/src/world/runtimeStore";
import type { admitWorldSpaces } from "../../web/src/world/spaceAdmission";
import {
  replayRefresh,
  replayRuntime,
  replaySpaces,
  type TraceState,
} from "./replay";
import {
  expectObservationMismatch,
  isObservationMismatch,
} from "./observations";
import { loadTrace, type Model } from "./traces";

const root = resolve(import.meta.dir, "../..");
const output = resolve(
  root,
  ".agents/quint-spike",
  new Date().toISOString().replaceAll(":", "-"),
);
const artifacts = relative(root, output);
const cli = resolve(
  root,
  ".agents/quint-tool/node_modules/@informalsystems/quint/dist/src/cli.js",
);
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
  const exports = await import(path);
  return (states: TraceState[]) =>
    name === "runtime-leases"
      ? replayRuntime(
          states,
          exports.ConnectionManager as typeof ConnectionManager,
        )
      : name === "browser-refresh"
        ? replayRefresh(
            states,
            exports.WorldRuntimeStore as typeof WorldRuntimeStore,
          )
        : replaySpaces(
            states,
            exports.admitWorldSpaces as typeof admitWorldSpaces,
          );
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
  const proc = Bun.spawn(["node", cli, ...executionArgs], {
    cwd: output,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 240_000,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const log = `${stdout}\n${stderr}`;
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

await mkdir(output, { recursive: true });
const version = await command("version", ["--version"]);
assert.equal(version.trim(), "0.33.0", "spike requires pinned Quint 0.33.0");
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
    .filter((file) => new RegExp(`^${item.name}_\\d+\\.itf\\.json$`).test(file))
    .sort();
  assert.equal(files.length, 100, "trace count changed");
  let steps = 0;
  const replayStarted = performance.now();
  for (const file of files) {
    const states = await loadTrace(resolve(output, file), item.name);
    try {
      await item.replay(states);
    } catch (error) {
      throw new Error(`${file}: implementation diverged from model`, {
        cause: error,
      });
    }
    steps += states.length - 1;
  }
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
    replaySpaces(states);
    exhaustiveConfigurations = configurations.length;
  }
  const faultyReplay = await implementationMutation(item.name);
  let killingTrace: string | null = null;
  let killingObservation: string | null = null;
  for (const file of files) {
    try {
      const states = await loadTrace(resolve(output, file), item.name);
      await faultyReplay(states);
    } catch (error) {
      if (!isObservationMismatch(error, item.mismatches)) throw error;
      killingTrace = file;
      killingObservation = error.observation;
      break;
    }
  }
  assert(
    killingTrace,
    "generated traces did not detect implementation mutation",
  );
  let droppedCatalogueControl = null;
  if (item.name === "browser-refresh") {
    const faultyCatalogueReplay = await implementationMutation(item.name, true);
    for (const file of files) {
      const states = await loadTrace(resolve(output, file), item.name);
      try {
        await faultyCatalogueReplay(states);
      } catch (error) {
        if (!isObservationMismatch(error, ["refresh.connections.count"]))
          throw error;
        droppedCatalogueControl = {
          trace: file,
          observation: error.observation,
        };
        break;
      }
    }
    assert(
      droppedCatalogueControl,
      "generated traces did not detect dropped catalogue",
    );
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
  const counterexampleStates = await loadTrace(
    resolve(root, counterexample),
    item.name,
  );
  const counterexampleMismatch = await expectObservationMismatch(
    () => item.replay(counterexampleStates),
    item.mismatches,
  );
  const result = {
    name: item.name,
    witnesses: witnessCounts,
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
    ...(exhaustiveConfigurations !== null ? { exhaustiveConfigurations } : {}),
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
