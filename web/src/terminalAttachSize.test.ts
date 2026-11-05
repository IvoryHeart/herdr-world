import { expect, test } from "bun:test";
import type { ConnectionClient } from "./api";
import {
  TERMINAL_DEFAULT_SIZE,
  TerminalAttachSize,
} from "./terminalAttachSize";
import { terminalSqueezed } from "../../shared/terminalSize";
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
function client(answers: Array<Promise<unknown>>) {
  let current = true;
  // Each test's browser memory of good sizes is its own.
  connections += 1;
  const reads: unknown[] = [];
  const value: ConnectionClient = {
    connectionId: `connection-${connections}`,
    generation: 1,
    serverRuntimeGeneration: 1,
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

test("a squeeze is below 40×10 in either dimension", () => {
  expect(terminalSqueezed({ cols: 12, rows: 1 })).toBe(true);
  expect(terminalSqueezed({ cols: 200, rows: 9 })).toBe(true);
  expect(terminalSqueezed({ cols: 39, rows: 50 })).toBe(true);
  expect(terminalSqueezed({ cols: 40, rows: 10 })).toBe(false);
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
