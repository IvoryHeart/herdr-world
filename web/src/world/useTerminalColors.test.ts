import { expect, test } from "bun:test";
import type { WorldRuntimeConnection } from "./runtimeStore";
import { mayInherit } from "./useTerminalColors";

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
