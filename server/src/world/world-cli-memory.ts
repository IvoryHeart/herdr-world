import { MemoryError, type MemoryAction } from "../../../shared/memory";
import { CliError } from "./world-cli-errors";
import type { WorldCliDeps } from "./world-cli";

export async function runMemoryCli(
  memory: WorldCliDeps["memory"],
  command: string,
  params: Record<string, unknown>,
  recheck: () => void,
) {
  if (!memory)
    throw new CliError("unavailable", "Memory service is unavailable");
  try {
    return await memory(command.slice(7) as MemoryAction, params, recheck);
  } catch (error) {
    if (!(error instanceof MemoryError)) throw error;
    const code =
      error.code === "invalid"
        ? "usage"
        : error.code === "not_found"
          ? "not_found"
          : error.code === "unavailable" || error.code === "uncertain"
            ? "unavailable"
            : "refused";
    throw new CliError(code, `${error.code}: ${error.message}`);
  }
}
