import assert from "node:assert/strict";
import { dirname, relative, resolve } from "node:path";
import { verificationModels } from "../quint/models";
import {
  modelPartScope,
  verificationJob,
  verificationJobs,
} from "./ci-model-plan";
import {
  validateEvidence,
  type VerificationManifest,
} from "./verification-evidence";

type Record = {
  model: string;
  path: string;
  elapsedMs: number;
  manifest: VerificationManifest;
  index: number;
};

/** Only the complete, disjoint job inventory may become canonical evidence. */
export async function combineModelParts(root: string, records: Record[]) {
  assert.equal(records.length, verificationJobs.length, "Missing model parts");
  assert.equal(
    new Set(records.map((record) => record.index)).size,
    records.length,
    "Duplicate model parts",
  );
  for (const record of records) {
    assert.equal(
      record.model,
      verificationJob(record.index).model,
      "Wrong part model",
    );
    assert.deepEqual(
      record.manifest.scope,
      modelPartScope(record.index),
      "Wrong model part scope",
    );
    await validateEvidence(root, record.manifest, 1);
  }
  return verificationModels.map((model) => {
    const parts = records
      .filter((record) => record.model === model)
      .sort((a, b) => a.index - b.index);
    assert.equal(
      parts.length,
      verificationJobs.filter((job) => job.model === model).length,
      "Missing model part",
    );
    const first = parts[0]!;
    for (const part of parts) {
      assert.deepEqual(
        part.manifest.tools,
        first.manifest.tools,
        "Model part tools differ",
      );
      assert.deepEqual(
        part.manifest.sourceInputs,
        first.manifest.sourceInputs,
        "Model part inputs differ",
      );
      assert.equal(
        part.manifest.sourceRevision,
        first.manifest.sourceRevision,
        "Model part revision differs",
      );
      assert.deepEqual(
        part.manifest.results.map(
          (result) => (result as { name: string }).name,
        ),
        [model],
        "Wrong part result",
      );
    }
    if (parts.length === 1) return first;
    const results = parts.map(
      (part) => part.manifest.results[0] as { controls: unknown[] },
    );
    assert(
      results.every((result) => Array.isArray(result.controls)),
      "Missing partial controls",
    );
    return {
      ...first,
      elapsedMs: Math.max(...parts.map((part) => part.elapsedMs)),
      manifest: {
        ...first.manifest,
        scope: { kind: "focused" as const, models: [model] },
        commands: parts.flatMap((part) =>
          part.manifest.commands.map((command) => ({
            ...command,
            label: `${verificationJob(part.index).part}:${command.label}`,
            log: relative(
              resolve(root, dirname(first.path)),
              resolve(root, dirname(part.path), command.log),
            ),
          })),
        ),
        results: [
          {
            ...results[0],
            controls: results.flatMap((result) => result.controls),
          },
        ],
      },
    };
  });
}
