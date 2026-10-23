import type { ReactNode } from "react";
import type { HistoryEntry } from "./agentHistory";
import type { ToolStep } from "./agentHistoryView";

export type HistoryDecorationTarget =
  | { type: "message"; entry: HistoryEntry }
  | { type: "step"; step: ToolStep };

export type HistoryDecoration = {
  message?: ReactNode;
  label?: string;
  state?: "error" | "interrupted";
  row?: ReactNode;
  detail?: ReactNode;
  after?: ReactNode;
};

/** Stable renderer plus identity-compared tokens; History itself passes neither. */
export type HistoryDecorator = (
  target: HistoryDecorationTarget,
  token: unknown,
) => HistoryDecoration | undefined;

export function historyDecorationKey(entry: HistoryEntry) {
  return entry.role === "tool" && entry.source_call_id
    ? `step:${entry.source_call_id}`
    : `entry:${entry.id}`;
}
