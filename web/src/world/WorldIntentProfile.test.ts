import { describe, expect, test } from "bun:test";
import { worldReadOnlyMessage } from "./WorldIntentProfile";

describe("World read-only context", () => {
  test("uses direct host-switch language without projection jargon", () => {
    expect(worldReadOnlyMessage(true, true)).toBe(
      "Switch hosts to activate this view.",
    );
    expect(worldReadOnlyMessage(true, false)).toBe(
      "This host is not ready. Switch hosts or reconnect it to continue.",
    );
    expect(worldReadOnlyMessage(false, true)).toBe(
      "This view belongs to an earlier connection. Select the current item to continue.",
    );
  });
});
