import { statSync } from "node:fs";
import { type CliContext, EXIT_FAILURE, EXIT_OK } from "./command";
import { installWorldIntegration } from "./integration";
import { integrationPaths, WORLD_HARNESSES } from "./integration-paths";
import { integrationDisabled } from "./integration-preferences";

/** Discover by existing harness config roots, without launching a harness or service. */
export function syncWorldIntegrations(context: CliContext): number {
  if (context.runtime.env.HERDR_WORLD_SKIP_INTEGRATIONS === "1") {
    context.log(
      "Skipped World's harness integrations (HERDR_WORLD_SKIP_INTEGRATIONS=1).",
    );
    return EXIT_OK;
  }
  let found = false;
  let code = EXIT_OK;
  const installed = new Map<string, string>();
  for (const harness of WORLD_HARNESSES) {
    const paths = integrationPaths(harness, context.runtime);
    if (!paths) continue;
    try {
      try {
        if (!statSync(paths.config).isDirectory()) continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      found = true;
      if (integrationDisabled(paths.id, context.runtime)) {
        context.log(
          `${harness}: skipped (previously uninstalled; run \`herdr-world integration install ${harness}\` to reenable).`,
        );
        continue;
      }
      // Shared readers still get an individual report, but only one file write.
      let action = installed.get(paths.file);
      if (!action) {
        action = installWorldIntegration(harness, context.runtime);
        installed.set(paths.file, action);
      }
      context.log(
        `${harness}: ${action} World's integration. Remove: herdr-world integration uninstall ${harness}`,
      );
    } catch (error) {
      context.error(
        `${harness}: World integration failed: ${(error as Error).message}`,
      );
      code = EXIT_FAILURE;
    }
  }
  if (!found)
    context.log(
      "No supported harness configuration folders found; no World integrations installed.",
    );
  return code;
}
