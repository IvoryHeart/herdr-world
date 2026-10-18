import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import BoardView from "./BoardView";
import {
  BoardDocumentStore,
  type BoardDocument,
  type BoardOp,
} from "./board/boardDocument";
import {
  fixtureHost,
  fixtureWorld,
  type FixtureSpace,
} from "./board/boardFixture";
import "./world.css";

/*
 * Synthetic Board fixture. `?mode=test` runs checks and posts them to
 * /result; `?mode=preview` keeps the board up for review. Every host,
 * workspace and agent name here is invented.
 */

const params = new URL(location.href).searchParams;
const mode = params.get("mode") ?? "test";
const theme = params.get("theme");
if (theme === "light" || theme === "dark")
  document.documentElement.dataset.theme = theme;
const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(condition: () => boolean, message: string, tries = 200) {
  for (let i = 0; i < tries; i++) {
    if (condition()) return;
    await settle();
  }
  throw new Error(message);
}

type Status = "working" | "blocked" | "done" | "idle" | "unknown";
/** "shell" is a plain terminal pane (Herdr reports it as idle). */
const space = (
  label: string,
  tabs: [string, ...(Status | "shell")[]][],
): FixtureSpace => ({
  label,
  tabs: tabs.map(([tab, ...panes]) => ({
    label: tab,
    panes: panes.map((pane) =>
      pane === "shell" ? (["idle", false] as const) : ([pane] as const),
    ) as FixtureSpace["tabs"][number]["panes"],
  })),
});
const world = fixtureWorld([
  fixtureHost("studio", [
    space("web-app", [
      ["login fix", "blocked"],
      ["review", "done"],
      ["dev server", "shell"],
      ["pair", "working", "blocked"],
    ]),
    space("docs", [
      ["tutorial", "working"],
      ["site build", "shell"],
    ]),
    space("api", [
      ["migrations", "unknown"],
      ["swarm", "working", "done", "blocked", "working", "idle", "shell"],
      ["tests", "working"],
    ]),
  ]),
  fixtureHost("build-box", [
    space("infra", [
      ["deploy", "working"],
      ["logs", "shell"],
    ]),
    space("nightly", [
      ["benchmarks", "done"],
      ["flaky test", "blocked"],
    ]),
  ]),
]);

/** An in-memory board store applying the service's operations. */
let saved: BoardDocument = {
  version: 1,
  revision: 0,
  layout: { anchors: {}, offsets: {}, pinned: {}, folded: [] },
  notes: [],
  strings: [],
};
function apply(ops: BoardOp[]) {
  const next = structuredClone(saved);
  for (const op of ops) {
    if (op.op === "note.put") {
      const at = next.notes.findIndex((note) => note.id === op.note.id);
      if (at < 0) next.notes.push({ ...op.note, rev: 1 });
      else if (op.rev !== next.notes[at]!.rev)
        return { conflict: "That note changed elsewhere.", document: saved };
      else next.notes[at] = { ...op.note, rev: op.rev + 1 };
    } else if (op.op === "note.delete") {
      next.notes = next.notes.filter((note) => note.id !== op.id);
      next.strings = next.strings.filter(
        (string) =>
          !("note" in string.from && string.from.note === op.id) &&
          !("note" in string.to && string.to.note === op.id),
      );
    } else if (op.op === "string.put") {
      next.strings = next.strings.filter(
        (string) => string.id !== op.string.id,
      );
      next.strings.push(op.string);
    } else if (op.op === "string.delete")
      next.strings = next.strings.filter((string) => string.id !== op.id);
    else if (op.op === "layout.set") {
      if (op.replace)
        next.layout = { ...next.layout, anchors: {}, offsets: {}, pinned: {} };
      Object.assign(next.layout.anchors, op.anchors ?? {});
      Object.assign(next.layout.offsets, op.offsets ?? {});
      Object.assign(next.layout.pinned, op.pinned ?? {});
      if (op.folded) next.layout.folded = op.folded;
    }
  }
  next.revision = saved.revision + 1;
  saved = next;
  return { document: structuredClone(saved) };
}
const store = new BoardDocumentStore({
  call: async (method, params) =>
    method === "world.board.get"
      ? structuredClone(saved)
      : apply((params as { ops: BoardOp[] }).ops),
  onControl: () => () => {},
  onStatus: () => () => {},
});

