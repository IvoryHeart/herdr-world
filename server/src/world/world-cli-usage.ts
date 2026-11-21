import { UsageQueryError } from "../usage/analytics";
import { CliError } from "./world-cli-errors";
import type { WorldCliDeps } from "./world-cli";

/** Keep usage error translation outside the shared command dispatcher. */
export async function runUsageCli(
  deps: Pick<WorldCliDeps, "usage">,
  params: Record<string, unknown>,
) {
  if (!deps.usage)
    throw new CliError("unavailable", "Usage analytics is unavailable");
  try {
    return await deps.usage(params);
  } catch (error) {
    if (error instanceof UsageQueryError)
      throw new CliError("usage", error.message);
    throw new CliError("unavailable", "Usage analytics is unavailable");
  }
}
