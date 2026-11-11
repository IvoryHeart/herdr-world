import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { bridge } from "../api";
import type { CoreTerminalPush } from "../coreWatch";
import { useState } from "react";
import {
  CoreTerminalWatch,
  type CoreWatchTarget,
  useCoreTerminalWatch,
} from "./CoreTerminalWatch";
import "../styles/tokens.css";
import "../styles/base.css";

// The production watch view fed, push by push, with what World's server
// relays from a recorded real-core watch: a desktop pane at 120x40, then
// 90x25, then closed (headless 200x120). The page records every call it
// makes; the test rotates the phone and opens its keyboard between pushes,
// then types real keys (CDP) into the view and its phone composer.

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const frames = async (n: number) => {
  for (let i = 0; i < n; i++) await frame();
};
window.addEventListener("error", (event) => failures.push(String(event.error)));
const capture = new URL(location.href).searchParams.get("capture");
const until = async (condition: () => boolean, ms = 2000) => {
  const end = performance.now() + ms;
  while (!condition() && performance.now() < end) await frame();
  return condition();
};

const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
let stream: string | null = null;
Object.assign(bridge, {
  call: async (method: string, params: Record<string, unknown> = {}) => {
    calls.push({ method, params });
    if (method === "world.core.watch") {
      stream = String(params.stream);
      return { stream, grid: { cols: 120, rows: 40 }, moved_from: null };
    }
    if (method === "world.core.input") return { sent: true };
    if (method === "world.core.leave") return { left: true };
    return { closed: true };
  },
  onStatus: () => () => {},
});
// Pushes go through the bridge's own parser, as a socket message would.
(
  bridge as unknown as { helloAcceptedForSocket: boolean }
).helloAcceptedForSocket = true;
const deliver = (push: CoreTerminalPush) =>
  (bridge as unknown as { onMessage(raw: string): void }).onMessage(
    JSON.stringify({ core_terminal: { ...push, stream } }),
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
};
/** A real key press (CDP), into whatever has focus. */
const press = (key: string) => fetch(`/key?key=${encodeURIComponent(key)}`);
/** Real text input (CDP), as a phone keyboard inserts it. */
const insert = (text: string) =>
  fetch(`/insert?text=${encodeURIComponent(text)}`);
const inputs = () => calls.filter((c) => c.method === "world.core.input");
const typedText = (from = 0) =>
  inputs()
    .slice(from)
    .filter((c) => !c.params.automatic)
    .map((c) => atob(String(c.params.data)))
    .join("");
const badge = () =>
  document.querySelector<HTMLElement>("[data-core-watch-badge]")?.dataset
    .coreWatchBadge;
const gridLine = () =>
  document.querySelector("[data-core-watch-grid]")?.textContent ?? "";
const xtermInput = () =>
  document.querySelector<HTMLTextAreaElement>(".core-watch-host textarea")!;

/** The first key takes World's fitted size; core answers with that grid. */
async function typeFirstKey() {
  xtermInput().focus();
  await frames(1);
  const before = inputs().length;
  await press("a");
  await until(() => inputs().length > before);
  const first = inputs()[before]?.params ?? {};
  deliver({
    stream: "",
    grid: { cols: Number(first.cols), rows: Number(first.rows) },
  });
  await frames(3);
  return first;
}

