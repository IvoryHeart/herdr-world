import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  fingerprintInputs,
  validateEvidence,
  type VerificationManifest,
} from "./verification-evidence";

test("evidence rejects stale inputs, incomplete runs and escaping paths", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "synthetic-verification-"));
  try {
    await writeFile(
      resolve(root, "source.ts"),
      "export const synthetic = 1;\n",
    );
    const manifest: VerificationManifest = {
      schemaVersion: 1,
      sourceRevision: "a".repeat(40),
      sourceInputs: await fingerprintInputs(root, ["source.ts"]),
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
        seeds: [42],
        maxSteps: 25,
        samples: 100,
        replayTraces: 10,
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
      results: [{ name: "synthetic" }],
      complete: true,
    };
    await validateEvidence(root, manifest, 1);
    await expect(
      validateEvidence(root, { ...manifest, complete: false }, 1),
    ).rejects.toThrow("incomplete");
    await expect(validateEvidence(root, manifest, 2)).rejects.toThrow(
      "Missing verification cases",
    );
    await expect(fingerprintInputs(root, ["../outside.ts"])).rejects.toThrow(
      "escapes",
    );
    await writeFile(
      resolve(root, "source.ts"),
      "export const synthetic = 2;\n",
    );
    await expect(validateEvidence(root, manifest, 1)).rejects.toThrow(
      "source changed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
