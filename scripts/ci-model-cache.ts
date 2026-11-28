import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readVerificationResources } from "./verification-resources";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  modelInputs,
  scanModelInputs,
  type ModelInputScan,
} from "./ci-model-inputs";
import { fingerprintInputs } from "./verification-evidence";
import {
  verificationJobs,
  verificationJob,
  modelPartScope,
} from "./ci-model-plan";
import { verificationShard, type Shard } from "./ci-verification";
import type {
  InputFingerprint,
  VerificationManifest,
} from "./verification-evidence";
import limits from "../tools/quint/model-resources.json";
import checker from "../tools/quint/checker.json";
import tooling from "../tools/quint/package.json";

type ModelToolIdentity = {
  runtime: { node: string; java: string; bun: string };
  java: string;
  platform: string;
  arch: string;
};

export type ModelBundle = {
  schema: 1;
  hash: string;
  inputs: InputFingerprint[];
  toolIdentity: ModelToolIdentity;
  shard: Shard;
  resource: Record<string, unknown>;
  cases: { path: string; manifest: VerificationManifest }[];
};

type ModelKey = {
  hash: string;
  inputs: InputFingerprint[];
  runtime: ModelToolIdentity["runtime"];
  toolIdentity: ModelToolIdentity;
};
export function validateModelBundle(
  bundle: ModelBundle,
  index: number,
  key: ModelKey,
) {
  assert.equal(bundle.schema, 1, "Unknown cache schema");
  assert.equal(bundle.hash, key.hash, "Model cache key changed");
  assert.deepEqual(bundle.inputs, key.inputs, "Model cache inputs changed");
  assert.deepEqual(
    bundle.toolIdentity,
    key.toolIdentity,
    "Model cache tools changed",
  );
  assert(
    bundle.shard.complete &&
      bundle.shard.index === index &&
      bundle.shard.total === verificationJobs.length &&
      !bundle.shard.reuse,
    "Incomplete or recursively reused group",
  );
  assert.deepEqual(
    bundle.shard.records.map((record) => record.model),
    verificationShard(index),
    "Wrong cached model inventory",
  );
  assert.equal(
    bundle.cases.length,
    bundle.shard.records.length,
    "Missing cached cases",
  );
  assert.deepEqual(
    bundle.resource.limits,
    limits,
    "Cached resource limits changed",
  );
  assert(
    bundle.resource.code === 0 &&
      !bundle.resource.failure &&
      !bundle.resource.cancelled &&
      bundle.resource.oomKills === 0 &&
      Number(bundle.resource.peakBytes) > 0 &&
      Number(bundle.resource.peakBytes) <= limits.memoryMaxBytes &&
      bundle.resource.memoryMaxBytes === limits.memoryMaxBytes,
    "Cached resource accounting failed",
  );
  for (const record of bundle.shard.records) {
    assert(
      /^\.agents\/verification\/runs\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\/manifest\.json$/.test(
        record.path,
      ),
      "Invalid cached path",
    );
    const matches = bundle.cases.filter((item) => item.path === record.path);
    assert.equal(matches.length, 1, "Missing or duplicate cached case");
    const manifest = matches[0]!.manifest;
    assert(
      manifest.schemaVersion === 1 &&
        manifest.complete &&
        /^[0-9a-f]{40}$/.test(manifest.sourceRevision),
      "Incomplete cached case",
    );
    assert.deepEqual(
      manifest.scope,
      modelPartScope(index),
      "Wrong cached case scope",
    );
    assert.deepEqual(
      manifest.results.map((item) => (item as { name: string }).name),
      [record.model],
      "Wrong cached case result",
    );
    // Deliberate negative controls retain nonzero exits. Only complete worker
    // evidence from a successful, resource-accounted group may be cached.
    assert(manifest.commands.length > 0, "Missing cached commands");
    assert.equal(
      new Set(manifest.sourceInputs.map((input) => input.path)).size,
      manifest.sourceInputs.length,
      "Duplicate cached inputs",
    );
    assert.deepEqual(
      manifest.tools,
      {
        ...key.runtime,
        quint: tooling.dependencies["@informalsystems/quint"],
        checker: checker.version,
        jarSha256: checker.jarSha256,
      },
      "Cached tools differ from admitted tools",
    );
    for (const input of key.inputs)
      assert.deepEqual(
        manifest.sourceInputs.find((item) => item.path === input.path),
        input,
        "Cached replay input differs",
      );
  }
}

