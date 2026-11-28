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
import { retainGroupResources, runModelGroup } from "./ci-model-groups";
import {
  MODEL_GROUP_RESERVE_BYTES,
  modelPartMemoryBytes,
  verificationGroup,
  verificationGroups,
  MODEL_GROUP_MEMORY_MIB,
  MODEL_GROUP_WORKERS,
} from "./ci-model-plan";
import limits from "../tools/quint/model-resources.json";
import { readVerificationResources } from "./verification-resources";

function initialAdmission(indices: number[]) {
  let memory = 0;
  const admitted: number[] = [];
  for (const index of indices) {
    memory += modelPartMemoryBytes(index) / 2 ** 20;
    if (
      admitted.length === MODEL_GROUP_WORKERS ||
      memory > MODEL_GROUP_MEMORY_MIB
    )
      break;
    admitted.push(index);
  }
  return admitted;
}

test("the production group runs four parts concurrently and omits only validated cache hits", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "packed-model-pool-"));
  try {
    // Cached prefixes may remove heavy parts. Exercise a real four-part
    // admission after those hits, independently of the current runner packing.
    const candidates = verificationGroups.flatMap((indices, group) =>
      indices.flatMap((_, prefix) =>
        initialAdmission(indices.slice(prefix)).length === 4 && prefix > 0
          ? [{ group: group + 1, prefix }]
          : [],
      ),
    );
    expect(candidates.length).toBeGreaterThan(0);
    const { group, prefix } = candidates[0]!;
    const indices = verificationGroup(group);
    for (const index of indices.slice(0, prefix)) {
      await mkdir(
        resolve(root, `.agents/verification/runs/ci-shard-${index}-reused`),
        { recursive: true },
      );
      await writeFile(
        resolve(
          root,
          `.agents/verification/runs/ci-shard-${index}-reused/manifest.json`,
        ),
        "{}",
      );
    }
    const started: number[] = [];
    let active = 0;
    let peak = 0;
    const barrier = Promise.withResolvers<void>();
    await runModelGroup(
      root,
      group,
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
      indices.slice(prefix).sort((a, b) => a - b),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("actual group admission preserves queue order and memory bounds while refilling slots", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "packed-model-admission-"));
  try {
    for (let group = 1; group <= 4; group++) {
      const started: number[] = [];
      const active = new Set<number>();
      await runModelGroup(
        root,
        group,
        new AbortController().signal,
        async (index) => {
          started.push(index);
          active.add(index);
          try {
            expect(active.size).toBeLessThanOrEqual(4);
            expect(
              MODEL_GROUP_RESERVE_BYTES +
                [...active].reduce(
                  (sum, part) => sum + modelPartMemoryBytes(part),
                  0,
                ),
            ).toBeLessThanOrEqual(limits.memoryMaxBytes);
            // Yield with every admitted part active to exercise the real pool.
            await Promise.resolve();
          } finally {
            active.delete(index);
          }
        },
      );
      expect(started).toEqual(verificationGroup(group));
      expect(active.size).toBe(0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failure and cancellation stop later memory waves and drain started parts", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "packed-model-failure-"));
  try {
    for (const cancel of [false, true]) {
      const control = new AbortController();
      const first = initialAdmission(verificationGroup(4));
      const started: number[] = [];
      let active = 0;
      const failure = new Error("synthetic model failure");
      await expect(
        runModelGroup(root, 4, control.signal, async (index) => {
          started.push(index);
          active++;
          try {
            await Promise.resolve();
            if (index === first[0]) {
              if (cancel) control.abort(failure);
              else throw failure;
            }
          } finally {
            active--;
          }
        }),
      ).rejects.toThrow(failure.message);
      expect(started).toEqual(first);
      expect(active).toBe(0);
    }
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
