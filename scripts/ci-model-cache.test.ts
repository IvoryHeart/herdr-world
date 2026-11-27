import { expect, test } from "bun:test";
import { validateModelBundle, type ModelBundle } from "./ci-model-cache";
import { verificationShard } from "./ci-verification";
import type { VerificationManifest } from "./verification-evidence";
import limits from "../tools/quint/resources.json";
import checker from "../tools/quint/checker.json";
import tooling from "../tools/quint/package.json";

const input = {
  path: "quint/model.qnt",
  sha256: "a".repeat(64),
  kind: "file" as const,
};
const runtime = {
  node: "synthetic-node",
  java: "synthetic-java",
  bun: "synthetic-bun",
};
const key = {
  hash: "b".repeat(64),
  inputs: [input],
  runtime,
  toolIdentity: {
    runtime,
    java: runtime.java,
    platform: process.platform,
    arch: process.arch,
  },
};
function fixture(): ModelBundle {
  const records = verificationShard(1).map((model) => ({
    model,
    path: `.agents/verification/runs/case-${model}/manifest.json`,
    elapsedMs: 1,
  }));
  return {
    schema: 1,
    ...key,
    shard: {
      kind: "ci-shard",
      index: 1,
      total: 3,
      attempt: 1,
      run: "original-run",
      complete: true,
      records,
    },
    resource: {
      limits,
      code: 0,
      cancelled: false,
      oomKills: 0,
      peakBytes: 1024,
      memoryMaxBytes: limits.memoryMaxBytes,
    },
    cases: records.map((record) => ({
      path: record.path,
      manifest: {
        schemaVersion: 1,
        tools: {
          ...runtime,
          quint: tooling.dependencies["@informalsystems/quint"],
          checker: checker.version,
          jarSha256: checker.jarSha256,
        },
        sourceRevision: "c".repeat(40),
        sourceInputs: [input],
        scope: { kind: "focused", models: [record.model] },
        results: [{ name: record.model }],
        complete: true,
        commands: [{ code: 0 }],
      } as VerificationManifest,
    })),
  };
}

test("passing group evidence validates for identical content across revisions and branches", () => {
  const bundle = fixture();
  expect(() => validateModelBundle(bundle, 1, key)).not.toThrow();
  bundle.shard.run = "another-branch-run";
  expect(() => validateModelBundle(bundle, 1, key)).not.toThrow();
  // Expected-negative control exits are legitimate; complete bounded acceptance
  // is the proof, rather than checking every subprocess exited successfully.
  bundle.cases[0]!.manifest.commands[0]!.code = 1;
  expect(() => validateModelBundle(bundle, 1, key)).not.toThrow();
});

test("invalidated, incomplete, cancelled, foreign and unbounded evidence cannot be reused", () => {
  const corruptions: Array<(bundle: ModelBundle) => void> = [
    (b) => {
      b.hash = "d".repeat(64);
    },
    (b) => {
      b.toolIdentity.runtime.node = "foreign";
    },
    (b) => {
      b.cases[0]!.manifest.tools.java = "foreign";
    },
    (b) => {
      b.inputs = [];
    },
    (b) => {
      b.shard.complete = false;
    },
    (b) => {
      b.shard.records = [];
    },
    (b) => {
      b.shard.reuse = { hash: key.hash, origin: "foreign" };
    },
    (b) => {
      b.resource.cancelled = true;
    },
    (b) => {
      b.resource.oomKills = 1;
    },
    (b) => {
      b.resource.peakBytes = limits.memoryMaxBytes + 1;
    },
    (b) => {
      b.resource.limits = {};
    },
    (b) => {
      b.cases = [];
    },
    (b) => {
      b.cases[0]!.path = "../outside";
    },
    (b) => {
      b.cases[0]!.manifest.complete = false;
    },
    (b) => {
      b.cases[0]!.manifest.commands = [];
    },
    (b) => {
      b.cases[0]!.manifest.sourceInputs = [];
    },
    (b) => {
      b.cases[0]!.manifest.results = [{ name: "foreign" }];
    },
  ];
  for (const corrupt of corruptions) {
    const bundle = structuredClone(fixture());
    corrupt(bundle);
    expect(() => validateModelBundle(bundle, 1, key)).toThrow();
  }
  expect(() => validateModelBundle(fixture(), 2, key)).toThrow();
});
