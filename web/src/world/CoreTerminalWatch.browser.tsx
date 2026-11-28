import { clock as fixtureTime } from "./testing/installTestClock";
import { presentTestFrame } from "./testing/testClock";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { bridge } from "../api";
import { type CoreTerminalPush, MIN_WATCH_SCALE } from "../coreWatch";
import { useState } from "react";
import {
  CoreTerminalWatch,
  type CoreWatchTarget,
  coreInspectorTerminal,
  useCoreTerminalDrafts,
} from "./CoreTerminalWatch";
import type { WorldObjectNode } from "./worldObject";
import {
  activateTerminalComposerDraftScope,
  readTerminalComposerDraft,
  terminalComposerDraftKey,
  writeTerminalComposerDraft,
} from "../terminalComposer";
import "../styles/tokens.css";
import "../styles/base.css";
import "./windows/WorldLayout.css";

// The production Terminal tab body of a herdr-core agent's Inspector, fed
// push by push with what World's server relays from a recorded real-core
// watch: a desktop pane at 120x40, then 90x25, then closed (headless
// 200x120). The page records every call it makes; the test rotates the
// phone and opens its keyboard between pushes, then types real keys (CDP).

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const frame = () => fixtureTime.frame();
const frames = async (n: number) => {
  for (let i = 0; i < n; i++) await frame();
};
const pause = (ms: number) => fixtureTime.advance(ms);
window.addEventListener("error", (event) => failures.push(String(event.error)));
const capture = new URL(location.href).searchParams.get("capture");
const until = async (condition: () => boolean, ms = 2000) => {
  const end = performance.now() + ms;
  while (!condition() && performance.now() < end) await frame();
  return condition();
};

const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
let stream: string | null = null;
/** While set, the watch answers only when it settles (a slow SSH host). */
let watchGate: Promise<void> | null = null;
Object.assign(bridge, {
  call: async (method: string, params: Record<string, unknown> = {}) => {
    calls.push({ method, params });
    if (method === "world.core.watch") {
      if (watchGate) await watchGate;
      stream = String(params.stream);
      return { stream, grid: { cols: 120, rows: 40 }, moved_from: null };
    }
    if (method === "world.core.input") return { sent: true };
    if (method === "world.core.hold") return { held: true };
    return { closed: true };
  },
  onStatus: () => () => {},
});
// Pushes go through the bridge's own parser, as a socket message would.
(
  bridge as unknown as { helloAcceptedForSocket: boolean }
).helloAcceptedForSocket = true;
const deliver = (push: CoreTerminalPush, to = stream) =>
  (bridge as unknown as { onMessage(raw: string): void }).onMessage(
    JSON.stringify({ core_terminal: { ...push, stream: to } }),
  );

const host = () => document.querySelector<HTMLElement>(".core-watch-host");
const termGrid = () => host()?.dataset.termGrid ?? null;
const rows = () =>
  document.querySelectorAll(".core-watch-host .xterm-rows > div").length;
const screenText = () =>
  document.querySelector(".core-watch-host .xterm-rows")?.textContent ?? "";
/** Asks the test to set the viewport, as rotating or a keyboard would. */
const viewport = async (width: number, height: number) => {
  await fetch(`/viewport?width=${width}&height=${height}`);
  await frames(4);
  await presentTestFrame(fixtureTime);
};
/** A real key press (CDP), into whatever has focus. */
const press = (key: string) => fetch(`/key?key=${encodeURIComponent(key)}`);
/** Real text input (CDP), as a phone keyboard inserts it. */
const insert = (text: string) =>
  fetch(`/insert?text=${encodeURIComponent(text)}`);
const inputs = () => calls.filter((c) => c.method === "world.core.input");
const holds = () => calls.filter((c) => c.method === "world.core.hold");
const lastHold = () => holds()[holds().length - 1]?.params ?? {};
const typedText = (from = 0) =>
  inputs()
    .slice(from)
    .filter((c) => !c.params.automatic)
    .map((c) => atob(String(c.params.data)))
    .join("");
const gridLine = () =>
  document.querySelector("[data-core-watch-grid]")?.textContent ?? "";
const xtermInput = () =>
  document.querySelector<HTMLTextAreaElement>(".core-watch-host textarea")!;
