import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { verificationModels } from "../quint/models";
import {
  aggregateCIShards,
  selectVerificationShards,
  verificationShard,
  type Shard,
} from "./ci-verification";
import {
  fingerprintInputs,
  type VerificationManifest,
} from "./verification-evidence";
import limits from "../tools/quint/resources.json";

const run = process.env.GITHUB_RUN_ID || "local";
const attempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1);
const headers = (): Shard[] =>
  [1, 2, 3].map((index) => ({
    kind: "ci-shard",
    index,
    total: 3,
    attempt,
    run,
    complete: true,
    records: verificationShard(index).map((model) => ({
      model,
      path: `.agents/verification/runs/case-${model}/manifest.json`,
      elapsedMs: 1,
    })),
  }));

test("three disjoint model groups cover the complete canonical inventory", () => {
  const all = [1, 2, 3].flatMap(verificationShard);
  expect([...all].sort()).toEqual([...verificationModels].sort());
  expect(new Set(all).size).toBe(all.length);
  for (const index of [0, 4, 1.5, NaN])
    expect(() => verificationShard(index)).toThrow();
});

test("the newest complete attempt per group is mandatory; omissions, duplicates and foreign runs fail", () => {
  expect(selectVerificationShards(headers(), run, attempt)).toHaveLength(3);
  const old = headers();
  old[0]!.attempt = attempt - 1;
  if (attempt > 1)
    expect(
      selectVerificationShards([...old, headers()[0]!], run, attempt),
    ).toHaveLength(3);
  for (const bad of [
    headers().slice(0, 2),
    [...headers(), headers()[0]!],
    headers().map((s) => ({ ...s, complete: false })),
    headers().map((s) => ({ ...s, run: "foreign" })),
    headers().map((s) => ({ ...s, attempt: attempt + 1 })),
    headers().map((s) => ({ ...s, records: s.records.slice(1) })),
  ]) {
    expect(() => selectVerificationShards(bad, run, attempt)).toThrow();
  }
  const duplicate = headers();
  duplicate[0]!.records[1] = duplicate[0]!.records[0]!;
  expect(() => selectVerificationShards(duplicate, run, attempt)).toThrow();
});

async function fixture(
  check: (
    root: string,
    manifests: Map<string, VerificationManifest>,
  ) => Promise<void>,
) {
  const root = await mkdtemp(resolve(tmpdir(), "ci-model-evidence-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.name", "Example");
    git("config", "user.email", "example@example.invalid");
    await writeFile(resolve(root, "input.ts"), "synthetic\n");
    git("add", ".");
    git("commit", "-qm", "source");
    const sourceInputs = await fingerprintInputs(root, ["input.ts"]);
    const manifests = new Map<string, VerificationManifest>();
    for (const shard of headers()) {
      const groupPath = `.agents/verification/runs/ci-shard-${shard.index}/manifest.json`;
      await mkdir(resolve(root, groupPath, ".."), { recursive: true });
      await writeFile(resolve(root, groupPath), JSON.stringify(shard));
      const resourcePath = resolve(
        root,
        `.agents/verification/resources/r${shard.index}/resources.json`,
      );
      await mkdir(resolve(resourcePath, ".."), { recursive: true });
      await writeFile(
        resourcePath,
        JSON.stringify({
          schemaVersion: 1,
          limits,
          code: 0,
          cancelled: false,
          oomKills: 0,
          peakBytes: 1024,
          memoryMaxBytes: limits.memoryMaxBytes,
          manifest: groupPath,
        }),
      );
      for (const record of shard.records) {
        const manifest: VerificationManifest = {
          schemaVersion: 1,
          scope: { kind: "focused", models: [record.model] },
          sourceRevision: git("rev-parse", "HEAD"),
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
            seeds: [42],
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
              log: "check.log",
            },
          ],
          results: [{ name: record.model }],
          complete: true,
        };
        await mkdir(resolve(root, record.path, ".."), { recursive: true });
        await writeFile(resolve(root, record.path), JSON.stringify(manifest));
        manifests.set(record.path, manifest);
      }
    }
    await check(root, manifests);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("distributed acceptance requires every model, current source/tools and every enforced resource record", async () => {
  await fixture(async (root, manifests) => {
    const signal = new AbortController().signal;
    await aggregateCIShards(root, signal);
    const aggregate = (
      await readdir(resolve(root, ".agents/verification/runs"))
    ).find((name) => name.startsWith("ci-aggregate-"))!;
    const complete = JSON.parse(
      await readFile(
        resolve(root, ".agents/verification/runs", aggregate, "manifest.json"),
        "utf8",
      ),
    );
    expect(complete.complete).toBe(true);
    expect(
      complete.results.map((r: { name: string }) => r.name).sort(),
    ).toEqual([...verificationModels].sort());
    expect(complete.ciShards).toHaveLength(3);
    const resourcePath = resolve(
      root,
      ".agents/verification/resources/r1/resources.json",
    );
    const resource = JSON.parse(await readFile(resourcePath, "utf8"));
    for (const fault of [
      { cancelled: true },
      { code: 1 },
      { oomKills: 1 },
      { peakBytes: 0 },
      { memoryMaxBytes: 1 },
      { limits: { ...limits, cpuQuotaPercent: 100 } },
    ]) {
      await writeFile(resourcePath, JSON.stringify({ ...resource, ...fault }));
      await expect(aggregateCIShards(root, signal)).rejects.toThrow();
    }
    await writeFile(resourcePath, JSON.stringify(resource));
    const [path, manifest] = [...manifests][0]!;
    for (const wrong of [
      { ...manifest, sourceRevision: "c".repeat(40) },
      { ...manifest, sourceInputs: [] },
      { ...manifest, tools: { ...manifest.tools, node: "other" } },
      { ...manifest, complete: false },
    ]) {
      await writeFile(resolve(root, path), JSON.stringify(wrong));
      await expect(aggregateCIShards(root, signal)).rejects.toThrow();
    }
    await writeFile(resolve(root, path), JSON.stringify(manifest));
    await rm(resolve(root, path));
    await expect(aggregateCIShards(root, signal)).rejects.toThrow();
  });
});

test("late cancellation invalidates distributed publication after mandatory accounting", async () => {
  await fixture(async (root) => {
    const cancellation = new AbortController();
    const reason = new Error("synthetic publication cancellation");
    let output = "";
    await expect(
      aggregateCIShards(root, cancellation.signal, async (path, data) => {
        output = path;
        await writeFile(path, data);
        cancellation.abort(reason);
      }),
    ).rejects.toBe(reason);
    expect(JSON.parse(await readFile(output, "utf8")).complete).toBe(false);
  });
});