export async function modelCacheKey(root: string, index: number) {
  return (await modelCacheKeys(root, [index]))[0]!;
}

/** Several parts' keys from one tool identification and one input scan. */
export async function modelCacheKeys(root: string, indices: number[]) {
  // These actual identities are checked after pinned setup and enter every key.
  const node = Bun.spawnSync(["node", "--version"]);
  const java = Bun.spawnSync(["java", "-version"]);
  assert(
    node.exitCode === 0 && java.exitCode === 0,
    "Cannot identify model tools",
  );
  const runtime = {
    bun: Bun.version,
    node: node.stdout.toString().trim(),
    java: java.stderr.toString().trim().split("\n")[0]!,
  };
  const toolIdentity = {
    runtime,
    java: java.stderr.toString().trim(),
    platform: process.platform,
    arch: process.arch,
  };
  const scan = scanModelInputs(root, trackedFiles(root));
  const keys = [];
  for (const index of indices)
    keys.push(await keyForToolIdentity(root, index, toolIdentity, scan));
  return keys;
}

function trackedFiles(root: string) {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root })
    .toString()
    .split("\0")
    .filter(Boolean);
}

async function keyForToolIdentity(
  root: string,
  index: number,
  toolIdentity: ModelToolIdentity,
  scan?: ModelInputScan,
) {
  assert(
    toolIdentity &&
      toolIdentity.runtime &&
      Object.values(toolIdentity.runtime).length === 3 &&
      (["node", "java", "bun"] as const).every(
        (name) =>
          typeof toolIdentity.runtime[name] === "string" &&
          toolIdentity.runtime[name].length > 0,
      ) &&
      toolIdentity.runtime.bun === Bun.version &&
      typeof toolIdentity.java === "string" &&
      toolIdentity.java.split("\n")[0] === toolIdentity.runtime.java &&
      toolIdentity.platform === process.platform &&
      toolIdentity.arch === process.arch,
    "Missing or invalid model tool identity",
  );
  const tools = [
    JSON.stringify(toolIdentity.runtime),
    toolIdentity.java,
    toolIdentity.platform,
    toolIdentity.arch,
  ].join("\n");
  const job = verificationJob(index);
  const files = trackedFiles(root);
  const inputs = await fingerprintInputs(
    root,
    modelInputs(root, files, job.model, scan ?? scanModelInputs(root, files)),
  );
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        schema: 2,
        model: job.model,
        part: job.part,
        tools,
        inputs,
      }),
    )
    .digest("hex");
  return {
    hash,
    inputs,
    runtime: toolIdentity.runtime,
    toolIdentity,
  };
}

export async function readReusedBundle(root: string, shard: Shard) {
  assert(shard.reuse, "Missing reuse receipt");
  assert.equal(
    shard.reuse.origin,
    `.agents/verification/runs/ci-shard-${shard.index}-reused/origin.json`,
    "Invalid reuse origin path",
  );
  const bundle = JSON.parse(
    await readFile(resolve(root, shard.reuse.origin), "utf8"),
  ) as ModelBundle;
  // Restore already admitted these tools against the pinned shard runtime.
  // Delivery validates that same complete identity and today's input closure;
  // it must not substitute its own unpinned (or absent) Node/Java.
  const key = await keyForToolIdentity(root, shard.index, bundle.toolIdentity);
  validateModelBundle(bundle, shard.index, key);
  assert.equal(shard.reuse.hash, key.hash, "Reused group key differs");
  assert.deepEqual(
    shard.records,
    bundle.shard.records,
    "Reused group records differ",
  );
  return bundle;
}

