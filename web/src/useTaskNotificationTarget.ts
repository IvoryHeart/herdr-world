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
  const [pending, setPending] = useState<{
    target: TaskNotificationTarget;
    pane: Pane;
  } | null>(null);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  useEffect(() => {
    if (!pending) return;
    const { target, pane } = pending;
    const { client, openChat, openTerminal, onOpened } = current.current;
    if (store.get().activeConnectionId !== target.connectionId) {
      setPending(null);
      return;
    }
    if (client.connectionId !== target.connectionId) return;
    if (
      !client.isCurrent() ||
      client.serverRuntimeGeneration !== target.runtimeGeneration
    ) {
      setPending(null);
      return;
    }
    const snapshot = store.getConnection(target.connectionId);
    if (snapshot.selectedPaneId !== target.paneId) {
      setPending(null);
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
    onOpened();
    setPending(null);
  });
  return useCallback(async (target: TaskNotificationTarget) => {
    const request = ++sequence.current;
    setPending(null);
    let restore: (() => void) | undefined;
    const pane = await store.focusTaskNotificationTarget(target, {
      activateConnection: true,
      beforeFocus: () => {
        if (request !== sequence.current) return;
        const { inspector, setInspector } = current.current;
        const previous = inspector.current;
        const retired = previous ? { ...previous, open: false } : null;
        restore = () => {
          if (inspector.current === retired) setInspector(previous);
        };
        // Do not let the old Chat's terminal restore its tab during native focus.
        setInspector(retired);
      },
    });
    if (request !== sequence.current) return;
    if (!pane) {
      restore?.();
      return;
    }
    setPending({ target, pane });
  }, []);
}
