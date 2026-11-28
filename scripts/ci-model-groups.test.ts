import { expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  retainGroupResources,
  runModelGroup,
  runsDiagnosticControl,
} from "./ci-model-groups";
import {
  DIAGNOSTIC_CONTROL_JOB,
  diagnosticControlGroup,
  verificationGroup,
  verificationJob,
} from "./ci-model-plan";
import { readVerificationResources } from "./verification-resources";

test("the production group runs four parts concurrently and omits only validated cache hits", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "packed-model-pool-"));
  try {
    const indices = verificationGroup(1);
    await mkdir(
      resolve(root, `.agents/verification/runs/ci-shard-${indices[0]}-reused`),
      { recursive: true },
    );
    await writeFile(
      resolve(
        root,
        `.agents/verification/runs/ci-shard-${indices[0]}-reused/manifest.json`,
      ),
      "{}",
    );
    const started: number[] = [];
    let active = 0;
    let peak = 0;
    const barrier = Promise.withResolvers<void>();
    await runModelGroup(
      root,
      1,
      new AbortController().signal,
      async (index) => {
        started.push(index);
        peak = Math.max(peak, ++active);
        if (active === 4) barrier.resolve();
        await barrier.promise;
        active--;
      },
    );
    expect(peak).toBe(4);
    expect(active).toBe(0);
    expect(started.sort((a, b) => a - b)).toEqual(
      indices.slice(1).sort((a, b) => a - b),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("every packed part retains the actual shared resource limit and failure receipt", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "packed-model-resources-"));
  try {
    const directory = resolve(root, ".agents/verification/resources/original");
    await mkdir(directory, { recursive: true });
    const runs = resolve(root, ".agents/verification/runs");
    for (const name of ["ci-shard-1-example", "ci-shard-2-example"])
      await mkdir(resolve(runs, name), { recursive: true });
    const receipt = {
      manifest: ".agents/verification/runs/ci-shard-1-example/manifest.json",
      code: 1,
      failure: "synthetic failure",
      cancelled: false,
      oomKills: 1,
      peakBytes: 4096,
      memoryMaxBytes: 4096,
      limits: { cpuQuotaPercent: 400 },
    };
    await writeFile(
      resolve(directory, "resources.json"),
      JSON.stringify(receipt),
    );
    await retainGroupResources(root, directory, [1, 2]);
    const records = await readVerificationResources(root);
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.manifest).sort()).toEqual(
      [1, 2].map(
        (i) => `.agents/verification/runs/ci-shard-${i}-example/manifest.json`,
      ),
    );
    for (const record of records)
      expect({ ...record, manifest: receipt.manifest }).toEqual(receipt);
    expect(
      JSON.parse(await readFile(resolve(directory, "resources.json"), "utf8")),
    ).toEqual(receipt);
    await expect(retainGroupResources(root, directory, [3])).rejects.toThrow(
      "Missing or duplicate group part",
    );
    await mkdir(resolve(runs, "ci-shard-2-duplicate"));
    await expect(retainGroupResources(root, directory, [2])).rejects.toThrow(
      "Missing or duplicate group part",
    );
    expect(await readdir(runs)).toHaveLength(3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the failing-candidate control runs once per run, only where browser-refresh misses", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "diagnostic-control-"));
  try {
    const owner = diagnosticControlGroup();
    expect(verificationGroup(owner)).toContain(DIAGNOSTIC_CONTROL_JOB);
    expect(verificationJob(DIAGNOSTIC_CONTROL_JOB).model).toBe(
      "browser-refresh",
    );
    // A full run reuses nothing: exactly one group exercises the control.
    const groups = [1, 2, 3, 4].filter((group) =>
      runsDiagnosticControl(root, group),
    );
    expect(groups).toEqual([owner]);
    // Reused browser-refresh evidence (unchanged tooling) skips it.
    const reused = `.agents/verification/runs/ci-shard-${DIAGNOSTIC_CONTROL_JOB}-reused`;
    await mkdir(resolve(root, reused), { recursive: true });
    await writeFile(resolve(root, reused, "manifest.json"), "{}");
    expect(runsDiagnosticControl(root, owner)).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
