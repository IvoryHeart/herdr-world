/*
 * The help pictures' stage (scripts/help-pictures.ts): the production Town,
 * Board, Code or an agent's Chat with the website's synthetic scene
 * (web/src/world/testing/site-shots/), World's view picker over it (not
 * over Code, whose picture is the whole view at the crop's size), in one
 * size and theme. `window.helpShots.show(control, press)` presses what opens
 * the control or brings it into view, rings it as Try does and returns where
 * it is; `hide()` undoes
 * that. Nothing contacts World, Herdr or GitHub.
 *
 *   ?scene=town|board|code|chat&theme=light|dark&phone=1
 */
window.__HERDR_WORLD_RENDERER_DEBUG__ = "counters";
let seed = 0x68656c70;
Math.random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
};

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentChat } from "../../components/AgentChat";
import type { Pane } from "../../types";
import type { TownQuietMarks } from "../../world/town/TownBoard";
import BoardView from "../../world/BoardView";
import CodeView from "../../world/code/CodeView";
import { fixtureIdeClient, type IdeClient } from "../../world/code/ideClient";
import { TownMasterFigure } from "../../world/TownMasterCard";
import { quietGreetingForTest } from "../../world/townMasterGreeting";
import {
  installSiteBridge,
  noAction,
  siteBoardStore,
  siteBoardWorld,
  siteCodeWorld,
  SiteTown,
  siteTownScene,
} from "../../world/testing/site-shots/siteStage";
import { setApartmentsClient } from "../../world/apartments/useApartments";
import { fixtureApartmentsClient } from "../../world/testing/apartmentsFixture";
import { WorldViewPicker } from "../../world/WorldViewPicker";
import type { WorldView } from "../../world/worldViewRouting";
import { findHelpTarget } from "../helpTry";
import "../../styles/tokens.css";
import "../../styles/base.css";
import "../../styles/vendor.css";
import "../../world/world.css";
import "../../components/WorkspaceInspectorFrame.css";
import "../../components/WorkspaceInspectorHost.css";
import "../../world/windows/windows.css";
import "../helpPanel.css";

const params = new URLSearchParams(location.search);
const scene = (params.get("scene") ?? "town") as
  | "town"
  | "board"
  | "code"
  | "chat";
const phone = params.get("phone") === "1";
const theme = params.get("theme") === "light" ? "light" : "dark";
document.documentElement.dataset.theme = theme;
// The ring holds still for the picture.
const still = document.createElement("style");
still.textContent =
  "[data-help-spotlight]{animation:none!important} *{caret-color:transparent!important}";
document.head.append(still);

const AT = "2026-11-18T09:00:00Z";
const chatMessages = [
  {
    id: "u1",
    role: "user",
    text: "Can you check why the checkout total rounds wrong?",
  },
  {
    id: "a1",
    role: "assistant",
    text: "The total adds rounded line prices. I changed it to round once, after adding, and the checkout tests pass.",
  },
  { id: "u2", role: "user", text: "Great. Open a pull request for it." },
  {
    id: "a2",
    role: "assistant",
    text: "Done: the pull request is open and its checks are running.",
  },
] as const;

installSiteBridge(async (method, params) => {
  if (scene !== "chat") return undefined;
  if (method === "agent_conversation.latest")
    return {
      conversation_version: 1,
      pane_id: "site-chat",
      agent: "claude",
      agent_status: "idle",
      session_binding: "reported",
      session_fingerprint: "a".repeat(64),
      session_label: "storefront checkout",
      status: "ok",
      unavailable: null,
      latest: null,
    };
  if (method === "agent_history.get")
    return params.before
      ? { history_version: 2, mode: "page", entries: [] }
      : {
          history_version: 2,
          mode: "snapshot",
          cursor: { epoch: "help", revision: 1 },
          window_limit: 200,
          agent: "claude",
          pane_id: "site-chat",
          workspace_id: "storefront",
          tab_id: "checkout",
          updated_at: AT,
          path: "",
          entries: chatMessages.map((message) => ({
            ...message,
            kind: "message",
            sent_at: AT,
          })),
        };
  if (method === "agent_conversation.steps") return { steps: [] };
  return {};
});
quietGreetingForTest();
// Town's Apartments sign counts synthetic residents rather than waiting.
if (scene === "town")
  setApartmentsClient(fixtureApartmentsClient(Date.parse(AT)));

