import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { modelCacheKeys } from "./ci-model-cache";
import { verificationJobs } from "./ci-model-plan";
import { verificationCacheDirectory } from "./verification-setup";
import manifest from "../package.json";

/**
 * Local `check:delivery` runs the gate's cheap tooling checks every time
 * (setup, the Quint project's typecheck and the notices check, whose inputs
 * include every Quint test file), and reuses only the model runs and the
 * diagnostic control when they passed on byte-identical inputs: every model
 * part's CI cache key (model, adapters, replay, verification tooling, seeds,
 * Bun/Node/Java and platform) and the gate's own command. Any change is a miss
 * and runs them again. HERDR_VERIFICATION_FRESH=1 always runs them. @internal
 */
export const alwaysRun = [
  "verification:setup",
  "verification:typecheck",
  "verification:notices:check",
] as const;

/** The gate steps a receipt may stand for. @internal */
export const reusable = [
  "verification:check",
  "verification:diagnostic-control",
] as const;

/** The receipt key of the reusable steps' inputs. @internal */
export async function verificationGateKey(
  root: string,
  partKeys: (
    root: string,
    indices: number[],
  ) => Promise<{ hash: string }[]> = modelCacheKeys,
) {
  const parts = (
    await partKeys(
      root,
      verificationJobs.map((_, index) => index + 1),
    )
  ).map((key) => key.hash);
  return createHash("sha256")
    .update(
      JSON.stringify({
        schema: 2,
        gate: manifest.scripts["verification:gate"],
        parts,
      }),
    )
    .digest("hex");
}

/** @internal */
export function gateReceipt(key: string, cache = verificationCacheDirectory()) {
  return join(cache, "gate-receipts", `${key}.json`);
}

async function run(command: string[], root: string) {
  const child = Bun.spawn(command, {
    cwd: root,
    stdio: ["inherit", "inherit", "inherit"],
  });
  const stop = () => child.kill("SIGTERM");
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    return await child.exited;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

async function runAll(steps: readonly string[], root: string) {
  for (const step of steps) {
    const code = await run([process.execPath, "run", step], root);
    if (code !== 0) return code;
  }
  return 0;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  // Setup pins the tools whose identities enter the key.
  let code = await runAll(alwaysRun, root);
  const began = performance.now();
  const key = code === 0 ? await verificationGateKey(root) : "";
  const receipt = key && gateReceipt(key);
  if (
    code === 0 &&
    Bun.env.HERDR_VERIFICATION_FRESH !== "1" &&
    existsSync(receipt)
  ) {
    console.info(
      `[verification] typecheck and notices passed; reused the models and diagnostic control that passed on identical inputs (${key.slice(0, 12)}) in ${((performance.now() - began) / 1000).toFixed(1)} s; HERDR_VERIFICATION_FRESH=1 runs them again`,
    );
  } else if (code === 0) {
    code = await runAll(reusable, root);
    // Inputs edited while the models ran must not inherit their receipt.
    if (code === 0 && (await verificationGateKey(root)) === key) {
      await mkdir(join(receipt, ".."), { recursive: true });
      await writeFile(
        receipt,
        JSON.stringify({ key, passedAt: new Date().toISOString() }),
      );
    }
  }
  process.exitCode = code;
}
