import type { CliActor } from "./world-ledger";
import type { Evidence } from "../verbs/types";
import type { CliErrorCode } from "./world-cli-errors";

export type WorldCliRequest = {
  command: string;
  params?: Record<string, unknown>;
  /** What the caller claims: its HERDR_PANE_ID. */
  caller?: { pane_id?: unknown };
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
