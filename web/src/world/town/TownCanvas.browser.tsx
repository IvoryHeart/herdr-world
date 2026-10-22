window.__HERDR_WORLD_RENDERER_DEBUG__ = true;
import { TERMINAL_COMPOSER_REQUEST_EVENT } from "../terminalComposerRequest";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Pane, Tab, Workspace } from "../../types";
import type { WorldRuntimeConnection } from "../runtimeStore";
import { buildWorldObject, type WorldObject } from "../worldObject";
import TownView from "../TownView";
import { TOWN_SHAPES, townShapeFor } from "./townLayout";
import { TownComposer } from "./TownComposer";
import "../../components/TerminalView.css";
import "../../components/MobileControls.css";
import { requestTrace } from "../devtools/trace";
import { initializeLayoutPreferences } from "../../layoutPreferences";
import {
  bridge,
  type BridgeControlMsg,
  type ConnectionClient,
} from "../../api";
import { readCompletionSeen } from "../completionSeenState";
import "../world.css";
import { worldLocalStorage } from "../../browserStorage";
import {
  readOfficePreferences,
  WORLD_OFFICE_PREFERENCES_CHANGED_EVENT,
  writeOfficePreferences,
} from "../officePreferences";

/*
 * Synthetic Office town fixture. `?mode=test` runs checks and posts them to
 * /result; `?mode=preview` keeps running with changing statuses for review.
 * Every host, workspace and agent name here is invented.
 */

const params = new URL(location.href).searchParams;
const mode = params.get("mode") ?? "test";
const scale = params.get("scale") ?? "typical";
const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
async function waitFor(condition: () => boolean, message: string) {
  for (let index = 0; index < 400; index += 1) {
    if (condition()) return;
    await settle();
  }
  throw new Error(message);
}

