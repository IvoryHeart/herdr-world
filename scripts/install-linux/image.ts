import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
} from "node:fs";
import { dirname } from "node:path";

type Run = (args: string[]) => Promise<string>;
const context = "scripts/install-linux";

/** Only dependency inputs belong here: scenario edits must still build on a cache hit. */
export function installBaseIdentity(
  inputs = [
    readFileSync(`${context}/Dockerfile.base`, "utf8"),
    readFileSync(`${context}/apt.sh`, "utf8"),
  ],
) {
  const hash = createHash("sha256")
    .update(JSON.stringify(["linux/amd64", ...inputs]))
    .digest("hex");
  return `herdr-world-install-base:${hash}`;
}

function report(message: string) {
  console.info(`[image] ${message}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `- Installer image: ${message}\n`,
    );
}

async function timed(label: string, work: () => Promise<unknown>) {
  const start = performance.now();
  try {
    await work();
  } finally {
    report(`${label}: ${((performance.now() - start) / 1000).toFixed(2)}s`);
  }
}

/** Cache the base, never the fixture: COPY always sees this checkout's scenarios. */
export async function buildInstallImage(
  image: string,
  run: Run,
  cacheFile?: string,
) {
  const base = installBaseIdentity();
  if (cacheFile && existsSync(cacheFile)) {
    await timed("load dependency cache", () =>
      run(["docker", "load", "--input", cacheFile]),
    );
    await run(["docker", "image", "inspect", base]);
    report("apt: skipped (0s; dependency cache hit)");
  } else {
    await timed("dependency docker build (cold cache)", () =>
      run([
        "docker",
        "build",
        "--platform",
        "linux/amd64",
        "--progress=plain",
        "--file",
        `${context}/Dockerfile.base`,
        "--tag",
        base,
        context,
      ]),
    );
    if (cacheFile) {
      mkdirSync(dirname(cacheFile), { recursive: true });
      await timed("save dependency cache", () =>
        run(["docker", "save", "--output", `${cacheFile}.tmp`, base]),
      );
      renameSync(`${cacheFile}.tmp`, cacheFile);
    }
  }
  await timed("fixture docker build", () =>
    run([
      "docker",
      "build",
      "--platform",
      "linux/amd64",
      "--progress=plain",
      "--force-rm",
      "--build-arg",
      `INSTALL_TEST_BASE=${base}`,
      "--tag",
      image,
      context,
    ]),
  );
}

/** Run real apt, bypassing all Docker RUN caches, against a refused local proxy. */
export function checkMirrorFailure() {
  const start = performance.now();
  const name = `world-install-mirror-${randomUUID()}`;
  try {
    const result = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        name,
        "--network",
        "none",
        "--env",
        "INSTALL_TEST_APT_PROXY=http://127.0.0.1:9",
        installBaseIdentity(),
        "sh",
        "/opt/install-test/apt.sh",
      ],
      { encoding: "utf8", timeout: 60_000 },
    );
    assert.ifError(result.error);
    assert(
      result.status !== 0,
      "Forced apt mirror failure unexpectedly succeeded",
    );
    assert.match(result.stderr, /Installer test base: apt failed/);
    report(
      `forced mirror failure: ${((performance.now() - start) / 1000).toFixed(2)}s; clear apt error (exit ${result.status})`,
    );
    console.info(result.stderr.trim());
  } finally {
    spawnSync("docker", ["rm", "--force", name], {
      stdio: "ignore",
      timeout: 60_000,
    });
  }
}

if (import.meta.main) {
  assert.deepEqual(process.argv.slice(2), ["--check-mirror-failure"]);
  checkMirrorFailure();
}
