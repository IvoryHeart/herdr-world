import { useState } from "react";
import { createRoot } from "react-dom/client";
import { bridge, type ConnectionClient } from "./api";
import { __storeTesting, store } from "./store";
import WorldInspector from "./world/WorldInspectorConversation";
import type { WorldInspectorConversation } from "./world/worldTerminalPresentation";
import "./styles/tokens.css";
import "./styles/base.css";
import "./world/world-inspector.css";

const failures: string[] = [];
const check = (condition: unknown, message: string) => {
  if (!condition) failures.push(message);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
const fingerprint = "a".repeat(64);
const subject = {
  connectionId: "alpha",
  generation: 7,
  paneId: "pane",
  terminalId: "terminal",
  sessionFingerprint: fingerprint,
};
const candidate = {
  candidateId: "tree",
  canonicalRoot: "/project/demo",
  gitCommonDir: "/project/demo/.git",
  branch: "topic",
  source: "foreground_cwd",
  evidence: {
    sourceRef: "Synthetic",
    observedAt: "2026-01-01T00:00:00Z",
    basis: "reported",
  },
};
const observation = {
  subject,
  revision: "r1",
  state: "resolved",
  candidates: [candidate],
  selectedCandidateId: "tree",
  observedAt: "2026-01-01T00:00:00Z",
};
const workspace = {
  workspace_id: "workspace",
  number: 1,
  label: "Example",
  focused: true,
  pane_count: 1,
  tab_count: 1,
  agent_status: "idle",
  cwd: "/project/demo",
};
const pane = {
  pane_id: "pane",
  terminal_id: "terminal",
  workspace_id: "workspace",
  tab_id: "tab",
  focused: true,
  agent: "claude",
  agent_status: "idle",
  revision: 1,
};
const message = {
  id: "m1",
  role: "assistant",
  kind: "message",
  text: "[Open source](/project/demo/src/main.ts:12) and [guide](https://example.test/guide). Also `/project/demo/src/main.ts:7`. [Outside](/project/other/main.ts:3).",
  sent_at: "2026-01-01T00:00:00Z",
};
const reads: Record<string, unknown>[] = [];
const client: ConnectionClient = {
  connectionId: "alpha",
  generation: 1,
  serverRuntimeGeneration: 7,
  isCurrent: () => true,
  acceptsServerGeneration: (value) => value === 7,
  async call(method, params = {}) {
    if (method === "agent_worktree.get") return observation;
    if (
      method === "agent_conversation.latest" ||
      method === "agent_conversation.get"
    )
      return {
        conversation_version: 1,
        pane_id: "pane",
        agent: "claude",
        agent_status: "idle",
        session_binding: "reported",
        session_fingerprint: fingerprint,
        session_label: "Example",
        status: "ok",
        unavailable: null,
        latest: message,
        deliveries: [],
        pending_prompt: null,
      };
    if (method === "agent_history.get")
      return {
        history_version: 2,
        mode: "snapshot",
        cursor: { epoch: "fixture", revision: 1 },
        window_limit: 200,
        agent: "claude",
        pane_id: "pane",
        workspace_id: "workspace",
        tab_id: "tab",
        updated_at: message.sent_at,
        path: "",
        entries: [message],
      };
    if (method === "file.list")
      return {
        workspace_id: "workspace",
        root: candidate.canonicalRoot,
        path: "",
        entries: [],
      };
    if (method === "git.diff_summary")
      return {
        workspace_id: "workspace",
        root: candidate.canonicalRoot,
        entries: [],
        counts: { staged: 0, unstaged: 0, untracked: 0 },
      };
    if (method === "file.read") {
      reads.push(params);
      return {
        workspace_id: "workspace",
        root: candidate.canonicalRoot,
        checkout_path: candidate.canonicalRoot,
        path: params.path,
        text: Array.from(
          { length: 40 },
          (_, i) => `const line${i + 1} = ${i + 1};`,
        ).join("\n"),
        size: 900,
        mtime_ms: 0,
        binary: false,
        truncated: false,
      };
    }
    return { ok: true };
  },
};
bridge.connection = () => client;
bridge.onControl = () => () => {};
__storeTesting.replaceState({
  ...store.get(),
  activeConnectionId: "alpha",
  connectionGeneration: 1,
  serverRuntimeGeneration: 7,
  status: "connected",
  catalogueReady: true,
  workspaces: [workspace],
  panes: [pane],
  connections: [
    {
      id: "alpha",
      label: "Example",
      source: "test",
      is_default: true,
      state: "ready",
      generation: 7,
    },
  ],
});
const host = document.createElement("div");
const target = document.createElement("div");
target.style.cssText = "height:90vh;width:96vw;position:relative";
document.body.append(host, target);
const initial: WorldInspectorConversation = {
  nodeId: "node",
  resourceIdentity: "resource",
  connectionId: "alpha",
  runtimeGeneration: 7,
  workspaceId: "workspace",
  tabId: "tab",
  paneId: "pane",
  terminalId: "terminal",
  agentSessionFingerprint: fingerprint,
  label: "Example",
  hostLabel: "Example host",
  spaceLabel: "Example space",
  context: {
    kind: "agent",
    label: "Example",
    stateLabel: "Idle",
    locationLabel: "Example",
  },
  view: "history",
  availableViews: ["history", "files", "changes"],
  dock: "right",
  size: 500,
  expanded: false,
};
let changeView: (view: "history" | "files") => void = () => {};
function Fixture() {
  const [conversation, setConversation] = useState(initial);
  changeView = (view) => setConversation((current) => ({ ...current, view }));
  return (
    <WorldInspector
      conversation={conversation}
      target={target}
      floating
      terminalActive={false}
      onChange={(change) =>
        setConversation((current) => ({ ...current, ...change }))
      }
      onClose={() => {}}
      onResourceFocus={() => {}}
      onTerminalPortalChange={() => {}}
    />
  );
}
createRoot(host).render(<Fixture />);

async function run() {
  // Wait for React, lazy resource modules and CodeMirror in the browser fixture.
  await settle();
  await settle();
  await settle();
  const origin = location.href;
  check(
    innerWidth === Number(new URLSearchParams(location.search).get("width")),
    "The fixture must use the requested CSS viewport width",
  );
  const chat = () => target.querySelector(".inspector-history-resource");
  const link = [...chat()!.querySelectorAll<HTMLAnchorElement>("a")].find(
    (anchor) => anchor.textContent === "Open source",
  );
  check(link, "The real Chat transcript must render its local Markdown link");
  link?.click();
  await settle();
  await settle();
  await settle();
  check(
    target.querySelector(".inspector-files-resource:not(.is-hidden)"),
    "Clicking Chat source must activate Files in the same Inspector",
  );
  check(
    location.href === origin,
    "A source link must preserve the browser location",
  );
  check(
    reads.some(
      (read) =>
        read.path === "src/main.ts" &&
        JSON.stringify(read.agent_worktree) ===
          JSON.stringify({ subject, revision: "r1", candidateId: "tree" }),
    ),
    "The file read must carry its originating worktree and runtime",
  );
  const detail = target.querySelector<HTMLElement>(
    ".workspace-inspector-file-detail",
  );
  check(
    detail &&
      detail.getBoundingClientRect().width > 0 &&
      detail.getBoundingClientRect().height > 0,
    "Files detail must be visible, including on phones",
  );
  check(
    target.querySelector(".cm-activeLine")?.textContent ===
      "const line12 = 12;",
    "The source preview must reveal line 12",
  );
  changeView("history");
  await settle();
  const inline = [...chat()!.querySelectorAll<HTMLAnchorElement>("a")].find(
    (anchor) => anchor.textContent === "/project/demo/src/main.ts:7",
  );
  check(inline, "Inline source references must also be clickable");
  inline?.click();
  await settle();
  await settle();
  check(
    target.querySelector(".cm-activeLine")?.textContent === "const line7 = 7;",
    "Reopening the same file must reveal the newly requested line",
  );
  check(
    document.querySelectorAll(".workspace-inspector").length === 1,
    "Source navigation must reuse the existing Inspector",
  );
  changeView("history");
  await settle();
  const before = reads.length;
  const outside = [...chat()!.querySelectorAll<HTMLAnchorElement>("a")].find(
    (anchor) => anchor.textContent === "Outside",
  );
  outside?.click();
  await settle();
  check(
    chat()
      ?.querySelector("[role=alert]")
      ?.textContent?.includes("outside the selected worktree"),
    "An unresolved local link must show an explicit notice",
  );
  check(
    reads.length === before && location.href === origin,
    "An outside-worktree link must neither read nor navigate",
  );
  chat()?.querySelector<HTMLButtonElement>("[role=alert] button")?.click();
  await settle();
  check(
    document.querySelector(".agent-worktree-picker"),
    "The notice must open the shared worktree chooser",
  );
  await fetch("/result", {
    method: "POST",
    body: JSON.stringify({ failures }),
  });
}
void run().catch((error: unknown) =>
  fetch("/result", {
    method: "POST",
    body: JSON.stringify({ failures: [String(error)] }),
  }),
);