function random(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOSTS = [
  {
    id: "local",
    label: "atlas",
    rooms: [
      "orbit",
      "harbor",
      "meadow",
      "lantern",
      "summit",
      "delta",
      "quarry",
      "willow",
    ],
  },
  {
    id: "build",
    label: "nova",
    rooms: [
      "gateway",
      "ledger",
      "canvas",
      "pocket",
      "compass",
      "keystone",
      "relay",
      "almanac",
    ],
  },
  {
    id: "lab",
    label: "lab",
    rooms: [
      "prism",
      "sextant",
      "archive",
      "notebook",
      "forge",
      "bench",
      "manuscript",
      "sandbox",
    ],
  },
];
const AGENTS = ["claude", "codex", "gemini"];
const NAMES = [
  "Mira",
  "Juno",
  "Theo",
  "Ivy",
  "Sol",
  "Pip",
  "Rae",
  "Ezra",
  "Lux",
  "Nia",
  "Kai",
  "Bo",
  "Wren",
  "Odin",
  "Fay",
  "Ada",
  "Moe",
  "Lyn",
  "Tess",
  "Ari",
];
const STATUSES = [
  "working",
  "working",
  "working",
  "working",
  "working",
  "done",
  "idle",
  "working",
];

type Topology = { connections: WorldRuntimeConnection[]; agentPanes: Pane[] };

function topology(seed: number): Topology {
  const r = random(seed);
  const agentPanes: Pane[] = [];
  const connections = HOSTS.map((host): WorldRuntimeConnection => {
    const roomNames =
      scale === "max"
        ? host.rooms
        : host.rooms.slice(0, 5 + Math.floor(r() * 4));
    const workspaces: Workspace[] = [];
    const tabs: Tab[] = [];
    const panes: Pane[] = [];
    roomNames.forEach((roomName, roomIndex) => {
      const workspaceId = `${host.id}-${roomName}`;
      // Extended rooms: agents spawning agents fill the first rooms far past
      // the owner's 2026-10-17 estimate of 11-15 desks.
      const extended =
        scale === "extended" && host === HOSTS[0]
          ? [100, 50, 24][roomIndex]
          : 0;
      const deskCount = extended
        ? extended
        : scale === "max"
          ? 11 + Math.floor(r() * 5)
          : 3 + Math.floor(r() * r() * 13);
      let paneTotal = 0;
      for (let d = 0; d < deskCount; d += 1) {
        const tabId = `${workspaceId}-tab-${d}`;
        // One crowded desk has more panes than drawn seats.
        const paneCount =
          host === HOSTS[0] && roomIndex === 0 && d === 0
            ? 6
            : scale === "max"
              ? 3 + Math.floor(r() * 2)
              : 2 + Math.floor(r() * 3);
        const agents = Math.min(paneCount, 1 + (r() < 0.55 ? 1 : 0));
        tabs.push({
          tab_id: tabId,
          workspace_id: workspaceId,
          number: d + 1,
          label: `task ${d + 1}`,
          focused: d === 0,
          pane_count: paneCount,
          agent_status: "working",
        });
        for (let p = 0; p < paneCount; p += 1) {
          const isAgent = p < agents;
          const name = NAMES[Math.floor(r() * NAMES.length)]!;
          const pane: Pane = {
            pane_id: `${tabId}-pane-${p}`,
            terminal_id: `${tabId}-terminal-${p}`,
            workspace_id: workspaceId,
            tab_id: tabId,
            focused: p === 0,
            agent: isAgent ? AGENTS[Math.floor(r() * AGENTS.length)]! : "",
            agent_status: isAgent
              ? STATUSES[Math.floor(r() * STATUSES.length)]!
              : "",
            task_summary: isAgent ? `${name} on ${roomName}` : undefined,
            revision: 1,
          };
          panes.push(pane);
          if (isAgent) agentPanes.push(pane);
        }
        paneTotal += paneCount;
      }
      workspaces.push({
        workspace_id: workspaceId,
        number: roomIndex + 1,
        label: roomName,
        focused: roomIndex === 0,
        pane_count: paneTotal,
        tab_count: deskCount,
        active_tab_id: `${workspaceId}-tab-0`,
        agent_status: "working",
      });
    });
    return {
      connectionId: host.id,
      label: host.label,
      source: "saved-profile",
      isDefault: host.id === "local",
      state: "ready",
      generation: 3,
      snapshotGeneration: 3,
      stale: false,
      actionable: true,
      snapshot: { workspaces, tabs, panes, agents: [] },
    };
  });
  return { connections, agentPanes };
}

/*
 * A fake owner for every synthetic host: pane.read returns an invented screen
 * (a menu question for blocked agents) and pane.send_input is recorded.
 */
const sent: { paneId: string; text: string; keys: string[] }[] = [];
const moves: { method: string; params: Record<string, unknown> }[] = [];
/** Each host's tabs in Herdr's order, for tab.list. */
let herdrTabs: (connectionId: string) => unknown[] = () => [];
let statusOf: (paneId: string) => string = () => "working";
const SCREENS = {
  blocked: [
    "● Updated the reception queue so the oldest agent waits first.",
    "",
    "  src/reception.ts  +18 -6",
    "",
    "Do you want to make this edit to src/reception.ts?",
    "❯ 1. Yes",
    "  2. Yes, and don't ask again this session",
    "  3. No, and tell the agent what to do differently (esc)",
  ],
  working: [
    "● Reading src/rooms.ts",
    "● Running the layout tests",
    "  ✓ 13 passed",
    "● Writing src/townLayout.ts",
    "✻ Thinking…",
  ],
};
// The service's conversation pushes, delivered as the bridge delivers them.
const controls = new Set<(control: BridgeControlMsg) => void>();
bridge.onControl = (handler) => {
  controls.add(handler);
  return () => controls.delete(handler);
};
const pushConversation = (connectionId: string, paneId: string) =>
  [...controls].forEach((handler) =>
    handler({
      type: "agent_conversation_changed",
      connection_id: connectionId,
      pane_id: paneId,
    }),
  );
const conversationCalls: { method: string; paneId: string }[] = [];
let latestText =
  "I'll sort the reception queue by when agents started waiting.\n\n| Queue | Order |\n|---|---|\n| reception | oldest first |";
(bridge as unknown as { connection: unknown }).connection = (
  connectionId: string,
  generation: number,
): ConnectionClient => ({
  connectionId,
  generation,
  serverRuntimeGeneration: generation,
  isCurrent: () => true,
  acceptsServerGeneration: () => true,
  call: async (method: string, params?: Record<string, unknown>) => {
    const paneId = String(params?.pane_id ?? "");
    if (method === "pane.read") {
      const status = statusOf(paneId);
      return {
        text: (status === "blocked" ? SCREENS.blocked : SCREENS.working).join(
          "\n",
        ),
      };
    }
    if (method.startsWith("agent_conversation."))
      conversationCalls.push({ method, paneId });
    if (
      method === "agent_conversation.watch" ||
      method === "agent_conversation.unwatch"
    )
      return { ok: true };
    if (method === "agent_conversation.latest")
      return conversationUnavailable
        ? {
            conversation_version: 1,
            pane_id: paneId,
            agent: "claude",
            agent_status: statusOf(paneId),
            session_binding: null,
            session_fingerprint: null,
            status: "unavailable",
            unavailable: {
              reason: "no_session",
              detail: "No saved session for this agent yet.",
            },
            latest: null,
          }
        : {
            conversation_version: 1,
            pane_id: paneId,
            agent: "claude",
            agent_status: statusOf(paneId),
            session_binding: "reported",
            session_fingerprint: "synthetic",
            status: "ok",
            unavailable: null,
            latest: {
              id: "a1",
              role: "assistant",
              kind: "message",
              text: latestText,
              sent_at: "2026-01-01T00:00:01Z",
            },
          };
    if (method === "tab.list") return { tabs: herdrTabs(connectionId) };
    if (method === "tab.move") {
      moves.push({ method, params: { ...params, connectionId } });
      return { type: "tab_list", tabs: [] };
    }
    if (method === "town.move_desk" || method === "town.move_pane") {
      moves.push({ method, params: params ?? {} });
      return { status: "moved", tab_id: "moved-tab", workspace_id: "moved" };
    }
    if (method === "pane.send_input") {
      sent.push({
        paneId,
        text: String(params?.text ?? ""),
        keys: (params?.keys as string[]) ?? [],
      });
      return {};
    }
    throw new Error(`unsupported ${method}`);
  },
});

// Uploads answer as the World service does, for the connection asked.
const uploads: string[] = [];
/** While set, uploads wait for it, as a slow upload would. */
let uploadGate: Promise<void> | null = null;
/** Set to fail the next upload, as a full disk would. */
let failNextUpload = false;
/** Set to make every conversation read unavailable. */
let conversationUnavailable = false;
async function answerUpload(url: URL): Promise<Response | null> {
  const match = /^\/api\/connections\/([^/]+)\/terminal-upload$/.exec(
    url.pathname,
  );
  if (!match) return null;
  const connectionId = decodeURIComponent(match[1]!);
  uploads.push(connectionId);
  if (uploadGate) await uploadGate;
  const headers = {
    "content-type": "application/json",
    "X-Herdr-Connection-Id": connectionId,
    "X-Herdr-Connection-Generation":
      url.searchParams.get("connection_generation") ?? "",
  };
  if (failNextUpload) {
    failNextUpload = false;
    return new Response(JSON.stringify({ error: "disk full" }), {
      status: 507,
      headers,
    });
  }
  return new Response(
    JSON.stringify({ path: `/uploads/${url.searchParams.get("filename")}` }),
    { headers },
  );
}
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    window.location.origin,
  );
  return (await answerUpload(url)) ?? realFetch(input, init);
}) as typeof fetch;
/** Uploads with byte progress use XMLHttpRequest; answer those the same way. */
class FixtureUploadRequest {
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  responseType = "";
  status = 0;
  statusText = "";
  response: Blob | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private url = new URL(window.location.origin);
  private headers = "";
  open(_method: string, url: string | URL) {
    this.url = new URL(String(url), window.location.origin);
  }
  setRequestHeader() {}
  getAllResponseHeaders() {
    return this.headers;
  }
  send(body: Blob) {
    this.upload.onprogress?.({
      loaded: body.size,
      total: body.size,
      lengthComputable: true,
    } as ProgressEvent);
    void answerUpload(this.url).then(async (response) => {
      if (!response) {
        this.onerror?.();
        return;
      }
      this.status = response.status;
      this.statusText = response.statusText;
      this.headers = [...response.headers]
        .map(([name, value]) => `${name}: ${value}`)
        .join("\r\n");
      this.response = await response.blob();
      this.onload?.();
    });
  }
}
window.XMLHttpRequest =
  FixtureUploadRequest as unknown as typeof XMLHttpRequest;

async function attachNote(host: HTMLElement, name = "notes.txt") {
  const picker = host.querySelector<HTMLInputElement>(
    '.town-reply input[type="file"]',
  )!;
  const files = new DataTransfer();
  files.items.add(new File(["synthetic"], name, { type: "text/plain" }));
  picker.files = files.files;
  picker.dispatchEvent(new Event("change", { bubbles: true }));
}

function worldFor(connections: WorldRuntimeConnection[]) {
  return buildWorldObject(connections, "local");
}

const phone = window.innerWidth < 640;

