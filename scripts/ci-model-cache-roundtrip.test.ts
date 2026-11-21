import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { lockedQuintVersion } from "./verification-setup";
import { modelCache, modelCacheKey } from "./ci-model-cache";
import {
  aggregateCIShards,
  verificationShard,
  type Shard,
} from "./ci-verification";
import {
  fingerprintInputs,
  type VerificationManifest,
} from "./verification-evidence";
import limits from "../tools/quint/resources.json";
import checker from "../tools/quint/checker.json";

test("cached groups survive unrelated revisions and aggregate with origin receipts; substituted artifacts fail", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "model-cache-roundtrip-"));
  const previousOutput = process.env.GITHUB_OUTPUT;
  const previousRun = process.env.GITHUB_RUN_ID;
  const previousAttempt = process.env.GITHUB_RUN_ATTEMPT;
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const write = async (path: string, value: unknown) => {
    await mkdir(resolve(root, path, ".."), { recursive: true });
    await writeFile(
      resolve(root, path),
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };
  try {
    process.env.GITHUB_OUTPUT = resolve(root, "outputs");
    process.env.GITHUB_RUN_ID = "current-run";
    process.env.GITHUB_RUN_ATTEMPT = "1";
    git("init", "-q");
    git("config", "user.name", "Example");
    git("config", "user.email", "example@example.invalid");
    await write(".gitignore", ".agents/\noutputs\n");
    await write("package.json", "{}");
    await write("quint/model.qnt", "model");
    await write("web/unrelated.ts", "before");
    git("add", ".");
    git("commit", "-qm", "source");
    const sourceInputs = await fingerprintInputs(root, [
      ".gitignore",
      "package.json",
      "quint/model.qnt",
      "web/unrelated.ts",
    ]);
    // A real constrained run leaves a cancellation-control readiness directory
    // alongside the supervisor's resource reports. It is not shard evidence.
    await write(
      ".agents/verification/resources/cancellation-control/ready.json",
      [123],
    );
    const sourceRevision = git("rev-parse", "HEAD");
    for (const index of [1, 2, 3]) {
      const key = await modelCacheKey(root, index);
      const path = `.agents/verification/runs/ci-shard-${index}-original/manifest.json`;
      const records: Shard["records"] = [];
      for (const model of verificationShard(index)) {
        const casePath = `.agents/verification/runs/case-${model}/manifest.json`;
        const manifest: VerificationManifest = {
          schemaVersion: 1,
          scope: { kind: "focused", models: [model] },
          sourceRevision,
          sourceInputs,
          tools: {
            ...key.runtime,
            quint: lockedQuintVersion,
            checker: checker.version,
            jarSha256: checker.jarSha256,
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
        };
        await write(casePath, manifest);
        records.push({ model, path: casePath, elapsedMs: 1 });
      }
      await write(path, {
        kind: "ci-shard",
        index,
        total: 3,
        attempt: 1,
        run: "old-run",
        complete: true,
        records,
      });
      await write(
        `.agents/verification/resources/original-${index}/resources.json`,
        {
          limits,
          code: 0,
          cancelled: false,
          oomKills: 0,
          peakBytes: 1024,
          memoryMaxBytes: limits.memoryMaxBytes,
          manifest: path,
        },
      );
      if (index === 1) {
        const resourcePath = `.agents/verification/resources/original-${index}/resources.json`;
        const resource = await readFile(resolve(root, resourcePath), "utf8");
        await rm(resolve(root, resourcePath));
        await expect(modelCache(root, "save", index)).rejects.toThrow(
          "Missing or duplicate fresh resource proof",
        );
        await write(resourcePath, resource);
        await write(
          ".agents/verification/resources/duplicate/resources.json",
          resource,
        );
        await expect(modelCache(root, "save", index)).rejects.toThrow(
          "Missing or duplicate fresh resource proof",
        );
        await rm(resolve(root, ".agents/verification/resources/duplicate"), {
          recursive: true,
        });
        await write(resourcePath, "malformed");
        await expect(modelCache(root, "save", index)).rejects.toThrow();
        await write(resourcePath, resource);
      }
      await modelCache(root, "save", index);
    }
    await rm(resolve(root, ".agents/verification"), { recursive: true });
    await write("web/unrelated.ts", "after");
    git("add", ".");
    git("commit", "-qm", "unrelated revision");
    for (const index of [1, 2, 3]) await modelCache(root, "restore", index);
    await aggregateCIShards(
      root,
      new AbortController().signal,
      async (_path, data) => {
        const aggregate = JSON.parse(data);
        expect(aggregate.sourceRevision).toBe(git("rev-parse", "HEAD"));
        expect(
          aggregate.ciShards.map((group: { mode: string }) => group.mode),
        ).toEqual(["reused", "reused", "reused"]);
        expect(
          aggregate.ciShards.every(
            (group: { hash: string; originRevision: string }) =>
              /^[0-9a-f]{64}$/.test(group.hash) &&
              group.originRevision === sourceRevision,
          ),
        ).toBe(true);
      },
    );
    const casePath = `.agents/verification/runs/case-${verificationShard(1)[0]}/manifest.json`;
    const original = JSON.parse(
      await readFile(resolve(root, casePath), "utf8"),
    );
    await write(casePath, {
      ...original,
      settings: { ...original.settings, samples: 1 },
    });
    await expect(
      aggregateCIShards(root, new AbortController().signal),
    ).rejects.toThrow("artifact differs from origin");
    await rm(resolve(root, ".agents/verification"), { recursive: true });
    await write("quint/model.qnt", "changed model");
    await modelCache(root, "restore", 1);
    expect(await readFile(process.env.GITHUB_OUTPUT, "utf8")).toContain(
      "reused=false",
    );
  } finally {
    for (const [name, value] of [
      ["GITHUB_OUTPUT", previousOutput],
      ["GITHUB_RUN_ID", previousRun],
      ["GITHUB_RUN_ATTEMPT", previousAttempt],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
