import { expect, test } from "bun:test";
import type { ConnectionClient } from "./api";
import {
  TERMINAL_DEFAULT_SIZE,
  TerminalAttachSize,
} from "./terminalAttachSize";
import {
  TERMINAL_SIZE_FLOOR,
  terminalSqueezed,
} from "../../shared/terminalSize";
import { terminalEndpointViewportSize } from "./terminalResize";
import type { PaneLayout } from "./types";

const layout = (width: number, height: number): PaneLayout => ({
  workspace_id: "workspace",
  tab_id: "tab",
  zoomed: false,
  splits: [],
  area: { x: 0, y: 0, width, height },
  focused_pane_id: "pane",
  panes: [
    { pane_id: "pane", focused: true, rect: { x: 0, y: 0, width, height } },
  ],
});
const xterm = { cols: 13, rows: 1 };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A client whose pane.layout answers come from `answers`, in order. */
let connections = 0;
function client(answers: Array<Promise<unknown>>, generation = 1) {
  let current = true;
  // Each test's browser memory of good sizes is its own.
  connections += 1;
  const reads: unknown[] = [];
  const value: ConnectionClient = {
    connectionId:
      generation === 1
        ? `connection-${connections}`
        : `connection-${connections - 1}`,
    generation: 1,
    serverRuntimeGeneration: generation,
    isCurrent: () => current,
    acceptsServerGeneration: () => true,
    call: async (method, params) => {
      if (method !== "pane.layout") return {};
      reads.push(params);
      return answers.shift() ?? Promise.reject(new Error("no answer"));
    },
  };
  return { value, reads, retire: () => (current = false) };
}

/** A hidden view with no store layout, on `first`'s client. */
function hiddenView(first: ConnectionClient) {
  const refs = {
    paneIdRef: { current: "pane" as string | undefined },
    paneTabIdRef: { current: "tab" as string | undefined },
    paneLayoutRef: { current: null as PaneLayout | null },
    isActivePaneRef: { current: true },
    currentClientRef: { current: first },
    desiredTerminalRef: { current: "terminal" as string | null },
  };
  let retries = 0;
  const size = new TerminalAttachSize({ ...refs, retry: () => (retries += 1) });
  const resolve = () => size.resolve("terminal", null, xterm);
  return { refs, size, resolve, retries: () => retries };
}

test("a hidden terminal attaches at the pane's size from one read", async () => {
  const one = client([Promise.resolve({ layout: layout(120, 40) })]);
  const view = hiddenView(one.value);
  expect(view.resolve()).toBeNull();
  await settle();
  expect(view.retries()).toBe(1);
  expect(view.resolve()).toMatchObject({ cols: 119, rows: 40 });
  expect(one.reads).toHaveLength(1);
});

test("a failed read falls back to the xterm size, or the default for a squeeze", async () => {
  const one = client([Promise.reject(new Error("pane.layout failed"))]);
  const view = hiddenView(one.value);
  view.resolve();
  await settle();
  // The unfitted xterm (13×1) is itself a squeeze.
  expect(view.resolve()).toMatchObject(TERMINAL_DEFAULT_SIZE);
});

test("after a reconnect the new client reads; the old failure is no fallback", async () => {
  const old = client([Promise.reject(new Error("connection changed"))]);
  const view = hiddenView(old.value);
  view.resolve();
  old.retire();
  await settle();
  expect(view.retries()).toBe(0);
  const replacement = client([Promise.resolve({ layout: layout(160, 45) })]);
  view.refs.currentClientRef.current = replacement.value;
  expect(view.resolve()).toBeNull();
  await settle();
  expect(view.resolve()).toMatchObject({ cols: 159, rows: 45 });
  expect(replacement.reads).toHaveLength(1);
});

test("a new client does not wait on the old client's pending read", async () => {
  const held = Promise.withResolvers<unknown>();
  const old = client([held.promise]);
  const view = hiddenView(old.value);
  view.resolve();
  const replacement = client([Promise.resolve({ layout: layout(160, 45) })]);
  view.refs.currentClientRef.current = replacement.value;
  expect(view.resolve()).toBeNull();
  expect(replacement.reads).toHaveLength(1);
  held.resolve({ layout: layout(80, 24) });
  await settle();
  // Only the replacement's read retries, and only its layout is used.
  expect(view.retries()).toBe(1);
  expect(view.resolve()).toMatchObject({ cols: 159, rows: 45 });
});

