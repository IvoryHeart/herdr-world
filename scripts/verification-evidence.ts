import assert from "node:assert/strict";
import { lstat, readFile, readlink } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { sha256 } from "./verification-setup";

export type InputFingerprint = {
  path: string;
  sha256: string;
  kind: "file" | "symlink";
};
export type VerificationManifest = {
  schemaVersion: 1;
  scope?: {
    kind: "focused" | "full-sequential" | "full-parallel";
    models: string[];
    workers?: number;
  };
  execution?: {
    workers: number;
    elapsedMs: number;
    cases: { model: string; elapsedMs: number; maxRSSBytes?: number }[];
    resources: {
      availableCPUs: number;
      totalMemoryBytes: number;
      cgroupPeakMemoryBytes?: number;
    };
  };
  sourceRevision: string;
  sourceInputs: InputFingerprint[];
  tools: {
    quint: string;
    checker: string;
    jarSha256: string;
    node: string;
    java: string;
    bun: string;
  };
  settings: {
    backend: string;
    seeds: number[];
    maxSteps: number;
    samples: number;
    replayTraces: number;
  };
  commands: {
    label: string;
    args: string[];
    code: number;
    elapsedMs: number;
    log: string;
  }[];
  results: unknown[];
  complete: boolean;
};

function safePath(path: string) {
  assert(
    path.length > 0 && !isAbsolute(path) && !path.split(/[\\/]/).includes(".."),
    "Evidence input path escapes the checkout",
  );
}

export async function fingerprintInputs(
  root: string,
  paths: readonly string[],
) {
  const unique = [...new Set(paths)].sort();
  return Promise.all(
    unique.map(async (path) => {
      safePath(path);
      const entry = await lstat(resolve(root, path));
      assert(
        entry.isFile() || entry.isSymbolicLink(),
        "Evidence inputs must be repository files or links",
      );
      // Record a tracked link itself, never follow it into user-specific data.
      const kind = entry.isSymbolicLink()
        ? ("symlink" as const)
        : ("file" as const);
      const bytes =
        kind === "symlink"
          ? await readlink(resolve(root, path))
          : await readFile(resolve(root, path));
      return { path, sha256: sha256(bytes), kind };
    }),
  );
}

export async function validateEvidence(
  root: string,
  manifest: VerificationManifest,
  expectedCases: number,
) {
  assert(
    manifest.schemaVersion === 1 && manifest.complete,
    "Verification evidence is incomplete",
  );
  assert(
    /^[0-9a-f]{40}$/.test(manifest.sourceRevision),
    "Missing source revision",
  );
  assert(
    manifest.results.length === expectedCases && expectedCases > 0,
    "Missing verification cases",
  );
  assert(
    manifest.commands.length > 0 && manifest.sourceInputs.length > 0,
    "Missing commands or inputs",
  );
  assert(
    new Set(manifest.sourceInputs.map((input) => input.path)).size ===
      manifest.sourceInputs.length,
    "Duplicate evidence inputs",
  );
  const current = await fingerprintInputs(
    root,
    manifest.sourceInputs.map((input) => input.path),
  );
  assert.deepEqual(
    current,
    [...manifest.sourceInputs].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    ),
    "Verification source changed since execution",
  );
  assert(
    manifest.tools.quint === "0.33.0" && manifest.tools.checker === "0.62.1",
    "Unpinned verifier",
  );
  assert(
    /^[0-9a-f]{64}$/.test(manifest.tools.jarSha256),
    "Missing checker digest",
  );
  assert(
    manifest.settings.seeds.length > 0 &&
      manifest.settings.maxSteps > 0 &&
      manifest.settings.samples > 0 &&
      manifest.settings.replayTraces > 0,
    "Invalid verification settings",
  );
}
