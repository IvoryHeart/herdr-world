import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, appendFileSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { modelCache, modelCacheKey } from "./ci-model-cache";
import { MODEL_GROUP_WORKERS, verificationGroup } from "./ci-model-plan";
import { runVerificationShard } from "./ci-verification";
import { runVerificationPool } from "./verification-pool";
import {
  runConstrainedVerification,
  runResourceRegressions,
  verifyResourceCancellation,
} from "./verification-resources";
import limits from "../tools/quint/model-resources.json";

function misses(root: string, group: number) {
  return verificationGroup(group).filter(
    (index) =>
      !existsSync(
        resolve(
          root,
          `.agents/verification/runs/ci-shard-${index}-reused/manifest.json`,
        ),
      ),
  );
}

/** @internal */
export function runModelGroup(
  root: string,
  group: number,
  signal: AbortSignal,
  execute = (index: number, workerSignal: AbortSignal) =>
    runVerificationShard(root, index, workerSignal),
) {
  return runVerificationPool(
    misses(root, group),
    MODEL_GROUP_WORKERS,
    signal,
    execute,
  );
}

/** One cgroup receipt accounts for every part run together, including failures. @internal */
export async function retainGroupResources(
  root: string,
  directory: string,
  indices: number[],
) {
  const receipt = JSON.parse(
    await readFile(resolve(directory, "resources.json"), "utf8"),
  );
  const runs = await readdir(resolve(root, ".agents/verification/runs"));
  for (const index of indices) {
    const parts = runs.filter(
      (name) =>
        name.startsWith(`ci-shard-${index}-`) && !name.endsWith("-reused"),
    );
    assert.equal(parts.length, 1, "Missing or duplicate group part");
    const manifest = `.agents/verification/runs/${parts[0]}/manifest.json`;
    if (manifest === receipt.manifest) continue;
    const output = resolve(
      root,
      ".agents/verification/resources",
      `group-${randomUUID()}`,
    );
    await mkdir(output, { recursive: true });
    await writeFile(
      resolve(output, "resources.json"),
      JSON.stringify({ ...receipt, manifest }),
    );
  }
}

if (import.meta.main) {
  const [action, rawGroup] = process.argv.slice(2);
  const group = Number(rawGroup);
  const indices = verificationGroup(group);
  const root = resolve(import.meta.dir, "..");
  if (action === "key") {
    const keys = await Promise.all(
      indices.map((index) => modelCacheKey(root, index)),
    );
    const hash = createHash("sha256")
      .update(JSON.stringify(keys.map((key) => key.hash)))
      .digest("hex");
    appendFileSync(process.env.GITHUB_OUTPUT!, `hash=${hash}\n`);
  } else if (action === "restore") {
    for (const index of indices) await modelCache(root, "restore", index);
    appendFileSync(
      process.env.GITHUB_OUTPUT!,
      `reused=${misses(root, group).length === 0}\n`,
    );
  } else if (action === "save") {
    for (const index of misses(root, group))
      await modelCache(root, "save", index);
  } else {
    assert(
      action === "run" || action === "execute",
      "Unknown model group action",
    );
    const cancellation = new AbortController();
    const stop = () => cancellation.abort(new Error("Model group cancelled"));
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    try {
      if (action === "execute") {
        await runModelGroup(root, group, cancellation.signal);
      } else {
        const regressions = await runResourceRegressions(
          root,
          true,
          cancellation.signal,
        );
        assert.equal(
          regressions.code,
          0,
          `Resource controls failed: ${regressions.stderr}`,
        );
        await verifyResourceCancellation(root, true);
        const result = await runConstrainedVerification(
          root,
          true,
          [
            process.execPath,
            "scripts/ci-model-groups.ts",
            "execute",
            String(group),
          ],
          limits,
          cancellation.signal,
        );
        if (result.failure) throw result.failure;
        assert.equal(result.code, 0, "Constrained model group failed");
        assert.equal(
          result.evidence.oomKills,
          0,
          "Model group exceeded memory limit",
        );
        await retainGroupResources(root, result.directory, misses(root, group));
        cancellation.signal.throwIfAborted();
      }
    } finally {
      process.off("SIGTERM", stop);
      process.off("SIGINT", stop);
    }
  }
}
