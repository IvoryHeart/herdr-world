import type { CliActor } from "./world-ledger";
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
  retrying?: boolean;
  notified?: { shown: boolean; reason: string } | null;
};
