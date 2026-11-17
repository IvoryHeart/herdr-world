/**
 * Renaming and closing a room (a Herdr workspace), shared by Town and Board:
 * the same dialogs, the same confirmation, and the same calls on the room's
 * own connection and the runtime generation it was observed in.
 */

import { ConfirmDialog, TextInputDialog } from "../components/ModalDialogs";
import { store } from "../store";
import { townScaleRuntime } from "./town/townScaleRuntime";
import {
  closeCoreRoom,
  coreKillConfirmation,
  coreKillPlan,
  renameCoreRoom,
} from "./coreControl";
import { confirmCoreKill } from "./CoreKillConfirm";
import { coreAlsoEndedText } from "../../../shared/coreKill";

/** The Town scale scene's own host, which the service does not know. */
const sceneClient = (connectionId: string) =>
  townScaleRuntime()?.client(connectionId) ?? null;

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
  /** A herdr-core room: World's own layout, through world.core.*. */
  core?: true;
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
    if (room.core) {
      await renameCoreRoom(room, room.workspaceId, value);
      return;
    }
    const scene = sceneClient(room.connectionId);
    await (scene
      ? scene.call("workspace.rename", {
          workspace_id: room.workspaceId,
          label: value,
        })
      : store.renameQualifiedWorkspace(
          {
            connectionId: room.connectionId,
            runtimeGeneration: room.generation,
          },
          room.workspaceId,
          value,
        ));
  } catch (cause) {
    reportFailure("Room rename", cause);
  }
}

/** Close a room: its running terminal sessions end. */
export async function closeRoom(room: RoomRenameCloseTarget) {
  try {
    const scene = sceneClient(room.connectionId);
    await (scene
      ? scene.call("workspace.close", { workspace_id: room.workspaceId })
      : store.closeQualifiedWorkspace(
          {
            connectionId: room.connectionId,
            runtimeGeneration: room.generation,
          },
          room.workspaceId,
        ));
  } catch (cause) {
    reportFailure("Room close", cause);
  }
}

/**
 * Close a herdr-core room: every terminal it shows ends, and everything
 * they started, so all of them are named before anything ends. The service
 * ends nothing beyond what was shown and refuses if more would end now.
 */
export async function closeCoreRoomConfirmed(
  room: RoomRenameCloseTarget,
  label: string,
) {
  try {
    const plan = await coreKillPlan(room, { workspaceId: room.workspaceId });
    const count = plan.roots.length + plan.descendants.length;
    const confirmed = await confirmCoreKill({
      title: "Close room",
      message: count
        ? `Close room “${label}”? ${count === 1 ? "This terminal ends" : `These ${count} terminals end`}, in World and in Herdr's apps:`
        : `Close room “${label}”? It has no running terminals.`,
      confirmLabel: "Close room",
      plan,
      listRoots: true,
    });
    if (!confirmed) return;
    const outcome = await closeCoreRoom(
      room,
      room.workspaceId,
      coreKillConfirmation(plan),
    );
    const alsoEnded = coreAlsoEndedText(outcome.alsoEnded);
    if (alsoEnded)
      store.notify({
        kind: "error",
        message: "More ended than you confirmed",
        detail: alsoEnded,
      });
    if (outcome.uncertain.length)
      store.notify({
        kind: "error",
        message: "Room close may not have finished",
        detail:
          "herdr-core did not answer for every terminal; the room stays until World sees them end.",
      });
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
