import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { availableParallelism, totalmem } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { verificationModels } from "../quint/models";
import { runVerificationPool } from "./verification-pool";
import { runVerificationProcess } from "./verification-process";
import {
  fingerprintInputs,
  validateEvidence,
  type VerificationManifest,
} from "./verification-evidence";
import {
  retainVerificationDiagnostics,
  sanitizeDiagnostic,
} from "./verification-diagnostics";
import execution from "../tools/quint/execution.json";

type CaseEvidence = {
  model: string;
  path: string;
  manifest: VerificationManifest;
  elapsedMs: number;
  maxRSSBytes?: number;
};
export async function aggregateVerificationEvidence(
  root: string,
  records: CaseEvidence[],
  expectedModels: readonly string[],
  workers: number,
) {
  assert(
    expectedModels.length > 0 &&
      new Set(expectedModels).size === expectedModels.length,
    "Invalid canonical model inventory",
  );
  assert.equal(
    records.length,
    expectedModels.length,
    "Missing canonical model evidence",
  );
  assert.deepEqual(
    records.map((record) => record.model).sort(),
    [...expectedModels].sort(),
    "Duplicate or omitted canonical models",
  );
  const first = records[0]!.manifest;
  for (const record of records) {
    await validateEvidence(root, record.manifest, 1);
    assert.deepEqual(
      record.manifest.results.map(
        (result) => (result as { name: string }).name,
      ),
      [record.model],
      "Mislabeled worker evidence",
    );
    assert.deepEqual(
      record.manifest.scope,
      { kind: "focused", models: [record.model] },
      "Worker evidence scope differs",
    );
    assert.deepEqual(
      record.manifest.sourceInputs,
      first.sourceInputs,
      "Workers used different source inputs",
    );
    assert.equal(
      record.manifest.sourceRevision,
      first.sourceRevision,
      "Workers used different source revisions",
    );
    assert.deepEqual(
      record.manifest.tools,
      first.tools,
      "Workers used different tool identities",
    );
  }
  const manifest: VerificationManifest = {
    ...first,
    scope: { kind: "full-parallel", models: [...expectedModels], workers },
    settings: {
      ...first.settings,
      replayTraces: Math.max(
        ...records.map((record) => record.manifest.settings.replayTraces),
      ),
    },
    commands: records.flatMap((record) =>
      record.manifest.commands.map((command) => ({
        ...command,
        label: `${record.model}:${command.label}`,
        log: `${dirname(record.path)}/${command.log}`,
      })),
    ),
    results: records.flatMap((record) => record.manifest.results),
    complete: true,
  };
  await validateEvidence(root, manifest, expectedModels.length);
  return manifest;
}

