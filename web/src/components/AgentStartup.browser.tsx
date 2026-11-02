import { useState } from "react";
import { createRoot } from "react-dom/client";
import { bridge } from "../api";
import { AgentChat, type Conversation } from "./AgentChat";
import { ResourceConnectionClientContext } from "../useConnectionClient";
import { useAgentChatStartup } from "../world/useAgentChatStartup";
import { worldInspectorForNode } from "../world/worldTerminalPresentation";
import type { WorldObjectNode } from "../world/worldObject";
import type { InspectorView } from "../workspaceResource";
import type { Pane } from "../types";
import "../styles/tokens.css";
import "../styles/base.css";
const failures: string[] = [];
const check = (yes: boolean, message: string) => {
  if (!yes) failures.push(message);
};
const settle = () => new Promise((r) => setTimeout(r, 80));
const controls = new Set<(x: any) => void>();
let exists = false,
  current = true,
  held: ReturnType<typeof Promise.withResolvers<Conversation>> | null = null;
const originalConnection = bridge.connection,
  originalControl = bridge.onControl;
bridge.onControl = (f) => {
  controls.add(f);
  return () => controls.delete(f);
};
const reply = (id: string): Conversation => ({
  conversation_version: 1,
  pane_id: id,
  agent: "claude",
  agent_status: exists ? "idle" : "blocked",
  session_binding: exists ? "reported" : null,
  session_fingerprint: exists ? "a".repeat(64) : null,
  session_label: exists ? "Synthetic session" : null,
  status: exists ? "ok" : "unavailable",
  unavailable: exists
    ? null
    : {
        reason: "no_session",
        detail: "Install the Herdr integration for this agent.",
        command: "example integration install",
      },
  messages: [],
  latest: null,
});
const client = {
  connectionId: "synthetic",
  generation: 1,
  serverRuntimeGeneration: 7,
  isCurrent: () => current,
  acceptsServerGeneration: (v: unknown) => v === 7,
  call: async (method: string, p: Record<string, unknown> = {}) => {
    if (method === "agent_conversation.latest")
      return held ? held.promise : reply(String(p.pane_id));
    if (method === "agent_history.get")
      return {
        history_version: 2,
        mode: "snapshot",
        cursor: { epoch: exists ? "record" : "empty", revision: 1 },
        window_limit: 200,
        agent: "claude",
        pane_id: p.pane_id,
        workspace_id: "room",
        tab_id: "tab",
        updated_at: "2026-11-01T09:00:00Z",
        path: "",
        entries: [],
      };
    if (
      method === "agent_conversation.watch" ||
      method === "agent_conversation.unwatch"
    )
      return {};
    if (method === "agent_conversation.steps") return { steps: [] };
    throw Error(`Unexpected ${method}`);
  },
};
bridge.connection = () => client;
function Harness({ id }: { id: string }) {
  const pane = {
    pane_id: id,
    terminal_id: `terminal-${id}`,
    workspace_id: "room",
    tab_id: `tab-${id}`,
    focused: true,
    agent: "claude",
    agent_status: "blocked",
    revision: 1,
  } as Pane;
  const [window, setWindow] = useState(
    () =>
      worldInspectorForNode(
        {
          id,
          kind: "agent",
          actionable: true,
          connectionId: "synthetic",
          generation: 7,
          nativeId: id,
          terminalId: pane.terminal_id,
          workspaceId: "room",
          tabId: pane.tab_id,
          label: "FirstMate",
          hostLabel: "Demo",
          spaceLabel: "Room",
          pane,
        } as unknown as WorldObjectNode,
        "history",
        ["terminal", "history", "files"],
        {
          kind: "agent",
          label: "FirstMate",
          agent: "claude",
          stateLabel: "Blocked",
          locationLabel: "Room",
        },
        { dock: "right", expanded: false, size: 520 },
      )!,
  );
  const cancel = useAgentChatStartup(
    client,
    pane,
    !!window.awaitChatSession && window.view === "terminal",
    () =>
      setWindow((w) => ({ ...w, view: "history", awaitChatSession: false })),
  );
  const choose = (view: InspectorView) => {
    cancel();
    setWindow((w) => ({ ...w, view, awaitChatSession: false }));
  };
  return (
    <main data-view={window.view}>
      <nav>
        <button onClick={() => choose("terminal")}>Terminal</button>
        <button onClick={() => choose("history")}>Chat</button>
        <button onClick={() => choose("files")}>Files</button>
      </nav>
      {window.view === "terminal" ? (
        <p>Qualified terminal admission</p>
      ) : window.view === "history" ? (
        <ResourceConnectionClientContext.Provider value={client}>
          <AgentChat
            pane={pane}
            active
            onOpenTerminal={() => choose("terminal")}
            onClose={() => {}}
          />
        </ResourceConnectionClientContext.Provider>
      ) : (
        <p>Files</p>
      )}
    </main>
  );
}
async function run() {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const mount = async (id: string) => {
    root.render(<Harness key={id} id={id} />);
    await settle();
    await settle();
  };
  const push = (id: string) => {
    for (const f of controls)
      f({
        type: "agent_conversation_changed",
        connection_id: "synthetic",
        connection_generation: 7,
        pane_id: id,
      });
  };
  const view = () => host.querySelector("main")?.getAttribute("data-view");
  try {
    await mount("new-agent");
    check(
      view() === "terminal" && !host.querySelector(".agent-chat"),
      "A new agent without a session must open on Terminal",
    );
    exists = true;
    push("new-agent");
    await settle();
    await settle();
    check(
      view() === "history" && !!host.querySelector(".agent-chat"),
      "An arriving conversation must switch an untouched window to Chat",
    );
    exists = false;
    await mount("manual");
    Array.from(host.querySelectorAll<HTMLButtonElement>("nav button"))
      .find((x) => x.textContent === "Chat")!
      .click();
    await settle();
    await settle();
    const note = host.querySelector(".agent-chat-starting");
    check(
      note?.textContent?.includes("Terminal") === true &&
        !note.textContent.toLowerCase().includes("install"),
      "A pre-session blocked agent must explain Terminal without an integration hint",
    );
    note?.querySelector<HTMLButtonElement>("button")?.click();
    await settle();
    check(
      view() === "terminal",
      "Open Terminal must use the existing window's view action",
    );
    exists = true;
    push("manual");
    await settle();
    await settle();
    check(
      view() === "terminal",
      "A manual view choice must stick when the session arrives",
    );
    exists = false;
    held = Promise.withResolvers<Conversation>();
    await mount("deferred");
    Array.from(host.querySelectorAll<HTMLButtonElement>("nav button"))
      .find((x) => x.textContent === "Files")!
      .click();
    await settle();
    exists = true;
    held.resolve(reply("deferred"));
    await settle();
    await settle();
    check(
      view() === "files",
      "A delayed session reply must not replace an explicit Files choice",
    );
    held = null;
    exists = false;
    held = Promise.withResolvers<Conversation>();
    await mount("retired");
    current = false;
    exists = true;
    held.resolve(reply("retired"));
    await settle();
    await settle();
    check(
      view() === "terminal",
      "A retired runtime cannot authorize a Chat handoff",
    );
  } finally {
    root.unmount();
    host.remove();
    bridge.connection = originalConnection;
    bridge.onControl = originalControl;
  }
}
run()
  .catch((e) => failures.push(String(e)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
