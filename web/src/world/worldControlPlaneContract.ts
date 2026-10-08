import { type WorkspaceSurfaceSelection } from "../App";
import { type WindowArrangementControl } from "../components/WindowArrangementMenu";
import type { CommandExtension } from "../components/CommandCombobox";
import { type WorldObject } from "./worldObject";
import { type WorldInspectorConversation } from "./worldTerminalPresentation";
import { type WorldView } from "./worldViewRouting";

export type WorldControlPlaneProps = {
  creationIntentRevision: { current: number };
  view: Exclude<WorldView, "spaces">;
  active: boolean;
  inspectorConversations: readonly WorldInspectorConversation[];
  dockedInspectorId: string | null;
  onDockedInspectorIdChange(windowId: string | null): void;
  onInspectorConversationsChange(
    conversations:
      | WorldInspectorConversation[]
      | ((
          current: WorldInspectorConversation[],
        ) => WorldInspectorConversation[]),
  ): void;
  onInspectorTerminalPortal(
    windowId: string,
    element: HTMLDivElement | null,
  ): void;
  onWorkspaceSurfaceSelectionReady(
    handler:
      | ((selection: WorkspaceSurfaceSelection) => Promise<boolean>)
      | null,
  ): void;
  onInspectorPaneFocusReady(
    handler: ((windowId: string, paneId: string) => void) | null,
  ): void;
  onActiveInspectorChange(id: string | null): void;
  onVisualArrangementControlReady(
    control: WindowArrangementControl | undefined,
  ): void;
  onVisualActionExtensionReady(extension: CommandExtension): void;
  viewToolbarPortal: HTMLDivElement | null;
  onGoToSpaces(): void;
  onPresentedWorldChange(world: WorldObject): void;
};

export const EMPTY_VISUAL_ACTION_EXTENSION: CommandExtension = {
  captureKey: null,
  groups: [],
};