export async function modelCache(root: string, action: string, index: number) {
  const key = await modelCacheKey(root, index);
  const cachePath = resolve(root, `.agents/model-cache/${index}/bundle.json`);
  if (action === "key") {
    assert(process.env.GITHUB_OUTPUT, "Missing GITHUB_OUTPUT");
    appendFileSync(process.env.GITHUB_OUTPUT, `hash=${key.hash}\n`);
    return;
  }
  const runs = resolve(root, ".agents/verification/runs");
  if (action === "restore") {
    let bundle: ModelBundle;
    try {
      bundle = JSON.parse(await readFile(cachePath, "utf8")) as ModelBundle;
      validateModelBundle(bundle, index, key);
    } catch (error) {
      // Invalid/missing evidence is a miss. Fresh execution is mandatory.
      console.info(`Model cache miss: ${String(error).slice(0, 400)}`);
      appendFileSync(process.env.GITHUB_OUTPUT!, "reused=false\n");
      return;
    }
    // Publication failures are fatal, never a partial restore followed by a
    // fresh run whose aggregate might accidentally consume both inventories.
    const output = `.agents/verification/runs/ci-shard-${index}-reused`;
    await mkdir(resolve(root, output), { recursive: true });
    const origin = `${output}/origin.json`;
    await writeFile(resolve(root, origin), JSON.stringify(bundle));
    const shard: Shard = {
      ...bundle.shard,
      run: process.env.GITHUB_RUN_ID!,
      attempt: Number(process.env.GITHUB_RUN_ATTEMPT || 1),
      reuse: { hash: key.hash, origin },
    };
    await writeFile(
      resolve(root, output, "manifest.json"),
      JSON.stringify(shard),
    );
    for (const item of bundle.cases) {
      await mkdir(resolve(root, item.path, ".."), { recursive: true });
      await writeFile(resolve(root, item.path), JSON.stringify(item.manifest));
    }
    const resources = resolve(
      root,
      `.agents/verification/resources/reused-${index}`,
    );
    await mkdir(resources, { recursive: true });
    await writeFile(
      resolve(resources, "resources.json"),
      JSON.stringify({
        ...bundle.resource,
        manifest: `${output}/manifest.json`,
      }),
    );
    appendFileSync(process.env.GITHUB_OUTPUT!, "reused=true\n");
    console.info(
      `Reused model group ${index}: ${key.hash}; origin run ${bundle.shard.run}`,
    );
    return;
  }
  assert.equal(action, "save", "Unknown model cache action");
  const group = (await readdir(runs)).find(
    (name) =>
      name.startsWith(`ci-shard-${index}-`) && !name.endsWith("-reused"),
  );
  assert(group, "Missing fresh model group");
  const path = `.agents/verification/runs/${group}/manifest.json`;
  const shard = JSON.parse(
    await readFile(resolve(root, path), "utf8"),
  ) as Shard;
  const resources = await readVerificationResources(root);
  const matching = resources.filter((item) => item.manifest === path);
  assert.equal(matching.length, 1, "Missing or duplicate fresh resource proof");
  const resource = matching[0]!;
  const bundle: ModelBundle = {
    schema: 1,
    ...key,
    shard,
    resource,
    cases: await Promise.all(
      shard.records.map(async (record) => ({
        path: record.path,
        manifest: JSON.parse(
          await readFile(resolve(root, record.path), "utf8"),
        ) as VerificationManifest,
      })),
    ),
  };
  validateModelBundle(bundle, index, key);
  await mkdir(resolve(cachePath, ".."), { recursive: true });
  await writeFile(cachePath, JSON.stringify(bundle));
}

if (import.meta.main) {
  const [action, index] = process.argv.slice(2);
  await modelCache(process.cwd(), action!, Number(index));
}
