import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { ConnectionClient } from "./api";
import { worldLocalStorage } from "./browserStorage";
import { store } from "./store";
import {
  taskNotificationView,
  type TaskNotificationTarget,
} from "./taskNotifications";
import type { Pane } from "./types";
import type { WorkspaceInspectorState } from "./workspaceResource";
import { readOfficePreferences } from "./world/officePreferences";

/** Spaces must render the admitted owner before opening its Inspector. */
export function useTaskNotificationTarget(options: {
  client: ConnectionClient;
  inspector: MutableRefObject<WorkspaceInspectorState | null>;
  setInspector(state: WorkspaceInspectorState | null): void;
  openChat(pane: Pane): void;
  openTerminal(): void;
  onOpened(): void;
}) {
  const current = useRef(options);
  current.current = options;
  const sequence = useRef(0);
  const retirement = useRef<{
    request: number;
    previous: WorkspaceInspectorState | null;
    retired: WorkspaceInspectorState | null;
  } | null>(null);
  const restoreRetired = useCallback(() => {
    const owned = retirement.current;
    retirement.current = null;
    if (owned && current.current.inspector.current === owned.retired)
      current.current.setInspector(owned.previous);
  }, []);
  const [pending, setPending] = useState<{
    request: number;
    target: TaskNotificationTarget;
    pane: Pane;
  } | null>(null);
  useEffect(
    () => () => {
      sequence.current++;
      retirement.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!pending || pending.request !== sequence.current) return;
    const { request, target, pane } = pending;
    const clearPending = () =>
      setPending((value) => (value?.request === request ? null : value));
    const refuse = () => {
      if (retirement.current?.request === request) restoreRetired();
      clearPending();
    };
    const { client, openChat, openTerminal, onOpened } = current.current;
    if (store.get().activeConnectionId !== target.connectionId) {
      refuse();
      return;
    }
    if (client.connectionId !== target.connectionId) return;
    if (
      !client.isCurrent() ||
      client.serverRuntimeGeneration !== target.runtimeGeneration
    ) {
      refuse();
      return;
    }
    const snapshot = store.getConnection(target.connectionId);
    if (snapshot.selectedPaneId !== target.paneId) {
      refuse();
      return;
    }
    if (
      !snapshot.workspaces.some(
        (workspace) => workspace.workspace_id === target.workspaceId,
      ) ||
      !snapshot.panes.some(
        (candidate) =>
          candidate.pane_id === target.paneId &&
          candidate.workspace_id === target.workspaceId,
      )
    )
      return;
    if (
      taskNotificationView(
        pane,
        readOfficePreferences(worldLocalStorage).townOpens,
      ) === "history"
    )
      openChat(pane);
    else openTerminal();
    if (retirement.current?.request === request) retirement.current = null;
    onOpened();
    clearPending();
  });
  return useCallback(
    async (target: TaskNotificationTarget) => {
      const request = ++sequence.current;
      setPending(null);
      const pane = await store.focusTaskNotificationTarget(target, {
        activateConnection: true,
        isCurrent: () => request === sequence.current,
        beforeFocus: () => {
          if (request !== sequence.current) return;
          const { inspector, setInspector } = current.current;
          if (
            retirement.current &&
            inspector.current === retirement.current.retired
          ) {
            // Transfer the original Inspector, never a predecessor's closed copy.
            retirement.current.request = request;
            return;
          }
          const previous = inspector.current;
          const retired = previous ? { ...previous, open: false } : null;
          retirement.current = { request, previous, retired };
          // Do not let the old Chat's terminal restore its tab during native focus.
          setInspector(retired);
        },
      });
      if (request !== sequence.current) {
        // A successor still in prechecks has not taken over this retirement.
        if (retirement.current?.request === request) restoreRetired();
        return;
      }
      if (!pane) {
        restoreRetired();
        return;
      }
      setPending({ request, target, pane });
    },
    [restoreRetired],
  );
}
