import { replayEffectRecovery } from "./effect-recovery";
import { verificationModels } from "./models";
import {
  retainVerificationDiagnostics,
  sanitizeDiagnostic,
} from "../scripts/verification-diagnostics";
import {
  mutateImplementation,
  type ImplementationFault,
} from "./implementationMutation";
import { replayObservationBase } from "./observation-base";
import { replayBindingResolution } from "./binding-resolution";
import { replayRuntimeControl } from "./runtime-control";
import { replayBrowserPreparation } from "./browser-preparation";
import { replayRuntimeDrain } from "./runtime-drain";
import { randomUUID } from "node:crypto";
import { runSensitivity } from "./sensitivity";
import { replayChunkCredits } from "./chunk-credits";
import { replayChunkAssembly } from "./chunk-assembly";
import { replayCreationFlow } from "./creation-flow";
import { replayRangerAuthority } from "./ranger-authority";
import { replayRangerRecovery } from "./ranger-recovery";
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { withPrivateChecker } from "../scripts/verification-checker";
import {
  assertVerificationInstalled,
  checkerHome,
  checkerJar,
  quintCli,
} from "../scripts/verification-setup";
import checker from "../tools/quint/checker.json";
import { publishVerificationEvidence } from "../scripts/verification-publication";
import {
  runVerificationProcess,
  runVerificationMetadata,
} from "../scripts/verification-process";
import {
  fingerprintInputs,
  validateEvidence,
  type VerificationManifest,
} from "../scripts/verification-evidence";
import { replayRefresh, replayRuntime, replaySpaces } from "./replay";
import { loadTrace, type Model, type ReplayDomain } from "./traces";

const root = resolve(import.meta.dir, "..");
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
    name: "binding-resolution",
    witnesses: [
      "restartUnconfirmed",
      "worldRestartReattached",
      "partialKept",
      "closeEnded",
      "allTerminalsGoneEnded",
      "moveFollowed",
      "lostReplyFollowedByTerminal",
      "outsideMoveUnresolved",
      "duplicateUnresolved",
      "lookAlikeRejected",
    ],
    replay: replayBindingResolution,
    mismatches: [
      "binding.attached",
      "binding.ambiguous",
      "binding.target",
      "binding.evidence",
      "binding.authority",
      "binding.absence",
    ],
  },
  {
    name: "observation-base",
    witnesses: [
      "unchangedSkip",
      "oneHostReplaced",
      "incarnationChanged",
      "retiredDuringRequest",
      "discardedConfirmation",
    ],
    replay: replayObservationBase,
    mismatches: [
      "base.generation",
      "base.token",
      "base.actionable",
      "base.authority",
      "base.held",
      "base.incarnation",
      "base.requests",
    ],
  },
  {
    name: "effect-recovery",
    witnesses: [
      "keyedRetry",
      "reconciled",
      "reattached",
      "repeated",
      "opaqueStopped",
      "claimReleased",
      "permanentRefusal",
      "migrationBlocked",
      "migrated",
      "cancelBefore",
      "cancelAfter",
      "revoked",
      "offlineWaits",
      "goneAfterDispatch",
      "peerFenced",
    ],
    replay: replayEffectRecovery,
    mismatches: [
      "effect.phase",
      "effect.attempt",
      "effect.applied",
      "effect.ever",
      "effect.receipt",
      "effect.authorized",
      "effect.handle",
      "effect.version",
      "effect.fence",
      "effect.target",
      "effect.peer.cas",
      "effect.peer.claimed",
      "effect.peer.attempt",
      "effect.notSent",
    ],
  },
  {
    name: "ranger-recovery",
    witnesses: [
      "stableRecovery",
      "freshGeneration",
      "endpointRejected",
      "bootRejected",
      "workspaceRejected",
      "transactionFailure",
    ],
    replay: replayRangerRecovery,
    mismatches: [
      "recovery.result",
      "recovery.fresh.generation",
      "recovery.persisted.task",
      "recovery.persisted.title",
      "recovery.persisted.run",
      "recovery.persisted.targets",
      "recovery.transaction.rejected",
    ],
  },
  {
    name: "ranger-authority",
    witnesses: [
      "permissionBlocked",
      "taskBlocked",
      "serviceBlocked",
      "runtimeBlocked",
      "workspaceBlocked",
      "authorizedWrite",
      "duplicateExecution",
    ],
    replay: replayRangerAuthority,
    mismatches: [
      "ranger.checking.expected",
      "ranger.dispatch.allowed",
      "ranger.execution.identity",
      "ranger.writes",
      "ranger.result",
      "ranger.write.label",
      "ranger.write.cwd",
      "ranger.write.focus",
    ],
  },
  {
    name: "creation-flow",
    witnesses: [
      "sourcePrepared",
      "lateAttachmentIgnored",
      "duplicateCoalesced",
      "readinessRetired",
      "uncertainDispatch",
      "conditionalFocus",
      "newerIntent",
    ],
    replay: replayCreationFlow,
    mismatches: [
      "creation.coalescing.owner",
      "creation.coalescing.duplicate",
      "creation.retention",
      "creation.dispatch.count",
      "creation.dispatch.generation",
      "creation.dispatch.source",
      "creation.dispatch.focus",
      "creation.outcome",
      "creation.progress",
      "creation.admission",
      "creation.focus",
      "creation.result.identity",
      "creation.cleanup.retention",
      "creation.cleanup.listeners",
    ],
  },
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
      "retiredDuringBackground",
      "failedBackground",
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
function replayTracesPerSeed(name: Model) {
  if (name === "effect-recovery") return 500;
  return [
    "binding-resolution",
    "browser-preparation",
    "chunk-credits",
    "creation-flow",
  ].includes(name)
    ? 500
    : 100;
}
const commands: CommandResult[] = [];
let activeLabel = "setup";

