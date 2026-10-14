import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { publishVerificationEvidence } from "./verification-publication";
import type { VerificationManifest } from "./verification-evidence";

test("shared canonical/focused publication waits for the write then rejects cancellation", async () => {
  const root = await mkdtemp(
    resolve(tmpdir(), "synthetic-evidence-publication-"),
  );
  try {
    const cancellation = new AbortController();
    const reason = new Error(
      "Synthetic cancellation while publication is pending",
    );
    let finished = false;
    // The callers validate the full manifest; this test isolates publication's acceptance boundary.
    const manifest = { complete: true } as VerificationManifest;
    await expect(
      publishVerificationEvidence(
        resolve(root, "manifest.json"),
        manifest,
        cancellation.signal,
        async (path, data) => {
          await writeFile(path, data);
          cancellation.abort(reason);
          await Promise.resolve();
          finished = true;
        },
      ),
    ).rejects.toBe(reason);
    expect(finished).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
