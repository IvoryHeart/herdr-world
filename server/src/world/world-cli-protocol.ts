import { BOARD_ELEMENT_CLI_COMMANDS } from "./world-cli-elements";
import { MEMORY_ACTIONS } from "../../../shared/memory";
import { GROUP_CLI_COMMANDS } from "./world-cli-groups";
import type { CliActor } from "./world-ledger";
import type { Evidence } from "../verbs/types";
import type { CliErrorCode } from "./world-cli-errors";

export type WorldCliRequest = {
  command: string;
  params?: Record<string, unknown>;
  /** What the caller claims: its HERDR_PANE_ID. */
  caller?: {
    pane_id?: unknown;
    core_terminal_id?: unknown;
    core_terminal?: unknown;
  };
};

export type WorldCliResponse = (
  | { ok: true; actor: CliActor; result: unknown }
  | {
      ok: false;
      code: CliErrorCode;
      error: string;
      actor?: CliActor;
      result?: unknown;
    }
) & {
  recorded?: boolean;
  command_evidence?: Evidence;
  retrying?: boolean;
  notified?: { shown: boolean; reason: string } | null;
};

/** The commands the endpoint accepts, as the CLI spells them. */
export const WORLD_CLI_COMMANDS = [
  ...MEMORY_ACTIONS.map((action) => `memory ${action}` as const),
  ...GROUP_CLI_COMMANDS,
  "whoami",
  "ls",
  "usage",
  "history",
  "undo",
  ...BOARD_ELEMENT_CLI_COMMANDS,
  "board card move",
  "board card pin",
  "board card unpin",
  "board card group",
  "board card ungroup",
  "colour set",
  "colour reset",
  "town desk move",
  "ask",
  "ask ls",
  "ask get",
  "ask acknowledge",
  "ask answer",
  "ask withdraw",
  "result",
  "result ls",
  "spawned-by",
] as const;
export type WorldCliCommand = (typeof WORLD_CLI_COMMANDS)[number];
