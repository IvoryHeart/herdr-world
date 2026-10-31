import { expect, test } from "bun:test";
import type { BoardDocument } from "./board/boardDocument";
import type { WorldRuntimeConnection } from "./runtimeStore";
import { countedWorldWork } from "./testing/countedWorldWork";
import { workViolations, type WorkByPhase } from "./testing/workCeilings";
import type { TerminalColors } from "./terminalColor";
import {
  mayInherit,
  terminalColorsSnapshot,
  type TerminalColorsSnapshot,
} from "./useTerminalColors";

const connection = (
  panes: { pane_id: string; terminal_id: string; tokens?: unknown }[],
) =>
  ({
    connectionId: "studio",
    snapshot: { panes },
  }) as unknown as WorldRuntimeConnection;
const claim = {
  child: { connection_id: "studio", terminal_id: "term_child" },
  parent: { connection_id: "studio", terminal_id: "term_parent" },
  source: "herdr:spawned_by",
  generation: 1,
  observed_at: 1,
};

test("colours are derived only while a saved claim joins listed terminals", () => {
  const none = { spawns: [], groups: [] };
  const child = { pane_id: "w1:p2", terminal_id: "term_child" };
  const parent = { pane_id: "w1:p1", terminal_id: "term_parent" };
  // A stamp alone waits for the service to save its claim.
  expect(
    mayInherit(none, [
      connection([parent, { ...child, tokens: { spawned_by: "w1:p1" } }]),
    ]),
  ).toBe(false);
  const saved = { spawns: [claim], groups: [] };
  expect(mayInherit(saved, [connection([])])).toBe(false);
  expect(mayInherit(saved, [connection([child])])).toBe(false);
  expect(mayInherit(saved, [connection([child, parent])])).toBe(true);
});

test("colours are derived again only when the document or connections change", async () => {
  const board = (colors: Record<string, string>) =>
    ({ layout: { colors } }) as unknown as BoardDocument;
  let document = board({ tab: "red" });
  let connections = [connection([])];
  const store = { get: () => ({ document }) };
  const runtime = { get: () => ({ connections }) };
  const last: TerminalColorsSnapshot = { colors: Object.freeze({}) };
  const observed: WorkByPhase = {};
  let colors: TerminalColors | undefined;
  const phase = async (name: string, reads: number) => {
    observed[name] = await countedWorldWork(() => {
      for (let read = 0; read < reads; read += 1)
        colors = terminalColorsSnapshot(last, store, runtime);
    });
    return colors;
  };
  const first = await phase("first-read", 1);
  // React reads the snapshot on every render and store notification.
  expect(await phase("unchanged", 1000)).toBe(first);
  document = board({ tab: "red" });
  // An edit that changes no colour keeps the colours' identity.
  expect(await phase("other-board-edit", 10)).toBe(first);
  document = board({ tab: "blue" });
  expect(await phase("colour-edit", 10)).toEqual({ tab: "blue" });
  connections = [connection([])];
  await phase("refresh", 10);
  const once = { "colors.derive": 1 };
  expect(
    workViolations(
      observed,
      {
        "first-read": once,
        "other-board-edit": once,
        "colour-edit": once,
        refresh: once,
      },
      "colours",
    ),
  ).toEqual([]);
  expect(observed.refresh).toEqual(once);
});