const section = () => document.querySelector<HTMLElement>(".core-watch")!;

/** The grid World asks for fits the view at actual size, edge to edge. */
function fitsView(size: Record<string, unknown>, label: string) {
  const view = document.querySelector<HTMLElement>(".core-watch-view")!;
  const drawing = document.querySelector<HTMLElement>(
    ".core-watch-host .xterm-screen",
  )!;
  // xterm opens at 80x24 and keeps it until core's first grid.
  const [cols, rows] = (termGrid() ?? "80x24").split("x").map(Number);
  const cellWidth = drawing.offsetWidth / cols!;
  const cellHeight = drawing.offsetHeight / rows!;
  const width = view.clientWidth - 16;
  const height = view.clientHeight - 16;
  const c = Number(size.cols);
  const r = Number(size.rows);
  check(
    c * cellWidth <= width + 0.5 &&
      (c + 1) * cellWidth > width &&
      r * cellHeight <= height + 0.5 &&
      (r + 1) * cellHeight > height,
    `${label}: ${c}x${r} fits ${width}x${height}px (cell ${cellWidth.toFixed(2)}x${cellHeight.toFixed(2)})`,
  );
}

/** World's view holds its size; core answers with that grid. */
async function adoptHold() {
  await until(() => holds().length > 0);
  const size = lastHold();
  deliver({
    stream: "",
    grid: { cols: Number(size.cols), rows: Number(size.rows) },
  });
  await frames(3);
  return size;
}