async function run() {
  const meta = document.createElement("meta");
  meta.name = "viewport";
  meta.content = "width=device-width, initial-scale=1";
  document.head.append(meta);
  const pushes: CoreTerminalPush[] = await (await fetch("/pushes")).json();
  const root = document.createElement("div");
  document.body.append(root);
  let closed = false;
  flushSync(() =>
    createRoot(root).render(
      <CoreTerminalWatch
        target={{ connectionId: "core-fixture", generation: 1, address: "t1" }}
        title="reviewer"
        onClose={() => {
          closed = true;
        }}
      />,
    ),
  );
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
  const grids = pushes.flatMap((p, i) => ("grid" in p ? [i] : []));
  check(grids.length === 3, `three grids recorded: ${grids.length}`);
  // Desktop pane at 120x40, then its resize to 90x25 with its repaint.
  const desktopEnd = grids[2]!;
  // Every grid xterm takes, in order.
  const adopted: string[] = [];
  new MutationObserver((records) => {
    // Records arrive batched: each one's successor holds its new value.
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
    document
      .querySelector("[data-core-watch-grid]")
      ?.textContent?.startsWith("90×25: the size of the Herdr app") === true,
    "the grid line says who set the size",
  );
  if (capture === "typing") await typeFirstKey();
  if (capture) return;
  // Rotate the phone, open its keyboard, close it, rotate back: the view
  // rescales, core's grid never changes and nothing is sent.
  const sent = calls.length;
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
    const view = document.querySelector<HTMLElement>(".core-watch-view")!;
    const drawn = document.querySelector<HTMLElement>(".core-watch-frame")!;
    check(
      drawn.offsetWidth <= view.clientWidth ||
        Number(host()?.dataset.scale) <= 0.45,
      `${width}x${height}: the drawing fits or scrolls at the minimum scale`,
    );
  }
  check(
    new Set(scales).size > 1,
    `only the drawing scales: ${scales.join(", ")}`,
  );
  check(
    calls.length === sent,
    `rotation and keyboard send nothing: ${JSON.stringify(calls.slice(sent))}`,
  );
  // The pane closes: core's headless grid, said plainly.
  for (const push of pushes.slice(desktopEnd)) deliver(push);
  await frames(3);
  check(termGrid() === "200x120", `headless is adopted: ${termGrid()}`);
  check(
    document
      .querySelector("[data-core-watch-grid]")
      ?.textContent?.includes("headless size") === true,
    "the headless grid is named honestly",
  );
  check(screenText().includes("headless now"), "output continues headless");
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
  await typing(() => closed);
  // core is killed: the stream ends and says so.
  deliver({ stream: "", closed: "core closed the connection" });
  await frames(2);
  check(
    document
      .querySelector(".core-watch-ended")
      ?.textContent?.includes("Lost the herdr-core connection") === true,
    "a lost core says so",
  );
  // Back closes the view and ends the watch.
  document.querySelector<HTMLButtonElement>(".core-watch-back")!.click();
  check(closed, "Back closes the watch");
  await reconnects();
}

/**
 * Typing into the view. xterm's own answers to the program never open the
 * keyboard; the first real key does, at the size that fits the view; while
 * World holds it, xterm's answers go as replies; focus reports never go;
 * Escape is a key; leaving gives the size back. Then the phone composer
 * sends text and an uploaded image's path through the same keyboard.
 */