const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
const frames = async (count: number) => {
  for (let i = 0; i < count; i++) await frame();
};
const stats = () => window.__HERDR_TOWN_RENDERER__;

/** Waits until Town's camera and actors stop moving, or `limit` ms pass. */
async function waitForSceneIdle(limit = 8000) {
  const began = performance.now();
  let calm = 0;
  while (performance.now() - began < limit) {
    await frame();
    const s = stats();
    calm = !s || s.flying || s.transitioning || s.walking ? 0 : calm + 1;
    if (calm >= 45) break;
  }
}

const view: WorldView =
  scene === "board" ? "board" : scene === "code" ? "code" : "town";
const hosts = {
  connections: [
    {
      id: "site-host-0",
      label: "studio",
      runtime: "herdr" as const,
      state: "ready" as const,
      generation: 1,
      endpoint: "site-host-0",
      machine: "site-host-0",
    },
    {
      id: "site-host-1",
      label: "buildbox",
      runtime: "herdr" as const,
      state: "ready" as const,
      generation: 1,
      endpoint: "site-host-1",
      machine: "site-host-1",
    },
  ],
  ids: null,
  explanation: "",
  onChange: noAction,
};
const picker = (
  <WorldViewPicker
    view={view}
    mobile={phone}
    onSelect={noAction}
    onExitZen={noAction}
    hosts={hosts}
  />
);
const chatPane: Pane = {
  pane_id: "site-chat",
  terminal_id: "site-chat-terminal",
  workspace_id: "storefront",
  tab_id: "checkout",
  focused: true,
  agent: "claude",
  agent_status: "idle",
  revision: 1,
};

/** Shows or clears the quiet marks; set while the Town stage is mounted. */
let setQuietShown: (shown: boolean) => void = noAction;
/** Swaps in the town of two runtimes; set while the Town stage is mounted. */
let setRuntimesShown: (shown: boolean) => void = noAction;

function Stage() {
  const [quietShown, setShown] = useState(false);
  setQuietShown = setShown;
  const [runtimesShown, setRuntimes] = useState(false);
  setRuntimesShown = setRuntimes;
  if (scene === "board")
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex" }}>
        <BoardView
          world={boardWorld!}
          selectedId={null}
          onSelect={noAction}
          onOpen={async () => {}}
          store={boardStore!}
        />
      </div>
    );
  if (scene === "code")
    return (
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          // The picture's crop (scripts/help-declarations.ts): the whole
          // view fits one picture, its project and Open button in reach.
          width: phone ? 390 : 640,
          height: phone ? 300 : 400,
          overflow: "hidden",
        }}
      >
        <CodeView
          world={codeWorld!}
          onOpenAgent={noAction}
          onOpenTerminal={noAction}
          client={codeClient!}
          secure
        />
      </div>
    );
  if (scene === "chat")
    return (
      <div
        className="world-managed-window"
        style={{
          position: "fixed",
          // Desktop: a window small enough that a picture holds all of it.
          inset: phone ? 0 : "calc(50% - 190px) calc(50% - 300px)",
          display: "flex",
          background: "var(--panel)",
          border: phone ? 0 : "1px solid var(--border)",
          borderRadius: phone ? 0 : 10,
          overflow: "hidden",
        }}
      >
        <AgentChat
          pane={chatPane}
          active
          onOpenTerminal={noAction}
          onClose={noAction}
        />
      </div>
    );
  return (
    // Town's view shell carries its colour tokens (townAsks.css), as the
    // town center ring's medallions and labels read them.
    <div
      className="town-stage town-view-shell"
      style={{ position: "fixed", inset: 0 }}
    >
      <TownMasterFigure />
      {/* A fresh town for each scene, so the usual one is as at load. */}
      <SiteTown
        key={runtimesShown ? "runtimes" : "town"}
        scene={runtimesShown ? runtimesTown! : town!}
        quiet={quietShown ? quiet! : undefined}
      />
    </div>
  );
}

const town = scene === "town" ? siteTownScene() : null;
/**
 * The same town with its two hosts as one machine's two runtimes, so room
 * plaques carry runtime icons. Only the runtimes' own picture shows it
 * (helpShots.show), so the other Town pictures stay as they were.
 */
