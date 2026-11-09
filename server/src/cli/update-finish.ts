import { readFileSync } from "node:fs";
import {
  escapeSystemdExecPath,
  xmlEscape,
} from "../config/service-definitions";
import type { RunProcessWithCodeTimeout } from "../http/update";
import { type CliContext, EXIT_FAILURE, EXIT_OK } from "./command";
import { restartRunningService, serviceStatus } from "./service-context";

// Covers a verified download, a live handoff and a plugin rebuild.
const HERDR_UPGRADE_TIMEOUT_MS = 10 * 60_000;

/** Restart the managed service only when its definition runs this executable. */
export function restartServiceUsing(
  context: CliContext,
  executable: string,
): number {
  let status: ReturnType<typeof serviceStatus>;
  try {
    status = serviceStatus(context);
  } catch (error) {
    context.log(`The service was not restarted: ${(error as Error).message}`);
    context.log(
      "Restart any running herdr-world process to use the new version.",
    );
    return EXIT_OK;
  }
  if (!status.installed || !status.active) {
    context.log(
      status.installed
        ? "The managed service is not running; it was not restarted."
        : "No managed service is installed; it was not restarted.",
    );
    context.log(
      "Restart any running herdr-world process to use the new version.",
    );
    return EXIT_OK;
  }
  let definition: string;
  try {
    definition = readFileSync(status.definition, "utf8");
  } catch (error) {
    context.error(
      `The service was not restarted: could not read ${status.definition}: ${(error as Error).message}`,
    );
    return EXIT_FAILURE;
  }
  const forms = [
    executable,
    escapeSystemdExecPath(executable),
    xmlEscape(executable),
  ];
  if (!forms.some((form) => definition.includes(form))) {
    context.log(
      `The managed service runs a different executable (${status.definition}); it was not restarted.`,
    );
    return EXIT_OK;
  }
  const code = restartRunningService(context);
  if (code === 0) context.log("Restarted the service.");
  else if (code === null)
    context.log(
      "The managed service stopped before restart; it was not restarted.",
    );
  else
    context.log(
      "The managed service restart failed; run `herdr-world service restart` to retry.",
    );
  return code ?? EXIT_OK;
}

/** Complete a World replacement without resolving or downloading another release. */
export async function finishUpdate(
  context: CliContext,
  runProcess: RunProcessWithCodeTimeout,
  skipHerdr = false,
): Promise<number> {
  if (skipHerdr) {
    context.log(
      "Skipped Herdr and integration/plugin upgrades (HERDR_WORLD_SKIP_HERDR=1).",
    );
  } else {
    // The new release declares its verified Herdr; let it bring Herdr, the
    // harness integrations and the plugin up to date as a separate step.
    // A Herdr problem leaves the World update in place.
    context.log("Upgrading Herdr for this release...");
    const herdr = await runProcess(
      [context.runtime.execPath, "herdr", "upgrade"],
      HERDR_UPGRADE_TIMEOUT_MS,
    ).catch((error: unknown) => ({
      code: EXIT_FAILURE,
      stdout: "",
      stderr: `Herdr upgrade failed: ${(error as Error).message}`,
    }));
    for (const line of `${herdr.stdout}\n${herdr.stderr}`.split("\n"))
      if (line.trim()) context.log(line.trimEnd());
    if (herdr.code !== 0) {
      context.log(
        "Herdr was not fully upgraded; run `herdr-world herdr upgrade` to retry.",
      );
    }
  }
  return restartServiceUsing(context, context.runtime.execPath);
}