async function run() {
  const meta = document.createElement("meta");
  meta.name = "viewport";
  meta.content = "width=device-width, initial-scale=1";
  document.head.append(meta);
  const pushes: CoreTerminalPush[] = await (await fetch("/pushes")).json();
  const root = document.createElement("div");
  document.body.append(root);
  let setOpen: (open: boolean) => void = () => {};
  // The Inspector's frame in World's shell (which a phone keyboard lifts):
  // its tab body fills it.
  function Window() {
    const [open, set] = useState(true);
    setOpen = set;
    return open ? (
      <div
        className="world-foundation-shell workspace-inspector"
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <button type="button" className="fixture-title">
          reviewer
        </button>
        <div style={{ flex: 1, minHeight: 0 }}>
          <CoreTerminalWatch
            target={{
              connectionId: "core-fixture",
              generation: 1,
              address: "t1",
            }}
            title="reviewer"
          />
        </div>
      </div>
    ) : null;
  }
  flushSync(() => createRoot(root).render(<Window />));
  await until(() => stream !== null);
  await frames(2);
  check(stream !== null, "the view asks to watch t1");
  check(
    JSON.stringify(calls[0]?.params) ===
      JSON.stringify({
        connection_id: "core-fixture",
        generation: 1,
        address: "t1",
        stream,
      }),
    `the watch names only the terminal: ${JSON.stringify(calls[0])}`,
  );
  // The open view holds the grid that fits it at once, with no key typed.
  await until(() => holds().length > 0);
  check(
    holds().length === 1 && lastHold().stream === stream,
    `the open view holds its size: ${JSON.stringify(holds())}`,
  );
  // Once its header settles, the size held is the one that fits.
  await pause(300);
  fitsView(lastHold(), "the held grid fits the view");
  const grids = pushes.flatMap((p, i) => ("grid" in p ? [i] : []));
  check(grids.length === 3, `three grids recorded: ${grids.length}`);
  // Desktop pane at 120x40, then its resize to 90x25 with its repaint: a
  // Herdr app holds the size, and World draws its grid.
  const desktopEnd = grids[2]!;
  const adopted: string[] = [];
  new MutationObserver((records) => {
    records.forEach((_, i) => {
      const grid = records[i + 1]?.oldValue ?? termGrid();
      if (grid && adopted[adopted.length - 1] !== grid) adopted.push(grid);
    });
  }).observe(host()!, {
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["data-term-grid"],
  });
  for (const push of pushes.slice(0, desktopEnd)) deliver(push);
  await frames(3);
  check(
    adopted.join(",") === "120x40,90x25",
    `xterm adopts each desktop grid in order: ${adopted.join(",")}`,
  );
  check(termGrid() === "90x25", `the desktop grid is shown: ${termGrid()}`);
  check(rows() === 25, `25 rows are drawn: ${rows()}`);
  check(
    screenText().includes("after resize"),
    `the repaint and live output are shown: ${screenText().slice(0, 200)}`,
  );
  check(
    gridLine().startsWith("90×25: the size of the Herdr app"),
    `the grid line says who set the size: ${gridLine()}`,
  );
  if (capture === "app") return;
  // Rotate the phone, open its keyboard, close it, rotate back: the drawing
  // rescales (never below a readable size), core's grid never changes under
  // World, nothing is typed, and World's held size follows the view once
  // it settles.
  const sent = inputs().length;
  const scales: string[] = [];
  for (const [width, height] of [
    [390, 844],
    [844, 390],
    [390, 480],
    [390, 844],
  ] as const) {
    await viewport(width, height);
    scales.push(host()?.dataset.scale ?? "");
    check(
      termGrid() === "90x25",
      `${width}x${height} keeps 90x25: ${termGrid()}`,
    );
    const scale = Number(host()?.dataset.scale);
    const view = document.querySelector<HTMLElement>(".core-watch-view")!;
    const drawn = document.querySelector<HTMLElement>(".core-watch-frame")!;
    check(
      scale >= MIN_WATCH_SCALE - 0.001,
      `${width}x${height}: the drawing stays readable: ${scale}`,
    );
    check(
      drawn.offsetWidth <= view.clientWidth ||
        Math.abs(scale - MIN_WATCH_SCALE) < 0.001,
      `${width}x${height}: the drawing fits or scrolls at the minimum scale`,
    );
  }
  check(
    new Set(scales).size > 1,
    `only the drawing scales: ${scales.join(", ")}`,
  );
  check(
    inputs().length === sent,
    `rotation and keyboard type nothing: ${JSON.stringify(inputs().slice(sent))}`,
  );
  await pause(300);
  fitsView(lastHold(), "after the rotations World holds the grid that fits");
  check(
    holds().length <= 5,
    `each settled view size is held once, not every frame: ${holds().length}`,
  );
  // The pane closes: core gives World its held size (no headless step).
  const held = await adoptHold();
  check(
    termGrid() === `${held.cols}x${held.rows}`,
    `World's held size is adopted: ${termGrid()}`,
  );
  check(
    gridLine().includes("fits this window; it goes back when you close it"),
    `the grid line says World holds the size: ${gridLine()}`,
  );
  check(
    section().dataset.held === `${held.cols}x${held.rows}`,
    `the view says what it holds: ${section().dataset.held}`,
  );
  if (capture === "held") return;
  // xterm parses writes later but resizes at once: a grid arriving right
  // behind a paint must not overtake it. An X sent to column 100 of a
  // 60-column grid stops at column 60; drawn after the next grid, it would
  // land at column 100.
  deliver({ stream: "", grid: { cols: 60, rows: 20 } });
  deliver({ stream: "", bytes: btoa("\x1b[H\x1b[2J\x1b[1;100HX") });
  deliver({ stream: "", grid: { cols: 120, rows: 40 } });
  await frames(3);
  const marks = [
    ...document.querySelectorAll(".core-watch-host .xterm-rows > div"),
  ].flatMap((row) => {
    const text = (row.textContent ?? "").trimEnd();
    return text.endsWith("X") ? [text.length] : [];
  });
  check(termGrid() === "120x40", `the later grid is adopted: ${termGrid()}`);
  check(
    marks.join() === "60",
    `a paint is drawn on its own grid before the next one: ${marks.join()}`,
  );
  // The headless grid, said plainly.
  for (const push of pushes.slice(desktopEnd)) deliver(push);
  await frames(3);
  check(
    gridLine().includes("headless size"),
    `the headless grid is named honestly: ${gridLine()}`,
  );
  await typing();
  await keyboardLift();
  // core is killed: the stream ends and says so.
  deliver({ stream: "", closed: "core closed the connection" });
  await frames(2);
  check(
    document
      .querySelector(".core-watch-ended")
      ?.textContent?.includes("Lost the herdr-core connection") === true,
    "a lost core says so",
  );
  // Closing the Inspector ends the watch (and with it World's seat).
  const firstStream = stream;
  flushSync(() => setOpen(false));
  await frames(2);
  check(
    calls.some(
      (c) =>
        c.method === "world.core.unwatch" && c.params.stream === firstStream,
    ),
    "closing the window ends the watch",
  );
  await twoInspectors();
  await reconnects();
  await earlyKeys();
  await minimized();
}

