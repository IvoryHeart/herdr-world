import { execFileSync } from "node:child_process";
import { verificationModels } from "../quint/models";
import { expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  readFile,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  aggregateVerificationEvidence,
  runParallelVerification,
} from "./verification-parallel";
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
    for (const tool of ["node", "java"] as const) {
      const mismatched = structuredClone(records);
      mismatched[1]!.manifest.tools[tool] = "other";
      await expect(
        aggregateVerificationEvidence(root, mismatched, expected, 2),
      ).rejects.toThrow("different tool identities");
    }
    const wrong = structuredClone(records);
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

test.serial.each(["resources", "publication"] as const)(
  "canonical cancellation during %s invalidates completed worker evidence",
  async (phase) => {
    const root = await mkdtemp(
      resolve(tmpdir(), "synthetic-canonical-finalization-"),
    );
    try {
      await writeFile(resolve(root, "input.ts"), "synthetic\n");
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
      git("init", "-q");
      git("add", "input.ts");
      git(
        "-c",
        "user.name=Example",
        "-c",
        "user.email=example@example.invalid",
        "commit",
        "-qm",
        "synthetic",
      );
      const revision = git("rev-parse", "HEAD");
      const sourceInputs = await fingerprintInputs(root, ["input.ts"]);
      const cancellation = new AbortController();
      const reason = new Error("Synthetic canonical finalization cancellation");
      const manifest = (model: string): VerificationManifest => ({
        schemaVersion: 1,
        scope: { kind: "focused", models: [model] },
        sourceRevision: revision,
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
            label: "synthetic",
            args: [],
            code: 0,
            elapsedMs: 1,
            log: "synthetic.log",
          },
        ],
        results: [{ name: model }],
        complete: true,
      });
      await expect(
        runParallelVerification(root, cancellation.signal, {
          executeCase: async (model) => ({
            model,
            manifest: manifest(model),
            path: `.agents/verification/runs/synthetic-${model}/manifest.json`,
            elapsedMs: 1,
          }),
          readPeak: async () => {
            if (phase === "resources") cancellation.abort(reason);
            return "1\n";
          },
          publish: async (path, data) => {
            await writeFile(path, data);
            if (phase === "publication") cancellation.abort(reason);
          },
        }),
      ).rejects.toBe(reason);
      const runs = resolve(root, ".agents/verification/runs");
      const folder = (await readdir(runs)).find((name) =>
        name.includes("parallel-"),
      )!;
      const evidence = JSON.parse(
        await readFile(resolve(runs, folder, "manifest.json"), "utf8"),
      );
      expect(evidence.complete).toBe(false);
      expect(evidence.progress).toHaveLength(verificationModels.length);
      expect(
        evidence.progress.every(
          (entry: { complete: boolean }) => entry.complete,
        ),
      ).toBe(true);
      expect(evidence.failure.reason).toContain(reason.message);
      const diagnostics = await readdir(
        resolve(root, ".agents/verification/diagnostics"),
      );
      expect(diagnostics).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