const selected: string[] = [];
const opened: string[] = [];
const host = document.createElement("div");
host.style.cssText = "position:fixed;inset:0";
document.body.appendChild(host);
const root = createRoot(host);
/** Mount Board; a new key remounts it, as a reload would. */
function mount(key: number) {
  root.render(
    <StrictMode>
      <BoardView
        key={key}
        world={world}
        selectedId={null}
        onSelect={(id) => selected.push(id)}
        onOpenTerminal={(id) => opened.push(id)}
        store={store}
      />
    </StrictMode>,
  );
}
mount(1);

const card = (key: string) =>
  host.querySelector<HTMLElement>(`[data-key="${key}"]`);
function at(key: string) {
  const match = /translate\(([-\d.e+]+)px, ([-\d.e+]+)px\)/.exec(
    card(key)?.style.transform ?? "",
  );
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}
function pointer(target: Element, type: string, x: number, y: number, id = 1) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      pointerId: id,
      pointerType: "mouse",
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: x,
      clientY: y,
    }),
  );
}
const centre = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};
/** Positions stop changing: the board is at rest. */
/**
 * Animation frames until card positions stop changing for three frames: the
 * board is at rest. Counted in frames, not milliseconds, so a busy machine
 * (slower frames) does not change the result.
 */
async function rest(limit = 600) {
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  let before = "";
  let still = 0;
  for (let i = 0; i < limit; i++) {
    await frame();
    const now = [...host.querySelectorAll<HTMLElement>(".board-card")]
      .map((el) => el.style.transform)
      .join("|");
    still = now === before ? still + 1 : 0;
    if (still >= 3) return i;
    before = now;
  }
  return Infinity;
}

