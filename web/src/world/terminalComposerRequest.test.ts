import { expect, test } from "bun:test";
import {
  requestTerminalComposer,
  takeTerminalComposerRequest,
} from "./terminalComposerRequest";

test("a composer request reaches only its own host's pane", () => {
  const wanted = { connectionId: "alpha", generation: 3, paneId: "p1" };
  requestTerminalComposer(wanted);
  // Another host, or a later runtime, with the same pane ID does not take it.
  expect(takeTerminalComposerRequest({ ...wanted, connectionId: "beta" })).toBe(
    false,
  );
  expect(takeTerminalComposerRequest({ ...wanted, generation: 4 })).toBe(false);
  expect(takeTerminalComposerRequest(wanted)).toBe(true);
  expect(takeTerminalComposerRequest(wanted)).toBe(false);
});
