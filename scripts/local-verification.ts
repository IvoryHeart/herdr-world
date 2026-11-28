import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { verificationModels } from "../quint/models";
import {
  validateEvidence,
  type VerificationManifest,
} from "./verification-evidence";

/** @internal Local reuse is deliberately conservative: every source byte and tool must match. */
export async function reusableLocalEvidence(
  root: string,
  manifest: VerificationManifest,
  files: string[],
  tools: Pick<VerificationManifest["tools"], "node" | "java" | "bun">,
) {
  assert.equal(
    manifest.scope?.kind,
    "full-parallel",
    "Not a complete local gate",
  );
  assert.deepEqual(
    [...manifest.scope.models].sort(),
    [...verificationModels].sort(),
    "Model inventory changed",
  );
  assert.deepEqual(
    manifest.results.map((result) => (result as { name: string }).name).sort(),
    [...verificationModels].sort(),
    "Model results changed",
  );
  assert.deepEqual(
    manifest.sourceInputs.map((input) => input.path).sort(),
    [...files].sort(),
    "Source inventory changed",
  );
  assert(
    manifest.commands.length > 0,
    "Missing command evidence cannot be reused",
  );
  assert(
    manifest.commands.every((command) => command.code === 0),
    "Failed commands cannot be reused",
  );
  for (const tool of ["node", "java", "bun"] as const)
    assert.equal(manifest.tools[tool], tools[tool], `${tool} changed`);
  await validateEvidence(root, manifest, verificationModels.length);
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const run = async (script: string) => {
    const child = Bun.spawn([process.execPath, "run", script], {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    });
    const stop = () => child.kill("SIGTERM");
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    try {
      assert.equal(await child.exited, 0, `${script} failed`);
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
  };
  await run("verification:setup");
  await run("verification:typecheck");
  await run("verification:notices:check");
  const files = Bun.spawnSync([
    "git",
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .stdout.toString()
    .split("\0")
    .filter(Boolean);
  const tools = {
    bun: Bun.version,
    node: Bun.spawnSync(["node", "--version"]).stdout.toString().trim(),
    java: Bun.spawnSync(["java", "-version"])
      .stderr.toString()
      .trim()
      .split("\n")[0]!,
  };
  const runs = resolve(root, ".agents/verification/runs");
  let reused: string | undefined;
  if (
    !process.argv.includes("--fresh") &&
    process.env.HERDR_VERIFICATION_FRESH !== "1"
  ) {
    const names = await readdir(runs).catch(() => [] as string[]);
    for (const name of names
      .filter((name) => name.includes("-parallel-"))
      .sort()
      .reverse()) {
      const path = resolve(runs, name, "manifest.json");
      try {
        await reusableLocalEvidence(
          root,
          JSON.parse(await readFile(path, "utf8")),
          files,
          tools,
        );
        reused = path;
        break;
      } catch {
        /* A changed input or incomplete run requires fresh evidence. */
      }
    }
  }
  if (reused)
    console.info(
      `Reused all ${verificationModels.length} models from ${reused}: identical source inventory, bytes and tools; model execution 0s`,
    );
  else await run("verification:check");
  // A local delivery/timings invocation is always full mode: one tooling control.
  await run("verification:diagnostic-control");
}
