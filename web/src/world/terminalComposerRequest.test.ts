import {
  readTerminalComposerDraft,
  writeTerminalComposerDraft,
  terminalComposerDraftKey,
} from "../terminalComposer";
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

test("owner recovery appends only to the qualified composer draft, without input", () => {
  const target = { connectionId: "recovery", generation: 7, paneId: "t1" };
  const key = terminalComposerDraftKey(
    target.connectionId,
    target.generation,
    target.paneId,
  );
  writeTerminalComposerDraft(key, "Existing draft");
  requestTerminalComposer(target, "printf saved_answer");
  expect(readTerminalComposerDraft(key)).toBe("Existing draft");
  expect(takeTerminalComposerRequest({ ...target, generation: 8 })).toBe(false);
  expect(readTerminalComposerDraft(key)).toBe("Existing draft");
  expect(takeTerminalComposerRequest(target)).toBe(true);
  expect(readTerminalComposerDraft(key)).toBe(
    "Existing draft\nprintf saved_answer",
  );
  expect(takeTerminalComposerRequest(target)).toBe(false);
});
