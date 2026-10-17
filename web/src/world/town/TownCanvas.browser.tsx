window.__HERDR_WORLD_RENDERER_DEBUG__ = true;
import { TERMINAL_COMPOSER_REQUEST_EVENT } from "../terminalComposerRequest";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Pane, Tab, Workspace } from "../../types";
import type { WorldRuntimeConnection } from "../runtimeStore";
import { buildWorldObject, type WorldObject } from "../worldObject";
import TownView from "../TownView";
import { initializeLayoutPreferences } from "../../layoutPreferences";
import { bridge, type ConnectionClient } from "../../api";
import "../world.css";

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
      const deskCount =
        scale === "max"
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
    if (method === "agent_history.get")
      return {
        history_version: 2,
        mode: "snapshot",
        cursor: { epoch: "synthetic", revision: 1 },
        window_limit: 200,
        agent: "claude",
        pane_id: paneId,
        workspace_id: String(params?.workspace_id ?? ""),
        tab_id: String(params?.tab_id ?? ""),
        updated_at: "2026-01-01T00:00:00Z",
        path: "",
        entries: [
          {
            id: "u1",
            role: "user",
            kind: "message",
            text: "Keep the oldest waiting agent first",
            sent_at: "2026-01-01T00:00:00Z",
          },
          {
            id: "a1",
            role: "assistant",
            kind: "message",
            text: "I'll sort the reception queue by when agents started waiting.",
            sent_at: "2026-01-01T00:00:01Z",
          },
        ],
      };
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
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    window.location.origin,
  );
  const match = /^\/api\/connections\/([^/]+)\/terminal-upload$/.exec(
    url.pathname,
  );
  if (!match) return realFetch(input, init);
  const connectionId = decodeURIComponent(match[1]!);
  uploads.push(connectionId);
  if (uploadGate) await uploadGate;
  return new Response(
    JSON.stringify({ path: `/uploads/${url.searchParams.get("filename")}` }),
    {
      headers: {
        "content-type": "application/json",
        "X-Herdr-Connection-Id": connectionId,
        "X-Herdr-Connection-Generation":
          url.searchParams.get("connection_generation") ?? "",
      },
    },
  );
}) as typeof fetch;

async function attachNote(host: HTMLElement) {
  const picker = host.querySelector<HTMLInputElement>(
    '.town-reply input[type="file"]',
  )!;
  const files = new DataTransfer();
  files.items.add(new File(["synthetic"], "notes.txt", { type: "text/plain" }));
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
  const roomCards = host.querySelectorAll(".town-room-card");
  const totalRooms = base.connections.reduce(
    (sum, c) => sum + (c.snapshot?.workspaces.length ?? 0),
    0,
  );
  check(
    roomCards.length === totalRooms,
    `expected ${totalRooms} room cards, found ${roomCards.length}`,
  );
  const receptions = host.querySelectorAll(".town-reception");
  check(receptions.length === 3, "every host needs one reception board");
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
    host.querySelectorAll('[aria-label^="Rename room"]').length === totalRooms,
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
  // The chatter is the agent's session history when it has one.
  await waitFor(
    () =>
      host
        .querySelector(".town-peek-screen")
        ?.textContent?.includes("I'll sort the reception queue") === true,
    "peek did not show the agent's session messages",
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
    const firstCard = host.querySelector(".town-peek");
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
      chatScreen.includes("I'll sort the reception queue") &&
        chatScreen.includes("Do you want"),
      "chat should show the agent's messages and its question",
    );
    // Direct typing happens in the full terminal.
    [...host.querySelectorAll<HTMLLabelElement>(".town-peek label")]
      .find((label) => label.textContent?.trim() === "Direct")!
      .querySelector("input")!
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
  host.querySelector<HTMLButtonElement>(".town-chooser-list button")!.click();
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