/**
 * A key typed before the watch answers (over a slow SSH host, say) waits
 * for it and then goes once: World's server knows the stream only after
 * core's observe attach answered (live core 0.1.21 refused the key with
 * "that terminal is not being watched").
 */
async function earlyKeys() {
  let release = () => {};
  watchGate = new Promise((resolve) => {
    release = resolve;
  });
  const root = document.createElement("div");
  document.body.append(root);
  const app = createRoot(root);
  const from = calls.length;
  flushSync(() =>
    app.render(
      <div style={{ position: "fixed", inset: 0 }}>
        <CoreTerminalWatch
          target={{
            connectionId: "core-fixture",
            generation: 1,
            address: "t6",
          }}
          title="slow"
        />
      </div>,
    ),
  );
  const watch = () =>
    calls
      .slice(from)
      .find(
        (c) => c.method === "world.core.watch" && c.params.address === "t6",
      );
  await until(() => watch() !== undefined);
  const key = String(watch()?.params.stream);
  const sentOn = () =>
    calls
      .slice(from)
      .filter(
        (c) => c.method === "world.core.input" && c.params.stream === key,
      );
  root.querySelector<HTMLTextAreaElement>(".core-watch-host textarea")!.focus();
  await press("a");
  await pause(200);
  check(
    sentOn().length === 0,
    `a key waits while the watch opens: ${JSON.stringify(sentOn())}`,
  );
  watchGate = null;
  release();
  await until(() => sentOn().length > 0);
  await pause(200);
  const typed = sentOn()
    .filter((c) => !c.params.automatic)
    .map((c) => atob(String(c.params.data)))
    .join("");
  check(typed === "a", `the waiting key goes once, after the watch: ${typed}`);
  check(
    !root.querySelector(".core-watch-notice"),
    "the waiting key is not refused",
  );
  flushSync(() => app.unmount());
  root.remove();
}

/**
 * Minimizing the Inspector ends its watch and World's seat (the page's
 * watch slots and the size go back); a look at Chat keeps both. Restored,
 * the Terminal tab watches again once it is the tab shown.
 */
async function minimized() {
  const node = {
    kind: "agent",
    id: "n7",
    label: "minimized",
    coreControl: true,
    stale: false,
    watch: { connectionId: "core-fixture", generation: 1, address: "t7" },
  } as unknown as WorldObjectNode;
  let view = { selected: true, shown: true };
  let rerender = () => {};
  function Harness() {
    const [, setTick] = useState(0);
    rerender = () => setTick((n) => n + 1);
    return (
      <div style={{ position: "fixed", inset: 0 }}>
        {coreInspectorTerminal(node, view)}
      </div>
    );
  }
  const root = document.createElement("div");
  document.body.append(root);
  const app = createRoot(root);
  const from = calls.length;
  const of = (method: string) =>
    calls
      .slice(from)
      .filter(
        (c) =>
          c.method === method &&
          (method !== "world.core.watch" || c.params.address === "t7"),
      );
  const set = async (next: typeof view) => {
    view = next;
    flushSync(rerender);
    await frames(2);
  };
  flushSync(() => app.render(<Harness />));
  await until(() => of("world.core.watch").length === 1);
  const first = String(of("world.core.watch")[0]?.params.stream);
  await set({ selected: false, shown: true });
  check(
    of("world.core.unwatch").length === 0 &&
      Boolean(root.querySelector(".core-watch")),
    "a look at Chat keeps the watch and World's seat",
  );
  await set({ selected: false, shown: false });
  check(
    of("world.core.unwatch").some((c) => c.params.stream === first),
    `minimizing ends the watch: ${JSON.stringify(of("world.core.unwatch"))}`,
  );
  check(!root.querySelector(".core-watch"), "a minimized window holds no view");
  await set({ selected: true, shown: false });
  await set({ selected: false, shown: true });
  check(
    of("world.core.watch").length === 1,
    "restored on Chat, nothing is watched until the Terminal tab is shown",
  );
  await set({ selected: true, shown: true });
  await until(() => of("world.core.watch").length === 2);
  check(
    of("world.core.watch").length === 2,
    "the Terminal tab watches again once shown",
  );
  flushSync(() => app.unmount());
  root.remove();
}

