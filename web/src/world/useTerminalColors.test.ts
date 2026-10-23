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

test("colours are derived only while something can inherit", () => {
  const none = { spawns: [], groups: [] };
  const shell = connection([{ pane_id: "w1:p1", terminal_id: "term_shell" }]);
  expect(mayInherit(none, [shell])).toBe(false);
  // A stamped pane, even before the service saves its claim.
  expect(
    mayInherit(none, [
      connection([
        {
          pane_id: "w1:p2",
          terminal_id: "term_x",
          tokens: { spawned_by: "w1:p1" },
        },
      ]),
    ]),
  ).toBe(true);
  // A saved claim counts only while one of its terminals is listed.
  const saved = { spawns: [claim], groups: [] };
  expect(mayInherit(saved, [shell])).toBe(false);
  expect(
    mayInherit(saved, [
      connection([{ pane_id: "w1:p2", terminal_id: "term_child" }]),
    ]),
  ).toBe(true);
});
