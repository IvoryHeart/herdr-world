window.__HERDR_WORLD_RENDERER_DEBUG__ = true;
import { TERMINAL_COMPOSER_REQUEST_EVENT } from "../terminalComposerRequest";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Pane, Tab, Workspace } from "../../types";
import type { WorldRuntimeConnection } from "../runtimeStore";
import { buildWorldObject, type WorldObject } from "../worldObject";
import TownView from "../TownView";
import { projectWorldOffice } from "../herdrOfficeProjection";
import type { WorldAsk } from "../worldAsks";
import { townCalls, unseenTownCompletions } from "./TownRail";
import { townAttentionDesks } from "./townAttention";
import type { BoardDocument, BoardOp } from "../board/boardDocument";
import {
  WorldPanelsContext,
  type WorldPanelEntry,
} from "../windows/WorldPanel";
import { TOWN_SHAPES, townShapeFor } from "./townLayout";
import "../../components/TerminalView.css";
import "../../components/MobileControls.css";
import { requestTrace } from "../devtools/trace";
import { initializeLayoutPreferences } from "../../layoutPreferences";
import {
  bridge,
  type BridgeControlMsg,
  type ConnectionClient,
} from "../../api";
import {
  officeCompletionIdentity,
  readCompletionSeen,
} from "../completionSeenState";
import { worldSourcesStore } from "../worldSources";
import "../world.css";
import {
  joinGroup,
  leaveGroups,
  observedSpawnClaims,
  type RelationGroup,
  type SpawnClaim,
  type TerminalRef,
} from "../../../../shared/relations";
import { relationObservations } from "../relations";
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
async function waitFor(
  condition: () => boolean,
  message: string | (() => string),
) {
  for (let index = 0; index < 400; index += 1) {
    if (condition()) return;
    await settle();
  }
  throw new Error(typeof message === "string" ? message : message());
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
      scale === "navigation"
        ? host === HOSTS[0]
          ? Array.from({ length: 128 }, (_, index) => `focus-room-${index}`)
          : [`${host.id}-destination`]
        : scale === "max"
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
        (scale === "extended" || scale === "protected") && host === HOSTS[0]
          ? [scale === "protected" ? 160 : 100, 50, 24][roomIndex]
          : 0;
      const deskCount =
        scale === "navigation"
          ? 1
          : extended
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
    // An agent in the first room spawned the one at the next desk.
    const [first] = workspaces;
    const child = panes.find(
      (pane) => pane.pane_id === `${first?.workspace_id}-tab-1-pane-0`,
    );
    if (child)
      (child as Pane & { tokens?: Record<string, string> }).tokens = {
        spawned_by: `${first!.workspace_id}-tab-2-pane-0`,
      };
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
      snapshot: {
        workspaces,
        tabs,
        panes,
        // Screenshots only (?names=demo): Herdr names for every agent.
        agents:
          typeof location !== "undefined" &&
          new URLSearchParams(location.search).get("names") === "demo"
            ? panes
                .filter((pane) => pane.agent)
                .map((pane) => ({
                  pane_id: pane.pane_id,
                  terminal_id: pane.terminal_id,
                  agent: pane.agent,
                  agent_status: pane.agent_status,
                  name: pane.task_summary?.split(" ")[0]?.toLowerCase(),
                }))
            : [],
      },
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
    if (method === "agent_quest.list")
      return {
        // A quest belongs to its pane, whatever order the panes are asked in.
        quests: ((params?.pane_ids as string[] | undefined) ?? []).map(
          (pane_id) => {
            const index = [...pane_id].reduce(
              (sum, char) => sum + char.charCodeAt(0),
              0,
            );
            return {
              pane_id,
              agent: "claude",
              session_binding: "reported",
              quest:
                index % 2
                  ? null
                  : {
                      quest_version: 1,
                      // A loop has no steps: its pennant has no bar.
                      ...(index % 4
                        ? { source: "todo", tool: "TodoWrite" }
                        : {
                            source: "loop",
                            tool: "ScheduleWakeup",
                            iterations: 3,
                          }),
                      title: "Synthetic quest",
                      status: "active",
                      steps: [],
                      progress: { done: index % 3, total: index % 4 ? 3 : 0 },
                      started_at: "2026-01-01T00:00:00Z",
                      updated_at: "2026-01-01T00:00:01Z",
                      set_by: null,
                      helpers: 0,
                    },
            };
          },
        ),
      };
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

/*
 * World's Board store, as the service keeps it: terminal, workspace and host
 * colours (card.color), groups joined with the shared rules, and every patch
 * recorded.
 */
const boardPatches: { op: string; [key: string]: unknown }[] = [];
let boardDocument: BoardDocument = {
  version: 1,
  revision: 1,
  layout: { anchors: {}, offsets: {}, pinned: {}, folded: [], colors: {} },
  notes: [],
  strings: [],
  relations: { spawns: [] as SpawnClaim[], groups: [] as RelationGroup[] },
};
// `?colors=demo` (for screenshots) starts with chosen room and host colours.
if (params.get("colors") === "demo")
  boardDocument.layout.colors = {
    "local:local-orbit": "teal",
    "local:local-harbor": "pink",
    "@host:local": "purple",
    "@host:build": "orange",
  };
const boardListeners = new Set<
  (control: { type: string; revision?: number }) => void
>();
const worldBridge = bridge as unknown as {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onControl(listener: (control: { type: string }) => void): () => void;
};
const bridgeCall = worldBridge.call.bind(bridge);
/** One open question from an agent (`herdr-world ask`), as the service keeps it. */
const askAnswers: { id: string; answer: string }[] = [];
const ledger = {
  version: 1,
  revision: 1,
  changes: [],
  results: [],
  asks: [
    {
      id: "q-synthetic-1",
      at: Date.now() - 90_000,
      actor: { label: "claude in w1:p2", verified: true },
      question: "Ship the reception fix now, or wait for review?",
      options: ["Ship", "Wait"],
      owner_only: true,
    } as WorldAsk,
  ],
};
worldBridge.call = async (method, params) => {
  if (method === "world.asks.get") return structuredClone(ledger);
  if (method === "world.ask.answer") {
    const id = String(params?.id);
    askAnswers.push({ id, answer: String(params?.answer) });
    ledger.asks = ledger.asks.filter((ask) => ask.id !== id);
    ledger.revision += 1;
    return structuredClone({ revision: ledger.revision, asks: ledger.asks });
  }
  if (method === "world.board.get") return structuredClone(boardDocument);
  if (method === "world.board.patch") {
    for (const op of (params?.ops ?? []) as {
      op: string;
      id: string;
      members: TerminalRef[];
      target: TerminalRef[];
      key: string;
      color: Extract<BoardOp, { op: "card.color" }>["color"];
    }[]) {
      boardPatches.push(op);
      if (op.op === "card.color") {
        const colors = (boardDocument.layout.colors ??= {});
        if (op.color) colors[op.key] = op.color;
        else delete colors[op.key];
      }
      const relations = (boardDocument.relations ??= {
        spawns: [],
        groups: [],
      });
      const groups = relations.groups;
      relations.groups =
        op.op === "group.join"
          ? joinGroup(groups, op.members, op.target, op.id, Date.now())
          : op.op === "group.leave"
            ? leaveGroups(groups, op.members)
            : groups;
    }
    boardDocument = { ...boardDocument, revision: boardDocument.revision + 1 };
    for (const listener of boardListeners)
      listener({
        type: "world_board_changed",
        revision: boardDocument.revision,
      });
    return { document: structuredClone(boardDocument) };
  }
  return bridgeCall(method, params);
};
const bridgeOnControl = worldBridge.onControl.bind(bridge);
worldBridge.onControl = (listener) => {
  boardListeners.add(listener);
  const off = bridgeOnControl(listener);
  return () => {
    boardListeners.delete(listener);
    off();
  };
};

/** Set to make every conversation read unavailable. */
let conversationUnavailable = false;

/** Show an agent's hover card, as a pointer over its reception entry does. */
function hoverEntry(entry: Element) {
  entry.dispatchEvent(
    new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }),
  );
}

