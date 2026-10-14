import assert from "node:assert/strict";
import * as defaults from "./creation-subjects";
import { syntheticBridge } from "./bridge-fixture";
export type CreationSubjects = typeof defaults;
export function creationFixture(subjects = defaults) {
  const {
    store,
    bridge,
    __storeTesting,
    emptyServerSessionState,
    connectionSnapshot,
  } = subjects;
  const previous = store.get();
  const fixture = syntheticBridge(undefined, undefined, false, bridge);
  const ids = ["synthetic-a", "synthetic-b"];
  const generations = [1, 1];
  const advertisement = {
    methods: ["pane.focus", "tab.create", "workspace.create"],
    capabilities: [],
  };
  const session = {
    ...emptyServerSessionState(1),
    navigationMode: "browser-local" as const,
    lastRefresh: 1,
    workspaces: [
      {
        workspace_id: "shared",
        label: "Synthetic workspace",
        number: 1,
        focused: true,
        active_tab_id: "shared-tab",
        pane_count: 1,
        tab_count: 1,
        agent_status: "idle",
      },
    ],
    tabs: [
      {
        workspace_id: "shared",
        tab_id: "shared-tab",
        label: "Synthetic tab",
        number: 1,
        focused: true,
        pane_count: 1,
        agent_status: "idle",
      },
    ],
    panes: [
      {
        workspace_id: "shared",
        tab_id: "shared-tab",
        pane_id: "shared-pane",
        terminal_id: "shared-terminal",
        focused: true,
        agent_status: "idle",
        revision: 1,
      },
    ],
    browserNavigation: {
      revision: 1,
      workspaceId: "shared",
      tabIds: { shared: "shared-tab" },
      paneIds: { "shared-tab": "shared-pane" },
    },
    selectedPaneId: "shared-pane",
    endpointAvailability: { "shared-terminal": advertisement },
  };
  __storeTesting.replaceState({
    ...previous,
    ...session,
    status: "connected",
    connectionPaused: false,
    activeConnectionId: ids[0]!,
    connectionGeneration: bridge.clientGeneration,
    catalogueReady: true,
    connections: ids.map((id, h) => ({
      id,
      label: id,
      generation: 1,
      state: "ready",
      source: "synthetic",
      is_default: h === 0,
    })),
    sessionsByConnectionId: { [ids[1]!]: session },
  });
  const calls: {
    host: number;
    id: string;
    generation: number;
    params: Record<string, unknown>;
    method: string;
  }[] = [];
  const entered = [
    Promise.withResolvers<void>(),
    Promise.withResolvers<void>(),
  ];
  fixture.sockets[0]!.onSend = (message) => {
    const host = ids.indexOf(message.connection_id);
    if (["tab.create", "workspace.create"].includes(message.method)) {
      assert(host >= 0, "Creation has no qualified owner");
      calls.push({
        host,
        id: message.id,
        generation: message.connection_generation,
        params: message.params,
        method: message.method,
      });
      entered[host]!.resolve();
    } else throw new Error(`Unexpected creation fixture RPC ${message.method}`);
  };
  const changed = () => {
    const current = store.get();
    __storeTesting.replaceState({
      ...current,
      connections: current.connections.map((connection, h) => ({
        ...connection,
        generation: generations[h]!,
      })),
    });
  };
  const retire = (h: number) => {
    generations[h] = 3;
    changed();
  };
  const target = (h: number) => ({
    connectionId: ids[h]!,
    runtimeGeneration: 1,
  });
  const attach = (h: number) => {
    const client = bridge.connection(ids[h]!, 1);
    return {
      client,
      attempt: store.beginTerminalAttachment(client, "shared-terminal"),
    };
  };
  const ready = (attachment: ReturnType<typeof attach>) =>
    store.completeTerminalAttachment(
      attachment.client,
      "shared-terminal",
      attachment.attempt,
      advertisement,
    );
  const result = () => ({
    root_pane: {
      workspace_id: "shared",
      tab_id: "created-tab",
      pane_id: "created-pane",
      terminal_id: "created-terminal",
    },
  });
  const reply = (h: number) => {
    const call = calls.find((call) => call.host === h)!;
    fixture.sockets[0]!.receive({
      id: call.id,
      connection_id: ids[h],
      connection_generation: 1,
      result: result(),
    });
  };
  return {
    subjects,
    fixture,
    ids,
    generations,
    target,
    calls,
    entered,
    attach,
    ready,
    retire,
    reply,
    result,
    snapshot: (h: number) => connectionSnapshot(store.get(), ids[h]!),
    restore: () => {
      try {
        fixture.restore();
      } finally {
        __storeTesting.replaceState(previous);
      }
    },
  };
}
