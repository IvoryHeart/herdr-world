import type { AssistantSnapshot } from "../../../../shared/assistant";
import type { WorkspaceSurfaceSelection } from "../../App";
import {
  __resetAssistantForTests,
  startAssistantClient,
  refreshAssistant,
  sendAssistant,
} from "../../assistant";
import { useAssistantShow } from "../useAssistantShow";
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
  __resetAssistantForTests();
  const originalCall = bridge.call;
  const originalAssistant = bridge.onAssistant;
  const originalNotify = store.notify;
  const errors: unknown[] = [];
  const pushed = new Set<(snapshot: AssistantSnapshot) => void>();
  let requestId = "";
  let revision = 0;
  const assistantSnapshot = (): AssistantSnapshot => ({
    instance_id: "show-browser",
    revision: revision++,
    config: {
      provider: "test",
      model: "test",
      credential_source: "assistant",
      allowed_workspaces: [],
    },
    providers: [
      { id: "test", label: "Test", configured: true, methods: ["api_key"] },
    ],
    models: [{ provider: "test", id: "test", label: "Test" }],
    messages: [],
    running: false,
    error: null,
    auth: null,
  });
  bridge.call = ((
    method: string,
    params: Record<string, unknown>,
    ...rest: any[]
  ) => {
    if (method.startsWith("bridge.assistant.")) {
      if (method.endsWith(".send")) requestId = String(params.request_id);
      return Promise.resolve(assistantSnapshot());
    }
    return (originalCall as any).call(bridge, method, params, ...rest);
  }) as typeof bridge.call;
  bridge.onAssistant = (listener) => {
    pushed.add(listener);
    return () => {
      pushed.delete(listener);
    };
  };
  store.notify = (notification) => {
    errors.push(notification);
  };
  let stopAssistant: (() => void) | undefined;
  let surfaceCalls = 0;
  const surfaceSelections: WorkspaceSurfaceSelection[] = [];
  const results: Array<Promise<boolean>> = [];
  const showHandler: {
    current:
      | ((selection: WorkspaceSurfaceSelection) => Promise<boolean>)
      | null;
  } = { current: null };
  const selectionReady = (
    handler:
      | ((selection: WorkspaceSurfaceSelection) => Promise<boolean>)
      | null,
  ) => {
    showHandler.current = handler
      ? (selection) => {
          surfaceCalls++;
          surfaceSelections.push(selection);
          const result = handler(selection);
          results.push(result);
          return result;
        }
      : null;
  };
  let clearInspectors = () => {};
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
    clearInspectors = () => change([]);
    useAssistantShow(showHandler);
    const current = useWorldInspectorController({
      ...props,
      onWorkspaceSurfaceSelectionReady: selectionReady,
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
      get: () => ({
        capabilities: {
          world_shared_acquisition: true,
          embedded_assistant: true,
        },
      }),
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
      (leaf) =>
        leaf.actionable &&
        leaf.kind === "agent" &&
        leaf.capabilities.agentHistory &&
        !!leaf.tabId,
    );
    if (!leaf?.tabId)
      throw new Error("Inspector fixture needs an actionable agent tab");
    await Promise.resolve();
    stopAssistant = startAssistantClient();
    await refreshAssistant();
    const generation = leaf.generation;
    const scope = {
      connection_id: leaf.connectionId,
      workspace_id: leaf.workspaceId!,
      runtime_generation: generation,
    };
    const show = (request: string, ownerGeneration = generation) => {
      const snapshot = assistantSnapshot();
      snapshot.messages = [
        {
          id: `reply-${snapshot.revision}`,
          role: "assistant",
          sent_at: "2026-11-01T00:00:00Z",
          text: "Requested",
          tools: [],
          sources: [],
          show: {
            ...scope,
            runtime_generation: ownerGeneration,
            pane_id: leaf.pane.pane_id,
            request_id: request,
          },
        },
      ];
      for (const push of pushed) push(snapshot);
    };
    show("another-browser");
    check(
      surfaceCalls === 0,
      "Ranger show from another browser does not enter Inspector admission",
    );
    await sendAssistant("Show this session", [scope]);
    const openedByRanger = reaches((value) =>
      value.inspectorConversations.some(
        (c) =>
          c.connectionId === leaf.connectionId &&
          c.paneId === leaf.pane.pane_id,
      ),
    );
    show(requestId);
    await Promise.all(results);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (results.length !== 1 || !(await results[0]))
      throw new Error(
        `Ranger show did not admit: requests=${requestId} calls=${surfaceCalls} errors=${JSON.stringify(errors)} intent=${controller?.intentError} active=${bridge.activeConnectionId} leaf=${leaf.connectionId}/${leaf.generation} scope=${JSON.stringify(scope)} client=${JSON.stringify({ transport: bridge.connection(leaf.connectionId)?.generation, runtime: bridge.connection(leaf.connectionId)?.serverRuntimeGeneration })} store=${JSON.stringify(store.get().connections.map((c) => ({ id: c.id, generation: c.generation, state: c.state })))} target=${JSON.stringify({ native: leaf.nativeId, pane: leaf.pane.pane_id, workspace: leaf.workspaceId })}`,
      );
    await openedByRanger;
    check(
      surfaceCalls === 1,
      "the originating Ranger browser reaches the actual shared Inspector handler",
    );
    check(
      surfaceSelections[0]?.view === "history",
      "Ranger requests History through the shared Inspector handler",
    );
    // This controller-only probe does not mount the conversation reader that
    // confirms readability. Keep main's pending Chat intent on Terminal.
    check(
      controller!.inspectorConversations.some(
        (c) =>
          c.connectionId === leaf.connectionId &&
          c.runtimeGeneration === generation &&
          c.paneId === leaf.pane.pane_id &&
          c.view === "terminal" &&
          c.awaitChatSession === true,
      ),
      "Ranger opens only its captured runtime's session and waits for readable History",
    );
    await sendAssistant("Show after replacement", [scope]);
    const count = controller!.inspectorConversations.length;
    show(requestId, generation + 1);
    await Promise.all(results);
    await Promise.resolve();
    check(
      controller!.inspectorConversations.length === count &&
        Number(results.length) === 2 &&
        (await results[1]) === false,
      "an obsolete Ranger generation cannot admit an Inspector",
    );
    check(
      errors.length === 1,
      "unavailable Ranger navigation reports an unavailable-target notification",
    );
    flushSync(() => clearInspectors());
    stopAssistant();
    stopAssistant = undefined;
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
    bridge.call = originalCall;
    bridge.onAssistant = originalAssistant;
    store.notify = originalNotify;
    stopAssistant?.();
    __resetAssistantForTests();
    if (hello) Object.defineProperty(bridge, "hello", hello);
    else delete (bridge as unknown as { hello?: unknown }).hello;
    closed = null;
    await store.refresh();
  }
}