async function run() {
  // World resolves its phone layout from the viewport, as the app does.
  initializeLayoutPreferences();
  document.body.style.margin = "0";
  document.body.style.background = "#14181f";
  const layoutShell = document.createElement("div");
  layoutShell.className = "world-view-layout";
  layoutShell.style.cssText =
    "position:relative;width:100vw;height:100vh;display:flex";
  const host = document.createElement("div");
  host.className = "world-view-stage";
  host.style.cssText =
    "position:relative;flex:1;min-width:0;display:flex;flex-direction:column";
  layoutShell.append(host);
  document.body.append(layoutShell);
  const base = topology(7);
  herdrTabs = (connectionId) =>
    base.connections.find((c) => c.connectionId === connectionId)?.snapshot
      ?.tabs ?? [];
  if (!phone && mode === "test") {
    const world = worldFor(base.connections);
    const leaf = world.leaves.find((candidate) => candidate.kind === "agent")!;
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;top:0;left:0;width:320px;z-index:1000";
    document.body.append(box);
    const composerRoot = createRoot(box);
    composerRoot.render(
      <TownComposer
        leaf={leaf}
        onClose={() => {}}
        onSent={() => {}}
        onError={() => {}}
        onDirect={() => {}}
      />,
    );
    await waitFor(
      () => !!box.querySelector(".terminal-composer-input"),
      "desktop Town composer mounts",
    );
    const editor = box.querySelector<HTMLTextAreaElement>(
      ".terminal-composer-input",
    )!;
    const direct = box.querySelector<HTMLButtonElement>(
      '[aria-label="Type directly into the terminal"]',
    )!;
    check(
      editor.getBoundingClientRect().width > 0 &&
        editor.getBoundingClientRect().height > 0 &&
        direct.getBoundingClientRect().width > 0,
      "desktop Town composer keeps its draft and Direct control visible with terminal CSS loaded",
    );
    composerRoot.unmount();
    box.remove();
  }
  const blocked = base.agentPanes.filter((_, index) => index % 23 === 4);
  for (const pane of blocked) pane.agent_status = "blocked";
  statusOf = (paneId) =>
    base.agentPanes.find((pane) => pane.pane_id === paneId)?.agent_status ?? "";
  let setWorld: (world: WorldObject) => void = () => {};
  const opened: string[] = [];
  const selected: string[] = [];
  const inspected: [string, string][] = [];
  function Harness() {
    const [world, set] = useState(() => worldFor(base.connections));
    const [selectedId, setSelectedId] = useState<string | null>(null);
    useEffect(() => {
      setWorld = set;
    }, []);
    return (
      <TownView
        world={world}
        selectedId={selectedId}
        onSelect={(id) => {
          selected.push(id);
          setSelectedId(id);
        }}
        onOpenTerminal={async (id) => {
          opened.push(id);
        }}
        floatingTerminals={[]}
        onOpenInspectorView={(id, view) => inspected.push([id, view])}
      />
    );
  }
  const root = createRoot(host);
  root.render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
  await waitFor(
    () => window.__HERDR_TOWN_RENDERER__?.ready === true,
    "town renderer did not become ready",
  );
  await waitFor(
    () =>
      host.querySelector(
        '.world-semantic-targets-overlay[aria-busy="false"]',
      ) !== null,
    "town targets did not finish progressive admission",
  );

  if (mode === "preview") {
    // Keep the town alive: flip a few statuses every couple of seconds.
    const r = random(99);
    window.setInterval(() => {
      for (let i = 0; i < 3; i += 1) {
        const pane = base.agentPanes[Math.floor(r() * base.agentPanes.length)]!;
        const roll = r();
        pane.agent_status =
          pane.agent_status === "blocked"
            ? "working"
            : roll < 0.12
              ? "blocked"
              : roll < 0.3
                ? "done"
                : roll < 0.45
                  ? "idle"
                  : "working";
      }
      const next = base.connections.map((connection) => ({
        ...connection,
        snapshot: connection.snapshot && {
          ...connection.snapshot,
          panes: connection.snapshot.panes.map((pane) => ({ ...pane })),
        },
      }));
      setWorld(worldFor(next));
    }, 2500);
    return;
  }

  const diagnostics = window.__HERDR_TOWN_RENDERER__!;
  check(
    diagnostics.level === "overview",
    `default level is ${diagnostics.level}, expected overview`,
  );
  check(
    (diagnostics.layout?.buildings ?? 0) === 3,
    "town did not lay out three buildings",
  );
  const narrowTown = diagnostics.layout?.formFactor === "narrow";
  const roomCards = host.querySelectorAll(".town-room-card");
  const totalRooms = base.connections.reduce(
    (sum, c) => sum + (c.snapshot?.workspaces.length ?? 0),
    0,
  );
  // Wide screens show every building at home. A phone stacks buildings and
  // their rooms in one column, so it draws the buildings in view.
  const drawnRooms = host.querySelectorAll(".town-room").length;
  check(
    narrowTown ? drawnRooms > 0 : drawnRooms === totalRooms,
    `expected ${totalRooms} rooms drawn, found ${drawnRooms}`,
  );
  check(
    roomCards.length === drawnRooms,
    `expected ${drawnRooms} room cards, found ${roomCards.length}`,
  );
  const receptions = host.querySelectorAll(".town-reception");
  check(
    narrowTown ? receptions.length > 0 : receptions.length === 3,
    "every host in view needs one reception board",
  );
  const waitingEntries = host.querySelectorAll(".town-reception-entry").length;
  check(waitingEntries > 0, "blocked agents did not appear at reception");
  const deskTargets = host.querySelectorAll(
    '.world-semantic-target[data-kind="desk"]',
  ).length;
  const totalTabs = base.connections.reduce(
    (sum, c) => sum + (c.snapshot?.tabs.length ?? 0),
    0,
  );
  check(
    deskTargets === totalTabs,
    `expected ${totalTabs} desk targets, found ${deskTargets}`,
  );
  check(
    host.querySelectorAll('[aria-label^="Rename room"]').length === drawnRooms,
    "every room needs a rename action",
  );
  // Room actions hidden at the overview must not take a tap.
  const hiddenActions = [
    ...host.querySelectorAll<HTMLElement>(
      '[aria-label^="Rename room"], [aria-label^="Close room"], [aria-label="New room"], [aria-label^="New seat in"]',
    ),
  ];
  const tappable = hiddenActions.filter((action) => {
    const box = action.getBoundingClientRect();
    if (!box.width || box.right < 0 || box.bottom < 0) return false;
    const hit = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    return hit !== null && action.contains(hit);
  });
  check(
    tappable.length === 0,
    `${tappable.length} hidden room actions take taps at the overview`,
  );
  check(
    host.querySelectorAll('[aria-label^="New seat in"]').length > 0,
    "rooms with free spots need a new seat action",
  );

  // The rail lists every agent that needs you.
  const blockedCount = base.agentPanes.filter(
    (p) => p.agent_status === "blocked",
  ).length;
  check(
    host.querySelectorAll(".town-rail-tree .town-call-blocked").length ===
      blockedCount,
    `rail should list ${blockedCount} waiting agents`,
  );

  // A reception entry opens a peek on that agent's live question.
  const entry = host.querySelector<HTMLButtonElement>(".town-reception-entry")!;
  entry.click();
  await waitFor(
    () =>
      host
        .querySelector(".town-peek-screen")
        ?.textContent?.includes("Do you want") === true,
    "peek did not show the agent's question",
  );
  check(selected.length === 0, "a peek must not select or open an Inspector");
  const answers = host.querySelectorAll<HTMLButtonElement>(
    ".town-peek .town-answers button",
  );
  check(answers.length === 3, `expected 3 answers, found ${answers.length}`);
  answers[0]!.click();
  await waitFor(() => sent.length === 1, "answer was not sent");
  check(
    sent[0]!.text === "1" && sent[0]!.keys.length === 0,
    `answer sent ${JSON.stringify(sent[0])}`,
  );
  const peekPane = sent[0]!.paneId;
  check(
    base.agentPanes.some(
      (p) => p.pane_id === peekPane && p.agent_status === "blocked",
    ),
    "answer went to a pane that is not waiting",
  );

  const peekConnection = base.connections.find((connection) =>
    connection.snapshot?.panes.some((pane) => pane.pane_id === peekPane),
  )?.connectionId;
  // The message is the agent's latest from Chat's conversation read model.
  await waitFor(
    () =>
      host
        .querySelector(".town-peek-screen")
        ?.textContent?.includes("I'll sort the reception queue") === true,
    "peek did not show the agent's latest message",
  );
  // The message is rendered as Chat renders it, never as terminal text.
  check(
    host.querySelector(".town-peek-screen table") !== null &&
      !(host.querySelector(".town-peek-screen")?.textContent ?? "").includes(
        "|---",
      ),
    "the peek should render the message's markdown table",
  );
  // The peek watches the pane as Chat does and rereads only on a push.
  check(
    conversationCalls.some(
      (call) =>
        call.method === "agent_conversation.watch" && call.paneId === peekPane,
    ),
    "the peek did not ask the service to watch its pane",
  );
  const readsBefore = conversationCalls.filter(
    (call) => call.method === "agent_conversation.latest",
  ).length;
  await new Promise((resolve) => setTimeout(resolve, 4_500));
  check(
    conversationCalls.filter(
      (call) => call.method === "agent_conversation.latest",
    ).length === readsBefore,
    "the peek reread its conversation without a push",
  );
  latestText = "The queue now keeps the oldest agent first.";
  pushConversation(peekConnection!, peekPane);
  await waitFor(
    () =>
      host
        .querySelector(".town-peek-screen")
        ?.textContent?.includes("keeps the oldest agent first") === true,
    "a pushed change did not refresh the peek",
  );
  // The question sits in its own box above the answers.
  check(
    (
      host.querySelector(".town-peek .town-question")?.textContent ?? ""
    ).startsWith("Do you want"),
    "the peek should box the agent's question",
  );
  // The reply line: desktop types in the card; the phone layout grows World's
  // composer inside the peek. Either way Send reaches that pane only.
  if (!phone) {
    const reply = host.querySelector<HTMLInputElement>(
      ".town-reply input:not([type])",
    )!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(reply, "Use the newest file");
    reply.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    host
      .querySelector<HTMLButtonElement>('.town-reply button[type="submit"]')!
      .click();
    await waitFor(() => sent.length === 2, "reply was not sent");
    check(
      sent[1]!.paneId === peekPane &&
        sent[1]!.text.includes("Use the newest file") &&
        sent[1]!.keys.includes("enter"),
      `reply sent ${JSON.stringify(sent[1])}`,
    );
    check(opened.length === 0, "replying must not open the full terminal");
    // 📎 uploads through the pane's own connection into the reply line.
    await attachNote(host);
    await waitFor(
      () =>
        host
          .querySelector<HTMLInputElement>(".town-reply input:not([type])")
          ?.value.includes("/uploads/notes.txt") === true,
      "attachment did not reach the reply line",
    );
    check(
      uploads.length === 1 && uploads[0] === peekConnection,
      `attachment uploaded through ${JSON.stringify(uploads)}`,
    );
    check(
      host.querySelector('.town-peek .attachment-chip[data-status="done"]') !==
        null,
      "the uploaded file should show a done chip",
    );
    // A failed upload shows a failed chip with Retry; retrying delivers it.
    failNextUpload = true;
    await attachNote(host, "retry.txt");
    await waitFor(
      () =>
        host.querySelector(
          '.town-peek .attachment-chip[data-status="failed"]',
        ) !== null,
      "a failed upload did not show a failed chip",
    );
    host
      .querySelector<HTMLButtonElement>(
        '.town-peek [aria-label="Retry retry.txt"]',
      )!
      .click();
    await waitFor(
      () =>
        host
          .querySelector<HTMLInputElement>(".town-reply input:not([type])")
          ?.value.includes("/uploads/retry.txt") === true,
      "the retried upload did not reach the reply line",
    );
    uploads.length = 1;
    // A number key pressed on another control never answers the agent.
    const zoomIn = host.querySelector<HTMLButtonElement>(
      '[aria-label="Zoom in"]',
    )!;
    zoomIn.focus();
    zoomIn.dispatchEvent(
      new KeyboardEvent("keydown", { key: "1", bubbles: true }),
    );
    await settle();
    check(sent.length === 2, "a number key outside the peek sent an answer");
    // An upload that finishes after switching agents stays with its agent.
    let release!: () => void;
    uploadGate = new Promise<void>((resolve) => (release = resolve));
    await attachNote(host);
    const firstCard = host.querySelector<HTMLElement>(".town-peek");
    const firstAgentKey = firstCard?.dataset.agentKey ?? "";
    [...host.querySelectorAll<HTMLButtonElement>(".town-peek-foot button")]
      .find((button) => button.textContent?.startsWith("Next"))!
      .click();
    // Each agent session gets its own card.
    await waitFor(
      () =>
        host.querySelector(".town-peek") !== null &&
        host.querySelector(".town-peek") !== firstCard,
      "Next did not move to another agent",
    );
    release();
    uploadGate = null;
    await settle();
    await settle();
    check(
      !host
        .querySelector<HTMLInputElement>(".town-reply input:not([type])")
        ?.value.includes("/uploads/"),
      "an earlier agent's upload landed in the next agent's reply",
    );
    // It lands in that agent's reply line when its peek opens again: the
    // path is kept for the pane, not for the card that started the upload.
    host.querySelector<HTMLButtonElement>(".town-peek-close")!.click();
    await settle();
    host
      .querySelector<HTMLButtonElement>(
        `.world-semantic-target[data-kind="agent"][data-target-key="${CSS.escape(firstAgentKey)}"]`,
      )!
      .click();
    await waitFor(
      () =>
        host.querySelector<HTMLElement>(".town-peek")?.dataset.agentKey ===
        firstAgentKey,
      "the first agent's peek did not reopen",
    );
    await settle();
    const reopened =
      host.querySelector<HTMLInputElement>(".town-reply input:not([type])")
        ?.value ?? "";
    check(
      reopened.includes("/uploads/notes.txt"),
      `an upload finished while its peek was closed was lost (${JSON.stringify(reopened)})`,
    );
    check(
      host.querySelector('.town-peek .attachment-chip[data-status="done"]') !==
        null,
      "the reopened peek should show the finished upload's chip",
    );
  } else {
    // 📎 uploads through the pane's own connection into World's composer.
    await attachNote(host);
    await waitFor(
      () =>
        host
          .querySelector<HTMLTextAreaElement>(
            ".town-peek .terminal-composer-input",
          )
          ?.value.includes("/uploads/notes.txt") === true,
      "attachment did not reach the composer",
    );
    check(
      host.querySelector(".town-peek .terminal-composer .attachment-chip") !==
        null,
      "the composer should show the upload's chip",
    );
    check(
      uploads.length === 1 && uploads[0] === peekConnection,
      `attachment uploaded through ${JSON.stringify(uploads)}`,
    );
    await waitFor(
      () => host.querySelector(".town-peek .terminal-composer-input") !== null,
      "Reply did not open the composer in the peek",
    );
    const composer = host.querySelector<HTMLTextAreaElement>(
      ".town-peek .terminal-composer-input",
    )!;
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setValue.call(composer, "Use the newest file");
    composer.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    host
      .querySelector<HTMLButtonElement>(
        '.town-peek [aria-label="Send draft to the terminal"]',
      )!
      .click();
    await waitFor(() => sent.length === 2, "composer message was not sent");
    check(
      sent[1]!.paneId === peekPane &&
        sent[1]!.text.includes("Use the newest file") &&
        sent[1]!.keys.includes("enter"),
      `composer sent ${JSON.stringify(sent[1])}`,
    );
    check(opened.length === 0, "chatting must not open the full terminal");
    const chatScreen =
      host.querySelector(".town-peek-screen")?.textContent ?? "";
    check(
      chatScreen.includes("keeps the oldest agent first") &&
        chatScreen.includes("Do you want"),
      "chat should show the agent's messages and its question",
    );
    // Direct typing happens in the full terminal.
    host
      .querySelector<HTMLButtonElement>(
        '.town-peek button[aria-label="Type directly into the terminal"]',
      )!
      .click();
    await waitFor(
      () => opened.length === 1,
      "Direct did not open the terminal",
    );
    opened.length = 0;
  }

  // A desk with more panes than seats lists every pane.
  const crowded = [
    ...host.querySelectorAll<HTMLButtonElement>(
      '.world-semantic-target[data-kind="desk"]',
    ),
  ].find((target) => target.getAttribute("aria-label")?.endsWith(", 6 panes"));
  check(crowded !== undefined, "the six-pane desk has no target");
  // From the keyboard: Shift+Enter opens it with focus on the first pane,
  // and Escape closes it with focus back on the desk.
  crowded!.focus();
  crowded!.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
    }),
  );
  await waitFor(
    () => host.querySelectorAll(".town-chooser-list button").length === 6,
    "the six-pane desk did not list all six panes",
  );
  await settle();
  check(
    document.activeElement === host.querySelector(".town-chooser-list button"),
    "the chooser did not take focus",
  );
  document.activeElement!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await waitFor(
    () => host.querySelector(".town-chooser") === null,
    "Escape did not close the chooser",
  );
  await settle();
  check(document.activeElement === crowded, "focus did not return to the desk");
  opened.length = 0;

  // On the phone, Back closes the composer, then the peek, before Town.
  if (phone) {
    host.querySelector<HTMLButtonElement>(".town-reception-entry")!.click();
    await waitFor(
      () => host.querySelector(".town-message-box") !== null,
      "peek did not open for Back",
    );
    host.querySelector<HTMLButtonElement>(".town-message-box")!.click();
    await waitFor(
      () => host.querySelector(".town-peek .terminal-composer-input") !== null,
      "composer did not open for Back",
    );
    history.back();
    await waitFor(
      () =>
        host.querySelector(".town-peek .terminal-composer-input") === null &&
        host.querySelector(".town-peek") !== null,
      "Back did not close the composer first",
    );
    history.back();
    await waitFor(
      () => host.querySelector(".town-peek") === null,
      "Back did not close the peek",
    );
  }

  // Inspector opens World's Inspector on Files for that agent.
  host.querySelector<HTMLButtonElement>(".town-reception-entry")!.click();
  await waitFor(
    () => host.querySelector(".town-peek") !== null,
    "peek did not reopen",
  );
  [...host.querySelectorAll<HTMLButtonElement>(".town-peek-foot button")]
    .find((button) => button.textContent === "Inspector")!
    .click();
  await settle();
  check(
    inspected.length === 1 && inspected[0]![1] === "files",
    `Inspector opened ${JSON.stringify(inspected)}`,
  );
  check(selected.length === 0, "Inspector must not change the selection path");

  // Open terminal, in the peek's header, opens the agent's terminal.
  host.querySelector<HTMLButtonElement>(".town-reception-entry")!.click();
  await waitFor(
    () => host.querySelector(".town-peek-head .town-peek-terminal") !== null,
    "the peek header has no Open terminal",
  );
  opened.length = 0;
  host
    .querySelector<HTMLButtonElement>(".town-peek-head .town-peek-terminal")!
    .click();
  await waitFor(() => opened.length === 1, "Open terminal did not open it");
  check(
    host.querySelector(".town-peek") === null,
    "Open terminal should close the peek",
  );
  opened.length = 0;

  // An unreadable conversation shows Chat's reason, not the screen.
  conversationUnavailable = true;
  host.querySelector<HTMLButtonElement>(".town-reception-entry")!.click();
  await waitFor(
    () =>
      host
        .querySelector(".town-peek-screen")
        ?.textContent?.includes("No saved session for this agent yet.") ===
      true,
    "the peek did not show why the conversation is unavailable",
  );
  conversationUnavailable = false;
  host.querySelector<HTMLButtonElement>(".town-peek-close")!.click();
  await settle();

  // Tapping the desk of an agent waiting at reception opens its chat.
  const waitingAgent = [
    ...host.querySelectorAll<HTMLButtonElement>(
      '.world-semantic-target[data-kind="agent"]',
    ),
  ].find((target) =>
    target.getAttribute("aria-label")?.includes(", needs input, desk "),
  );
  check(waitingAgent !== undefined, "no waiting agent has a target");
  const [waitingName, , deskName, roomName, hostName] = waitingAgent!
    .getAttribute("aria-label")!
    .split(", ");
  const waitingDesk = [
    ...host.querySelectorAll<HTMLButtonElement>(
      '.world-semantic-target[data-kind="desk"]',
    ),
  ].find((target) =>
    target
      .getAttribute("aria-label")
      ?.toLowerCase()
      .includes(`${deskName}, ${roomName}, ${hostName},`.toLowerCase()),
  );
  check(waitingDesk !== undefined, "the waiting agent's desk has no target");
  waitingDesk?.click();
  await waitFor(
    () =>
      host.querySelector(`.town-peek[aria-label="${waitingName} peek"]`) !==
        null && host.querySelector(".town-peek .town-pill-blocked") !== null,
    "tapping a desk did not open its waiting agent's chat",
  );
  check(opened.length === 0, "tapping a desk in Chat mode opened a terminal");
  host.querySelector<HTMLButtonElement>(".town-peek-close")!.click();
  await settle();

  const waitingKey = waitingAgent?.dataset.targetKey ?? "";
  await waitFor(
    () => window.__HERDR_TOWN_RENDERER__!.summoned.includes(waitingKey),
    "the tapped agent did not walk to its desk",
  );

  // With Town opens set to Terminal, tapping a finished agent's table opens
  // its terminal, brings it to its desk too, and marks nothing reviewed.
  writeOfficePreferences(worldLocalStorage, {
    ...readOfficePreferences(worldLocalStorage),
    townOpens: "terminal",
  });
  window.dispatchEvent(new Event(WORLD_OFFICE_PREFERENCES_CHANGED_EVENT));
  await settle();
  const finishedAgent = [
    ...host.querySelectorAll<HTMLButtonElement>(
      '.world-semantic-target[data-kind="agent"]',
    ),
  ].find(
    (target) =>
      target.getAttribute("aria-label")?.includes(", done, desk ") &&
      !window.__HERDR_TOWN_RENDERER__!.summoned.includes(
        target.dataset.targetKey ?? "",
      ),
  );
  check(finishedAgent !== undefined, "no finished agent has a target");
  const [, , finishedDesk, finishedRoom, finishedHost] = finishedAgent!
    .getAttribute("aria-label")!
    .split(", ");
  const seenBefore = [...readCompletionSeen(worldLocalStorage)].sort().join();
  [
    ...host.querySelectorAll<HTMLButtonElement>(
      '.world-semantic-target[data-kind="desk"]',
    ),
  ]
    .find((target) =>
      target
        .getAttribute("aria-label")
        ?.toLowerCase()
        .includes(
          `${finishedDesk}, ${finishedRoom}, ${finishedHost},`.toLowerCase(),
        ),
    )
    ?.click();
  await waitFor(
    () => opened.length === 1,
    "Terminal mode did not open the terminal",
  );
  check(
    host.querySelector(".town-peek") === null,
    "Terminal mode opened a peek",
  );
  await waitFor(
    () =>
      window.__HERDR_TOWN_RENDERER__!.summoned.includes(
        finishedAgent?.dataset.targetKey ?? "",
      ),
    "Terminal mode did not bring the agent to its desk",
  );
  check(
    [...readCompletionSeen(worldLocalStorage)].sort().join() === seenBefore,
    "Terminal mode marked the finished agent reviewed",
  );
  writeOfficePreferences(worldLocalStorage, {
    ...readOfficePreferences(worldLocalStorage),
    townOpens: "chat",
  });
  window.dispatchEvent(new Event(WORLD_OFFICE_PREFERENCES_CHANGED_EVENT));
  await settle();
  opened.length = 0;

  // Opening a desk's terminal on desktop must leave its keys to the terminal:
  // no hidden composer may be requested.
  if (!phone) {
    let composerRequests = 0;
    const countRequest = () => (composerRequests += 1);
    window.addEventListener(TERMINAL_COMPOSER_REQUEST_EVENT, countRequest);
    [
      ...host.querySelectorAll<HTMLButtonElement>(
        '.world-semantic-target[data-kind="desk"]',
      ),
    ]
      .find(
        (target) => !target.getAttribute("aria-label")?.endsWith(", 6 panes"),
      )!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await waitFor(() => opened.length === 1, "desk did not open its terminal");
    window.removeEventListener(TERMINAL_COMPOSER_REQUEST_EVENT, countRequest);
    check(
      composerRequests === 0,
      "desktop terminals must not open World's composer",
    );
    opened.length = 0;
  }

  // On a phone, home fits one building; − steps out to the whole town and +
  // comes back.
  if (phone) {
    const home = diagnostics.zoom;
    host.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')!.click();
    await waitFor(
      () => window.__HERDR_TOWN_RENDERER__!.zoom < home * 0.8,
      "zoom out did not reach the whole town",
    );
    host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click();
    await waitFor(
      () => Math.abs(window.__HERDR_TOWN_RENDERER__!.zoom - home) < home * 0.05,
      "zoom in did not return home",
    );
  }

  // Room card activation zooms into the room.
  const zoomBefore = diagnostics.zoom;
  // Cards remount when the camera passes the whole-town level.
  host.querySelector<HTMLButtonElement>(".town-room-card")!.click();
  await waitFor(
    () => window.__HERDR_TOWN_RENDERER__!.zoom > zoomBefore * 1.3,
    "room card did not zoom in",
  );
  await waitFor(
    () => window.__HERDR_TOWN_RENDERER__!.level !== "overview",
    "zoomed room stayed at overview",
  );
  check(selected.length === 0, "a room tap must not open an Inspector");

  // From the keyboard, M on a desk lists the host's other rooms; choosing one
  // asks the service to move that desk there.
  const deskTarget = [
    ...host.querySelectorAll<HTMLButtonElement>(
      '.world-semantic-target[data-kind="desk"]',
    ),
  ].find(
    (target) => !target.getAttribute("aria-label")?.endsWith(", 6 panes"),
  )!;
  deskTarget.focus();
  deskTarget.dispatchEvent(
    new KeyboardEvent("keydown", { key: "m", bubbles: true }),
  );
  await waitFor(
    () => host.querySelectorAll(".town-chooser-list button").length > 0,
    "M on a desk did not list rooms to move it to",
  );
  // The desk's own room comes first: other desks' places, then Last.
  const choices = [
    ...host.querySelectorAll<HTMLButtonElement>(".town-chooser-list button"),
  ];
  check(
    choices[0]?.textContent?.includes("’s place") === true,
    `M on a desk lists places in its room first (${choices[0]?.textContent})`,
  );
  choices.find((button) => button.textContent?.includes(" desks"))!.click();
  await waitFor(
    () => moves.length === 1,
    "choosing a room did not move the desk",
  );
  const deskMove = moves[0]!;
  check(
    deskMove.method === "town.move_desk" &&
      typeof deskMove.params.tab_id === "string" &&
      typeof deskMove.params.workspace_id === "string" &&
      !String(deskMove.params.tab_id).startsWith(
        `${deskMove.params.workspace_id}-tab-`,
      ),
    `desk move sent ${JSON.stringify(deskMove)}`,
  );
  // A touch hold lifts a desk; a second finger turns it into a pinch and
  // drops the drag cleanly.
  const canvasHost = host.querySelector("canvas")!.parentElement!;
  const heldDesk = [
    ...host.querySelectorAll<HTMLElement>(
      '.world-semantic-target[data-kind="desk"]',
    ),
  ].find((target) => {
    const box = target.getBoundingClientRect();
    return (
      box.width > 0 &&
      box.left > 0 &&
      box.top > 0 &&
      box.right < window.innerWidth &&
      box.bottom < window.innerHeight
    );
  });
  if (heldDesk) {
    // Record it in Town's event trace, as the settings menu would turn it on.
    requestTrace("town", true);
    await waitFor(
      () => host.querySelector('[aria-label="Town event trace"]') !== null,
      "the Town event trace did not open",
    );
    const box = heldDesk.getBoundingClientRect();
    const touch = (type: string, id: number, x: number, y: number) =>
      canvasHost.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: id,
          pointerType: "touch",
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
          clientX: x,
          clientY: y,
        }),
      );
    touch(
      "pointerdown",
      21,
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    await waitFor(
      () => host.querySelector(".town-drag-ghost") !== null,
      "holding a desk did not lift it",
    );
    touch("pointerdown", 22, box.left + 4, box.top + 4);
    await waitFor(
      () => host.querySelector(".town-drag-ghost") === null,
      "a second finger did not drop the drag",
    );
    touch("pointerup", 22, box.left + 4, box.top + 4);
    touch("pointerup", 21, box.left + box.width / 2, box.top + box.height / 2);
    check(moves.length === 1, "a cancelled drag must not move anything");
    // The exported trace holds the gesture (input, transitions, effects) and
    // the frames it asked for, with their reasons, once they are drawn.
    const drawn = window.__HERDR_TOWN_RENDERER__?.frames ?? 0;
    await waitFor(
      () => (window.__HERDR_TOWN_RENDERER__?.frames ?? 0) >= drawn + 2,
      "Town drew no frame after the gesture",
    );
    let exported = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          exported = text;
        },
      },
    });
    [
      ...host.querySelectorAll<HTMLButtonElement>(
        '[aria-label="Town event trace"] button',
      ),
    ]
      .find((button) => button.textContent === "Copy trace")!
      .click();
    await waitFor(() => exported !== "", "the Town trace did not export");
    check(
      ["pressing → card", "liftCard", "settleCard", "pinchStart"].every(
        (text) => exported.includes(text),
      ),
      `Town's trace export holds the hold, lift and pinch (${exported.slice(0, 300)})`,
    );
    const frames = (
      JSON.parse(exported) as {
        entries: { kind: string; detail?: { reasons?: string[] } }[];
      }
    ).entries.filter((entry) => entry.kind === "frame");
    check(
      frames.some((entry) => entry.detail?.reasons?.includes("drag")),
      `Town's trace export holds a frame and its reason (${JSON.stringify(frames.slice(-6))})`,
    );
    requestTrace("town", false);
  }

  // Holding a desk and dropping it on another desk of its room reorders the
  // room's tabs with Herdr's tab.move on that host, as Spaces does.
  const [fromDesk, ontoDesk] = (() => {
    const visible = [
      ...host.querySelectorAll<HTMLElement>(
        '.world-semantic-target[data-kind="desk"]',
      ),
    ].filter((target) => {
      const box = target.getBoundingClientRect();
      return (
        box.width > 0 &&
        box.left > 0 &&
        box.top > 0 &&
        box.right < window.innerWidth &&
        box.bottom < window.innerHeight
      );
    });
    const room = (target: HTMLElement) => {
      const [connectionId, , tabId] = JSON.parse(target.dataset.targetKey!);
      return `${connectionId} ${String(tabId).replace(/-tab-\d+$/, "")}`;
    };
    for (const from of visible) {
      const onto = visible.find(
        (other) => other !== from && room(other) === room(from),
      );
      if (onto) return [from, onto];
    }
    return [];
  })();
  // Every move that lands is drawn landing, with dust unless motion is
  // reduced: a same-room reorder and a move to another room alike.
  const drags = () => window.__HERDR_TOWN_RENDERER__!.drags;
  const landed = async (
    since: { landings: number; dust: number },
    why: string,
  ) => {
    await waitFor(
      () => drags().landings > since.landings,
      `${why} did not land`,
    );
    check(
      window.__HERDR_TOWN_RENDERER__!.reducedMotion ||
        drags().dust > since.dust,
      `${why} landed without dust`,
    );
  };
  if (fromDesk && ontoDesk) {
    const before = moves.length;
    const drawn = { ...drags() };
    const at = (target: HTMLElement) => {
      const box = target.getBoundingClientRect();
      return [box.left + box.width / 2, box.top + box.height / 2] as const;
    };
    const press = (type: string, [x, y]: readonly [number, number]) =>
      canvasHost.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 31,
          pointerType: "touch",
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
          clientX: x,
          clientY: y,
        }),
      );
    press("pointerdown", at(fromDesk));
    await waitFor(
      () => host.querySelector(".town-drag-ghost") !== null,
      "holding a desk did not lift it for a reorder",
    );
    press("pointermove", at(ontoDesk));
    await waitFor(
      () =>
        host.querySelector<HTMLElement>(".town-drag-ghost")?.dataset.valid ===
        "true",
      "a desk in its own room was not a drop target",
    );
    check(
      host.querySelector(".town-drag-ghost")!.textContent!.includes("’s place"),
      "the drag names the reorder",
    );
    press("pointerup", at(ontoDesk));
    await waitFor(
      () => moves.length === before + 1,
      "dropping a desk on another in its room did not reorder",
    );
    const [connectionId, , tabId] = JSON.parse(fromDesk.dataset.targetKey!);
    const reorder = moves[before]!;
    check(
      reorder.method === "tab.move" &&
        reorder.params.tab_id === tabId &&
        reorder.params.connectionId === connectionId &&
        typeof reorder.params.insert_index === "number",
      `desk reorder sent ${JSON.stringify(reorder)}`,
    );
    await landed(drawn, "a reordered desk");

    // Carried to another room's floor, the desk moves there with
    // town.move_desk and lands the same way.
    const rooms = [
      ...host.querySelectorAll<HTMLElement>(
        '.world-semantic-target[data-kind="room"]',
      ),
    ].filter((target) => {
      const box = target.getBoundingClientRect();
      return (
        box.width > 0 &&
        box.left > 0 &&
        box.top > 0 &&
        box.right < window.innerWidth &&
        box.bottom + 40 < window.innerHeight
      );
    });
    const floor = (target: HTMLElement) => {
      const box = target.getBoundingClientRect();
      return [box.left + box.width / 2, box.bottom + 24] as const;
    };
    let moved = false;
    for (const room of rooms) {
      const ghost = () => host.querySelector<HTMLElement>(".town-drag-ghost");
      press("pointerdown", at(fromDesk));
      await waitFor(() => ghost() !== null, "holding a desk did not lift it");
      press("pointermove", floor(room));
      await settle();
      const label = ghost()?.textContent ?? "";
      if (
        ghost()?.dataset.valid !== "true" ||
        label.includes("’s place") ||
        label.includes("last of")
      ) {
        // Not another room here: carry it back home and let it go.
        press("pointermove", at(fromDesk));
        press("pointerup", [-10, -10]);
        await waitFor(() => ghost() === null, "a cancelled carry stayed up");
        continue;
      }
      const before = moves.length;
      const drawn = { ...drags() };
      press("pointerup", floor(room));
      await waitFor(
        () => moves.length === before + 1,
        "dropping a desk in another room did not move it",
      );
      check(
        moves[before]!.method === "town.move_desk",
        `a cross-room drop sent ${JSON.stringify(moves[before])}`,
      );
      await landed(drawn, "a desk moved to another room");
      moved = true;
      break;
    }
    check(moved, "no visible room took a carried desk");
  } else check(false, "no two visible desks share a room");

  // Town shows no move icons; moving is by drag, hold or the keyboard.
  check(
    !host.querySelector(".town-desk-move") &&
      ![...host.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "Move…",
      ),
    "Town shows a visible move control",
  );

  // A blocked agent walks to reception when its status changes.
  const pane = base.agentPanes.find((p) => p.agent_status === "working")!;
  pane.agent_status = "blocked";
  setWorld(
    worldFor(
      base.connections.map((connection) => ({
        ...connection,
        snapshot: connection.snapshot && {
          ...connection.snapshot,
          panes: connection.snapshot.panes.map((p) => ({ ...p })),
        },
      })),
    ),
  );
  await waitFor(
    () =>
      window.__HERDR_TOWN_RENDERER__!.walking > 0 ||
      window.__HERDR_TOWN_RENDERER__!.reducedMotion,
    "blocked agent did not walk",
  );
  check(
    diagnostics.lastError === null,
    `renderer error: ${diagnostics.lastError}`,
  );

  if (scale === "extended") {
    // Rooms extend: every tab has a desk, the newest included, and zooming
    // into the 100-desk room opens at its first desks.
    const tabs = base.connections.flatMap((c) => c.snapshot?.tabs ?? []);
    check(
      diagnostics.desks === tabs.length,
      `an extended town drew ${diagnostics.desks} of ${tabs.length} desks`,
    );
    // Earlier checks leave the camera at a desk; step out until the 100-desk
    // room's card shows (on a phone, Zoom out returns to the first building).
    const orbitCard = () =>
      [...host.querySelectorAll<HTMLButtonElement>(".town-room-card")].find(
        (card) => card.textContent?.includes("orbit"),
      );
    for (let step = 0; step < 6 && !orbitCard(); step += 1) {
      host.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    const roomCard = orbitCard();
    check(
      roomCard !== undefined,
      `the 100-desk room has no card (level ${diagnostics.level}, zoom ${diagnostics.zoom.toFixed(2)}, ${host.querySelectorAll(".town-room-card").length} cards)`,
    );
    roomCard?.click();
    const first = () =>
      [
        ...host.querySelectorAll<HTMLElement>(
          '.world-semantic-target[data-kind="desk"]',
        ),
      ].find(
        (target) =>
          JSON.parse(target.dataset.targetKey!)[2] === "local-orbit-tab-0",
      );
    await waitFor(() => {
      const box = first()?.getBoundingClientRect();
      return (
        !!box &&
        box.width > 0 &&
        box.top >= 0 &&
        box.left >= 0 &&
        box.bottom <= window.innerHeight &&
        box.right <= window.innerWidth
      );
    }, "zooming into the 100-desk room did not show its first desk");
    const newest = [
      ...host.querySelectorAll<HTMLElement>(
        '.world-semantic-target[data-kind="desk"]',
      ),
    ].some(
      (target) =>
        JSON.parse(target.dataset.targetKey!)[2] === "local-orbit-tab-99",
    );
    check(newest, "the 100-desk room's newest desk has no target");
    check(
      diagnostics.lastError === null,
      `renderer error at scale: ${diagnostics.lastError}`,
    );

    // The town takes its shape from its container: phones and portrait
    // screens stack buildings and rooms grow downward; wide screens use
    // columns of rooms on one street.
    const stage = host.querySelector("canvas")!.parentElement!;
    const expected = townShapeFor(stage.clientWidth, stage.clientHeight);
    const shown = diagnostics.layout!;
    check(
      shown.formFactor === expected.formFactor &&
        shown.roomColumns === expected.roomColumns &&
        shown.deskColumns === expected.deskColumns,
      `the town's shape ${JSON.stringify(shown)} does not fit a ${stage.clientWidth}x${stage.clientHeight} container`,
    );
    // Half-width windows sit in between: portrait or medium, both two
    // columns of rooms.
    const fits =
      window.innerWidth < 640
        ? [TOWN_SHAPES.phone]
        : window.innerHeight > window.innerWidth * 1.3
          ? [TOWN_SHAPES.portrait]
          : window.innerWidth >= 1200
            ? [TOWN_SHAPES.wide]
            : [TOWN_SHAPES.portrait, TOWN_SHAPES.medium];
    check(
      fits.some((shape) => shape === expected),
      `a ${window.innerWidth}x${window.innerHeight} window got ${JSON.stringify(expected)}`,
    );

    // A room that grows while the user holds the town waits to reflow until
    // they let go and pause; then every new desk is drawn.
    const before = diagnostics.layout!.geometry;
    const press = (type: string) =>
      stage.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 51,
          pointerType: "mouse",
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
          clientX: 20,
          clientY: stage.clientHeight - 20,
        }),
      );
    press("pointerdown");
    const snapshot = base.connections[0]!.snapshot!;
    const grown = "local-meadow";
    for (let index = 24; index < 64; index += 1) {
      const tabId = `${grown}-tab-${index}`;
      snapshot.tabs.push({
        tab_id: tabId,
        workspace_id: grown,
        number: index + 1,
        label: `task ${index + 1}`,
        focused: false,
        pane_count: 1,
        agent_status: "unknown",
      });
      snapshot.panes.push({
        pane_id: `${tabId}-pane-0`,
        terminal_id: `${tabId}-terminal-0`,
        workspace_id: grown,
        tab_id: tabId,
        focused: false,
        agent: "",
        agent_status: "",
        revision: 1,
      });
    }
    setWorld(
      worldFor(
        base.connections.map((connection) => ({
          ...connection,
          snapshot: connection.snapshot && {
            ...connection.snapshot,
            tabs: [...connection.snapshot.tabs],
            panes: [...connection.snapshot.panes],
          },
        })),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
    check(
      diagnostics.layout!.geometry === before,
      "the town reflowed while the user held it",
    );
    press("pointerup");
    const tabs2 = base.connections.flatMap((c) => c.snapshot?.tabs ?? []);
    await waitFor(
      () =>
        diagnostics.layout!.geometry !== before &&
        diagnostics.desks === tabs2.length,
      "the grown room never reflowed after the user let go",
    );
    check(
      diagnostics.lastError === null,
      `renderer error after a reflow: ${diagnostics.lastError}`,
    );
  }

  // StrictMode mounts twice; exactly one renderer and canvas must survive.
  check(
    diagnostics.activeApplications === 1,
    `expected one live renderer, found ${diagnostics.activeApplications}`,
  );
  check(
    document.querySelectorAll("canvas[data-office-canvas]").length === 1,
    "duplicate town canvases",
  );
  root.unmount();
  await settle();
  check(
    window.__HERDR_TOWN_RENDERER__!.activeApplications === 0,
    "unmount left a live renderer",
  );
  check(
    document.querySelectorAll("canvas[data-office-canvas]").length === 0,
    "unmount left a town canvas",
  );
}

run()
  .catch((error: unknown) => {
    failures.push(error instanceof Error ? error.message : String(error));
  })
  .finally(() => {
    if (mode === "test")
      void fetch("/result", { method: "POST", body: JSON.stringify(failures) });
  });
