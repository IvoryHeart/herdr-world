import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verificationModels } from "../quint/models";
import { lockedQuintVersion } from "./verification-setup";
import {
  fingerprintInputs,
  type VerificationManifest,
} from "./verification-evidence";
import { reusableLocalEvidence } from "./local-verification";

test("local model reuse requires the complete successful inventory, source bytes and current tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "local-model-reuse-"));
  try {
    await writeFile(join(root, "input.ts"), "synthetic");
    const tools = {
      bun: "synthetic-bun",
      node: "synthetic-node",
      java: "synthetic-java",
    };
    const manifest: VerificationManifest = {
      schemaVersion: 1,
      complete: true,
      sourceRevision: "a".repeat(40),
      sourceInputs: await fingerprintInputs(root, ["input.ts"]),
      scope: {
        kind: "full-parallel",
        models: [...verificationModels],
        workers: 4,
      },
      tools: {
        ...tools,
        quint: lockedQuintVersion,
        checker: "0.62.1",
        jarSha256: "b".repeat(64),
      },
      settings: {
        backend: "tlc",
        seeds: [42],
        maxSteps: 1,
        samples: 1,
        replayTraces: 1,
      },
      commands: [
        {
          label: "all-controls",
          args: [],
          code: 0,
          elapsedMs: 1,
          log: "synthetic.log",
        },
      ],
      results: verificationModels.map((name) => ({ name })),
    };
    await reusableLocalEvidence(root, manifest, ["input.ts"], tools);
    for (const mutate of [
      (value: VerificationManifest) => {
        value.complete = false;
      },
      (value: VerificationManifest) => {
        value.commands = [];
      },
      (value: VerificationManifest) => {
        value.commands[0]!.code = 1;
      },
      (value: VerificationManifest) => {
        value.results.pop();
      },
      (value: VerificationManifest) => {
        value.tools.java = "changed";
      },
      (value: VerificationManifest) => {
        value.scope!.kind = "focused";
      },
    ]) {
      const changed = structuredClone(manifest);
      mutate(changed);
      await expect(
        reusableLocalEvidence(root, changed, ["input.ts"], tools),
      ).rejects.toThrow();
    }
    await expect(
      reusableLocalEvidence(root, manifest, ["input.ts", "new.ts"], tools),
    ).rejects.toThrow("Source inventory changed");
    await writeFile(join(root, "input.ts"), "changed");
    await expect(
      reusableLocalEvidence(root, manifest, ["input.ts"], tools),
    ).rejects.toThrow("source changed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
