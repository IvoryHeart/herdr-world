export type DeskReadKind = "screen" | "receipt";
export type DeskReadTarget = {
  connection_id: string;
  connection_generation: number;
  pane_id: string;
  /** The same public session fingerprint used by Desk receipts and World leaves. */
  session: string | null;
};
export type DeskReceiptTarget = DeskReadTarget & { trigger: string };
export type DeskDeclaration = {
  screens: DeskReadTarget[];
  receipts: DeskReceiptTarget[];
};
export type DeskReadNotice = DeskReadTarget & {
  type: "world_desk_reads";
  kind: DeskReadKind;
  /** Per-holder trigger captured at read start; late joiners receive null. */
  trigger: string | null;
  result?: unknown;
  error?: string;
  /** A failed read is always delivered; browsers count failures per captured trigger. */
  failures?: number;
};

export function deskReadKey(
  kind: DeskReadKind,
  target: DeskReadTarget,
): string {
  return JSON.stringify([
    kind,
    target.connection_id,
    target.connection_generation,
    target.pane_id,
    target.session,
  ]);
}