/**
 * Typing into the view. A key typed while focus is on the page or the
 * Inspector's frame focuses the terminal and is sent once; xterm's own
 * answers go as automatic replies (World's server sends them only on a seat
 * a person typed into); Escape is a key; focus leaving gives nothing back.
 * Then the phone composer sends text and an uploaded image's path.
 */
async function typing() {
  // The program asks where the cursor is and turns on focus reports.
  deliver({ stream: "", bytes: btoa("\x1b[6n\x1b[?1004h") });
  await until(() => inputs().length > 0);
  check(
    inputs().every((c) => c.params.automatic === true),
    `xterm's answer goes only as a reply: ${JSON.stringify(inputs())}`,
  );
  const before = inputs().length;
  // Focus on the Inspector's title: the first key still reaches the terminal.
  document.querySelector<HTMLElement>(".fixture-title")!.focus();
  await press("a");
  await until(() => typedText(before).length > 0);
  check(
    typedText(before) === "a",
    `the first key goes once, as typed: ${JSON.stringify(inputs().slice(before))}`,
  );
  check(
    document.activeElement === xtermInput(),
    "the first key focuses the terminal",
  );
  check(
    Boolean(document.querySelector(".core-watch-host .xterm.focus")),
    "the terminal's cursor is active",
  );
  // A click on the view focuses the terminal too.
  xtermInput().blur();
  document
    .querySelector<HTMLElement>(".core-watch-view")!
    .dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
  await frames(2);
  check(
    document.activeElement === xtermInput(),
    "a click on the view focuses the terminal",
  );
  // Escape is the program's key here.
  const beforeEscape = inputs().length;
  await press("Escape");
  await until(() => inputs().length > beforeEscape);
  check(typedText(before) === "a\x1b", `Escape is typed: ${typedText(before)}`);
  // Focus leaves and the page idles: World keeps its size (no give-back).
  await pause(300);
  const holding = holds().length;
  xtermInput().blur();
  await pause(1500);
  check(
    holds().length === holding &&
      calls.every((c) => c.method !== "world.core.leave"),
    `blur and idle give nothing back: ${JSON.stringify(calls.slice(-3))}`,
  );
  check(Boolean(section().dataset.held), "World still holds its size");
  // The phone's composer: text, then an image uploaded to the host.
  document.documentElement.dataset.layout = "mobile";
  await frames(2);
  const composer = document.querySelector<HTMLTextAreaElement>(
    ".core-watch-composer textarea",
  );
  check(Boolean(composer), "the phone has the Terminal's composer");
  if (!composer) return;
  const send = () =>
    document
      .querySelector<HTMLButtonElement>(
        ".core-watch-composer .terminal-composer-submit.is-primary",
      )
      ?.click();
  composer.focus();
  await press("Escape");
  await frames(1);
  check(
    !typedText(before).endsWith("\x1b\x1b"),
    "a key in the composer is the composer's",
  );
  const sentBefore = inputs().length;
  await insert("ship it");
  await frames(2);
  send();
  await until(() => typedText(sentBefore).endsWith("\r"));
  check(
    typedText(sentBefore) === "ship it\r",
    `the composer types its text and Enter: ${JSON.stringify(typedText(sentBefore))}`,
  );
  const image = new DataTransfer();
  image.items.add(
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "shot.png", {
      type: "image/png",
    }),
  );
  composer.dispatchEvent(
    new ClipboardEvent("paste", {
      clipboardData: image,
      bubbles: true,
      cancelable: true,
    }),
  );
  const uploaded = await until(() =>
    composer.value.includes("herdr-world-uploads-"),
  );
  check(uploaded, `the image's host path is in the draft: ${composer.value}`);
  const uploads: Array<{ path: string; generation: string | null }> = await (
    await fetch("/uploads")
  ).json();
  check(
    uploads.length === 1 &&
      uploads[0]!.path === "/api/connections/core-fixture/upload-image" &&
      uploads[0]!.generation === "1",
    `the image goes to the core connection's host: ${JSON.stringify(uploads)}`,
  );
  const imageFrom = inputs().length;
  send();
  await until(() => typedText(imageFrom).endsWith("\r"), 3000);
  // As on a Herdr terminal: the path alone (so an agent attaches the
  // image), a pause, then the rest and Enter.
  const firstImageBatch = atob(String(inputs()[imageFrom]?.params.data ?? ""));
  check(
    firstImageBatch === "/tmp/herdr-world-uploads-example/shot.png" &&
      /^ *\r$/.test(typedText(imageFrom).slice(firstImageBatch.length)),
    `the path is typed alone, then Enter: ${JSON.stringify(typedText(imageFrom))}`,
  );
  delete document.documentElement.dataset.layout;
  await frames(2);
}

