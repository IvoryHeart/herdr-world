/**
 * Renaming and closing a room (a Herdr workspace), shared by Town and Board:
 * the same dialogs, the same confirmation, and the same calls on the room's
 * own connection and the runtime generation it was observed in.
 */

import { ConfirmDialog, TextInputDialog } from "../components/ModalDialogs";
import { store } from "../store";

/** The rename or close dialog being shown, and the room it names. */
export type RoomRenameCloseDialog = {
  mode: "rename" | "close";
  label: string;
};

/** The room a rename or close acts on. */
export type RoomRenameCloseTarget = {
  connectionId: string;
  /** The runtime generation the room was observed in. */
  generation: number;
  workspaceId: string;
};

const reportFailure = (action: string, cause: unknown) =>
  store.notify({
    kind: "error",
    message: `${action} failed`,
    detail: cause instanceof Error ? cause.message : String(cause),
  });

/** Rename a room, unless the new name is empty or unchanged. */
export async function renameRoom(
  room: RoomRenameCloseTarget,
  from: string,
  label: string,
) {
  const value = label.trim();
  if (!value || value === from) return;
  try {
    await store.renameQualifiedWorkspace(
      { connectionId: room.connectionId, runtimeGeneration: room.generation },
      room.workspaceId,
      value,
    );
  } catch (cause) {
    reportFailure("Room rename", cause);
  }
}

/** Close a room: its running terminal sessions end. */
export async function closeRoom(room: RoomRenameCloseTarget) {
  try {
    await store.closeQualifiedWorkspace(
      { connectionId: room.connectionId, runtimeGeneration: room.generation },
      room.workspaceId,
    );
  } catch (cause) {
    reportFailure("Room close", cause);
  }
}

/** The rename and close room dialogs. */
export function RoomRenameCloseDialogs({
  dialog,
  onClose,
  onRename,
  onConfirmClose,
}: {
  dialog: RoomRenameCloseDialog | null;
  onClose(): void;
  onRename(label: string): void;
  onConfirmClose(): void;
}) {
  return (
    <>
      <TextInputDialog
        open={dialog?.mode === "rename"}
        title="Rename room"
        label="Room name"
        initialValue={dialog?.mode === "rename" ? dialog.label : ""}
        submitLabel="Rename"
        onClose={onClose}
        onSubmit={onRename}
      />
      <ConfirmDialog
        open={dialog?.mode === "close"}
        title="Close room"
        message={
          dialog?.mode === "close"
            ? `Close room “${dialog.label}”? Its running terminal sessions will end.`
            : ""
        }
        confirmLabel="Close room"
        danger
        onClose={onClose}
        onConfirm={() => {
          if (dialog?.mode === "close") onConfirmClose();
        }}
      />
    </>
  );
}
