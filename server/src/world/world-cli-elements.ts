import type {
  BoardElementService,
  BoardElementAction,
} from "./board-element-service";
import { CliError } from "./world-cli-errors";

export const BOARD_ELEMENT_CLI_COMMANDS = [
  "board element types",
  "board element list",
  "board element put",
  "board element delete",
  "board element read",
] as const;

export async function runBoardElementCommand(
  service: BoardElementService | undefined,
  command: string,
  params: Record<string, unknown>,
  recheck: () => void,
) {
  if (!service)
    throw new CliError("unavailable", "Board elements are unavailable");
  const result = await service.call(
    command.slice("board element ".length) as BoardElementAction,
    params,
    () => {
      recheck();
      return true;
    },
  );
  if (
    result &&
    typeof result === "object" &&
    "status" in result &&
    ["refused", "conflict", "unavailable"].includes(String(result.status))
  ) {
    throw new CliError(
      result.status === "unavailable" ? "unavailable" : "refused",
      "Board element operation could not complete; read the current element and source generation.",
      result,
    );
  }
  return result;
}
