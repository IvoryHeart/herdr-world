import assert from "node:assert/strict";
import { balanceShards } from "./balance-shards";
import timings from "./verification-timings.json";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { verificationModels } from "../quint/models";
import { aggregateVerificationEvidence } from "./verification-parallel";
import {
  fingerprintInputs,
  type VerificationManifest,
} from "./verification-evidence";
import { runVerificationPool } from "./verification-pool";
import {
  runVerificationProcess,
  runVerificationMetadata,
} from "./verification-process";
import { publishVerificationEvidence } from "./verification-publication";
import execution from "../tools/quint/execution.json";
import limits from "../tools/quint/resources.json";

export const CI_VERIFICATION_SHARDS = 3;
export function verificationShard(index: number): string[] {
  assert(
    Number.isInteger(index) && index >= 1 && index <= CI_VERIFICATION_SHARDS,
    "Invalid verification shard",
  );
  return balanceShards(
    verificationModels,
    timings.seconds,
    CI_VERIFICATION_SHARDS,
  )[index - 1]!;
}

type Case = {
  model: string;
  path: string;
  elapsedMs: number;
  maxRSSBytes?: number;
};
export type Shard = {
  kind: "ci-shard";
  index: number;
  total: number;
  attempt: number;
  run: string;
  complete: boolean;
  records: Case[];
};
export function selectVerificationShards(
  shards: readonly Shard[],
  run: string,
  attempt: number,
): Shard[] {
  const latest = new Map<number, Shard>();
  for (const shard of shards) {
    verificationShard(shard.index);
    assert(
      shard.kind === "ci-shard" &&
        shard.total === CI_VERIFICATION_SHARDS &&
        shard.run === run &&
        Number.isInteger(shard.attempt) &&
        shard.attempt > 0 &&
        shard.attempt <= attempt,
      "Foreign or invalid shard evidence",
    );
    const prior = latest.get(shard.index);
    assert(prior?.attempt !== shard.attempt, "Duplicate shard evidence");
    if (!prior || prior.attempt < shard.attempt) latest.set(shard.index, shard);
  }
  assert.equal(
    latest.size,
    CI_VERIFICATION_SHARDS,
    "Missing verification shards",
  );
  return [...latest.values()]
    .sort((a, b) => a.index - b.index)
    .map((shard) => {
      assert(shard.complete, "Incomplete verification shard");
      assert.deepEqual(
        shard.records.map((record) => record.model),
        verificationShard(shard.index),
        "Omitted or duplicated shard models",
      );
      return shard;
    });
}

async function source(root: string, signal: AbortSignal) {
  const options = { cwd: root, signal };
  const revision = (
    await runVerificationMetadata(["git", "rev-parse", "HEAD"], options)
  ).stdout.trim();
  const paths = (
    await runVerificationMetadata(["git", "ls-files", "-z"], options)
  ).stdout
    .split("\0")
    .filter(Boolean);
  return { revision, inputs: await fingerprintInputs(root, paths) };
}

export async function runVerificationShard(
  root: string,
  index: number,
  signal: AbortSignal,
) {
  const models = verificationShard(index);
  const identity = await source(root, signal);
  const output = resolve(
    root,
    ".agents/verification/runs",
    `ci-shard-${index}-${randomUUID()}`,
  );
  await mkdir(output, { recursive: true });
  const shard: Shard = {
    kind: "ci-shard",
    index,
    total: CI_VERIFICATION_SHARDS,
    attempt: Number(process.env.GITHUB_RUN_ATTEMPT || 1),
    run: process.env.GITHUB_RUN_ID || "local",
    complete: false,
    records: [],
  };
  const manifest = resolve(output, "manifest.json");
  await writeFile(manifest, JSON.stringify(shard));
  try {
    shard.records = await runVerificationPool(
      models,
      execution.workers,
      signal,
      async (model, workerSignal) => {
        const result = await runVerificationProcess(
          [process.execPath, resolve(root, "quint/run.ts"), "--case", model],
          {
            cwd: root,
            signal: workerSignal,
            timeoutMs: execution.workerTimeoutMs,
            graceMs: execution.workerGraceMs,
          },
        );
        assert.equal(
          result.code,
          0,
          `${model} failed: ${result.stderr.slice(-4096)}`,
        );
        const path = result.stdout.match(
          /Evidence: (\.agents\/verification\/runs\/[a-zA-Z0-9_.-]+)/,
        )?.[1];
        assert(
          path && ![".", ".."].includes(path.split("/").at(-1)!),
          "Missing worker manifest",
        );
        const manifestPath = `${path}/manifest.json`;
        const evidence = JSON.parse(
          await readFile(resolve(root, manifestPath), "utf8"),
        ) as VerificationManifest;
        assert.equal(
          evidence.sourceRevision,
          identity.revision,
          "Worker revision changed",
        );
        assert.deepEqual(
          evidence.sourceInputs,
          identity.inputs,
          "Worker inputs changed",
        );
        console.info(
          `${model}: passed in ${(result.elapsedMs / 1000).toFixed(1)}s`,
        );
        return {
          model,
          path: manifestPath,
          elapsedMs: result.elapsedMs,
          maxRSSBytes: result.maxRSSBytes,
        };
      },
    );
    signal.throwIfAborted();
    shard.complete = true;
    await writeFile(manifest, JSON.stringify(shard));
    signal.throwIfAborted();
    console.info(`Shard evidence: ${relative(root, output)}`);
  } catch (error) {
    shard.complete = false;
    await writeFile(manifest, JSON.stringify(shard));
    throw error;
  }
}

