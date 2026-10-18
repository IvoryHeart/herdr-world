import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import BoardView from "./BoardView";
import {
  BoardDocumentStore,
  type BoardDocument,
  type BoardEnd,
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
      const want = op.if_anchor;
      const side = want && string?.[want.end];
      const unchanged =
        !want ||
        (side &&
          "anchor" in side &&
          side.anchor.connection_id === want.connection_id &&
          side.anchor.kind === want.kind &&
          side.anchor.native_id === want.native_id);
      if (string && unchanged) string.detached = true;
    } else if (op.op === "anchor.witness") {
      const side = next.strings.find(
        (candidate) => candidate.id === op.string_id,
      )?.[op.end];
      if (side && "anchor" in side) side.anchor.witness = op.witness;
    } else if (op.op === "card.color") {
      const colors = { ...(next.layout.colors ?? {}) };
      if (op.color) colors[op.key] = op.color;
      else delete colors[op.key];
      next.layout.colors = colors;
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
const sent: {
  paneId: string;
  terminalId: string;
  text: string;
  stringId: string;
  rev: number;
}[] = [];
/** Pane IDs the fake service reports as closed ("not found"). */
const closedPanes = new Set<string>();
/** While set, anchor checks wait here until the test answers them. */
let heldChecks: ((state: string) => void)[] | null = null;
const started: {
  workspace: string;
  kind: string;
  text: string;
  name: string;
}[] = [];
const createdTabs: string[] = [];
let lastAnchors: Record<
  string,
  { x: number; y: number; visible: boolean }
> | null = null;
const movedTabs: { tab: string; to: string }[] = [];
const host = document.createElement("div");
host.style.cssText = "position:fixed;inset:0";
document.body.appendChild(host);
const root = createRoot(host);
/** Mount Board; a new key remounts it, as a reload would. */
function mount(key: number, shown = world, selectedId: string | null = null) {
  root.render(
    <StrictMode>
      <BoardView
        key={key}
        world={shown}
        selectedId={selectedId}
        onNodeAnchorsChange={(anchors) => {
          lastAnchors = anchors;
        }}
        onSelect={(id) => selected.push(id)}
        onOpenTerminal={(id) => opened.push(id)}
        store={store}
        sendNote={async (target, note) => {
          sent.push({
            paneId: target.paneId,
            terminalId: target.terminalId,
            text: note.text,
            stringId: target.stringId,
            rev: note.rev,
          });
          return { status: "sent", agent: target.label };
        }}
        moveTab={async (tab, space) => {
          movedTabs.push({ tab: tab.nativeId, to: space.nativeId });
          const tabId = `${space.nativeId}:t9`;
          // As the service does for every move: strings to the tab follow it.
          const ops = saved.strings.flatMap((string) => {
            const follow = (end: BoardEnd): BoardEnd =>
              "anchor" in end &&
              end.anchor.kind === "tab" &&
              end.anchor.native_id === tab.nativeId
                ? { anchor: { ...end.anchor, native_id: tabId } }
                : end;
            const from = follow(string.from),
              to = follow(string.to);
            return from !== string.from || to !== string.to
              ? [{ op: "string.put" as const, string: { ...string, from, to } }]
              : [];
          });
          if (ops.length) apply(ops);
          return { status: "moved", tab_id: tabId, panes: [] };
        }}
        createTab={async (space, name) => {
          createdTabs.push(`${space.nativeId}:${name ?? ""}`);
          // A name the fake refuses: created, but naming failed.
          return name === "Refused" ? { namingProblem: "no such tab" } : {};
        }}
        startAgent={async (space, kind, name, text) => {
          started.push({ workspace: space.nativeId, kind, text, name });
          // The fake new agent lands in an existing pane of that workspace.
          const leaf = space.space.children[0]!;
          return {
            status: "sent",
            pane_id: leaf.nativeId,
            terminal_id: leaf.terminalId,
          };
        }}
        checkAnchor={async (_host, anchor) =>
          heldChecks
            ? new Promise((resolve) =>
                heldChecks!.push((state) => resolve({ state })),
              )
            : {
                state: closedPanes.has(anchor.native_id) ? "absent" : "present",
              }
        }
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
/** Set a React-controlled field as a user would. */
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function choose(select: HTMLSelectElement, index: number) {
  const option = select.querySelectorAll("option:not([disabled])")[
    index
  ] as HTMLOptionElement;
  Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )!.set!.call(select, option.value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
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

  const tab = card("studio:w1:t1")!;
  const t = centre(tab);
  pointer(tab, "pointerdown", t.x, t.y);
  pointer(tab, "pointerup", t.x, t.y);
  check(
    selected.length === 1 && selected[0]!.includes("w1:p1"),
    "a tap selects the tab's pane",
  );
  // The board captures the pointer, so a real dblclick targets the board.
  await bringIntoView(() => card("studio:w1:t1")!);
  const tv = centre(card("studio:w1:t1")!);
  boardEl().dispatchEvent(
    new MouseEvent("dblclick", { bubbles: true, clientX: tv.x, clientY: tv.y }),
  );
  check(opened.length === 1, "a double-click opens the terminal");
  check(saved.notes.length === 0, "a double-click on a tab makes no note");

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
  const cutButton = host.querySelector<HTMLButtonElement>(".board-cut")!;
  const shown = () => getComputedStyle(cutButton).display !== "none";
  check(shown(), "the Delete button is visible");
  {
    const away = emptySpot();
    pointer(boardEl(), "pointerdown", away.x, away.y, 33);
    pointer(boardEl(), "pointerup", away.x, away.y, 33);
    await waitFor(() => !shown(), "tapping the board hides the Delete button");
    yarn.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 9,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
      }),
    );
    yarn.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 9,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
      }),
    );
    await waitFor(shown, "picking the string again shows Delete");
  }
  cutButton.click();
  await waitFor(() => saved.strings.length === 1, "Cut string removes it");
  await waitFor(() => !shown(), "the Delete button goes away after a delete");

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
      sent[0]!.text === "Ship the login fix" &&
      saved.strings.some((string) => string.id === sent[0]!.stringId) &&
      saved.notes.some((note) => note.rev === sent[0]!.rev),
    "the note goes to the strung pane, with its witnessed terminal, string and revision",
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
  {
    // A double-click on a note edits it, rather than making another.
    const all = [...host.querySelectorAll<HTMLElement>(".board-note")];
    const newest = all[all.length - 1]!;
    const c = centre(newest);
    boardEl().dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, clientX: c.x, clientY: c.y }),
    );
    await settle(100);
    check(saved.notes.length === 2, "a double-click on a note makes no note");
    check(
      document.activeElement?.getAttribute("aria-label") === "Note text",
      "a double-click on a note edits it",
    );
  }
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
  const noteDialog = '[aria-label="Start an agent with this note"]';
  await waitFor(
    () => Boolean(host.querySelector(noteDialog)),
    "a note opens the new-tab dialog",
  );
  check(
    host.querySelectorAll(`${noteDialog} select option:not([disabled])`)
      .length === 5,
    "the dialog lists each workspace",
  );
  check(
    ![...host.querySelectorAll(`${noteDialog} [role="radio"]`)].some(
      (b) => b.textContent === "Terminal",
    ),
    "a note starts an agent, not a plain terminal",
  );
  const submit = () =>
    host.querySelector<HTMLButtonElement>(`${noteDialog} [type="submit"]`)!;
  check(submit().disabled, "nothing starts before a choice");
  choose(host.querySelector<HTMLSelectElement>(`${noteDialog} select`)!, 0);
  [...host.querySelectorAll<HTMLButtonElement>(`${noteDialog} [role="radio"]`)]
    .find((b) => b.textContent === "Claude")!
    .click();
  await settle(30);
  check(!submit().disabled, "choosing a workspace and an agent enables Start");
  check(started.length === 0, "nothing starts until confirmed");
  submit().click();
  await waitFor(
    () => saved.strings.length === 1,
    "the new agent is strung to the note",
  );
  check(
    started.length === 1 &&
      started[0]!.kind === "claude" &&
      started[0]!.text === "Ship the login fix" &&
      started[0]!.name === "Ship the login",
    "the agent starts with the note, its tab named from the note",
  );
  const startedEnd = saved.strings[0]!.to;
  check(
    "anchor" in startedEnd &&
      startedEnd.anchor.kind === "pane" &&
      startedEnd.anchor.witness.length === 1,
    "the string goes to the new pane with its terminal as witness",
  );

  // Without a note: + on a workspace opens a terminal or starts an agent.
  {
    const newTab = '[aria-label="New tab in web-app"]';
    const pick = async (label: string, name = "") => {
      host
        .querySelector<HTMLButtonElement>('[aria-label="New in web-app"]')!
        .click();
      await waitFor(
        () => Boolean(host.querySelector(newTab)),
        "+ on a workspace opens the new-tab dialog with it chosen",
      );
      [...host.querySelectorAll<HTMLButtonElement>(`${newTab} [role="radio"]`)]
        .find((b) => b.textContent === label)!
        .click();
      if (name)
        type(host.querySelector<HTMLInputElement>(`${newTab} input`)!, name);
      await settle(30);
      host
        .querySelector<HTMLButtonElement>(`${newTab} [type="submit"]`)!
        .click();
      await settle(50);
    };
    await pick("Terminal", "Logs");
    check(
      createdTabs.length === 1 && createdTabs[0]!.endsWith(":Logs"),
      "Terminal opens a plain tab with the given name",
    );
    await pick("Terminal", "Refused");
    await waitFor(
      () =>
        Boolean(
          host
            .querySelector(".board-toast")
            ?.textContent?.includes(
              "Opened a terminal in web-app, but it could not be named",
            ),
        ),
      "a naming failure reports the created tab, not a failed create",
    );
    check(createdTabs.length === 2, "the failed name creates no second tab");
    await pick("Codex");
    check(
      started.length === 2 &&
        started[1]!.kind === "codex" &&
        started[1]!.text === "",
      "an agent starts with no note and nothing to send",
    );
    check(
      Boolean(host.querySelector('[aria-label^="New workspace on "]')),
      "each host offers a new workspace",
    );
    check(
      card("studio:w1")!
        .querySelector(".board-counts")!
        .textContent!.includes("agent"),
      "a workspace card counts its agents",
    );
  }

  // Colours: the user picks a tab or workspace colour; status keeps its own.
  {
    const tabKey = "studio:w1:t2";
    await bringIntoView(() => card(tabKey)!);
    const c = centre(card(tabKey)!);
    pointer(card(tabKey)!, "pointerdown", c.x, c.y, 35);
    pointer(card(tabKey)!, "pointerup", c.x, c.y, 35);
    const id = selected[selected.length - 1]!;
    mount(2, world, id);
    await waitFor(
      () => Boolean(host.querySelector('[aria-label="Colour of review"]')),
      "selecting a tab offers its colours",
    );
    await settle(100);
    {
      const bar = host
        .querySelector('[aria-label="Colour of review"]')!
        .getBoundingClientRect();
      const tab = card(tabKey)!.getBoundingClientRect();
      check(
        (bar.bottom <= tab.top + 1 && tab.top - bar.bottom < 40) ||
          (bar.top >= tab.bottom - 1 && bar.top - tab.bottom < 40),
        "the colour bar rides next to its card",
      );
    }
    await waitFor(
      () => Boolean(lastAnchors?.[id]),
      "Board reports where the selected node is, for the Inspector's line",
    );
    {
      const a = lastAnchors![id]!;
      const r = card(tabKey)!.getBoundingClientRect();
      check(
        a.visible &&
          Math.abs(a.x - r.right) < 3 &&
          a.y > r.top &&
          a.y < r.bottom,
        "the line meets the selected card's right edge",
      );
    }
    {
      // Zoomed out, the line goes to the workspace, not the hidden tab.
      for (
        let i = 0;
        i < 14 && !boardEl().classList.contains("board-far");
        i++
      ) {
        host
          .querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')!
          .click();
        await settle(40);
      }
      await rest();
      await settle(100);
      const ws = card("studio:w1")!.getBoundingClientRect();
      const a = lastAnchors![id]!;
      check(
        Math.abs(a.x - Math.min(ws.right, innerWidth - 4)) < 6 &&
          a.y > ws.top - 4 &&
          a.y < ws.bottom + 4,
        "zoomed out, the line goes to the tab's workspace",
      );
      await bringIntoView(() => card(tabKey)!);
    }
    const before = getComputedStyle(card(tabKey)!).backgroundColor;
    host
      .querySelector<HTMLButtonElement>(
        '[aria-label="Colour of review"] [aria-label="Colour teal"]',
      )!
      .click();
    await waitFor(
      () => saved.layout.colors?.[tabKey] === "teal",
      "the colour is saved",
    );
    await waitFor(
      () => getComputedStyle(card(tabKey)!).backgroundColor !== before,
      "the tab takes the colour",
    );
    check(
      card(tabKey)!.classList.contains("board-s-done"),
      "the status stays on the card",
    );
    [
      ...host.querySelectorAll<HTMLButtonElement>(
        '[aria-label="Colour of review"] button',
      ),
    ]
      .find((b) => b.textContent === "No colour")!
      .click();
    await waitFor(() => !saved.layout.colors?.[tabKey], "No colour clears it");
    mount(2, world, null);
    await settle(50);
  }

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

  // Tidy carries strung notes with their cards.
  {
    const strungTo = saved.strings[0]!.to;
    const paneId = "anchor" in strungTo ? strungTo.anchor.native_id : "";
    const tabKey =
      [...host.querySelectorAll<HTMLElement>(".board-tab")].find(
        (el) =>
          el.querySelector(`[data-pane$=":${paneId}"]`) ||
          el.dataset.key === `studio:${paneId.split(":")[0]}:t1`,
      )?.dataset.key ?? "studio:w1:t1";
    await bringIntoView(() => card("studio:w1")!);
    const ws = card("studio:w1")!;
    const wc = centre(ws.querySelector(".board-label")!);
    pointer(ws, "pointerdown", wc.x, wc.y, 31);
    for (let i = 1; i <= 8; i++) {
      pointer(ws, "pointermove", wc.x + i * 25, wc.y + i * 10, 31);
      await settle(16);
    }
    await settle(150);
    pointer(ws, "pointerup", wc.x + 200, wc.y + 80, 31);
    await rest();
    await settle(700);
    const noteBefore = at(noteKey)!,
      tabBefore = at(tabKey)!;
    host
      .querySelector<HTMLButtonElement>('[aria-label="Tidy the board"]')!
      .click();
    await rest();
    await settle(300);
    const noteAfter = at(noteKey)!,
      tabAfter = at(tabKey)!;
    const tabMoved = {
      x: tabAfter.x - tabBefore.x,
      y: tabAfter.y - tabBefore.y,
    };
    check(Math.hypot(tabMoved.x, tabMoved.y) > 20, "tidy moved the strung tab");
    check(
      Math.abs(noteAfter.x - noteBefore.x - tabMoved.x) < 3 &&
        Math.abs(noteAfter.y - noteBefore.y - tabMoved.y) < 3,
      "a strung note moves with its card when the board is tidied",
    );
    await waitFor(
      () => Math.abs(saved.notes[0]!.x - noteAfter.x) < 1,
      "the note's new place is saved",
    );
    [...host.querySelectorAll<HTMLButtonElement>(".board-toast button")]
      .find((b) => b.textContent === "Undo")!
      .click();
    await rest();
    await settle(300);
    const noteUndone = at(noteKey)!;
    check(
      Math.hypot(noteUndone.x - noteBefore.x, noteUndone.y - noteBefore.y) < 3,
      "Undo puts the note back too",
    );
  }

  // Another client moves a workspace and folds it: the open board follows,
  // and its own next save keeps that change rather than restoring its old one.
  {
    await settle(800);
    const key = "studio:w2";
    const was = at(key)!;
    const offset = saved.layout.offsets[key] ?? { x: 0, y: 0 };
    apply([
      {
        op: "layout.set",
        offsets: { [key]: { x: offset.x + 400, y: offset.y } },
        folded: [...saved.layout.folded, key],
      },
    ]);
    await store.refresh();
    await rest();
    await settle(400);
    check(
      Math.abs(at(key)!.x - was.x - 400) < 3,
      "another client's move reaches the open board",
    );
    check(
      card(key)!.classList.contains("board-folded"),
      "another client's fold reaches the open board",
    );
    // A local change afterwards saves the whole layout including that move.
    host.querySelector<HTMLButtonElement>(`[aria-label="Open docs"]`)!.click();
    await waitFor(
      () => !saved.layout.folded.includes(key),
      "a local change saves after the remote one",
    );
    check(
      Math.abs((saved.layout.offsets[key]?.x ?? 0) - offset.x - 400) < 1,
      "the local save keeps the other client's move",
    );
  }

  // Tidy moves any note left on a card to free space.
  {
    const notesBefore = saved.notes.length;
    const spot = emptySpot();
    boardEl().dispatchEvent(
      new MouseEvent("dblclick", {
        bubbles: true,
        clientX: spot.x,
        clientY: spot.y,
      }),
    );
    await waitFor(
      () => saved.notes.length === notesBefore + 1,
      "a note to drop on a card",
    );
    (document.activeElement as HTMLElement | null)?.blur();
    await settle(100);
    const fresh = saved.notes[saved.notes.length - 1]!;
    const noteEl = card(`note:${fresh.id}`)!;
    const from = centre(noteEl),
      to = centre(card("studio:w1")!);
    pointer(noteEl, "pointerdown", from.x, from.y, 34);
    for (let i = 1; i <= 6; i++) {
      pointer(
        noteEl,
        "pointermove",
        from.x + ((to.x - from.x) * i) / 6,
        from.y + ((to.y - from.y) * i) / 6,
        34,
      );
      await settle(16);
    }
    await settle(150);
    pointer(noteEl, "pointerup", to.x, to.y, 34);
    await settle(300);
    const onCard = () => {
      const notes = [...host.querySelectorAll<HTMLElement>(".board-note")].map(
        (el) => el.getBoundingClientRect(),
      );
      const others = [
        ...host.querySelectorAll<HTMLElement>(".board-card:not(.board-note)"),
      ]
        .filter(
          (el) =>
            el.offsetParent !== null && getComputedStyle(el).display !== "none",
        )
        .map((el) => el.getBoundingClientRect());
      return notes.some((n) =>
        others.some(
          (o) =>
            n.left < o.right &&
            n.right > o.left &&
            n.top < o.bottom &&
            n.bottom > o.top,
        ),
      );
    };
    check(onCard(), "the dropped note sits on a card");
    host
      .querySelector<HTMLButtonElement>('[aria-label="Tidy the board"]')!
      .click();
    await rest();
    await settle(400);
    check(!onCard(), "after Tidy no note sits on a card");
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

  // The event trace: on from the menu, it records input and gestures.
  [
    ...host.querySelectorAll<HTMLButtonElement>(
      '.board-menu [role="menuitemcheckbox"]',
    ),
  ]
    .find((b) => b.textContent?.includes("Event trace"))!
    .click();
  await waitFor(
    () => Boolean(host.querySelector(".board-trace")),
    "Event trace opens the trace",
  );
  const tapAt = emptySpot();
  pointer(boardEl(), "pointerdown", tapAt.x, tapAt.y, 30);
  pointer(boardEl(), "pointerup", tapAt.x, tapAt.y, 30);
  await waitFor(
    () =>
      Boolean(
        host.querySelector(".board-trace")?.textContent?.includes("input"),
      ),
    "the trace records input",
  );
  check(
    host.querySelector(".board-trace-head")!.textContent!.includes("idle"),
    "the trace shows the gesture state",
  );
  host
    .querySelector<HTMLButtonElement>('[aria-label="Close the event trace"]')!
    .click();
  await waitFor(
    () => !host.querySelector(".board-trace"),
    "closing turns the trace off",
  );

  // A stale host's cached panes are never offered as Send targets.
  {
    const noteOf = (end: (typeof saved.strings)[number]["from"]) =>
      "note" in end ? end.note : null;
    const strungNote =
      noteOf(saved.strings[0]!.from) ?? noteOf(saved.strings[0]!.to)!;
    const sendShown = () =>
      [...host.querySelectorAll(".board-notebar button")].some((b) =>
        b.textContent?.startsWith("Send to"),
      );
    const tapNote = async () => {
      await bringIntoView(() => card(`note:${strungNote}`)!);
      const c = centre(card(`note:${strungNote}`)!);
      pointer(card(`note:${strungNote}`)!, "pointerdown", c.x, c.y, 36);
      pointer(card(`note:${strungNote}`)!, "pointerup", c.x, c.y, 36);
      await settle(100);
    };
    await tapNote();
    check(sendShown(), "a live strung agent offers Send");
    mount(
      2,
      fixtureWorld(
        world.hosts.map((h) => ({
          ...h,
          stale: true,
          spaces: h.spaces.map((space) => ({
            ...space,
            stale: true,
            actionable: false,
          })),
        })),
      ),
    );
    await settle(200);
    await tapNote();
    check(!sendShown(), "a stale host's pane offers no Send");
    check(
      Boolean(host.querySelector(".board-yarn-loose")),
      "a stale host's strings are drawn dashed",
    );
    // The strung pane is not on the board (but not known to be gone): its
    // string stays drawn, dashed, where the pane was last seen.
    const paneId = strungPane()?.native_id;
    const strings = host.querySelectorAll(
      ".board-yarn:not(.board-yarn-temp)",
    ).length;
    mount(
      2,
      variant((leaf) => (leaf.nativeId === paneId ? null : leaf)),
    );
    await settle(300);
    check(
      host.querySelectorAll(".board-yarn:not(.board-yarn-temp)").length ===
        strings && Boolean(host.querySelector(".board-yarn-loose")),
      "a string whose target left the board stays drawn, dashed",
    );
    mount(2);
    await settle(200);
  }

  // Editing a note while another client edits it: the draft survives the
  // refresh, the save is refused rather than overwriting, and Keep mine saves it.
  {
    const count = saved.notes.length;
    const spot = emptySpot();
    boardEl().dispatchEvent(
      new MouseEvent("dblclick", {
        bubbles: true,
        clientX: spot.x,
        clientY: spot.y,
      }),
    );
    await waitFor(() => saved.notes.length === count + 1, "a note to edit");
    const id = saved.notes[saved.notes.length - 1]!.id;
    await waitFor(
      () => document.activeElement?.getAttribute("aria-label") === "Note text",
      "the new note is being edited",
    );
    const editor = document.activeElement as HTMLElement;
    editor.textContent = "My draft";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    const remote = saved.notes.find((n) => n.id === id)!;
    apply([
      {
        op: "note.put",
        note: {
          id,
          text: "Their edit",
          color: remote.color,
          x: remote.x,
          y: remote.y,
        },
        rev: remote.rev,
      },
    ]);
    await store.refresh();
    await settle(100);
    check(
      editor.isConnected && editor.textContent === "My draft",
      "a remote edit leaves the draft alone",
    );
    editor.blur();
    await waitFor(
      () =>
        Boolean(
          host
            .querySelector(".board-unsaved")
            ?.textContent?.includes("changed on another device"),
        ),
      "a conflicting save is kept on screen, not applied",
    );
    check(
      saved.notes.find((n) => n.id === id)!.text === "Their edit",
      "the other client's edit is not overwritten",
    );
    // A later notice does not take the draft away.
    host
      .querySelector<HTMLButtonElement>('[aria-label="Tidy the board"]')!
      .click();
    await settle(100);
    check(
      Boolean(host.querySelector(".board-unsaved")),
      "the unsaved draft outlasts other notices",
    );
    [...host.querySelectorAll<HTMLButtonElement>(".board-unsaved button")]
      .find((b) => b.textContent === "Keep mine")!
      .click();
    await waitFor(
      () => saved.notes.find((n) => n.id === id)!.text === "My draft",
      "Keep mine saves the draft over the newer text",
    );
    // Deleted elsewhere while being edited: what was typed is kept, and can
    // be saved as a new note.
    (document.activeElement as HTMLElement | null)?.blur();
    await settle(100);
    const before = saved.notes.length;
    const spot2 = emptySpot();
    boardEl().dispatchEvent(
      new MouseEvent("dblclick", {
        bubbles: true,
        clientX: spot2.x,
        clientY: spot2.y,
      }),
    );
    await waitFor(
      () => saved.notes.length === before + 1,
      "another note to edit",
    );
    const goneId = saved.notes[saved.notes.length - 1]!.id;
    await waitFor(
      () => document.activeElement?.getAttribute("aria-label") === "Note text",
      "editing the second note",
    );
    const editor2 = document.activeElement as HTMLElement;
    editor2.textContent = "Typed before it vanished";
    editor2.dispatchEvent(new Event("input", { bubbles: true }));
    apply([
      {
        op: "note.delete",
        id: goneId,
        rev: saved.notes.find((n) => n.id === goneId)!.rev,
      },
    ]);
    await store.refresh();
    await waitFor(
      () =>
        Boolean(
          host
            .querySelector(".board-unsaved")
            ?.textContent?.includes("deleted on another device"),
        ),
      "a draft whose note was deleted elsewhere is kept",
    );
    [...host.querySelectorAll<HTMLButtonElement>(".board-unsaved button")]
      .find((b) => b.textContent === "Save as a new note")!
      .click();
    await waitFor(
      () => saved.notes.some((n) => n.text === "Typed before it vanished"),
      "the kept draft can be saved as a new note",
    );
  }

  // A late "absent" about a pane the string no longer names never detaches
  // it: a move rewrote the string while the check was in flight.
  {
    const string = saved.strings.find((candidate) => {
      const end = candidate.to;
      return (
        !candidate.detached && "anchor" in end && end.anchor.kind === "pane"
      );
    })!;
    const end = string.to as Extract<BoardEnd, { anchor: unknown }>;
    const old = end.anchor.native_id;
    heldChecks = [];
    mount(
      2,
      variant((leaf) => (leaf.nativeId === old ? null : leaf)),
    );
    await waitFor(
      () => (heldChecks?.length ?? 0) > 0,
      "the missing pane is checked",
    );
    const live = world.leaves.find(
      (leaf) => leaf.nativeId !== old && leaf.kind === "agent",
    )!;
    apply([
      {
        op: "string.put",
        string: {
          ...string,
          to: {
            anchor: {
              ...end.anchor,
              native_id: live.nativeId,
              witness: [live.terminalId],
            },
          },
        },
      },
    ]);
    await store.refresh();
    mount(2);
    await settle(100);
    for (const answer of heldChecks!) answer("absent");
    heldChecks = null;
    await settle(200);
    check(
      !saved.strings.find((candidate) => candidate.id === string.id)!.detached,
      "a late absent reply about the old pane does not detach the moved string",
    );
  }

  // A workspace's witness follows its terminals, including a pane that
  // leaves and comes back more than once.
  {
    const docs = world.leaves.filter(
      (leaf) => leaf.workspaceId === "w2" && leaf.connectionId === "studio",
    );
    const all = docs.map((leaf) => leaf.terminalId).sort();
    const leaving = docs[docs.length - 1]!;
    const noteId = saved.notes[0]!.id;
    apply([
      {
        op: "string.put",
        string: {
          id: "witness-check",
          from: { note: noteId },
          to: {
            anchor: {
              connection_id: "studio",
              kind: "workspace",
              native_id: "w2",
              witness: all,
            },
          },
        },
      },
    ]);
    await store.refresh();
    const witness = () => {
      const end = saved.strings.find(
        (string) => string.id === "witness-check",
      )!.to;
      return "anchor" in end ? [...end.anchor.witness].sort().join(",") : "";
    };
    const without = all.filter((t) => t !== leaving.terminalId).join(",");
    for (let round = 1; round <= 2; round++) {
      mount(
        2,
        variant((leaf) =>
          leaf.nativeId === leaving.nativeId && leaf.workspaceId === "w2"
            ? null
            : leaf,
        ),
      );
      await waitFor(
        () => witness() === without,
        `round ${round}: a pane leaving updates the witness`,
      );
      mount(2);
      await waitFor(
        () => witness() === all.join(","),
        `round ${round}: the pane coming back is recorded again`,
      );
    }
    mount(2);
    await settle(200);
  }
}

if (mode === "test")
  run()
    .catch((error) => failures.push(String(error)))
    .finally(() =>
      fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
    );