/**
 * Teams: the fixture's spawn token draws a connector; dragging one desk onto
 * another in its room groups them (a mouse on wide screens, a held touch on
 * phones), seats its tab after the other's in Herdr and walls them in.
 */
async function groupTwoDesks(
  host: HTMLElement,
  canvasHost: HTMLElement,
  room: string,
) {
  await waitFor(
    () => host.querySelector('.town-team-link[data-kind="spawned"]') !== null,
    "a spawned agent's desk has no connector to its parent's",
  );
  // The spawned desk ("task 2") wears its parent's ("task 3") colour.
  const deskColor = (name: string) =>
    host
      .querySelector<HTMLElement>(
        `.world-semantic-target[data-kind="desk"][aria-label^="Desk ${name}, ${room},"]`,
      )
      ?.getAttribute("data-color");
  await waitFor(
    () =>
      Boolean(deskColor("task 3")) &&
      deskColor("task 2") === deskColor("task 3"),
    `the spawned desk does not inherit its parent's colour (${deskColor("task 2")} vs ${deskColor("task 3")})`,
  );
  // Visible, with its centre (where the pointer rests) clear of the edge
  // zone and the rail on wide screens, where a carried desk pans the town
  // and would slide away from the desk it rests on.
  const clear = 64;
  const left = phone ? clear : 252 + clear;
  const onScreen = (target: HTMLElement) => {
    const box = target.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    return (
      box.width > 0 &&
      box.left > 8 &&
      box.top > 8 &&
      box.right < window.innerWidth - 8 &&
      box.bottom < window.innerHeight - 8 &&
      x > left &&
      x < window.innerWidth - clear &&
      y > clear &&
      y < window.innerHeight - clear
    );
  };
  const desks = [
    ...host.querySelectorAll<HTMLElement>(
      '.world-semantic-target[data-kind="desk"]',
    ),
  ].filter(onScreen);
  const roomOf = (target: HTMLElement) =>
    target.getAttribute("aria-label")?.split(", ")[1];
  // A desk not yet in a team, and another in its room.
  const teamless = (target: HTMLElement) =>
    !target.getAttribute("aria-label")?.includes(", in a team with ");
  const from = desks.find(
    (target) =>
      teamless(target) &&
      desks.some(
        (other) => other !== target && roomOf(other) === roomOf(target),
      ),
  );
  const to =
    from &&
    desks.find((target) => target !== from && roomOf(target) === roomOf(from));
  check(Boolean(from && to), "no two desks of one room on screen to group");
  if (!from || !to) return;
  const walled = () =>
    [...host.querySelectorAll<SVGElement>(".town-team-wall")].reduce(
      (sum, wall) => sum + Number(wall.dataset.desks ?? 0),
      0,
    );
  const walls = walled();
  const kind = phone ? "touch" : "mouse";
  const point = (type: string, x: number, y: number) =>
    canvasHost.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 31,
        pointerType: kind,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: x,
        clientY: y,
      }),
    );
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const start = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
  const end = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  point("pointerdown", start.x, start.y);
  if (phone)
    await waitFor(
      () => host.querySelector(".town-drag-ghost") !== null,
      "holding a desk did not lift it to group",
    );
  for (let step = 1; step <= 8; step += 1) {
    point(
      "pointermove",
      start.x + ((end.x - start.x) * step) / 8,
      start.y + ((end.y - start.y) * step) / 8,
    );
    await settle();
  }
  // Resting on the other desk snaps to it: the plaque offers to group.
  await waitFor(
    () =>
      host
        .querySelector(".town-drag-ghost")
        ?.textContent?.startsWith("Group with") === true,
    () =>
      `a desk resting on another does not offer to group (ghost: ${host.querySelector(".town-drag-ghost")?.textContent ?? "none"}; from ${from.getAttribute("aria-label")} to ${to.getAttribute("aria-label")})`,
  );
  point("pointerup", end.x, end.y);
  await waitFor(
    () => boardPatches.some((op) => op.op === "group.join"),
    "dropping a desk on another did not group them",
  );
  const join = boardPatches.find((op) => op.op === "group.join") as unknown as {
    members: TerminalRef[];
    target: TerminalRef[];
  };
  const tabOf = (ref: TerminalRef) => ref.terminal_id.split("-terminal-")[0];
  check(
    join.members.length === 1 &&
      join.target.length === 1 &&
      tabOf(join.members[0]!) !== tabOf(join.target[0]!),
    `group.join sent one terminal per desk (${JSON.stringify(join)})`,
  );
  await waitFor(
    () => moves.some((move) => move.method === "tab.move"),
    "grouping did not seat the desk next to its teammate in Herdr",
  );
  const seat = moves.find((move) => move.method === "tab.move")!;
  check(
    seat.params.tab_id === tabOf(join.members[0]!) &&
      Number.isInteger(seat.params.insert_index),
    `tab.move seats the grouped tab (${JSON.stringify(seat)})`,
  );
  await waitFor(() => walled() > walls, "the grouped desks have no team wall");
  // Walls are drawn only; the desk's name says who its team is.
  const fromKey = from.dataset.targetKey;
  await waitFor(
    () =>
      host
        .querySelector<HTMLElement>(
          `.world-semantic-target[data-target-key="${CSS.escape(fromKey ?? "")}"]`,
        )
        ?.getAttribute("aria-label")
        ?.includes(", in a team with ") === true,
    "a grouped desk's label does not name its team",
  );
  // Without a drag: M on the desk offers to group it or take it out.
  host
    .querySelector<HTMLElement>(
      `.world-semantic-target[data-target-key="${CSS.escape(fromKey ?? "")}"]`,
    )
    ?.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true }));
  const choices = () =>
    [...host.querySelectorAll(".town-chooser-list button > span")].map(
      (entry) => entry.textContent,
    );
  await waitFor(
    () =>
      choices().includes("Group with…") && choices().includes("Leave the team"),
    `a grouped desk's move menu has no team actions (${choices().join(", ")})`,
  );
  host.querySelector<HTMLElement>(".town-chooser .town-peek-close")?.click();
  await waitFor(
    () => host.querySelector(".town-chooser") === null,
    "the desk's move menu did not close",
  );
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
  // The service saves a claim for each spawn stamp it sees.
  boardDocument.relations = {
    groups: boardDocument.relations?.groups ?? [],
    spawns: [],
  };
  boardDocument.relations.spawns = observedSpawnClaims(
    relationObservations(base.connections),
    1,
  );
  herdrTabs = (connectionId) =>
    base.connections.find((c) => c.connectionId === connectionId)?.snapshot
      ?.tabs ?? [];
  const blocked = base.agentPanes.filter((_, index) => index % 23 === 4);
  for (const pane of blocked) pane.agent_status = "blocked";
  if (scale === "protected")
    for (const pane of base.agentPanes) {
      const index = Number(pane.tab_id?.replace("local-orbit-tab-", ""));
      if (pane.workspace_id === "local-orbit" && index < 130)
        pane.agent_status = "blocked";
    }

  const asker = base.agentPanes.find(
    (pane) =>
      pane.agent_status === "idle" && pane.workspace_id === "local-orbit",
  );
  if (asker)
    Object.assign(ledger.asks[0]!.actor, {
      connection_id: "local",
      pane_id: asker.pane_id,
      terminal_id: asker.terminal_id,
    });

  statusOf = (paneId) =>
    base.agentPanes.find((pane) => pane.pane_id === paneId)?.agent_status ?? "";
  let setWorld: (world: WorldObject) => void = () => {};
  const opened: string[] = [];
  const selected: string[] = [];
  const inspected: [string, string][] = [];
  /** Windows opened without focusing their pane (the docked Town master). */
  const unfocusedOpens: string[] = [];
  function Harness() {
    const [world, set] = useState(() => worldFor(base.connections));
    const [selectedId, setSelectedId] = useState<string | null>(() =>
      scale === "navigation"
        ? worldFor(base.connections).leaves.find(
            (leaf) => leaf.connectionId === "local",
          )!.id
        : null,
    );
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
        onOpenInspectorView={(id, view, focus = true) => {
          inspected.push([id, view]);
          if (!focus) unfocusedOpens.push(id);
        }}
      />
    );
  }
  // Every agent works on one synthetic pull request of yours, read in detail,
  // so desks show badges that open its card.
  const agents = worldFor(base.connections).leaves.filter(
    (leaf) => leaf.kind === "agent",
  );
  worldSourcesStore.useFetch(async () =>
    Response.json({
      observedAt: 1,
      sources: [],
      items: [
        {
          key: "github:pr:example-org/atlas#7",
          source: "github",
          kind: "pull_request",
          ref: "example-org/atlas#7",
          title: "Synthetic change",
          url: "https://github.com/example-org/atlas/pull/7",
          lane: "green",
          status: "open",
          roles: ["author"],
          updatedAt: 1,
          number: 7,
          repo: "example-org/atlas",
          base: "main",
          headSha: "7".repeat(40),
          draft: false,
          checks: "pass",
          review: "review_required",
          mergeable: "mergeable",
          pr: {
            baseRef: "main",
            behindBy: 0,
            checks: [{ name: "Unit tests", state: "pass", required: true }],
            checksTruncated: false,
            reviewers: [],
            uiChange: false,
            images: 0,
          },
        },
      ],
      links: agents.map((leaf) => ({
        connectionId: leaf.connectionId,
        generation: leaf.generation,
        paneId: leaf.nativeId,
        sessionFingerprint: leaf.agentSessionFingerprint ?? null,
        itemKey: "github:pr:example-org/atlas#7",
        via: "branch",
      })),
    }),
  );
  // A stand-in for WorldControlPlane's panel windows: Town's summary window
  // renders its body into this element while open.
  const panelBody = document.createElement("div");
  panelBody.className = "fixture-panel-body";
  // A plain frame so screenshots show the window; the real frame is design's.
  Object.assign(panelBody.style, {
    position: "fixed",
    zIndex: "50",
    overflow: "auto",
    background: "#16181d",
    color: "#e8e6e1",
    fontFamily: "system-ui, sans-serif",
    border: "1px solid #333",
    borderRadius: "10px",
    ...(window.innerWidth <= 640
      ? { inset: "0", borderRadius: "0" }
      : { top: "56px", right: "16px", width: "380px", maxHeight: "80vh" }),
  });
  document.body.append(panelBody);
  const panelEntries: WorldPanelEntry[] = [];
  const panels = {
    panels: panelEntries,
    panelBodyRef: () => () => {},
    register: (entry: WorldPanelEntry) => {
      panelEntries.push(entry);
      return () => {
        const at = panelEntries.indexOf(entry);
        if (at >= 0) panelEntries.splice(at, 1);
      };
    },
    bodies: { "panel:town-summary": panelBody },
  };
  let releaseRenderer: (() => void) | null = null;
  if (scale === "navigation") {
    const { Application } = await import("pixi.js");
    const original = Application.prototype.init;
    const held = Promise.withResolvers<void>();
    Application.prototype.init = async function (
      ...args: Parameters<typeof original>
    ) {
      await held.promise;
      return original.apply(this, args);
    };
    releaseRenderer = () => {
      Application.prototype.init = original;
      held.resolve();
    };
  }
  const root = createRoot(host);
  root.render(
    <StrictMode>
      <WorldPanelsContext.Provider value={panels}>
        <Harness />
      </WorldPanelsContext.Provider>
    </StrictMode>,
  );
  if (scale === "navigation") {
    const summaryButton = () =>
      window.innerWidth <= 640
        ? host.querySelector<HTMLButtonElement>(".town-board-chip")
        : host.querySelector<HTMLButtonElement>(".town-board-open");
    await waitFor(
      () => summaryButton() !== null,
      "Summary launcher is missing before renderer setup",
    );
    summaryButton()!.click();
    await waitFor(
      () => panelBody.querySelectorAll(".town-summary-room").length === 130,
      "Summary omitted rooms past presentation admission",
    );
    const destination =
      base.connections[base.connections.length - 1]!.snapshot!.workspaces[0]!;
    const roomButton = () =>
      panelBody.querySelector<HTMLButtonElement>(
        `button[aria-label="Show room ${destination.label} in Town"]`,
      );
    const desk = (nativeId: string) =>
      [
        ...host.querySelectorAll<HTMLElement>(
          '.world-semantic-target[data-kind="desk"]',
        ),
      ].find((target) => JSON.parse(target.dataset.targetKey!)[2] === nativeId);
    const targetId = `${destination.workspace_id}-tab-0`;
    const selectedDeskId = `${base.connections[0]!.snapshot!.workspaces[0]!.workspace_id}-tab-0`;
    check(
      window.__HERDR_TOWN_RENDERER__?.ready !== true,
      "the delayed-setup probe already has a renderer",
    );
    roomButton()!.click();
    if (window.innerWidth <= 640)
      await waitFor(
        () => panelBody.querySelector(".town-summary") === null,
        "phone navigation did not close Summary before setup",
      );
    releaseRenderer!();
    await waitFor(
      () => window.__HERDR_TOWN_RENDERER__?.ready === true,
      "delayed renderer never initialized",
    );
    const diagnostics = window.__HERDR_TOWN_RENDERER__!;
    const focused = () => {
      const rect = desk(targetId)?.getBoundingClientRect();
      return Boolean(
        !diagnostics.flying &&
          diagnostics.zoom > 1.2 &&
          rect &&
          rect.left >= 0 &&
          rect.right <= window.innerWidth &&
          rect.top >= 0 &&
          rect.bottom <= window.innerHeight,
      );
    };
    await waitFor(
      focused,
      "the room request was lost before renderer/layout readiness",
    );
    check(
      desk(selectedDeskId) !== undefined,
      "preferred room admission displaced the selected desk",
    );
    host
      .querySelector<HTMLButtonElement>('[aria-label="Show the whole town"]')!
      .click();
    await waitFor(
      () => !diagnostics.flying && diagnostics.zoom < 1,
      "navigation repeat setup did not return to overview",
    );
    if (window.innerWidth <= 640) summaryButton()!.click();
    await waitFor(
      () => roomButton() !== null,
      "Summary did not reopen for the repeated room request",
    );
    roomButton()!.click();
    await waitFor(
      focused,
      "a repeated room request did not move the camera again",
    );
    setWorld(worldFor(base.connections.slice(0, -1)));
    await waitFor(
      () => desk(targetId) === undefined,
      "removed room remained admitted",
    );
    await settle();
    const restored = {
      ...base.connections[base.connections.length - 1]!,
      generation: 4,
      snapshotGeneration: 4,
    };
    const beforeFrames = diagnostics.frames;
    setWorld(worldFor([...base.connections.slice(0, -1), restored]));
    await waitFor(
      () => diagnostics.frames > beforeFrames,
      "restored topology never rendered",
    );
    check(
      !diagnostics.flying,
      "removed room navigation replayed on a new generation",
    );
    check(
      desk(selectedDeskId) !== undefined,
      "room removal displaced the selected desk",
    );
    check(
      diagnostics.lastError === null,
      `room navigation renderer error: ${diagnostics.lastError}`,
    );
    root.unmount();
    await settle();
    check(
      diagnostics.activeApplications === 0,
      "room navigation unmount leaked a renderer",
    );
    return;
  }
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

  if (scale === "protected" && mode === "test") {
    const rendered = window.__HERDR_TOWN_RENDERER__!;
    const orbitCard = () =>
      [...host.querySelectorAll<HTMLButtonElement>(".town-room-card")].find(
        (card) => card.textContent?.includes("orbit"),
      );
    await waitFor(
      () => orbitCard() !== undefined,
      "protected room has no overview card",
    );
    const beforeFrames = rendered.frames;
    orbitCard()!.click();
    await waitFor(
      () => rendered.frames > beforeFrames && !rendered.flying,
      "protected room focus never settled",
    );
    await waitFor(
      () =>
        host.querySelectorAll('.world-semantic-target[data-kind="desk"]')
          .length === rendered.desks &&
        host.querySelector(
          '.world-semantic-targets-overlay[aria-busy="false"]',
        ) !== null,
      "protected targets never finished admission after focus",
    );
    const visible = new Set(
      [
        ...host.querySelectorAll<HTMLElement>(
          '.world-semantic-target[data-kind="desk"]',
        ),
      ].map((target) => JSON.parse(target.dataset.targetKey!)[2] as string),
    );
    check(
      Array.from(
        { length: 130 },
        (_, index) => `local-orbit-tab-${index}`,
      ).every((key) => visible.has(key)),
      "protected desks beyond 127 lost their browser targets",
    );
    const orbit = [...visible].filter((key) =>
      key.startsWith("local-orbit-tab-"),
    ).length;
    const expand = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="Expand room orbit"]',
    );
    check(
      expand?.textContent?.trim() === `+${160 - orbit}`,
      `protected room plaque ${expand?.textContent?.trim()} disagrees with ${orbit} visible desks of 160`,
    );
    check(
      expand?.getAttribute("aria-label") ===
        "Expand room orbit toward 127 desks" &&
        expand.title.includes("127 desks") &&
        !expand.title.includes("all 160"),
      "expansion accessibility text overpromises all 160 desks",
    );
    check(
      rendered.lastError === null,
      `protected-room renderer error: ${rendered.lastError}`,
    );
    check(
      rendered.activeApplications === 1 &&
        document.querySelectorAll("canvas[data-office-canvas]").length === 1,
      "protected-room StrictMode duplicated the renderer",
    );
    root.unmount();
    await settle();
    check(
      rendered.activeApplications === 0 &&
        document.querySelectorAll("canvas[data-office-canvas]").length === 0,
      "protected-room unmount left a renderer",
    );
    return;
  }

  if (mode === "preview") {
    // `&zoom=room`: into the first room, where an agent spawned another.
    if (params.get("zoom") === "room") {
      const label = base.connections[0]?.snapshot?.workspaces[0]?.label;
      const card = () =>
        [...host.querySelectorAll<HTMLElement>(".town-room-card")].find(
          (entry) =>
            entry.getAttribute("aria-label")?.startsWith(`${String(label)}:`),
        );
      const canvas = host.querySelector<HTMLElement>(".town-canvas-host");
      // Double-tap the room's floor twice: each one zooms in 2x there.
      for (let zoom = 0; canvas && zoom < 2; zoom += 1) {
        const box = card()?.getBoundingClientRect();
        if (!box) break;
        const point = {
          clientX: box.left + box.width / 2,
          clientY: box.bottom + 30,
        };
        for (const type of [
          "pointerdown",
          "pointerup",
          "pointerdown",
          "pointerup",
        ])
          canvas.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              pointerId: 41,
              pointerType: "mouse",
              button: 0,
              buttons: type === "pointerdown" ? 1 : 0,
              ...point,
            }),
          );
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
      // Then pan with the arrow keys until the room's top is in view.
      for (let step = 0; canvas && step < 12; step += 1) {
        const top =
          [
            ...host.querySelectorAll<HTMLElement>(
              '.world-semantic-target[data-kind="room"]',
            ),
          ]
            .find((target) =>
              target
                .getAttribute("aria-label")
                ?.toLowerCase()
                .includes(String(label).toLowerCase()),
            )
            ?.getBoundingClientRect().top ?? 100;
        if (top >= 70) break;
        canvas.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
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

  // An agent's question leads the Needs you list, with its options.
  await waitFor(
    () => host.querySelector(".town-ask") !== null,
    "an agent's question is missing from the Needs you list",
  );
  check(
    [...host.querySelectorAll(".town-ask-options button")].some(
      (button) => button.textContent === "Ship",
    ),
    "the question's options are not offered",
  );

  const diagnostics = window.__HERDR_TOWN_RENDERER__!;
  check(
    diagnostics.level === "overview",
    `default level is ${diagnostics.level}, expected overview`,
  );
  check(
    [...host.querySelectorAll(".town-quest")].every(
      (pennant) => getComputedStyle(pennant).display === "none",
    ),
    "quest pennants must not float over the overview's room cards",
  );
  check(
    (diagnostics.layout?.buildings ?? 0) === 3,
    "town did not lay out three buildings",
  );
  const narrowTown = diagnostics.layout?.formFactor === "narrow";
  const totalRooms = base.connections.reduce(
    (sum, c) => sum + (c.snapshot?.workspaces.length ?? 0),
    0,
  );
  // Wide screens show every building at home. A phone stacks buildings and
  // their rooms in one column, so it draws the buildings in view. Under load
  // the room overlays can follow the renderer by a frame or more: wait.
  await waitFor(
    () =>
      narrowTown
        ? host.querySelectorAll(".town-room").length > 0
        : host.querySelectorAll(".town-room").length === totalRooms,
    "the town's rooms were never drawn",
  );
  // Phones show the Town board as a compact chip, wider screens the board and
  // its Summary button; either opens the Town summary window, whose
  // needs-you count is the sign's, the chip's and the rail's.
  {
    const chip = host.querySelector<HTMLButtonElement>(".town-board-chip")!;
    const board = host.querySelector<HTMLElement>(".town-board")!;
    const shown = (element: HTMLElement) =>
      getComputedStyle(element).display !== "none";
    const phone = window.innerWidth <= 640;
    check(
      phone ? shown(chip) && !shown(board) : !shown(chip) && shown(board),
      phone
        ? "a phone shows the Town board chip, not the board"
        : "a wide screen shows the Town board, not its chip",
    );
    const signNeeds = Number(
      board.querySelectorAll("dd")[1]?.textContent ?? "NaN",
    );
    const chipNeeds = Number(
      chip.querySelector('[data-status="blocked"]')?.textContent?.slice(1),
    );
    (phone
      ? chip
      : board.querySelector<HTMLButtonElement>(".town-board-open")!
    ).click();
    await waitFor(
      () =>
        panelEntries.some((entry) => entry.id === "panel:town-summary") &&
        panelBody.querySelector(".town-summary") !== null,
      "the Town summary window did not open",
    );
    const windowNeeds = Number(
      panelBody.querySelector("#town-summary-needs span")?.textContent,
    );
    const railNeeds = Number(
      host.querySelector(".town-rail-head b")?.textContent ?? "0",
    );
    check(
      windowNeeds === signNeeds &&
        windowNeeds === chipNeeds &&
        windowNeeds === railNeeds,
      `needs-you counts differ: summary ${windowNeeds}, sign ${signNeeds}, chip ${chipNeeds}, rail ${railNeeds}`,
    );
    check(
      ledger.asks.length > 0 &&
        panelBody.querySelectorAll(".town-ask").length === ledger.asks.length,
      "the summary must show the rail's open questions",
    );
    const summaryAsk = panelBody.querySelector<HTMLElement>(".town-ask")!;
    const railAsk = host.querySelector<HTMLElement>(".town-ask")!;
    check(
      getComputedStyle(summaryAsk).backgroundColor ===
        getComputedStyle(railAsk).backgroundColor &&
        getComputedStyle(summaryAsk).borderLeftColor ===
          getComputedStyle(railAsk).borderLeftColor &&
        getComputedStyle(summaryAsk).backgroundColor !== "rgba(0, 0, 0, 0)",
      "the Summary portal lost the shared question card colors",
    );
    const sections = [...panelBody.querySelectorAll("h3")].map((heading) =>
      heading.textContent?.replace(/\s*\d+$/, ""),
    );
    check(
      sections.join("|") ===
        "Needs you|Finished, not reviewed|Hosts and rooms|Spend",
      `summary sections out of order: ${sections.join(", ")}`,
    );
    check(
      panelBody.textContent?.includes("No cost data") === true,
      "a summary without metrics says there is no cost data",
    );
    const questionId = ledger.asks[0]!.id;
    panelBody
      .querySelector<HTMLButtonElement>(".town-ask-options button")!
      .click();
    await waitFor(() => {
      const counts = [
        panelBody.querySelector("#town-summary-needs span")?.textContent,
        board.querySelectorAll("dd")[1]?.textContent,
        chip.querySelector('[data-status="blocked"]')?.textContent?.slice(1),
        host.querySelector(".town-rail-head b")?.textContent ?? "0",
      ];
      return counts.every((value) => Number(value) === windowNeeds - 1);
    }, "answering an ask did not update every needs-you count together");
    check(
      askAnswers.some(
        (answer) => answer.id === questionId && answer.answer === "Ship",
      ),
      "the summary answer did not use the question's existing owner action",
    );
    panelEntries.find((entry) => entry.id === "panel:town-summary")!.onClose();
    await waitFor(
      () => panelBody.querySelector(".town-summary") === null,
      "closing the Town summary window left its body",
    );
  }
  const roomCards = host.querySelectorAll(".town-room-card");
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
  // A room past 24 desks shows its busiest until expanded into a longer room.
  const perRoom = new Map<string, number>();
  for (const entry of base.connections.flatMap((c) => c.snapshot?.tabs ?? []))
    perRoom.set(entry.workspace_id, (perRoom.get(entry.workspace_id) ?? 0) + 1);
  const expectedOffice = projectWorldOffice(
    worldFor(base.connections),
    Date.now(),
  );
  const seen = readCompletionSeen(worldLocalStorage);
  const expectedCalls = townCalls(
    expectedOffice.roster,
    new Map(),
    unseenTownCompletions(
      expectedOffice.roster,
      new Set(
        expectedOffice.roster
          .filter(({ agent }) => seen.has(officeCompletionIdentity(agent)))
          .map(({ agent }) => agent.key),
      ),
    ),
    (key) => expectedOffice.roster.find(({ agent }) => agent.key === key),
  );
  const protectedDesks = townAttentionDesks(
    expectedCalls,
    ledger.asks,
    expectedOffice.roster,
  );
  const protectedCounts = new Map<string, number>();
  for (const { desk } of expectedOffice.deskRoster)
    if (protectedDesks.has(desk.key)) {
      const id = expectedOffice.rooms.find(({ key }) => key === desk.roomKey)!
        .workspaceRef.nativeId;
      protectedCounts.set(id, (protectedCounts.get(id) ?? 0) + 1);
    }
  const drawn = (expanded: string | null) =>
    [...perRoom].reduce(
      (sum, [id, count]) =>
        sum +
        Math.max(
          id === expanded ? count : Math.min(count, 24),
          protectedCounts.get(id) ?? 0,
        ),
      0,
    );
  const visibleDeskKeys = new Set(
    [
      ...host.querySelectorAll<HTMLElement>(
        '.world-semantic-target[data-kind="desk"]',
      ),
    ].map((target) => target.dataset.targetKey),
  );
  check(
    [...protectedDesks].every((key) => visibleDeskKeys.has(key)),
    "fold hid a desk from the shared call/ask attention source",
  );
  check(
    diagnostics.desks === drawn(null),
    `a folded town drew ${diagnostics.desks} of ${drawn(null)} desks`,
  );
  if (scale === "extended") {
    const expand = () =>
      host.querySelector<HTMLButtonElement>(
        'button[aria-label^="Expand room orbit"]',
      );
    check(expand() !== null, "the 100-desk room offers no Expand");
    expand()?.click();
    // Wait for the drawn targets: the reflow waits for the press to settle.
    await waitFor(
      () =>
        diagnostics.desks === drawn("local-orbit") &&
        host.querySelectorAll('.world-semantic-target[data-kind="desk"]')
          .length === drawn("local-orbit"),
      `expanding the 100-desk room drew ${diagnostics.desks} of ${drawn("local-orbit")} desks`,
    );
    check(
      host.querySelector('button[aria-label^="Fold room orbit"]') !== null,
      "an expanded room offers Fold",
    );
  }
  const deskTargets = host.querySelectorAll(
    '.world-semantic-target[data-kind="desk"]',
  ).length;
  const totalTabs = drawn(scale === "extended" ? "local-orbit" : null);
  check(
    deskTargets === totalTabs,
    `expected ${totalTabs} desk targets, found ${deskTargets}`,
  );
  // Counted now: expanding a room can move other rooms out of the drawn area.
  const roomsNow = host.querySelectorAll(".town-room").length;
  const renames = host.querySelectorAll('[aria-label^="Rename room"]').length;
  check(
    renames === roomsNow,
    `every room needs a rename action (${renames} of ${roomsNow})`,
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

  // Tapping an agent opens its one window, World's Inspector, on Chat; no
  // peek card opens. The card is only a preview on hover.
  const entry = host.querySelector<HTMLButtonElement>(".town-reception-entry")!;
  entry.click();
  await waitFor(
    () => inspected.length === 1,
    "tapping an agent did not open its window",
  );
  check(
    inspected[0]![1] === "history" && host.querySelector(".town-peek") === null,
    `a tap should open the agent's window on Chat, not a card (${JSON.stringify(inspected)})`,
  );
  inspected.length = 0;

  // Hovering an agent shows its card with the live question.
  if (!phone) {
    hoverEntry(entry);
    await waitFor(
      () =>
        host
          .querySelector(".town-peek-screen")
          ?.textContent?.includes("Do you want") === true,
      "peek did not show the agent's question",
    );
    check(selected.length === 0, "a peek must not select or open an Inspector");
    const answers = host.querySelectorAll<HTMLButtonElement>(
      '.town-peek [aria-label="Answers"] button',
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
          call.method === "agent_conversation.watch" &&
          call.paneId === peekPane,
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
    // The card is a preview: no reply line and no attachments of its own.
    // Open chat opens the agent's one window on Chat, where replies go.
    check(
      host.querySelector(".town-peek input, .town-peek textarea") === null &&
        host.querySelector('.town-peek input[type="file"]') === null,
      "the hover card should have no reply line or attachments",
    );
    inspected.length = 0;
    [
      ...host.querySelectorAll<HTMLButtonElement>(
        '.town-peek [aria-label="Chat"] button',
      ),
    ]
      .find((button) => button.textContent === "Open chat")!
      .click();
    await waitFor(
      () =>
        inspected.length === 1 &&
        inspected[0]![1] === "history" &&
        host.querySelector(".town-peek") === null,
      "Open chat did not open the agent's window on Chat",
    );
    check(opened.length === 0, "Open chat must not open the full terminal");
    // Next on the card opens the next waiting agent's window.
    hoverEntry(entry);
    await waitFor(
      () => host.querySelector(".town-peek") !== null,
      "the card did not show for Next",
    );
    inspected.length = 0;
    [...host.querySelectorAll<HTMLButtonElement>(".town-peek-foot button")]
      .find((button) => button.textContent?.startsWith("Next"))!
      .click();
    await waitFor(
      () =>
        inspected.length === 1 &&
        inspected[0]![1] === "history" &&
        host.querySelector(".town-peek") === null,
      "Next did not open the next agent's window",
    );
    inspected.length = 0;
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

  if (!phone) {
    const card = () =>
      host.querySelector<HTMLButtonElement>(".town-reception-entry")!;
    // Open chat and Open terminal cover the window; the card has no
    // separate Inspector button.
    hoverEntry(card());
    await waitFor(
      () => host.querySelector(".town-peek") !== null,
      "the card did not show again",
    );
    check(
      ![...host.querySelectorAll<HTMLButtonElement>(".town-peek button")].some(
        (button) => button.textContent === "Inspector",
      ),
      "the card must not offer a separate Inspector button",
    );

    // Open terminal, in the card's header, opens the agent's terminal.
    hoverEntry(card());
    await waitFor(
      () => host.querySelector(".town-peek-head .town-peek-terminal") !== null,
      "the card's header has no Open terminal",
    );
    opened.length = 0;
    host
      .querySelector<HTMLButtonElement>(".town-peek-head .town-peek-terminal")!
      .click();
    await waitFor(() => opened.length === 1, "Open terminal did not open it");
    check(
      host.querySelector(".town-peek") === null,
      "Open terminal should close the card",
    );
    opened.length = 0;

    // An unreadable conversation shows Chat's reason, not the screen.
    conversationUnavailable = true;
    hoverEntry(card());
    await waitFor(
      () =>
        host
          .querySelector(".town-peek-screen")
          ?.textContent?.includes("No saved session for this agent yet.") ===
        true,
      "the card did not show why the conversation is unavailable",
    );
    conversationUnavailable = false;
    host.querySelector<HTMLButtonElement>(".town-peek-close")!.click();
    await settle();
  }

  // Tapping the desk of an agent waiting at reception opens its chat.
  const waitingAgent = [
    ...host.querySelectorAll<HTMLButtonElement>(
      '.world-semantic-target[data-kind="agent"]',
    ),
  ].find((target) =>
    target.getAttribute("aria-label")?.includes(", needs input, desk "),
  );
  check(waitingAgent !== undefined, "no waiting agent has a target");
  const [, , deskName, roomName, hostName] = waitingAgent!
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
  inspected.length = 0;
  waitingDesk?.click();
  await waitFor(
    () => inspected.length === 1 && inspected[0]![1] === "history",
    "tapping a desk did not open its waiting agent's window on Chat",
  );
  check(opened.length === 0, "tapping a desk in Chat mode opened a terminal");
  check(
    host.querySelector(".town-peek") === null,
    "tapping a desk should open the window, not a card",
  );
  inspected.length = 0;

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

  // The Town master's chat (FirstMate's) is docked from the start on wide
  // screens: once per visit, on Chat, without moving the pane's focus.
  inspected.length = 0;
  writeOfficePreferences(worldLocalStorage, {
    ...readOfficePreferences(worldLocalStorage),
    townMaster: "codex",
  });
  window.dispatchEvent(new Event(WORLD_OFFICE_PREFERENCES_CHANGED_EVENT));
  if (!phone) {
    await waitFor(
      () => inspected.length === 1 && unfocusedOpens.length === 1,
      "the Town master's chat was not docked",
    );
    check(
      inspected[0]![1] === "history",
      "the Town master's chat should open on Chat",
    );
  } else {
    await settle();
    await settle();
    check(
      inspected.length === 0,
      "a phone must not open the Town master's chat by itself",
    );
  }
  // Changing views and back does not reopen it in the same visit.
  writeOfficePreferences(worldLocalStorage, {
    ...readOfficePreferences(worldLocalStorage),
    townMaster: "",
  });
  window.dispatchEvent(new Event(WORLD_OFFICE_PREFERENCES_CHANGED_EVENT));
  await settle();
  writeOfficePreferences(worldLocalStorage, {
    ...readOfficePreferences(worldLocalStorage),
    townMaster: "codex",
  });
  window.dispatchEvent(new Event(WORLD_OFFICE_PREFERENCES_CHANGED_EVENT));
  await settle();
  await settle();
  check(
    inspected.length === (phone ? 0 : 1),
    "the Town master's chat opened again in the same visit",
  );
  writeOfficePreferences(worldLocalStorage, {
    ...readOfficePreferences(worldLocalStorage),
    townMaster: "",
  });
  window.dispatchEvent(new Event(WORLD_OFFICE_PREFERENCES_CHANGED_EVENT));
  inspected.length = 0;

  // Activating an agent's desk opens its window on Chat, not its terminal,
  // and on desktop requests no hidden composer.
  if (!phone) {
    let composerRequests = 0;
    const countRequest = () => (composerRequests += 1);
    window.addEventListener(TERMINAL_COMPOSER_REQUEST_EVENT, countRequest);
    inspected.length = 0;
    waitingDesk!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await waitFor(
      () => inspected.length >= 1 && inspected[0]![1] === "history",
      "activating a desk did not open its agent's window on Chat",
    );
    window.removeEventListener(TERMINAL_COMPOSER_REQUEST_EVENT, countRequest);
    check(opened.length === 0, "activating a desk opened a terminal");
    check(
      composerRequests === 0,
      "desktop activation must not open World's composer",
    );
    inspected.length = 0;
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
  // Seated agents with a quest show a pennant at their seats; a tap names
  // it as a quest, so it never reads as a pinned desk.
  const shownPennant = () =>
    [...host.querySelectorAll<HTMLButtonElement>(".town-quest")].find(
      (pennant) => getComputedStyle(pennant).display !== "none",
    );
  await waitFor(
    () => shownPennant() !== undefined,
    "no quest pennant at any seat in the zoomed room",
  );
  const pennant = shownPennant()!;
  check(
    pennant.getAttribute("aria-label")?.startsWith("Quest: Synthetic quest") ===
      true,
    `a pennant names its quest (${pennant.getAttribute("aria-label")})`,
  );
  const pennantLabel = pennant.querySelector<HTMLElement>(".town-quest-label")!;
  check(
    getComputedStyle(pennantLabel).display === "none",
    "a pennant's label waits for hover or a tap",
  );
  pennant.click();
  await waitFor(
    () => getComputedStyle(pennantLabel).display !== "none",
    "tapping a pennant did not show its label",
  );
  check(
    /^Quest\s+Synthetic quest/.test(pennantLabel.textContent ?? "") &&
      selected.length === 0,
    `a pennant tap shows the quest and selects nothing (${pennantLabel.textContent})`,
  );
  // A press elsewhere closes it, even where a tap gives the button no focus.
  document.body.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true }),
  );
  await waitFor(
    () => getComputedStyle(pennantLabel).display === "none",
    "a press elsewhere did not close a pennant's label",
  );
  await waitFor(
    () => host.querySelector(".town-desk-badge") !== null,
    "desks of agents with a pull request show its badge",
  );
  const badge = host.querySelector<HTMLButtonElement>(".town-desk-badge")!;
  check(
    badge.textContent === "#7 ✓" &&
      badge.dataset.tone === "pass" &&
      badge.tagName === "BUTTON",
    `a desk badge of your pull request is a button (${badge.textContent})`,
  );
  badge.click();
  await waitFor(
    () => document.querySelector(".town-badge-popover .pr-card") !== null,
    "the badge opens the pull request card",
  );
  const popover = document.querySelector<HTMLElement>(".town-badge-popover")!;
  check(
    popover.querySelector(".pr-card-command code")?.textContent ===
      "gh pr merge 7 --repo example-org/atlas --merge" &&
      popover
        .querySelector<HTMLAnchorElement>(".pr-card-command a")
        ?.href.endsWith("/pull/7") === true &&
      selected.length === 0,
    "the card offers Open on GitHub and the merge command, not an Inspector",
  );
  check(
    popover.contains(document.activeElement),
    "focus moves into the card, so a keyboard reaches its actions",
  );
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await waitFor(
    () => document.querySelector(".town-badge-popover") === null,
    "Escape closes the pull request card",
  );

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
    await groupTwoDesks(
      host,
      canvasHost,
      String(base.connections[0]?.snapshot?.workspaces[0]?.label),
    );
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
    const tried: string[] = [];
    for (const room of rooms) {
      const ghost = () => host.querySelector<HTMLElement>(".town-drag-ghost");
      press("pointerdown", at(fromDesk));
      await waitFor(() => ghost() !== null, "holding a desk did not lift it");
      press("pointermove", floor(room));
      // The ghost judges the drop target on a later frame, whose timing
      // depends on the renderer (SwiftShader or the GPU); give it a few.
      for (let frame = 0; frame < 10; frame += 1) {
        await settle();
        if (ghost()?.dataset.valid === "true") break;
      }
      const label = ghost()?.textContent ?? "";
      tried.push(
        `${room.dataset.id ?? room.getAttribute("aria-label") ?? "room"}: ${ghost()?.dataset.valid ?? "no ghost"} ${JSON.stringify(label)}`,
      );
      if (
        ghost()?.dataset.valid !== "true" ||
        label.includes("’s place") ||
        label.includes("last of") ||
        label === "Leave the team"
      ) {
        // Not another room here (its own floor, where a grouped desk would
        // leave its team): carry it back home and let it go.
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
    if (!moved) {
      // A phone stacks rooms in one column, so the other rooms are out of
      // view: held at the bottom edge, the desk scrolls the town until
      // another room is under it.
      const ghost = () => host.querySelector<HTMLElement>(".town-drag-ghost");
      const otherRoom = () => {
        // Only a move to another room reads "Move … to <room>"; its own
        // room offers "… place" or "Put … last".
        const label = ghost()?.textContent ?? "";
        return ghost()?.dataset.valid === "true" && /^Move .+ to /.test(label);
      };
      press("pointerdown", at(fromDesk));
      await waitFor(() => ghost() !== null, "holding a desk did not lift it");
      // Nudge at the edge, then step back out of it so the town is still
      // when we look and drop.
      // The town's own bottom edge (a tray may cover the window's), and
      // up to about 30 s of scrolling: the 100-desk room is tall on a phone
      // and a slow runner draws few frames.
      const stage = canvasHost.getBoundingClientRect();
      const x = stage.left + stage.width / 2;
      const edge = [x, stage.bottom - 20] as const;
      const still = [x, stage.bottom - 110] as const;
      const until = performance.now() + 30_000;
      while (!otherRoom() && performance.now() < until) {
        press("pointermove", edge);
        await new Promise((resolve) => setTimeout(resolve, 250));
        press("pointermove", still);
        await settle();
      }
      check(
        otherRoom(),
        "holding a desk at the edge never scrolled another room under it",
      );
      const before = moves.length;
      const drawn = { ...drags() };
      press("pointerup", still);
      await waitFor(
        () => moves.length === before + 1,
        "dropping a desk in a room scrolled into view did not move it",
      );
      check(
        moves[before]!.method === "town.move_desk",
        `an edge-scrolled drop sent ${JSON.stringify(moves[before])}`,
      );
      await landed(drawn, "a desk moved to a room scrolled into view");
      moved = true;
    }
    check(
      moved,
      `no room took a carried desk (${rooms.length} visible; ${tried.join("; ")})`,
    );
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
    // Rooms fold past 24 desks until expanded; an expanded room extends to
    // every tab, the newest included, and zooming in opens at its first desks.
    check(
      diagnostics.desks === drawn("local-orbit"),
      `an expanded room drew ${diagnostics.desks} of ${drawn("local-orbit")} desks`,
    );
    // Earlier checks leave the camera at a desk; step out until the 100-desk
    // room's card shows (on a phone, Zoom out returns to the first building).
    const orbitCard = () =>
      [...host.querySelectorAll<HTMLButtonElement>(".town-room-card")].find(
        (card) => card.textContent?.includes("orbit"),
      );
    const frameDelay = Number(params.get("flightFrameDelay") ?? 0);
    const actualRAF = window.requestAnimationFrame.bind(window);
    if (frameDelay > 0) {
      await waitFor(
        () => !diagnostics.flying,
        "initial camera flight did not finish",
      );
      for (let into = 0; into < 3 && diagnostics.level !== "desk"; into += 1) {
        const before = diagnostics.frames;
        host
          .querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!
          .click();
        await waitFor(
          () => diagnostics.frames > before && !diagnostics.flying,
          "desk-entry camera flight did not finish",
        );
      }
      check(
        diagnostics.level === "desk",
        "slow-frame check did not enter desk level",
      );
      window.requestAnimationFrame = (callback) =>
        actualRAF(() => {
          setTimeout(() => callback(performance.now()), frameDelay);
        });
    }
    const zoomSteps: { frames: number; zoom: number; flying: boolean }[] = [];
    try {
      for (let step = 0; step < 6 && !orbitCard(); step += 1) {
        const beforeFrames = diagnostics.frames;
        host
          .querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')!
          .click();
        await waitFor(
          () => diagnostics.frames > beforeFrames && !diagnostics.flying,
          "zoom-out camera flight did not finish",
        );
        zoomSteps.push({
          frames: diagnostics.frames - beforeFrames,
          zoom: diagnostics.zoom,
          flying: diagnostics.flying,
        });
      }
    } finally {
      if (frameDelay > 0) window.requestAnimationFrame = actualRAF;
    }
    const roomCard = orbitCard();
    check(
      roomCard !== undefined,
      `the 100-desk room has no card (level ${diagnostics.level}, zoom ${diagnostics.zoom.toFixed(2)}, ${host.querySelectorAll(".town-room-card").length} cards; steps ${JSON.stringify(zoomSteps)})`,
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
    // Seen marks and questions can change during the checks above: fold must
    // use the current attention set, not the initial protected-desk count.
    const expandedDesks = diagnostics.desks;
    const expandedGeometry = diagnostics.layout!.geometry;
    host
      .querySelector<HTMLButtonElement>('button[aria-label^="Fold room orbit"]')
      ?.click();
    const foldedPlaque = () =>
      host.querySelector<HTMLButtonElement>(
        'button[aria-label^="Expand room orbit"]',
      );
    await waitFor(
      () =>
        diagnostics.desks < expandedDesks &&
        diagnostics.layout!.geometry !== expandedGeometry &&
        foldedPlaque() !== null,
      "fold did not restore the room's current attention desks",
    );
    await waitFor(
      () =>
        host.querySelectorAll('.world-semantic-target[data-kind="desk"]')
          .length === diagnostics.desks &&
        host.querySelector(
          '.world-semantic-targets-overlay[aria-busy="false"]',
        ) !== null,
      "folded desk targets did not finish progressive admission",
    );
    const orbitDesks = [
      ...host.querySelectorAll<HTMLElement>(
        '.world-semantic-target[data-kind="desk"]',
      ),
    ].filter((target) =>
      JSON.parse(target.dataset.targetKey!)[2].startsWith("local-orbit-tab-"),
    ).length;
    check(
      foldedPlaque()!.textContent?.trim() === `+${100 - orbitDesks}`,
      `fold plaque ${foldedPlaque()!.textContent?.trim()} disagrees with ${orbitDesks} visible desks of 100`,
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
    // A room under the 24-desk fold grows to it (a folded room would not).
    const grown = "local-lantern";
    const had = perRoom.get(grown) ?? 0;
    for (let index = had; index < 24; index += 1) {
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
    const grownDeskCount = () =>
      [
        ...host.querySelectorAll<HTMLElement>(
          '.world-semantic-target[data-kind="desk"]',
        ),
      ].filter((target) =>
        JSON.parse(target.dataset.targetKey!)[2].startsWith(`${grown}-tab-`),
      ).length;
    await waitFor(
      () => diagnostics.layout!.geometry !== before && grownDeskCount() === 24,
      () =>
        `the grown room never reflowed after the user let go (geometry changed: ${diagnostics.layout!.geometry !== before}, grown desks: ${grownDeskCount()})`,
    );
    check(
      diagnostics.lastError === null,
      `renderer error after a reflow: ${diagnostics.lastError}`,
    );
  }

  // Last, as picking moves focus and the camera: a room takes its workspace's colour, chosen beside its name; a building
  // takes its host's, chosen on its reception board. Both are saved with the
  // terminal colours, and a room's carpet shows its colour.
  {
    const pick = async (trigger: HTMLButtonElement, color: string) => {
      trigger.click();
      await waitFor(
        () =>
          document.querySelector(
            `.color-swatch-popover [aria-label="Colour ${color}"]`,
          ) !== null,
        `${trigger.getAttribute("aria-label")} did not open the palette`,
      );
      document
        .querySelector<HTMLButtonElement>(
          `.color-swatch-popover [aria-label="Colour ${color}"]`,
        )!
        .click();
    };
    const roomSwatch = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="Colour of room "]',
    );
    check(roomSwatch !== null, "a room offers its colour beside its name");
    if (roomSwatch) {
      await pick(roomSwatch, "teal");
      await waitFor(
        () => Object.values(boardDocument.layout.colors ?? {}).includes("teal"),
        "choosing a room colour did not save it",
      );
      const [key] = Object.entries(boardDocument.layout.colors ?? {}).find(
        ([, color]) => color === "teal",
      )!;
      check(
        /^[^@:][^:]*:[^:]+$/.test(key) && !key.includes(":tab:"),
        `a room colour is saved under its workspace's card key (${key})`,
      );
      const card = roomSwatch
        .closest(".town-room")!
        .querySelector<HTMLElement>(".town-room-card");
      await waitFor(
        () =>
          host
            .querySelector<HTMLButtonElement>(
              'button[aria-label^="Colour of room "]',
            )
            ?.getAttribute("aria-label")
            ?.endsWith(": teal") === true,
        "the room's swatch does not show its new colour",
      );
      check(
        !card || card.style.getPropertyValue("--carpet") !== "",
        "the room card has a carpet colour",
      );
    }
    const buildingSwatch = host.querySelector<HTMLButtonElement>(
      'button[aria-label$="\'s building"], button[aria-label*="\'s building:"]',
    );
    check(buildingSwatch !== null, "a building offers its colour on reception");
    if (buildingSwatch) {
      await pick(buildingSwatch, "pink");
      await waitFor(
        () =>
          Object.entries(boardDocument.layout.colors ?? {}).some(
            ([key, color]) => key.startsWith("@host:") && color === "pink",
          ),
        "choosing a building colour did not save it under its host",
      );
    }
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