test("a read that settles while another terminal is wanted is not reused", async () => {
  const one = client([
    Promise.resolve({ layout: layout(80, 24) }),
    Promise.resolve({ layout: layout(120, 40) }),
  ]);
  const view = hiddenView(one.value);
  view.resolve();
  view.refs.desiredTerminalRef.current = "other";
  await settle();
  expect(view.retries()).toBe(0);
  view.refs.desiredTerminalRef.current = "terminal";
  expect(view.resolve()).toBeNull();
  await settle();
  expect(view.resolve()).toMatchObject({ cols: 119, rows: 40 });
  expect(one.reads).toHaveLength(2);
});

test("a shown terminal uses its fitted size and reads nothing", () => {
  const one = client([]);
  const view = hiddenView(one.value);
  expect(
    view.size.resolve("terminal", { cols: 90, rows: 30 }, xterm),
  ).toMatchObject({ cols: 90, rows: 30 });
  expect(one.reads).toHaveLength(0);
});

test("a squeeze is below 30×5 in either dimension", () => {
  // Observed squeezes: 12–24 columns by 1–3 rows; a shown 30×8 is legitimate.
  expect(terminalSqueezed({ cols: 13, rows: 1 })).toBe(true);
  expect(terminalSqueezed({ cols: 24, rows: 3 })).toBe(true);
  expect(terminalSqueezed({ cols: 200, rows: 4 })).toBe(true);
  expect(terminalSqueezed({ cols: 30, rows: 5 })).toBe(false);
  expect(terminalSqueezed({ cols: 30, rows: 8 })).toBe(false);
});

test("a hidden terminal never adopts a squeezed layout: it uses the default", () => {
  const one = client([]);
  const view = hiddenView(one.value);
  view.refs.paneLayoutRef.current = layout(13, 1);
  expect(view.resolve()).toMatchObject(TERMINAL_DEFAULT_SIZE);
  expect(one.reads).toHaveLength(0);
});

test("a squeezed pane gets this browser's last good size for the terminal", () => {
  const one = client([]);
  const view = hiddenView(one.value);
  view.refs.paneLayoutRef.current = layout(120, 40);
  expect(view.resolve()).toMatchObject({ cols: 119, rows: 40 });
  // Shown later at 96×27, then another client squeezes the pane.
  view.size.fitted({ cols: 96, rows: 27 });
  view.refs.paneLayoutRef.current = layout(13, 1);
  expect(view.resolve()).toMatchObject({ cols: 96, rows: 27 });
});

test("a squeezed read also falls back to the good size", async () => {
  const one = client([Promise.resolve({ layout: layout(13, 1) })]);
  const view = hiddenView(one.value);
  view.resolve();
  await settle();
  expect(view.resolve()).toMatchObject(TERMINAL_DEFAULT_SIZE);
});

test("a shown terminal keeps its fit, however small", () => {
  const one = client([]);
  const view = hiddenView(one.value);
  expect(
    view.size.resolve("terminal", { cols: 30, rows: 8 }, xterm),
  ).toMatchObject({ cols: 30, rows: 8 });
});

test("only a terminal shown after being hidden claims its size", () => {
  const one = client([]);
  const view = hiddenView(one.value);
  view.refs.paneLayoutRef.current = layout(120, 40);
  view.resolve(); // attached hidden
  expect(view.size.fitted({ cols: 96, rows: 27 })).toBe(true);
  expect(view.size.fitted({ cols: 90, rows: 25 })).toBe(false);
  view.size.hide();
  expect(view.size.fitted({ cols: 96, rows: 27 })).toBe(true);
  // Attached while shown: no claim needed.
  view.size.resolve("terminal", { cols: 96, rows: 27 }, xterm);
  expect(view.size.fitted({ cols: 96, rows: 27 })).toBe(false);
});

