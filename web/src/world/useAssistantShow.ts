import { useEffect, type RefObject } from "react";
import { store } from "../store";
import { onAssistantShow } from "../assistant";
import type { WorkspaceSurfaceSelection } from "../App";

/** Use the shared Inspector admission path without selecting a different runtime. */
export function useAssistantShow(
  handler: RefObject<
    ((selection: WorkspaceSurfaceSelection) => Promise<boolean>) | null
  >,
) {
  useEffect(
    () =>
      onAssistantShow((show) => {
        const open = handler.current;
        const unavailable = () =>
          store.notify({
            kind: "error",
            message: "Ranger could not show this workspace or session",
            detail:
              "The selected runtime or workspace is no longer available. Refresh and ask Ranger again.",
          });
        if (!open) {
          unavailable();
          return;
        }
        void open({
          connectionId: show.connection_id,
          runtimeGeneration: show.runtime_generation,
          workspaceId: show.workspace_id,
          ...(show.pane_id
            ? { paneId: show.pane_id, view: "history" as const }
            : {}),
        }).then((accepted) => {
          if (!accepted) unavailable();
        }, unavailable);
      }),
    [handler],
  );
}
