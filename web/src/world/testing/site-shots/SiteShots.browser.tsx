/*
 * The website's Town in the production TownCanvas, for herdr.world's
 * screenshots (scripts/site-screenshots.ts). Real time and real motion with
 * a fixed random sequence; nothing contacts World, Herdr or GitHub. The
 * warehouse shows its own synthetic crates (`?townWarehouseFixture`).
 */
window.__HERDR_WORLD_RENDERER_DEBUG__ = "counters";
let seed = 0x73697465;
Math.random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
};

import { createRoot } from "react-dom/client";
import BoardView from "../../BoardView";
import {
  installSiteBridge,
  noAction,
  siteBoardStore,
  siteBoardWorld,
  SiteTown,
  siteTownScene,
} from "./siteStage";
import "../../../styles/tokens.css";
import "../../../styles/base.css";
import "../../world.css";

installSiteBridge();
const town = siteTownScene();
const board = siteBoardStore();
const boardWorld = siteBoardWorld();
const view = new URLSearchParams(location.search).get("view") ?? "town";

const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
const stats = () => window.__HERDR_TOWN_RENDERER__!;

/** Waits until the camera and actors stop moving, or `limit` ms pass. */
async function untilCalm(limit = 8000) {
  const began = performance.now();
  let calm = 0;
  while (performance.now() - began < limit) {
    await frame();
    const s = stats();
    calm = s.flying || s.transitioning || s.walking ? 0 : calm + 1;
    if (calm >= 45) break;
  }
  return {
    level: stats().level,
    zoom: stats().zoom,
    bubbles: document.querySelectorAll(".town-step").length,
  };
}

function click(label: string) {
  const button = document.querySelector<HTMLButtonElement>(
    `${view === "board" ? "" : ".town-zoom "}button[aria-label="${label}"]`,
  );
  if (!button) throw new Error(`No ${label} button`);
  button.click();
}

const site = {
  ready: (async () => {
    await document.fonts.ready;
    const root = createRoot(document.getElementById("root")!);
    if (view === "board") {
      root.render(
        <div style={{ position: "fixed", inset: 0, display: "flex" }}>
          <BoardView
            world={boardWorld}
            selectedId={null}
            onSelect={noAction}
            onOpen={async () => {}}
            store={board}
          />
        </div>,
      );
      for (let i = 0; i < 240; i++) await frame();
      return { cards: document.querySelectorAll(".board-workspace").length };
    }
    root.render(
      <div className="town-stage" style={{ position: "fixed", inset: 0 }}>
        <SiteTown scene={town} />
      </div>,
    );
    while (!stats()?.ready) await frame();
    return {
      desks: stats().desks,
      actors: stats().actors,
      ...(await untilCalm(12_000)),
    };
  })(),
  /** Whole town (ALL), then each Zoom in step: building, room, desk. */
  async zoom(step: "all" | "in" | "out") {
    if (view === "board") {
      click(
        step === "in"
          ? "Zoom in"
          : step === "out"
            ? "Zoom out"
            : "Fit everything",
      );
      for (let i = 0; i < 90; i++) await frame();
      return { cards: document.querySelectorAll(".board-workspace").length };
    }
    click(
      step === "all"
        ? "Show the whole town"
        : step === "in"
          ? "Zoom in"
          : "Zoom out",
    );
    return untilCalm();
  },
  untilCalm,
};

Object.assign(window, { siteShots: site });
