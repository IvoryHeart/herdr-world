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

// World is often opened over plain HTTP on a LAN or tailnet address, where
// crypto.randomUUID does not exist; tests run as if on such an origin.
Object.defineProperty(Crypto.prototype, "randomUUID", {
  value: undefined,
  configurable: true,
});
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
    else if (op.op === "string.detach") {
      const string = next.strings.find((candidate) => candidate.id === op.id);
      if (string) string.detached = true;
    } else if (op.op === "anchor.witness") {
      const side = next.strings.find(
        (candidate) => candidate.id === op.string_id,
      )?.[op.end];
      if (side && "anchor" in side) side.anchor.witness = op.witness;
    } else if (op.op === "layout.set") {
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
const sent: { paneId: string; terminalId: string; text: string }[] = [];
/** Pane IDs the fake service reports as closed ("not found"). */
const closedPanes = new Set<string>();
const started: { workspace: string; kind: string; text: string }[] = [];
const movedTabs: { tab: string; to: string }[] = [];
const host = document.createElement("div");
host.style.cssText = "position:fixed;inset:0";
document.body.appendChild(host);
const root = createRoot(host);
/** Mount Board; a new key remounts it, as a reload would. */
function mount(key: number, shown = world) {
  root.render(
    <StrictMode>
      <BoardView
        key={key}
        world={shown}
        selectedId={null}
        onSelect={(id) => selected.push(id)}
        onOpenTerminal={(id) => opened.push(id)}
        store={store}
        sendNote={async (target, text) => {
          sent.push({
            paneId: target.paneId,
            terminalId: target.terminalId,
            text,
          });
          return { status: "sent", agent: target.label };
        }}
        moveTab={async (tab, space) => {
          movedTabs.push({ tab: tab.nativeId, to: space.nativeId });
          return { status: "moved", tab_id: `${space.nativeId}:t9`, panes: [] };
        }}
        startAgent={async (space, kind, _name, text) => {
          started.push({ workspace: space.nativeId, kind, text });
          // The fake new agent lands in an existing pane of that workspace.
          const leaf = space.space.children[0]!;
          return {
            status: "sent",
            pane_id: leaf.nativeId,
            terminal_id: leaf.terminalId,
          };
        }}
        checkAnchor={async (_host, anchor) => ({
          state: closedPanes.has(anchor.native_id) ? "absent" : "present",
        })}
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
function pointer(
  target: Element,
  type: string,
  x: number,
  y: number,
  id = 1,
  touch: { primary: boolean } | null = null,
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      pointerId: id,
      pointerType: touch ? "touch" : "mouse",
      isPrimary: touch?.primary ?? false,
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
    // Cards and the camera both: a flight is not rest.
    const now =
      [...host.querySelectorAll<HTMLElement>(".board-card")]
        .map((el) => el.style.transform)
        .join("|") +
      (host.querySelector<HTMLElement>(".board-world")?.style.transform ?? "");
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
  // A double-tap with a finger, the second tap 300 ms after the first.
  for (let i = 0; i < 2; i++) {
    pointer(boardEl(), "pointerdown", spot.x, spot.y, 7 + i, { primary: true });
    pointer(boardEl(), "pointerup", spot.x, spot.y, 7 + i, { primary: true });
    await settle(300);
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
  // Focusing a note (a phone keyboard) can scroll the board; it never stays scrolled.
  boardEl().scrollTop = 80;
  boardEl().dispatchEvent(new Event("scroll"));
  await settle(50);
  check(boardEl().scrollTop === 0, "the board never stays scrolled");
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

  // Send the note to the agent it is strung to.
  const noteEl = card(noteKey)!;
  const nc = centre(noteEl);
  pointer(noteEl, "pointerdown", nc.x, nc.y, 11);
  pointer(noteEl, "pointerup", nc.x, nc.y, 11);
  await waitFor(
    () =>
      Boolean(
        [...host.querySelectorAll(".board-notebar button")].find((b) =>
          b.textContent?.startsWith("Send to"),
        ),
      ),
    "a note strung to an agent offers Send",
  );
  [...host.querySelectorAll<HTMLButtonElement>(".board-notebar button")]
    .find((b) => b.textContent?.startsWith("Send to"))!
    .click();
  await waitFor(() => sent.length === 1, "Send sends the note");
  const remaining = saved.strings[0]!.to;
  check(
    "anchor" in remaining &&
      sent[0]!.paneId === remaining.anchor.native_id &&
      remaining.anchor.witness.includes(sent[0]!.terminalId) &&
      sent[0]!.text === "Ship the login fix",
    "the note goes to the strung pane, with its witnessed terminal",
  );

  // A mouse double-click on empty board uses the browser's own double-click.
  const spot2 = emptySpot();
  for (let i = 0; i < 2; i++) {
    pointer(boardEl(), "pointerdown", spot2.x, spot2.y, 1);
    pointer(boardEl(), "pointerup", spot2.x, spot2.y, 1);
  }
  check(saved.notes.length === 1, "two mouse clicks alone do not make a note");
  document.elementFromPoint(spot2.x, spot2.y)!.dispatchEvent(
    new MouseEvent("dblclick", {
      bubbles: true,
      clientX: spot2.x,
      clientY: spot2.y,
    }),
  );
  await waitFor(
    () => saved.notes.length === 2,
    "a mouse double-click makes a note",
  );
  (document.activeElement as HTMLElement | null)?.blur();
  await settle(100);
  // The new note is selected and its swatches show their colours.
  const swatch = host.querySelector<HTMLElement>(
    ".board-notebar .board-swatch",
  );
  check(
    Boolean(swatch) &&
      !["rgba(0, 0, 0, 0)", "transparent"].includes(
        getComputedStyle(swatch!).backgroundColor,
      ),
    "note colour swatches are filled",
  );
  // Select it with a tap (as after a terminal had focus), then Delete.
  const secondNote = [
    ...host.querySelectorAll<HTMLElement>(".board-note"),
  ].find((el) => el.dataset.key !== noteKey)!;
  const sc = centre(secondNote);
  pointer(secondNote, "pointerdown", sc.x, sc.y, 14);
  pointer(secondNote, "pointerup", sc.x, sc.y, 14);
  await settle(50);
  check(
    document.activeElement === secondNote,
    "a tapped note takes the keyboard focus",
  );
  secondNote.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
  );
  await waitFor(
    () => saved.notes.length === 1,
    "the Delete key deletes the selected note",
  );

  // A finger whose lift was never seen must not break the next pinch.
  const scale = () =>
    Number(
      /scale\(([\d.e+-]+)\)/.exec(
        host.querySelector<HTMLElement>(".board-world")!.style.transform,
      )?.[1],
    );
  const p0 = emptySpot();
  pointer(boardEl(), "pointerdown", p0.x, p0.y, 40, { primary: true });
  const before3 = scale();
  pointer(boardEl(), "pointerdown", p0.x, p0.y, 41, { primary: true });
  pointer(boardEl(), "pointerdown", p0.x + 20, p0.y, 42, { primary: false });
  pointer(boardEl(), "pointermove", p0.x + 120, p0.y, 42, { primary: false });
  await settle(100);
  check(
    scale() > before3 * 1.5,
    `a new pinch zooms after a stuck finger (${before3} → ${scale()})`,
  );
  pointer(boardEl(), "pointerup", p0.x + 120, p0.y, 42, { primary: false });
  pointer(boardEl(), "pointerup", p0.x, p0.y, 41, { primary: true });
  await rest();

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

  // World's topology can be empty for a moment (for example while a terminal
  // opens or closes). Afterwards the board must still zoom, drag and draw.
  mount(2, fixtureWorld([]));
  await waitFor(
    () => !host.querySelector(".board-workspace"),
    "an empty world shows no workspaces",
  );
  mount(2);
  await waitFor(() => Boolean(card("studio:w2")), "the board comes back");
  await rest();
  check(
    [
      ...host.querySelectorAll<SVGPathElement>(
        ".board-yarn:not(.board-yarn-temp)",
      ),
    ].some(
      (path) =>
        path.isConnected &&
        path.getBoundingClientRect().width +
          path.getBoundingClientRect().height >
          0,
    ),
    "strings are drawn after the topology comes back",
  );
  const scaleNow = () =>
    Number(
      /scale\(([\d.e+-]+)\)/.exec(
        host.querySelector<HTMLElement>(".board-world")!.style.transform,
      )?.[1],
    );
  const wheelBefore = scaleNow();
  const wc = centre(boardEl());
  boardEl().dispatchEvent(
    new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -120,
      clientX: wc.x,
      clientY: wc.y,
    }),
  );
  await settle(100);
  check(
    scaleNow() > wheelBefore,
    `the mouse wheel zooms after the topology comes back (${wheelBefore} → ${scaleNow()})`,
  );
  const dragged = card("studio:w2")!;
  const dragFrom = at("studio:w2")!;
  const dc = centre(dragged);
  pointer(dragged, "pointerdown", dc.x, dc.y, 13);
  for (let i = 1; i <= 8; i++) {
    pointer(dragged, "pointermove", dc.x + i * 10, dc.y, 13);
    await settle(16);
  }
  pointer(dragged, "pointerup", dc.x + 80, dc.y, 13);
  await rest();
  const dragTo = at("studio:w2")!;
  check(
    Math.hypot(dragTo.x - dragFrom.x, dragTo.y - dragFrom.y) > 20,
    "cards still drag after the topology comes back",
  );

  /** The fixture world with each pane changed by `edit`, or dropped if null. */
  const variant = (
    edit: (leaf: (typeof world.leaves)[number]) => typeof leaf | null,
  ) =>
    fixtureWorld(
      world.hosts.map((h) => ({
        ...h,
        spaces: h.spaces.map((space) => ({
          ...space,
          children: space.children.flatMap((leaf) => {
            const next = edit(leaf);
            return next ? [next] : [];
          }),
        })),
      })),
    );
  const strungPane = () => {
    const end = saved.strings[0]!.to;
    return "anchor" in end ? end.anchor : null;
  };

  // Herdr restarted: same IDs, new terminals. Board asks before trusting them.
  mount(
    2,
    variant((leaf) => ({
      ...leaf,
      terminalId: `${leaf.terminalId}_restarted`,
    })),
  );
  await waitFor(
    () => Boolean(host.querySelector(".board-banner")),
    "a restarted Herdr asks to keep or detach",
  );
  await waitFor(
    () => Boolean(host.querySelector(".board-yarn-loose")),
    "unconfirmed strings are dashed",
  );
  [...host.querySelectorAll<HTMLButtonElement>(".board-banner button")]
    .find((b) => b.textContent === "Keep")!
    .click();
  await waitFor(
    () => strungPane()?.witness.some((t) => t.endsWith("_restarted")) ?? false,
    "Keep records the new terminals",
  );
  await waitFor(
    () => !host.querySelector(".board-banner"),
    "the prompt goes once kept",
  );
  // Back to the original terminals: Keep again so the rest of the test runs as before.
  mount(2);
  await waitFor(
    () => Boolean(host.querySelector(".board-banner")),
    "the original terminals are unconfirmed again",
  );
  [...host.querySelectorAll<HTMLButtonElement>(".board-banner button")]
    .find((b) => b.textContent === "Keep")!
    .click();
  await waitFor(() => !host.querySelector(".board-banner"), "kept again");

  // The strung pane closes and Herdr says it is not found: Needs a home.
  const gone = strungPane()!.native_id;
  closedPanes.add(gone);
  mount(
    2,
    variant((leaf) => (leaf.nativeId === gone ? null : leaf)),
  );
  await waitFor(
    () => saved.strings[0]?.detached === true,
    "a closed target detaches its string",
  );
  check(saved.notes.length === 1, "the note stays on the board");
  host.querySelector<HTMLButtonElement>(".board-tray-button")!.click();
  await waitFor(
    () => host.querySelectorAll(".board-tray-row").length === 1,
    "Needs a home lists the string",
  );
  [...host.querySelectorAll<HTMLButtonElement>(".board-tray-row button")]
    .find((b) => b.textContent === "Discard")!
    .click();
  await waitFor(() => saved.strings.length === 0, "Discard removes the string");
  closedPanes.clear();
  mount(2);
  // Wait for the restored world itself: the closed pane's square is back.
  await waitFor(
    () => host.querySelectorAll(".board-sum span").length === 19,
    "the board is back with every pane",
  );

  // Start a new agent from the note: a workspace and a kind, then strung.
  const noteAgain = card(noteKey)!;
  const na = centre(noteAgain);
  pointer(noteAgain, "pointerdown", na.x, na.y, 15);
  pointer(noteAgain, "pointerup", na.x, na.y, 15);
  await waitFor(
    () =>
      Boolean(
        [...host.querySelectorAll(".board-notebar button")].find(
          (b) => b.textContent === "Start an agent…",
        ),
      ),
    "a note offers to start an agent",
  );
  [...host.querySelectorAll<HTMLButtonElement>(".board-notebar button")]
    .find((b) => b.textContent === "Start an agent…")!
    .click();
  await waitFor(
    () =>
      host.querySelectorAll(
        '[aria-label="Start an agent with this note"] .board-tray-row',
      ).length === 5,
    "the chooser lists each workspace",
  );
  host
    .querySelector<HTMLButtonElement>(
      '[aria-label="Start an agent with this note"] .board-tray-row button',
    )!
    .click();
  await waitFor(
    () => saved.strings.length === 1,
    "the new agent is strung to the note",
  );
  check(
    started.length === 1 &&
      started[0]!.kind === "claude" &&
      started[0]!.text === "Ship the login fix",
    "the agent starts with the note",
  );
  const startedEnd = saved.strings[0]!.to;
  check(
    "anchor" in startedEnd &&
      startedEnd.anchor.kind === "pane" &&
      startedEnd.anchor.witness.length === 1,
    "the string goes to the new pane with its terminal as witness",
  );

  // Drag a tab onto another workspace: it glues, and asks before moving.
  if (innerWidth > 720) {
    try {
      localStorage.removeItem("herdr-world.board.move-no-ask");
    } catch {
      // Storage unavailable in this browser: the dialog shows anyway.
    }
    await bringIntoView(() => card("studio:w2")!);
    const moving = card("studio:w2:t2")!;
    const target = card("studio:w1")!;
    const from = centre(moving.querySelector(".board-label")!),
      to = centre(target);
    const dragTo = async () => {
      pointer(moving, "pointerdown", from.x, from.y, 16);
      for (let i = 1; i <= 10; i++) {
        pointer(
          moving,
          "pointermove",
          from.x + ((to.x - from.x) * i) / 10,
          from.y + ((to.y - from.y) * i) / 10,
          16,
        );
        await settle(16);
      }
    };
    await dragTo();
    check(
      target.classList.contains("board-glue"),
      "the workspace a tab is over glows",
    );
    pointer(moving, "pointerup", to.x, to.y, 16);
    await waitFor(
      () => Boolean(host.querySelector(".board-move")),
      "dropping on a workspace asks first",
    );
    check(
      host.querySelector(".board-move")!.textContent!.includes("site build") &&
        host.querySelector(".board-move")!.textContent!.includes("web-app"),
      "the question names the tab and the workspace",
    );
    host.querySelector<HTMLInputElement>(".board-noask input")!.click();
    [...host.querySelectorAll<HTMLButtonElement>(".board-move button")]
      .find((b) => b.textContent === "Move")!
      .click();
    await waitFor(() => movedTabs.length === 1, "Move moves the tab");
    check(
      movedTabs[0]!.tab === "w2:t2" && movedTabs[0]!.to === "w1",
      "the right tab goes to the right workspace",
    );
    await rest();
    await dragTo();
    pointer(moving, "pointerup", to.x, to.y, 16);
    await waitFor(
      () => movedTabs.length === 2,
      "with Don't ask again, a drop moves at once",
    );
    check(!host.querySelector(".board-move"), "and no question is shown");
    try {
      localStorage.removeItem("herdr-world.board.move-no-ask");
    } catch {
      // Nothing stored.
    }
  }

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

  // In the overview, tapping a workspace zooms in on it instead of selecting.
  const selectedBefore = selected.length;
  const target = card("build-box:w2")!;
  const tc = centre(target);
  pointer(target, "pointerdown", tc.x, tc.y, 12);
  pointer(target, "pointerup", tc.x, tc.y, 12);
  await waitFor(
    () => !boardEl().classList.contains("board-far"),
    "tapping a workspace in the overview zooms in",
  );
  await rest();
  const tc2 = centre(card("build-box:w2")!);
  const bc = centre(boardEl());
  check(
    Math.hypot(tc2.x - bc.x, tc2.y - bc.y) < 40,
    "the tapped workspace is centred",
  );
  check(selected.length === selectedBefore, "an overview tap does not select");
  for (let i = 0; i < 12; i++)
    host.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')!.click();
  await waitFor(
    () => boardEl().classList.contains("board-far"),
    "back to the overview",
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
