import { fileURLToPath } from "node:url";
import { shipyardRepository } from "../../../shared/shipyard";
import { parseReviewRemote } from "../workspace/pull-request";
import { runProcessWithCodeTimeout } from "../utils/process-utils";
import type { InstanceIdentity } from "./instances";
import { sha, text } from "./parse";

/** Source builds read their own checkout, never the caller's cwd or an agent's. */
export async function shipyardInstanceIdentity(
  generation: string,
  version: string,
  startedAt: number,
): Promise<InstanceIdentity> {
  const identity: InstanceIdentity = {
    generation,
    version,
    startedAt,
    kind: Bun.isStandaloneExecutable ? "installed" : "source",
    repo: Bun.isStandaloneExecutable ? "ivoryheart/herdr-world" : null,
    branch: null,
    sha: null,
  };
  if (Bun.isStandaloneExecutable) return identity;
  const cwd = fileURLToPath(new URL("../../../", import.meta.url));
  try {
    const result = await runProcessWithCodeTimeout(
      ["git", "-C", cwd, "rev-parse", "HEAD", "--abbrev-ref", "HEAD"],
      2_000,
    );
    if (result.code === 0 && result.stdout.length < 2048) {
      const [commit, branch] = result.stdout.trim().split("\n");
      identity.sha = sha(commit);
      identity.branch = branch === "HEAD" ? null : text(branch, 256);
    }
    const remote = await runProcessWithCodeTimeout(
      ["git", "-C", cwd, "remote", "get-url", "origin"],
      2_000,
    );
    if (remote.code === 0 && remote.stdout.length < 2048) {
      const parsed = parseReviewRemote("origin", remote.stdout.trim());
      if (parsed?.host === "github.com")
        identity.repo = shipyardRepository(parsed.repository);
    }
  } catch {
    /* Version and listening port remain useful without Git. */
  }
  return identity;
}
