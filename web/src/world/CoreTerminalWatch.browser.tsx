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
// makes; the test rotates the phone and opens its keyboard between pushes.

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const frames = async (n: number) => {
  for (let i = 0; i < n; i++) await frame();
};
window.addEventListener("error", (event) => failures.push(String(event.error)));
const capture = new URL(location.href).searchParams.has("capture");

const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
let stream: string | null = null;
Object.assign(bridge, {
  call: async (method: string, params: Record<string, unknown> = {}) => {
    calls.push({ method, params });
    if (method === "world.core.watch") {
      stream = String(params.stream);
      return { stream, grid: { cols: 120, rows: 40 }, moved_from: null };
    }
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
  // Typing into the view goes nowhere: it is not an input.
  const textarea = document.querySelector<HTMLTextAreaElement>(
    ".core-watch-host textarea",
  );
  textarea?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "a", bubbles: true }),
  );
  textarea?.dispatchEvent(
    new InputEvent("input", { data: "a", bubbles: true }),
  );
  await frames(2);
  check(calls.length === sent, "keys in the view send nothing");
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
