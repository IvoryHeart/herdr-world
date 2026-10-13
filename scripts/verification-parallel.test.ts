import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { aggregateVerificationEvidence } from "./verification-parallel";
import {
  fingerprintInputs,
  type VerificationManifest,
} from "./verification-evidence";

test("canonical evidence requires every focused worker and one source/tool identity", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "synthetic-pool-evidence-"));
  try {
    await mkdir(resolve(root, "sources"));
    await writeFile(resolve(root, "sources/input.ts"), "synthetic");
    const sourceInputs = await fingerprintInputs(root, ["sources/input.ts"]);
    const make = (model: string): VerificationManifest => ({
      schemaVersion: 1,
      scope: { kind: "focused", models: [model] },
      sourceRevision: "a".repeat(40),
      sourceInputs,
      tools: {
        quint: "0.33.0",
        checker: "0.62.1",
        jarSha256: "b".repeat(64),
        node: "synthetic",
        java: "synthetic",
        bun: "synthetic",
      },
      settings: {
        backend: "tlc",
        seeds: [42, 73, 103],
        maxSteps: 25,
        samples: 500,
        replayTraces: 100,
      },
      commands: [
        {
          label: "synthetic-check",
          args: [],
          code: 0,
          elapsedMs: 1,
          log: "synthetic.log",
        },
      ],
      results: [{ name: model }],
      complete: true,
    });
    const records = ["synthetic-a", "synthetic-b"].map((model) => ({
      model,
      manifest: make(model),
      path: `.agents/verification/runs/${model}/manifest.json`,
      elapsedMs: 1,
    }));
    const expected = records.map((record) => record.model);
    const manifest = await aggregateVerificationEvidence(
      root,
      records,
      expected,
      2,
    );
    expect(manifest.complete).toBe(true);
    expect(manifest.results).toHaveLength(2);
    expect(manifest.scope).toEqual({
      kind: "full-parallel",
      models: expected,
      workers: 2,
    });
    await expect(
      aggregateVerificationEvidence(root, records.slice(0, 1), expected, 2),
    ).rejects.toThrow("Missing canonical model evidence");
    await expect(
      aggregateVerificationEvidence(
        root,
        [records[0]!, records[0]!],
        expected,
        2,
      ),
    ).rejects.toThrow("Duplicate or omitted canonical models");
    const wrong = structuredClone(records);
    wrong[1]!.manifest.tools.node = "other";
    await expect(
      aggregateVerificationEvidence(root, wrong, expected, 2),
    ).rejects.toThrow("different tool identities");
    wrong[1]!.manifest = make("wrong-model");
    await expect(
      aggregateVerificationEvidence(root, wrong, expected, 2),
    ).rejects.toThrow("Mislabeled worker evidence");
    wrong[1]!.manifest = make("synthetic-b");
    wrong[1]!.manifest.complete = false;
    await expect(
      aggregateVerificationEvidence(root, wrong, expected, 2),
    ).rejects.toThrow("incomplete");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