/**
 * A phone keyboard that shrinks only the visual viewport (the layout stays
 * 844 tall): App measures it into --keyboard-inset-content, and the view's
 * composer and Send must end above the keyboard's top.
 */
async function keyboardLift() {
  const root = document.documentElement;
  const textarea = () =>
    document
      .querySelector(".core-watch-composer textarea")!
      .getBoundingClientRect();
  const send = () =>
    document
      .querySelector(
        ".core-watch-composer .terminal-composer-submit.is-primary",
      )!
      .getBoundingClientRect();
  root.dataset.layout = "mobile";
  await viewport(390, 844);
  const visibleBottom = 480;
  check(
    innerHeight === 844 && textarea().bottom > visibleBottom,
    `the composer starts at the layout's bottom: ${innerHeight}, ${textarea().bottom}`,
  );
  root.classList.add("keyboard-open");
  root.style.setProperty("--keyboard-inset-bottom", `${844 - visibleBottom}px`);
  root.style.setProperty(
    "--keyboard-inset-content",
    `${844 - visibleBottom}px`,
  );
  root.style.setProperty("--keyboard-inset-composer-gap", "0px");
  await frames(2);
  check(
    textarea().bottom <= visibleBottom &&
      send().bottom <= visibleBottom &&
      send().top >= 0,
    `the composer and Send sit above the keyboard: textarea ${textarea().top}-${textarea().bottom}, Send ${send().top}-${send().bottom}`,
  );
  root.classList.remove("keyboard-open");
  for (const name of ["bottom", "content", "composer-gap"])
    root.style.removeProperty(`--keyboard-inset-${name}`);
  delete root.dataset.layout;
  await frames(2);
}

/**
 * Two Inspectors with core terminals: a key typed on the bare page goes to
 * the one shown or clicked last, never to both.
 */
async function twoInspectors() {
  const root = document.createElement("div");
  document.body.append(root);
  const streams: Record<string, string> = {};
  const box = (address: string, left: string) => (
    <div
      className="workspace-inspector"
      data-fixture={address}
      style={{ position: "fixed", top: 0, bottom: 0, left, width: "50%" }}
    >
      <CoreTerminalWatch
        target={{ connectionId: "core-fixture", generation: 1, address }}
        title={address}
      />
    </div>
  );
  const watchesBefore = calls.length;
  const app = createRoot(root);
  flushSync(() =>
    app.render(
      <>
        {box("t3", "0")}
        {box("t4", "50%")}
      </>,
    ),
  );
  await until(
    () =>
      calls.slice(watchesBefore).filter((c) => c.method === "world.core.watch")
        .length === 2,
  );
  for (const c of calls.slice(watchesBefore))
    if (c.method === "world.core.watch")
      streams[String(c.params.address)] = String(c.params.stream);
  await frames(3);
  const typedOn = (address: string, from: number) =>
    inputs()
      .slice(from)
      .filter(
        (c) => c.params.stream === streams[address] && !c.params.automatic,
      )
      .map((c) => atob(String(c.params.data)))
      .join("");
  (document.activeElement as HTMLElement | null)?.blur();
  let from = inputs().length;
  await press("b");
  await until(() => inputs().length > from);
  await frames(2);
  check(
    typedOn("t4", from) === "b" && typedOn("t3", from) === "",
    `a page key goes to the last shown terminal only: t3 ${JSON.stringify(typedOn("t3", from))}, t4 ${JSON.stringify(typedOn("t4", from))}`,
  );
  // A click on the first makes it the one.
  document
    .querySelector<HTMLElement>("[data-fixture=t3] .core-watch-view")!
    .dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
  await frames(2);
  (document.activeElement as HTMLElement | null)?.blur();
  from = inputs().length;
  await press("a");
  await until(() => inputs().length > from);
  await frames(2);
  check(
    typedOn("t3", from) === "a" && typedOn("t4", from) === "",
    `after a click, page keys go to that terminal: t3 ${JSON.stringify(typedOn("t3", from))}, t4 ${JSON.stringify(typedOn("t4", from))}`,
  );
  flushSync(() => app.unmount());
  root.remove();
}