async function typing(closed: () => boolean) {
  check(badge() === "watching", `the view starts watching: ${badge()}`);
  // The program asks where the cursor is and turns on focus reports.
  deliver({ stream: "", bytes: btoa("\x1b[6n\x1b[?1004h") });
  await frames(3);
  check(
    inputs().length === 0,
    `xterm's answer alone sends nothing: ${JSON.stringify(inputs())}`,
  );
  const first = await typeFirstKey();
  const view = document.querySelector<HTMLElement>(".core-watch-view")!;
  const drawing = document.querySelector<HTMLElement>(
    ".core-watch-host .xterm-screen",
  )!;
  const cell = drawing.offsetWidth / Number(first.cols);
  const room = view.clientWidth - 16;
  check(
    first.stream === stream &&
      atob(String(first.data)) === "a" &&
      first.automatic === undefined,
    `the first key goes once, as a key, with no focus report before it: ${JSON.stringify(inputs())}`,
  );
  check(
    Number(first.cols) * cell <= room + 0.5 &&
      (Number(first.cols) + 1) * cell > room,
    `the first key asks for the grid that fits the view: ${first.cols}x${first.rows} in ${room}px`,
  );
  check(badge() === "typing", `the badge says World is typing: ${badge()}`);
  check(
    gridLine().includes("World's size while you type"),
    `the grid line says World holds the size: ${gridLine()}`,
  );
  // While World holds the keyboard, xterm's answer goes as a reply.
  deliver({ stream: "", bytes: btoa("\x1b[6n") });
  await until(() => inputs().length === 2);
  const reply = inputs()[1]?.params ?? {};
  check(
    reply.automatic === true &&
      /^\x1b\[\d+;\d+R$/.test(atob(String(reply.data ?? ""))),
    `xterm's cursor report goes as a reply: ${JSON.stringify(reply)}`,
  );
  // Escape is the program's key here, not Back.
  await press("Escape");
  await until(() => inputs().length === 3);
  check(typedText() === "a\x1b", `Escape is typed: ${typedText()}`);
  check(!closed(), "Escape in the terminal does not close the view");
  // Focus leaves the view: a few seconds later the size goes back.
  xtermInput().blur();
  const left = await until(
    () => calls.some((c) => c.method === "world.core.leave"),
    6000,
  );
  check(left, "leaving the view gives the size back");
  check(
    inputs().length === 3,
    `focus reports never go: ${JSON.stringify(inputs().slice(3))}`,
  );
  check(badge() === "watching", `the badge says watching again: ${badge()}`);
  // The phone's composer: text, then an image uploaded to the host.
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
  const sentBefore = inputs().length;
  composer.focus();
  await press("Escape");
  await frames(1);
  check(!closed(), "Escape in the composer does not close the view");
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
}

/**
 * World's open watch while its connection goes away and comes back: the
 * view stays and says why, then watches the new generation by itself.
 */
async function reconnects() {
  const target = (generation: number): CoreWatchTarget => ({
    connectionId: "core-fixture",
    generation,
    address: "t2",
  });
  let nodes = new Map([["n1", { label: "builder", watch: target(1) }]]);
  let rerender = () => {};
  let api: ReturnType<typeof useCoreTerminalWatch> | null = null;
  function Harness() {
    const [, setTick] = useState(0);
    rerender = () => setTick((n) => n + 1);
    api = useCoreTerminalWatch((id) => nodes.get(id));
    return <div data-harness>{api.view}</div>;
  }
  const root = document.createElement("div");
  document.body.append(root);
  flushSync(() => createRoot(root).render(<Harness />));
  const watches = () => calls.filter((c) => c.method === "world.core.watch");
  const latest = () => watches()[watches().length - 1]?.params.generation;
  const before = watches().length;
  check(api!.watch("missing") === false, "only a live core terminal opens");
  flushSync(() => void api!.watch("n1"));
  await frames(2);
  check(
    watches().length === before + 1 && latest() === 1,
    "the watch opens on the current generation",
  );
  // kill -9: the connection goes stale (no target) and the stream ends.
  nodes = new Map([["n1", { label: "builder" } as never]]);
  flushSync(rerender);
  deliver({ stream: "", closed: "core closed the connection" });
  await frames(2);
  const view = () => root.querySelector(".core-watch");
  check(
    view()
      ?.querySelector(".core-watch-ended")
      ?.textContent?.includes("Lost the herdr-core connection") === true,
    `the view stays and says why: ${view()?.textContent?.slice(0, 120)}`,
  );
  check(watches().length === before + 1, "a lost connection is not retried");
  // Core is back: a new generation is watched without a tap.
  nodes = new Map([["n1", { label: "builder", watch: target(2) }]]);
  flushSync(rerender);
  await frames(2);
  check(
    watches().length === before + 2 && latest() === 2,
    `the new generation is watched: ${JSON.stringify(watches().slice(before))}`,
  );
  check(!view()?.querySelector(".core-watch-ended"), "the ended notice clears");
}

void run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