async function run() {
  await waitFor(
    () => host.querySelectorAll(".board-tab").length === 13,
    "the board did not render every tab",
  );
  check(
    host.querySelectorAll(".board-workspace").length === 5,
    "every workspace is a card",
  );
  check(
    host.querySelectorAll(".board-zone").length === 2,
    "every host is a zone",
  );
  check(
    Boolean(host.querySelector(".board-tab.board-s-blocked .board-badge")),
    "a tab that needs the user shows its badge",
  );
  check(
    Boolean(host.querySelector(".board-workspace.board-attn")),
    "a workspace with a waiting tab is marked",
  );
  check((await rest()) < 120, "the board is still at first sight");

  // Taller cards (pane rows) are placed by their real size: no overlaps.
  // Only cards on show: the overview hides tab cards (opacity 0).
  const rects = [...host.querySelectorAll<HTMLElement>(".board-card")]
    .filter((el) => !(el.closest(".board-far") && el.matches(".board-tab")))
    .map((el) => el.getBoundingClientRect());
  let overlapping = 0;
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!,
        b = rects[j]!;
      if (
        a.left < b.right &&
        a.right > b.left &&
        a.top < b.bottom &&
        a.bottom > b.top
      )
        overlapping++;
    }
  check(overlapping === 0, `no cards overlap (${overlapping} pairs)`);

  if (innerWidth <= 720) {
    const zones = [...host.querySelectorAll(".board-zone")].map((el) =>
      el.getBoundingClientRect(),
    );
    check(
      zones.length === 2 && zones[1]!.top > zones[0]!.top + 20,
      "phones stack the hosts",
    );
  }

  // Zoom in so cards are large enough to grab.
  // Looked up each time: a remount replaces the element.
  const boardEl = () => host.querySelector<HTMLElement>(".board")!;
  for (let i = 0; i < 4; i++)
    host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click();
  await settle(100);

  // Drag a workspace: its tabs follow, and the board comes to rest.
  const ws = card("studio:w2")!;
  const tabBefore = at("studio:w2:t1")!;
  const wsBefore = at("studio:w2")!;
  const from = centre(ws);
  pointer(ws, "pointerdown", from.x, from.y);
  for (let step = 1; step <= 10; step++) {
    pointer(ws, "pointermove", from.x + step * 12, from.y + step * 8);
    await settle(16);
  }
  await settle(200);
  pointer(ws, "pointerup", from.x + 120, from.y + 80);
  // About a second at 60 frames a second; more frames means it never settles.
  const restFrames = await rest();
  check(
    restFrames < 100,
    `the board comes to rest within about a second (${restFrames} frames)`,
  );
  const wsAfter = at("studio:w2")!,
    tabAfter = at("studio:w2:t1")!;
  const moved = Math.hypot(wsAfter.x - wsBefore.x, wsAfter.y - wsBefore.y);
  check(moved > 30, "the workspace moved with the pointer");
  const followed =
    Math.abs(tabAfter.x - wsAfter.x - (tabBefore.x - wsBefore.x)) < 40 &&
    Math.abs(tabAfter.y - wsAfter.y - (tabBefore.y - wsBefore.y)) < 40;
  check(followed, "its tabs followed and kept their arrangement");

  // A tap selects; a double-click opens the terminal.
  const tab = card("studio:w1:t1")!;
  const t = centre(tab);
  pointer(tab, "pointerdown", t.x, t.y);
  pointer(tab, "pointerup", t.x, t.y);
  check(
    selected.length === 1 && selected[0]!.includes("w1:p1"),
    "a tap selects the tab's pane",
  );
  tab.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  check(opened.length === 1, "a double-click opens the terminal");

  // Several panes: a row each; a tap on a row selects that pane.
  const pair = card("studio:w1:t4")!;
  const pairRows = pair.querySelectorAll<HTMLElement>("[data-pane]");
  check(pairRows.length === 2, "a two-pane tab shows a row per pane");
  check(
    pair.classList.contains("board-s-blocked"),
    "a tab takes its most urgent agent's status",
  );
  const second = centre(pairRows[1]!);
  pointer(pairRows[1]!, "pointerdown", second.x, second.y);
  pointer(pairRows[1]!, "pointerup", second.x, second.y);
  // Pane keys are `connection:pane`; leaf IDs end with the pane ID.
  const secondPane = pairRows[1]!.dataset.pane!.split(":").slice(1).join(":");
  check(
    selected[selected.length - 1]?.endsWith(secondPane) ?? false,
    "a tap on a pane row selects that pane",
  );
  // A tab with more panes than rows lists the rest in a chooser.
  const swarm = card("studio:w3:t2")!;
  check(
    swarm.querySelectorAll("[data-pane]").length === 3,
    "a six-pane tab draws three rows",
  );
  const more = swarm.querySelector<HTMLButtonElement>(".board-more");
  check(more?.textContent === "+3 more", "and says how many more");
  more?.click();
  await waitFor(
    () => host.querySelectorAll(".board-chooser .board-pane").length === 6,
    "the chooser lists every pane",
  );
  host
    .querySelector<HTMLButtonElement>('.board-chooser [aria-label="Close"]')!
    .click();
  // A plain terminal looks like one and never pulses.
  const shell = card("studio:w1:t3")!;
  check(
    shell.classList.contains("board-terminal"),
    "a shell-only tab is drawn as a terminal",
  );
  check(
    getComputedStyle(shell, "::after").display === "none",
    "a terminal has no status ring",
  );

  // Fold and unfold: no other card moves.
  const others = ["studio:w2", "studio:w3", "studio:w2:t1", "build-box:w1"].map(
    (key) => [key, at(key)] as const,
  );
  host.querySelector<HTMLButtonElement>('[aria-label="Fold web-app"]')!.click();
  await waitFor(() => !card("studio:w1:t1"), "folding hid the tabs");
  await settle(100);
  check(
    host.querySelectorAll(".board-tree").length === 9,
    "folding removes the folded tabs' lines at once",
  );
  check(
    host.querySelector('[aria-label="Open web-app"]')?.textContent === "4",
    "a folded workspace shows its tab count",
  );
  host.querySelector<HTMLButtonElement>('[aria-label="Open web-app"]')!.click();
  await waitFor(
    () => Boolean(card("studio:w1:t1")),
    "unfolding showed the tabs",
  );
  await rest();
  for (const [key, point] of others) {
    const now = at(key)!;
    check(
      Math.hypot(now.x - point!.x, now.y - point!.y) < 2,
      `unfolding left ${key} where it was`,
    );
  }

  // Tidy the board, then Undo restores every card.
  const snapshot = ["studio:w2", "studio:w2:t1", "build-box:w2"].map(
    (key) => [key, at(key)!] as const,
  );
  host
    .querySelector<HTMLButtonElement>('[aria-label="Tidy the board"]')!
    .click();
  await rest();
  await waitFor(
    () =>
      Boolean(
        [...host.querySelectorAll(".board-toast button")].find(
          (b) => b.textContent === "Undo",
        ),
      ),
    "tidy offers Undo",
  );
  [...host.querySelectorAll<HTMLButtonElement>(".board-toast button")]
    .find((b) => b.textContent === "Undo")!
    .click();
  await rest();
  for (const [key, point] of snapshot) {
    const now = at(key)!;
    check(
      Math.hypot(now.x - point.x, now.y - point.y) < 3,
      `Undo restored ${key}`,
    );
  }

  // Notes: a double-tap on empty board pins one, ready to type in.
  const emptySpot = () => {
    for (let y = innerHeight - 40; y > 80; y -= 37)
      for (let x = 30; x < innerWidth - 30; x += 41) {
        const el = document.elementFromPoint(x, y);
        if (
          el &&
          !el.closest(".board-card, .board-controls, .board-zone-label")
        )
          return { x, y };
      }
    throw new Error("no empty board to tap");
  };
  const spot = emptySpot();
  for (let i = 0; i < 2; i++) {
    pointer(boardEl(), "pointerdown", spot.x, spot.y, 7);
    pointer(boardEl(), "pointerup", spot.x, spot.y, 7);
    await settle(60);
  }
  await waitFor(() => saved.notes.length === 1, "a double-tap created a note");
  await waitFor(
    () => document.activeElement?.getAttribute("aria-label") === "Note text",
    "the new note is ready to type in",
  );
  const textbox = document.activeElement as HTMLElement;
  textbox.textContent = "Ship the login fix";
  textbox.blur();
  await waitFor(
    () => saved.notes[0]?.text === "Ship the login fix",
    "typing in a note saves it",
  );
  const noteKey = `note:${saved.notes[0]!.id}`;
  await waitFor(() => Boolean(card(noteKey)), "the note is on the board");

  /** Leave the overview and pan so an element is in the middle of the screen. */
  const bringIntoView = async (el: () => Element) => {
    for (let i = 0; i < 12 && boardEl().classList.contains("board-far"); i++) {
      host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click();
      await settle(30);
    }
    const r = el().getBoundingClientRect();
    const dx = innerWidth / 2 - (r.left + r.width / 2);
    const dy = innerHeight / 2 - (r.top + r.height / 2);
    const from = emptySpot();
    pointer(boardEl(), "pointerdown", from.x, from.y, 10);
    pointer(boardEl(), "pointermove", from.x + dx / 2, from.y + dy / 2, 10);
    pointer(boardEl(), "pointermove", from.x + dx, from.y + dy, 10);
    await settle(200);
    pointer(boardEl(), "pointerup", from.x + dx, from.y + dy, 10);
    await rest();
  };

  // Strings: drag a note's handle onto one pane of a two-pane tab.
  const dragHandle = async (fromKey: string, to: Element) => {
    const handle = card(fromKey)!.querySelector<HTMLElement>(".board-handle")!;
    const a = centre(handle),
      b = centre(to);
    pointer(handle, "pointerdown", a.x, a.y, 8);
    for (let step = 1; step <= 6; step++) {
      pointer(
        handle,
        "pointermove",
        a.x + ((b.x - a.x) * step) / 6,
        a.y + ((b.y - a.y) * step) / 6,
        8,
      );
      await settle(16);
    }
    pointer(handle, "pointerup", b.x, b.y, 8);
  };
  await bringIntoView(() => card("studio:w1:t4")!);
  const pairSecond =
    card("studio:w1:t4")!.querySelectorAll<HTMLElement>("[data-pane]")[1]!;
  await dragHandle(noteKey, pairSecond);
  await waitFor(
    () => saved.strings.length === 1,
    "dropping on a pane row strings the note",
  );
  const end = saved.strings[0]!.to;
  check(
    "anchor" in end &&
      end.anchor.kind === "pane" &&
      end.anchor.native_id ===
        pairSecond.dataset.pane!.split(":").slice(1).join(":"),
    `the string attaches to that exact pane (${JSON.stringify(end)} vs ${pairSecond.dataset.pane}; notes ${saved.notes.length})`,
  );
  // Onto a tab with several panes but no row: the chooser asks which pane.
  await bringIntoView(() => card("studio:w3:t2")!);
  await dragHandle(
    noteKey,
    card("studio:w3:t2")!.querySelector(".board-label")!,
  );
  await waitFor(
    () =>
      Boolean(
        host
          .querySelector(".board-chooser")
          ?.textContent?.includes("String to which pane"),
      ),
    "stringing to a multi-pane tab asks which pane",
  );
  host
    .querySelectorAll<HTMLButtonElement>(".board-chooser .board-pane")[2]!
    .click();
  await waitFor(
    () => saved.strings.length === 2,
    "choosing a pane finishes the string",
  );
  await waitFor(
    () =>
      host.querySelectorAll(".board-yarn:not(.board-yarn-temp)").length === 2,
    "both strings are drawn",
  );
  check(
    !host.querySelector(".board-yarn-loose"),
    "strings to live panes are confirmed",
  );

  // Cut a string: pick it, then Cut string.
  const yarn = host.querySelector<SVGPathElement>(".board-yarn-hit")!;
  const box = yarn.getBoundingClientRect();
  yarn.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      pointerId: 9,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    }),
  );
  await waitFor(
    () => !host.querySelector<HTMLButtonElement>(".board-cut")!.hidden,
    "picking a string offers Cut",
  );
  host.querySelector<HTMLButtonElement>(".board-cut")!.click();
  await waitFor(() => saved.strings.length === 1, "Cut string removes it");

  // A reload keeps notes, strings and the layout.
  await settle(900);
  const wsBefore2 = at("studio:w2")!;
  const beforeReload = boardEl();
  mount(2);
  // Wait for the new tree: the old one stays until React commits.
  await waitFor(
    () => boardEl() !== beforeReload && Boolean(card(noteKey)),
    "the note is back after a reload",
  );
  await rest();
  const wsAfter2 = at("studio:w2")!;
  check(
    Math.hypot(wsAfter2.x - wsBefore2.x, wsAfter2.y - wsBefore2.y) < 2,
    "the layout is restored after a reload",
  );
  await waitFor(
    () =>
      host.querySelectorAll(".board-yarn:not(.board-yarn-temp)").length === 1,
    "the string is back after a reload",
  );

  // Zoom out to the overview: tabs fold into status squares, nothing moves.
  const before = at("studio:w1:t1")!;
  for (let i = 0; i < 12; i++)
    host.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')!.click();
  await waitFor(
    () => boardEl().classList.contains("board-far"),
    "zooming out shows the overview",
  );
  check(
    getComputedStyle(card("studio:w1:t1")!).pointerEvents === "none",
    "overview tabs cannot be grabbed",
  );
  check(
    host.querySelectorAll(".board-sum .board-sq-shell").length === 4,
    "overview squares draw shells hollow",
  );
  check(
    host.querySelectorAll(".board-sum span").length === 19,
    "workspace cards show a square per pane",
  );
  const after = at("studio:w1:t1")!;
  check(
    Math.hypot(after.x - before.x, after.y - before.y) < 1,
    "zooming never moves cards",
  );

  // Pulses can be turned off.
  host
    .querySelector<HTMLButtonElement>('[aria-label="Board settings"]')!
    .click();
  await waitFor(
    () => Boolean(host.querySelector('[role="menuitemcheckbox"]')),
    "the settings menu opened",
  );
  host.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!.click();
  await waitFor(
    () => boardEl().classList.contains("board-no-pulse"),
    "the settings menu turns pulses off",
  );
}

if (mode === "test")
  run()
    .catch((error) => failures.push(String(error)))
    .finally(() =>
      fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
    );
