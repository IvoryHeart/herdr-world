import { useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { bridge } from "../../api";
import { store } from "../../store";
import { startFocusedInterest } from "../../store/focusedInterest";
import { worldRuntimeStore } from "../runtimeStore";
import {
  useWorldInspectorController,
  type WorldInspectorController,
} from "../useWorldInspectorController";
import type { WorldInspectorConversation } from "../worldTerminalPresentation";

const noop = () => {};
const props = {
  creationIntentRevision: { current: 0 },
  view: "desk" as const,
  active: true,
  dockedInspectorId: null,
  onDockedInspectorIdChange: noop,
  onInspectorTerminalPortal: noop,
  onWorkspaceSurfaceSelectionReady: noop,
  onInspectorPaneFocusReady: noop,
  onActiveInspectorChange: noop,
  onVisualArrangementControlReady: noop,
  onVisualActionExtensionReady: noop,
  viewToolbarPortal: null,
  onGoToSpaces: noop,
  onPresentedWorldChange: noop,
};

/** Actual Inspector admission/removal effects, with a stale aggregate preview. */
export async function runSharedInspectorChecks(
  check: (value: boolean, message: string) => void,
): Promise<void> {
  const connection = bridge.connection;
  const hello = Object.getOwnPropertyDescriptor(bridge, "hello");
  const mount = document.createElement("div");
  document.body.append(mount);
  const root = createRoot(mount);
  let controller: WorldInspectorController | undefined;
  let closed: { owner: string; tab: string } | null = null;
  let absentReads = 0,
    focusCalls = 0;
  const waiters = new Set<{
    predicate(value: WorldInspectorController): boolean;
    resolve(): void;
  }>();
  const reaches = (predicate: (value: WorldInspectorController) => boolean) => {
    if (controller && predicate(controller)) return Promise.resolve();
    return new Promise<void>((resolve) => waiters.add({ predicate, resolve }));
  };
  function Probe() {
    const [conversations, change] = useState<WorldInspectorConversation[]>([]);
    const current = useWorldInspectorController({
      ...props,
      inspectorConversations: conversations,
      onInspectorConversationsChange: change,
    });
    useLayoutEffect(() => {
      controller = current;
      for (const waiter of waiters)
        if (waiter.predicate(current)) {
          waiters.delete(waiter);
          waiter.resolve();
        }
    });
    return <div data-shared-inspectors={conversations.length} />;
  }
  try {
    await worldRuntimeStore.refresh();
    Object.defineProperty(bridge, "hello", {
      configurable: true,
      get: () => ({ capabilities: { world_shared_acquisition: true } }),
    });
    bridge.connection = ((id, generation) => {
      const client = connection.call(bridge, id, generation);
      return {
        ...client,
        async call(method, params, timeout, options) {
          if (
            closed &&
            id === closed.owner &&
            ["workspace.focus", "tab.focus", "pane.focus"].includes(method)
          )
            focusCalls++;
          const result = await client.call(method, params, timeout, options);
          if (!closed || id !== closed.owner) return result;
          if (method === "tab.list") {
            absentReads++;
            return {
              ...result,
              tabs: result.tabs.filter(
                (tab: { tab_id: string }) => tab.tab_id !== closed!.tab,
              ),
            };
          }
          if (method === "pane.list")
            return {
              ...result,
              panes: result.panes.filter(
                (pane: { tab_id: string }) => pane.tab_id !== closed!.tab,
              ),
            };
          return result;
        },
      };
    }) as typeof bridge.connection;
    startFocusedInterest();
    const ready = reaches(() => true);
    flushSync(() => root.render(<Probe />));
    await ready;
    const leaf = controller!.aggregateWorld.leaves.find(
      (leaf) => leaf.actionable && leaf.kind === "agent" && !!leaf.tabId,
    );
    if (!leaf?.tabId)
      throw new Error("Inspector fixture needs an actionable agent tab");
    closed = { owner: leaf.connectionId, tab: leaf.tabId };
    const opened = reaches((value) =>
      value.inspectorConversations.some(
        (conversation) => conversation.tabId === leaf.tabId,
      ),
    );
    const accepted = await controller!.applySelection(
      leaf.id,
      "terminal",
      false,
      controller!.aggregateWorld,
    );
    check(accepted, "a stale aggregate tab can initially admit its preview");
    await opened;
    const removed = reaches(
      (value) =>
        absentReads > 0 &&
        !value.inspectorConversations.some(
          (conversation) => conversation.tabId === leaf.tabId,
        ),
    );
    await removed;
    check(
      absentReads > 0,
      "admitting the preview starts a fresh qualified focused read",
    );
    check(
      mount.querySelector('[data-shared-inspectors="0"]') !== null,
      "fresh absence removes the already-closed preview through the actual Inspector effects",
    );
    check(
      focusCalls === 0,
      "preview observation never focuses its native target",
    );
  } finally {
    flushSync(() => root.unmount());
    mount.remove();
    bridge.connection = connection;
    if (hello) Object.defineProperty(bridge, "hello", hello);
    else delete (bridge as unknown as { hello?: unknown }).hello;
    closed = null;
    await store.refresh();
  }
}