export async function aggregateCIShards(
  root: string,
  signal: AbortSignal,
  publish?: (path: string, data: string) => Promise<void>,
) {
  const runs = resolve(root, ".agents/verification/runs");
  const artifacts: Array<{ path: string; shard: Shard }> = [];
  for (const name of await readdir(runs))
    if (name.startsWith("ci-shard-")) {
      const path = `.agents/verification/runs/${name}/manifest.json`;
      artifacts.push({
        path,
        shard: JSON.parse(await readFile(resolve(root, path), "utf8")) as Shard,
      });
    }
  const selected = selectVerificationShards(
    artifacts.map((entry) => entry.shard),
    process.env.GITHUB_RUN_ID || "local",
    Number(process.env.GITHUB_RUN_ATTEMPT || 1),
  );
  const resourceRecords = await Promise.all(
    (await readdir(resolve(root, ".agents/verification/resources"))).map(
      async (name) =>
        JSON.parse(
          await readFile(
            resolve(
              root,
              ".agents/verification/resources",
              name,
              "resources.json",
            ),
            "utf8",
          ),
        ),
    ),
  );
  const records = [];
  const accounting: unknown[] = [];
  const identity = await source(root, signal);
  for (const shard of selected) {
    const path = artifacts.find((entry) => entry.shard === shard)!.path;
    const resource = resourceRecords.filter(
      (record) => record.manifest === path,
    );
    assert.equal(
      resource.length,
      1,
      "Missing or duplicate shard resource accounting",
    );
    const evidence = resource[0]!;
    accounting.push({
      index: shard.index,
      attempt: shard.attempt,
      ...evidence,
    });
    assert.deepEqual(evidence.limits, limits, "Shard resource limits differ");
    assert(
      evidence.code === 0 &&
        !evidence.failure &&
        !evidence.cancelled &&
        evidence.oomKills === 0 &&
        evidence.peakBytes > 0 &&
        evidence.peakBytes <= limits.memoryMaxBytes &&
        evidence.memoryMaxBytes === limits.memoryMaxBytes,
      "Failed or missing shard resource accounting",
    );
    for (const record of shard.records) {
      assert(
        /^\.agents\/verification\/runs\/[a-zA-Z0-9_.-]+\/manifest\.json$/.test(
          record.path,
        ),
        "Invalid shard case path",
      );
      assert(
        ![".", ".."].includes(record.path.split("/").at(-2)!),
        "Case path escapes its run",
      );
      const manifest = JSON.parse(
        await readFile(resolve(root, record.path), "utf8"),
      ) as VerificationManifest;
      assert.equal(
        manifest.sourceRevision,
        identity.revision,
        "Shard revision differs from checkout",
      );
      assert.deepEqual(
        manifest.sourceInputs,
        identity.inputs,
        "Shard source inventory differs",
      );
      records.push({ ...record, manifest });
    }
  }
  const manifest = await aggregateVerificationEvidence(
    root,
    records,
    verificationModels,
    execution.workers * CI_VERIFICATION_SHARDS,
  );
  const output = resolve(runs, `ci-aggregate-${randomUUID()}/manifest.json`);
  await mkdir(resolve(output, ".."), { recursive: true });
  const distributed = { ...manifest, ciShards: accounting };
  try {
    await publishVerificationEvidence(output, distributed, signal, publish);
  } catch (error) {
    await writeFile(
      output,
      JSON.stringify({
        ...distributed,
        complete: false,
        failure: "CI aggregate was not accepted",
      }),
    );
    throw error;
  }
  console.info(
    `All ${verificationModels.length} canonical cases accounted for: ${relative(root, output)}`,
  );
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  assert(
    args.length === 1 &&
      (args[0] === "aggregate" || /^[123]\/3$/.test(args[0]!)),
    "Use ci-verification.ts i/3 | aggregate",
  );
  const cancellation = new AbortController();
  const stop = () => cancellation.abort(new Error("CI verification cancelled"));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const timer = setTimeout(stop, execution.runTimeoutMs);
  try {
    await (args[0] === "aggregate"
      ? aggregateCIShards
      : (root: string, signal: AbortSignal) =>
          runVerificationShard(root, Number(args[0]![0]), signal))(
      resolve(import.meta.dir, ".."),
      cancellation.signal,
    );
  } finally {
    clearTimeout(timer);
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