test("a replacement runtime never reuses the retired runtime's good size", () => {
  // Found by rev-sol on #650: same connection and terminal IDs, new runtime.
  const before = client([], 1);
  const retired = hiddenView(before.value);
  retired.size.resolve("terminal", null, xterm);
  retired.size.fitted({ cols: 240, rows: 80 });
  const after = client([], 2);
  expect(after.value.connectionId).toBe(before.value.connectionId);
  const replacement = hiddenView(after.value);
  replacement.refs.paneLayoutRef.current = layout(13, 1);
  expect(replacement.resolve()).toMatchObject(TERMINAL_DEFAULT_SIZE);
});

/** A tab of `count` panes side by side (or stacked), sized like Herdr's. */
const split = (
  width: number,
  height: number,
  count: number,
  stacked = false,
): PaneLayout => ({
  ...layout(width, height),
  panes: Array.from({ length: count }, (_, index) => ({
    pane_id: index === 0 ? "pane" : `pane-${index}`,
    focused: index === 0,
    rect: stacked
      ? { x: 0, y: index * (height / count), width, height: height / count }
      : { x: index * (width / count), y: 0, width: width / count, height },
  })),
});

test("a split pane is not a squeeze: the floor is the tab's", () => {
  // Found by rev-opus on #650: a pane-level floor turned a 3-pane 120×40
  // tab into a 309×32 surface.
  for (const [tab, cells] of [
    [split(120, 40, 3), { cols: 37, rows: 38 }],
    [split(80, 40, 2), { cols: 37, rows: 38 }],
    [split(120, 30, 3, true), { cols: 117, rows: 8 }],
    [layout(38, 20), { cols: 37, rows: 20 }],
  ] as const) {
    const one = client([]);
    const view = hiddenView(one.value);
    view.refs.paneLayoutRef.current = tab;
    const size = view.resolve()!;
    expect(size).toMatchObject(cells);
    expect(terminalEndpointViewportSize(size, tab, "pane")).toEqual({
      cols: tab.area.width,
      rows: tab.area.height,
    });
  }
});

test("only the selected pane claims its size", () => {
  const one = client([]);
  const view = hiddenView(one.value);
  view.refs.isActivePaneRef.current = false;
  view.refs.paneLayoutRef.current = layout(120, 40);
  view.resolve();
  expect(view.size.fitted({ cols: 96, rows: 27 })).toBe(false);
});

test("a tiny shown fit is never the hidden fallback for a squeezed tab", () => {
  // Found by rev-sol on #650 (adapted from its probe): a fit one below the
  // floor was reused, leaving the tab squeezed.
  const tiny = {
    cols: TERMINAL_SIZE_FLOOR.cols - 1,
    rows: TERMINAL_SIZE_FLOOR.rows - 1,
  };
  const one = client([]);
  const view = hiddenView(one.value);
  view.refs.paneLayoutRef.current = layout(tiny.cols, tiny.rows);
  view.size.resolve("terminal", tiny, xterm);
  view.size.fitted(tiny);
  view.size.hide();
  const size = view.resolve()!;
  expect(size).toMatchObject(TERMINAL_DEFAULT_SIZE);
  expect(
    terminalSqueezed(terminalEndpointViewportSize(size, size.layout, "pane")!),
  ).toBe(false);
});

test("a tiny shown fit is never the fallback for a failed read", async () => {
  const one = client([Promise.reject(new Error("pane.layout failed"))]);
  const view = hiddenView(one.value);
  view.size.fitted({
    cols: TERMINAL_SIZE_FLOOR.cols - 1,
    rows: TERMINAL_SIZE_FLOOR.rows - 1,
  });
  view.size.hide();
  view.resolve();
  await settle();
  expect(view.resolve()).toMatchObject(TERMINAL_DEFAULT_SIZE);
});

test("a read that settles after the view is gone neither retries nor stays", async () => {
  // TerminalView's teardown clears desiredTerminalRef; the settle checks it.
  const held = Promise.withResolvers<unknown>();
  const one = client([held.promise]);
  const view = hiddenView(one.value);
  view.resolve();
  view.refs.desiredTerminalRef.current = null; // unmounted
  held.resolve({ layout: layout(120, 40) });
  await settle();
  expect(view.retries()).toBe(0);
  view.refs.desiredTerminalRef.current = "terminal";
  expect(view.resolve()).toBeNull(); // a fresh read, not the settled one
  expect(one.reads).toHaveLength(2);
});
