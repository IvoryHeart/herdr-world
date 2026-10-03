import { expect, test } from "bun:test";
import type { ConnectionClient } from "../api";
import type { Pane } from "../types";
import {
  inspectorTerminalFileAdmitted,
  type InspectorTerminalFileRequest,
} from "./inspectorTerminalHandoff";
import {
  worldInspectorWindowId,
  type WorldInspectorConversation,
} from "./worldTerminalPresentation";

const inspector = {
  connectionId: "local",
  runtimeGeneration: 7,
  workspaceId: "studio",
  tabId: "work",
  nodeId: "builder",
} as WorldInspectorConversation;
const client = {
  connectionId: "local",
  generation: 2,
  serverRuntimeGeneration: 7,
  isCurrent: () => true,
} as ConnectionClient;
const panes = [
  { pane_id: "builder-pane", workspace_id: "studio", tab_id: "work" },
] as Pane[];
const request: InspectorTerminalFileRequest = {
  connectionId: "local",
  connectionGeneration: 7,
  runtimeGeneration: 7,
  workspaceId: "studio",
  paneId: "builder-pane",
  path: "src/example.ts",
  windowId: worldInspectorWindowId(inspector),
};

test("terminal files admit only their originating window, pane and lease", () => {
  expect(inspectorTerminalFileAdmitted(request, inspector, client, panes)).toBe(
    true,
  );
  for (const change of [
    { windowId: "another-window" },
    { connectionId: "other-host" },
    { connectionGeneration: 1 },
    { runtimeGeneration: 6 },
    { workspaceId: "another-space" },
    { paneId: "another-pane" },
  ])
    expect(
      inspectorTerminalFileAdmitted(
        { ...request, ...change },
        inspector,
        client,
        panes,
      ),
    ).toBe(false);
  expect(inspectorTerminalFileAdmitted(request, inspector, client, [])).toBe(
    false,
  );
  expect(
    inspectorTerminalFileAdmitted(request, inspector, client, [
      { ...panes[0]!, tab_id: "moved" },
    ]),
  ).toBe(false);
  expect(
    inspectorTerminalFileAdmitted(
      request,
      inspector,
      { ...client, isCurrent: () => false },
      panes,
    ),
  ).toBe(false);
});