const implementationMutation = (
  name: Model,
  fault: ImplementationFault = "primary",
) => mutateImplementation(name, fault, { root, output });

async function command(
  label: string,
  args: string[],
  expectedViolation = false,
) {
  activeLabel = label;
  const started = performance.now();
  const executionArgs = args.map((arg) =>
    arg.startsWith("quint/") || arg.startsWith(".agents/")
      ? resolve(root, arg)
      : arg,
  );
  const temporary = resolve(output, `temporary-${label}`);
  await mkdir(temporary, { recursive: true });
  let partialLog = "";
  let checkerLog = "";
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
    ? withPrivateChecker(
        temporary,
        cancellation.signal,
        (port, signal) =>
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
        (text) => {
          checkerLog += text.replaceAll(root, "<checkout>");
        },
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
    .finally(async () => {
      if (checkerLog)
        await writeFile(resolve(output, `${label}-checker.log`), checkerLog);
      await rm(temporary, { recursive: true, force: true });
    });
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
  activeLabel = label;
  const input = resolve(output, `${label}-request.json`);
  const resultPath = resolve(output, `${label}-result.json`);
  await writeFile(input, JSON.stringify(request));
  const temporary = resolve(output, `temporary-${label}`);
  await mkdir(temporary, { recursive: true });
  let partialLog = "";
  const result = await runVerificationProcess(
    [
      process.execPath,
      resolve(root, "scripts/verification-replay.ts"),
      input,
      resultPath,
    ],
    {
      cwd: root,
      // Real SQLite replay performs durable commits and reopen/migration work.
      // Keep its bound explicit; the outer case and gate limits still apply.
      timeoutMs: request.model === "effect-recovery" ? 480_000 : 30_000,
      onOutput: (text) => {
        partialLog += text.replaceAll(root, "<checkout>");
      },
      signal: cancellation.signal,
      env: {
        ...process.env,
        TMPDIR: temporary,
        TMP: temporary,
        TEMP: temporary,
      },
    },
  )
    .catch(async (error) => {
      await writeFile(resolve(output, `${label}.log`), partialLog);
      await writeFile(
        resolve(output, `${label}.failure.json`),
        JSON.stringify({
          reason:
            error instanceof Error ? error.message : "Unknown worker failure",
        }),
      );
      throw error;
    })
    .finally(() => rm(temporary, { recursive: true, force: true }));
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
  await writeFile(
    resolve(output, "commands.json"),
    JSON.stringify(commands, null, 2),
  );
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
  diagnosticControl = false,
) {
  assert(
    requestedModels.length > 0 &&
      new Set(requestedModels).size === requestedModels.length &&
      requestedModels.every((name) => cases.some((item) => item.name === name)),
    "Unknown or duplicate model selection",
  );
  assert.deepEqual(
    cases.map((item) => item.name).sort(),
    [...verificationModels].sort(),
    "Canonical model inventory differs from runner cases",
  );
  const runCases = cases.filter((item) => requestedModels.includes(item.name));
  const abort = () => cancellation.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    const tools = await assertVerificationInstalled();
    const nodeVersion = await runVerificationMetadata(["node", "--version"], {
      signal: cancellation.signal,
    });
    const javaVersion = await runVerificationMetadata(["java", "-version"], {
      signal: cancellation.signal,
    });
    const revision = await runVerificationMetadata(
      ["git", "rev-parse", "HEAD"],
      { cwd: root, signal: cancellation.signal },
    );
    const tracked = await runVerificationMetadata(["git", "ls-files", "-z"], {
      cwd: root,
      signal: cancellation.signal,
    });
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
          scope: {
            kind:
              runCases.length === verificationModels.length
                ? "full-sequential"
                : "focused",
            models: runCases.map((item) => item.name),
          },
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
      const traceCount = replayTracesPerSeed(item.name);
      const model = `quint/${item.name}.qnt`;
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
        allowed:
          item.name === "effect-recovery"
            ? ["effect.receipt"]
            : item.name === "binding-resolution"
              ? ["binding.attached"]
              : item.mismatches,
        mutant: mutantBundle,
      });
      const killingTrace = killed.trace;
      const killingObservation = killed.observation;
      const effectControls: {
        fault: string;
        trace: string;
        observation: string;
      }[] = [];
      if (item.name === "effect-recovery") {
        for (const [fault, observation] of [
          ["effect-authorization", "effect.authorized"],
          ["effect-generation", "effect.target"],
          ["effect-not-sent", "effect.notSent"],
        ] as const) {
          const mutant = await implementationMutation(item.name, fault);
          const result = await replayWorker(`${item.name}-${fault}-control`, {
            model: item.name,
            files: files.map((file) => resolve(output, file)),
            mode: "mutation",
            allowed: [observation],
            mutant,
          });
          effectControls.push({
            fault,
            trace: result.trace,
            observation: result.observation,
          });
        }
      }
      const bindingControls = [];
      if (item.name === "binding-resolution") {
        for (const [fault, observation] of [
          ["binding-duplicate", "binding.ambiguous"],
          ["binding-listing-move", "binding.attached"],
          ["binding-absence", "binding.absence"],
          ["binding-partial", "binding.target"],
          ["binding-authority", "binding.authority"],
        ] as const) {
          const mutant = await implementationMutation(item.name, fault);
          const result = await replayWorker(
            `binding-resolution-${fault}-control`,
            {
              model: item.name,
              files: files.map((file) => resolve(output, file)),
              mode: "mutation",
              allowed: [observation],
              mutant,
            },
          );
          bindingControls.push({
            fault,
            trace: result.trace,
            observation: result.observation,
          });
        }
      }
      if (item.name === "observation-base") {
        const incarnation = await implementationMutation(
          item.name,
          "incarnation-reset",
        );
        await replayWorker("observation-base-incarnation-control", {
          model: item.name,
          files: files.map((file) => resolve(output, file)),
          mode: "mutation",
          allowed: ["base.incarnation"],
          mutant: incarnation,
        });
      }
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
      let backgroundGuardControl = null;
      if (item.name === "runtime-drain") {
        const bundle = await implementationMutation(
          item.name,
          "background-guard",
        );
        const result = await replayWorker(
          "runtime-drain-background-guard-control",
          {
            model: item.name,
            files: files.map((file) => resolve(output, file)),
            mode: "mutation",
            allowed: ["drain.ready.seen"],
            mutant: bundle,
          },
        );
        backgroundGuardControl = {
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
      let creationAdmissionControl = null;
      if (item.name === "creation-flow") {
        const bundle = await implementationMutation(
          item.name,
          "admission-fence",
        );
        const result = await replayWorker("creation-flow-admission-control", {
          model: item.name,
          files: files.map((file) => resolve(output, file)),
          mode: "mutation",
          allowed: ["creation.admission"],
          mutant: bundle,
        });
        creationAdmissionControl = {
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
          mode: diagnosticControl ? "positive" : "counterexample",
          allowed: item.mismatches,
        },
      );
      const result = {
        bindingControls,
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
        ...(creationAdmissionControl ? { creationAdmissionControl } : {}),
        ...(backgroundGuardControl ? { backgroundGuardControl } : {}),
        ...(effectControls.length ? { effectControls } : {}),
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
    const manifest: VerificationManifest = {
      schemaVersion: 1,
      scope: {
        kind:
          runCases.length === verificationModels.length
            ? "full-sequential"
            : "focused",
        models: runCases.map((item) => item.name),
      },
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
        replayTraces: Math.max(
          ...runCases.map((item) => replayTracesPerSeed(item.name)),
        ),
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
    await publishVerificationEvidence(
      resolve(output, "manifest.json"),
      manifest,
      cancellation.signal,
    );
    cancellation.signal.throwIfAborted();
    console.log(
      "All selected finite models verified; generated production replays and negative controls passed.",
    );
    console.log(`Evidence: ${artifacts}`);
  } catch (error) {
    await mkdir(output, { recursive: true });
    const failure = {
      label: activeLabel,
      model:
        cases.find((item) => activeLabel.startsWith(item.name))?.name ?? null,
      reason: sanitizeDiagnostic(
        error instanceof Error ? error.message : "Unknown verification failure",
        root,
      ),
    };
    await writeFile(
      resolve(output, "run.failure.json"),
      JSON.stringify(failure, null, 2),
    );
    try {
      const initial = JSON.parse(
        await readFile(resolve(output, "manifest.json"), "utf8"),
      );
      initial.complete = false;
      initial.failure = failure;
      initial.commands = commands;
      try {
        initial.results = JSON.parse(
          await readFile(resolve(output, "results.json"), "utf8"),
        ).results;
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code !== "ENOENT")
          throw readError;
      }
      await writeFile(
        resolve(output, "manifest.json"),
        JSON.stringify(initial, null, 2),
      );
    } catch (readError) {
      if ((readError as NodeJS.ErrnoException).code !== "ENOENT")
        throw readError;
    }
    const diagnostics = await retainVerificationDiagnostics(
      output,
      root,
      activeLabel,
    );
    console.error(`Diagnostics: ${relative(root, diagnostics)}`);
    throw error;
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  assert(
    args.length === 0 ||
      (args.length === 2 && args[0] === "--case") ||
      (args.length === 1 && args[0] === "--diagnostic-control"),
    "Use --case <model> for focused development checks",
  );
  const diagnostic = args[0] === "--diagnostic-control";
  await runReviewedQuintModels(
    diagnostic
      ? ["browser-refresh"]
      : args.length
        ? [args[1] as Model]
        : undefined,
    diagnostic,
  );
}