const runtimesTown =
  scene === "town" ? siteTownScene(undefined, { runtimes: true }) : null;
let runtimesSwapped = false;

/** Swaps the Town stage and waits until the new town has settled. */
async function swapTown(runtimes: boolean) {
  setRuntimesShown(runtimes);
  runtimesSwapped = runtimes;
  await frames(10);
  while (!stats()?.ready) await frame();
  await waitForSceneIdle(12_000);
}

/**
 * Two working agents have gone quiet (useTownQuiet.ts), so the town board
 * carries its "2 quiet 10 m+" line and their desks their hourglasses. Only
 * the quiet agents' own picture shows them (helpShots.show), so the other
 * Town pictures stay as they were.
 */
function quietMarks(scene: NonNullable<typeof town>): TownQuietMarks {
  const now = Date.now();
  const keys = scene.projection.roster
    .map(({ agent }) => agent)
    .filter((agent) => agent.semanticStatus === "working")
    .slice(0, 2)
    .map((agent) => agent.key);
  return {
    keys: new Set(keys),
    since: new Map(keys.map((key, n) => [key, now - (23 + 14 * n) * 60_000])),
    board: { count: keys.length, minutes: 10, onFind: noAction },
  };
}
const quiet = town ? quietMarks(town) : null;
const boardStore = scene === "board" ? siteBoardStore() : null;
const boardWorld = scene === "board" ? siteBoardWorld() : null;
const codeWorld = scene === "code" ? siteCodeWorld() : null;
// code-server enabled and nothing started: a project on this computer ready
// to open, with its agents and terminals beside it. Opening is never pressed.
const codeClient = scene === "code" ? siteIdeClient() : null;
function siteIdeClient(): IdeClient {
  const client = fixtureIdeClient("ssh");
  return {
    ...client,
    status: async (refresh) => ({
      ...(await client.status(refresh)),
      localConnections: ["site-host-0"],
    }),
  };
}

/** Shown and inside the screen: a Town sign can be out of the camera's view. */
function onScreen(element: Element | null) {
  const box = element?.getClientRects()[0];
  return (
    !!box &&
    box.right > 0 &&
    box.bottom > 0 &&
    box.left < innerWidth &&
    box.top < innerHeight
  );
}

let pressed: HTMLElement[] = [];
let ringed: HTMLElement | null = null;

const helpShots = {
  ready: (async () => {
    await document.fonts.ready;
    createRoot(document.getElementById("root")!).render(
      <>
        <Stage />
        {scene === "code" ? null : phone ? (
          picker
        ) : (
          <div className="zen-dock">{picker}</div>
        )}
      </>,
    );
    if (scene === "town") {
      while (!stats()?.ready) await frame();
      await waitForSceneIdle(12_000);
    } else await frames(240);
    // Chat's message buttons show on hover; the picture shows them.
    (document.activeElement as HTMLElement | null)?.blur();
    return { scene, phone, theme };
  })(),
  /**
   * Presses what opens the control when it is not on screen, rings it and
   * returns its box, or null when it is not there.
   */
  async show(control: string, press: readonly string[] = []) {
    if (control === "town.quiet" && quiet) {
      setQuietShown(true);
      await frames(20);
    }
    if (control === "town.runtime" && runtimesTown) await swapTown(true);
    if (!onScreen(document.querySelector(`[data-help="${control}"]`))) {
      for (const selector of press) {
        const button = document.querySelector<HTMLElement>(selector);
        if (!button) continue;
        button.click();
        pressed.push(button);
        await frames(20);
      }
      // A camera press (Town's ALL) flies before the control is in view.
      if (pressed.length && scene === "town") await waitForSceneIdle();
    }
    const target = findHelpTarget(control);
    if (!target) return null;
    ringed = target;
    target.setAttribute("data-help-spotlight", "");
    await frames(6);
    const box = target.getBoundingClientRect();
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      viewport: { width: innerWidth, height: innerHeight },
    };
  },
  async hide() {
    ringed?.removeAttribute("data-help-spotlight");
    ringed = null;
    for (const button of pressed.reverse()) button.click();
    pressed = [];
    setQuietShown(false);
    await frames(20);
    if (runtimesSwapped) await swapTown(false);
  },
};

Object.assign(window, { helpShots });