export async function runParallelVerification(
  root: string,
  signal: AbortSignal,
) {
  const began = performance.now();
  assert(
    Number.isSafeInteger(execution.workers) &&
      execution.workers > 0 &&
      execution.workers <= 4,
    "Invalid verification worker count",
  );
  assert(
    Number.isSafeInteger(execution.workerTimeoutMs) &&
      execution.workerTimeoutMs > 0 &&
      execution.workerTimeoutMs <= execution.runTimeoutMs &&
      execution.runTimeoutMs <= 15 * 60_000 &&
      execution.workerGraceMs >= 10_000,
    "Invalid verification execution deadlines",
  );
  const workers = Math.min(execution.workers, availableParallelism());
  const output = resolve(
    root,
    ".agents/verification/runs",
    `${new Date().toISOString().replaceAll(":", "-")}-parallel-${randomUUID()}`,
  );
  await mkdir(output, { recursive: true });
  const revision = await runVerificationProcess(["git", "rev-parse", "HEAD"], {
    cwd: root,
    timeoutMs: 5000,
    signal,
  });
  const tracked = await runVerificationProcess(["git", "ls-files", "-z"], {
    cwd: root,
    timeoutMs: 5000,
    signal,
  });
  assert.equal(revision.code, 0);
  assert.equal(tracked.code, 0);
  const inputs = await fingerprintInputs(
    root,
    tracked.stdout.split("\0").filter(Boolean),
  );
  const progress: {
    model: string;
    complete: boolean;
    code?: number;
    elapsedMs?: number;
    manifest?: string;
  }[] = [];
  const initial = {
    schemaVersion: 1,
    scope: { kind: "full-parallel", models: [...verificationModels], workers },
    sourceRevision: revision.stdout.trim(),
    sourceInputs: inputs,
    complete: false,
    results: [],
    progress,
  };
  await writeFile(
    resolve(output, "manifest.json"),
    JSON.stringify(initial, null, 2),
  );
  console.info(
    `Quint: ${verificationModels.length} cases, ${workers} isolated workers`,
  );
  try {
    const records = await runVerificationPool(
      verificationModels,
      workers,
      signal,
      async (model, workerSignal) => {
        const status = { model, complete: false } as (typeof progress)[number];
        progress.push(status);
        let log = "";
        try {
          const result = await runVerificationProcess(
            [process.execPath, resolve(root, "quint/run.ts"), "--case", model],
            {
              cwd: root,
              timeoutMs: execution.workerTimeoutMs,
              graceMs: execution.workerGraceMs,
              signal: workerSignal,
              onOutput: (text) => {
                log = (log + text.replaceAll(root, "<checkout>")).slice(-65536);
              },
            },
          );
          status.code = result.code;
          status.elapsedMs = result.elapsedMs;
          assert.equal(
            result.code,
            0,
            `${model} worker failed; see ${model}-worker.log`,
          );
          const match = result.stdout.match(
            /Evidence: (\.agents\/verification\/runs\/[a-zA-Z0-9_.-]+)/,
          );
          assert(match, `${model} worker omitted its evidence manifest`);
          assert(
            ![".", ".."].includes(match[1]!.split("/").slice(-1)[0]!),
            "Worker evidence directory escapes its run",
          );
          const path = `${match[1]!}/manifest.json`;
          const manifest = JSON.parse(
            await readFile(resolve(root, path), "utf8"),
          ) as VerificationManifest;
          await validateEvidence(root, manifest, 1);
          assert.equal(
            manifest.sourceRevision,
            initial.sourceRevision,
            "Source revision changed during parallel verification",
          );
          assert.deepEqual(
            manifest.sourceInputs,
            inputs,
            "Source inputs changed during parallel verification",
          );
          status.complete = true;
          status.manifest = path;
          console.info(
            `${model}: passed in ${(result.elapsedMs / 1000).toFixed(1)}s`,
          );
          return {
            model,
            path,
            manifest,
            elapsedMs: result.elapsedMs,
            maxRSSBytes: result.maxRSSBytes,
          };
        } catch (error) {
          throw Object.assign(
            new Error(
              `${model}: ${error instanceof Error ? error.message : "Unknown worker failure"}`,
            ),
            { model },
          );
        } finally {
          await writeFile(resolve(output, `${model}-worker.log`), log);
        }
      },
    );
    const manifest = await aggregateVerificationEvidence(
      root,
      records,
      verificationModels,
      workers,
    );
    let cgroupPeakMemoryBytes: number | undefined;
    try {
      const value = Number(
        (await readFile("/sys/fs/cgroup/memory.peak", "utf8")).trim(),
      );
      if (Number.isSafeInteger(value) && value > 0)
        cgroupPeakMemoryBytes = value;
    } catch (error) {
      if (
        !["ENOENT", "EACCES"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
    }
    manifest.execution = {
      workers,
      elapsedMs: Math.round(performance.now() - began),
      cases: records.map(({ model, elapsedMs, maxRSSBytes }) => ({
        model,
        elapsedMs,
        maxRSSBytes,
      })),
      resources: {
        availableCPUs: availableParallelism(),
        totalMemoryBytes: totalmem(),
        cgroupPeakMemoryBytes,
      },
    };
    await writeFile(
      resolve(output, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    console.info(
      `All ${verificationModels.length} canonical cases passed in ${(manifest.execution.elapsedMs / 1000).toFixed(1)}s; evidence: ${relative(root, output)}`,
    );
  } catch (error) {
    const model =
      error instanceof Error && "model" in error
        ? String(error.model)
        : "parallel-gate";
    const label = `${model}-worker`;
    const failure = {
      model,
      label,
      reason: sanitizeDiagnostic(
        error instanceof Error
          ? error.message
          : "Unknown parallel verification failure",
        root,
      ),
    };
    await writeFile(
      resolve(output, "run.failure.json"),
      JSON.stringify(failure, null, 2),
    );
    await writeFile(
      resolve(output, "manifest.json"),
      JSON.stringify({ ...initial, failure, progress }, null, 2),
    );
    const diagnostics = await retainVerificationDiagnostics(
      output,
      root,
      label,
    );
    console.error(`Diagnostics: ${relative(root, diagnostics)}`);
    throw error;
  }
}
