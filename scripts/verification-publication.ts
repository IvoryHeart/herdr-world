import { writeFile } from "node:fs/promises";
import type { VerificationManifest } from "./verification-evidence";

/** Call inside the runner's failure handler so rejection invalidates its evidence. */
export async function publishVerificationEvidence(
  path: string,
  manifest: VerificationManifest,
  signal: AbortSignal,
  publish: (path: string, data: string) => Promise<void> = writeFile,
) {
  signal.throwIfAborted();
  await publish(path, JSON.stringify(manifest, null, 2));
  signal.throwIfAborted();
}
