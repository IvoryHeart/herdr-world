import type { BinReader } from "./bincode";

/**
 * Herdr `ServerMessage::SemanticNotification` (tag 14 in the frozen endpoint
 * generation 1 enum). Herdr reports the semantic event after applying its own
 * notification policy (lifecycle transitions, external-agent suppression,
 * `herdr notification show`); each client-rendered shell chooses how to show it.
 */
export type SemanticNotificationKind =
  | "needs_attention"
  | "finished"
  | "update_installed"
  | "custom";

export type SemanticNotificationSound = "done" | "request";

export interface SemanticNotification {
  kind: SemanticNotificationKind;
  title: string;
  body: string | null;
  sound: SemanticNotificationSound | null;
  agent: string | null;
  workspaceId: string | null;
  tabId: string | null;
  paneId: string | null;
}

// Variant order mirrors Herdr's `SemanticNotificationKind` and
// `SemanticNotificationSound` declarations.
const KINDS: readonly SemanticNotificationKind[] = [
  "needs_attention",
  "finished",
  "update_installed",
  "custom",
];
const SOUNDS: readonly SemanticNotificationSound[] = ["done", "request"];
// `ToastHerdrPosition`: TopLeft, TopRight, BottomLeft, BottomRight.
const POSITION_VARIANTS = 4;
const MAX_TITLE_CHARS = 200;
const MAX_TEXT_CHARS = 400;

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function optionalText(r: BinReader, max: number): string | null {
  const value = r.option(() => r.string());
  return value ? clip(value, max) : null;
}

/** Decode the payload after the ServerMessage variant tag. */
export function readSemanticNotification(r: BinReader): SemanticNotification {
  const kind = KINDS[r.variant()];
  if (!kind) throw new Error("unknown semantic notification kind");
  const title = clip(r.string(), MAX_TITLE_CHARS);
  const body = optionalText(r, MAX_TEXT_CHARS);
  const sound = r.option(() => {
    const value = SOUNDS[r.variant()];
    if (!value) throw new Error("unknown semantic notification sound");
    return value;
  });
  const agent = optionalText(r, MAX_TITLE_CHARS);
  const workspaceId = optionalText(r, MAX_TITLE_CHARS);
  const tabId = optionalText(r, MAX_TITLE_CHARS);
  const paneId = optionalText(r, MAX_TITLE_CHARS);
  // Toast placement only applies to Herdr's own TUI renderer.
  r.option(() => {
    if (r.variant() >= POSITION_VARIANTS)
      throw new Error("unknown semantic notification position");
  });
  return { kind, title, body, sound, agent, workspaceId, tabId, paneId };
}