/**
 * The Inspector's Terminal tab while its core connection goes away and
 * comes back: closing keeps the live terminal's draft; a stale node says
 * so; a new generation is watched afresh and retires the old draft.
 */
async function reconnects() {
  const target = (generation: number): CoreWatchTarget => ({
    connectionId: "core-fixture",
    generation,
    address: "t2",
  });
  const leaf = (watch?: CoreWatchTarget) =>
    ({
      kind: "agent",
      id: "n1",
      label: "builder",
      coreControl: true,
      stale: watch === undefined,
      ...(watch ? { watch } : {}),
    }) as unknown as WorldObjectNode;
  let node = leaf(target(1));
  let open = true;
  let rerender = () => {};
  function Harness() {
    const [, setTick] = useState(0);
    rerender = () => setTick((n) => n + 1);
    useCoreTerminalDrafts([{ nodeById: new Map([["n1", node]]) as never }]);
    return (
      <div style={{ position: "fixed", inset: 0 }}>
        {open
          ? coreInspectorTerminal(node, { selected: true, shown: true })
          : null}
      </div>
    );
  }
  activateTerminalComposerDraftScope("spaces-host", 3);
  const draft = (generation: number) =>
    terminalComposerDraftKey("core-fixture", generation, "t2");
  const root = document.createElement("div");
  document.body.append(root);
  const watches = () => calls.filter((c) => c.method === "world.core.watch");
  const latest = () => watches()[watches().length - 1]?.params.generation;
  const before = watches().length;
  flushSync(() => createRoot(root).render(<Harness />));
  await frames(2);
  check(
    watches().length === before + 1 && latest() === 1,
    "the tab watches the current generation",
  );
  document.documentElement.dataset.layout = "mobile";
  await frames(2);
  const composer = () =>
    document.querySelector<HTMLTextAreaElement>(
      ".core-watch-composer textarea",
    );
  writeTerminalComposerDraft(draft(1), "unsent message");
  await frames(2);
  check(
    composer()?.value === "unsent message",
    `the composer shows the draft: ${composer()?.value}`,
  );
  open = false;
  flushSync(rerender);
  await frames(2);
  check(!document.querySelector(".core-watch"), "closing removes the view");
  check(
    readTerminalComposerDraft(draft(1)) === "unsent message",
    "closing the Inspector keeps the live terminal's draft",
  );
  open = true;
  flushSync(rerender);
  await frames(2);
  check(
    composer()?.value === "unsent message",
    `reopening shows the draft again: ${composer()?.value}`,
  );
  // kill -9: the connection goes stale; the tab says so instead of a
  // Herdr terminal.
  node = leaf();
  flushSync(rerender);
  await frames(2);
  check(
    document.body.textContent?.includes(
      "This herdr-core terminal is not live now.",
    ) === true,
    "a stale core terminal says so",
  );
  // Core is back: a new generation is watched without a tap.
  node = leaf(target(2));
  flushSync(rerender);
  await frames(2);
  check(
    watches().length === before + 3 && latest() === 2,
    `the new generation is watched: ${JSON.stringify(watches().slice(before))}`,
  );
  check(
    readTerminalComposerDraft(draft(1)) === "",
    "a new generation (a change of owner) retires the old draft",
  );
  delete document.documentElement.dataset.layout;
}

void run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
