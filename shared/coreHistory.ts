import type { HistoryEntry } from "../server/src/agent/session-history";

/** A reading choice only; it never authorizes a core send or keys. */
export type CoreHistorySession = { kind: "id" | "path"; value: string };
export type CoreHistory = {
  status: "ok" | "unavailable";
  reason?: string;
  detail: string;
  entries: HistoryEntry[];
  /** Explicitly linked by the reader, identified by argv/title, or inferred. */
  source?: "linked" | "native" | "discovered";
  truncated?: boolean;
};
