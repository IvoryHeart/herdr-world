import { describe, expect, test } from "bun:test";
import { dialogKeyAction } from "./dialogKeyboard";

describe("dialog keyboard containment", () => {
  test("confirms on Enter when focus is inside the dialog but not on a button", () => {
    expect(dialogKeyAction("Enter", true)).toBe("confirm");
    expect(dialogKeyAction("Enter", true, false)).toBe("confirm");
  });

  test("leaves Enter to the focused button inside a confirmation dialog", () => {
    expect(dialogKeyAction("Enter", true, true)).toBe("native");
  });

  test("closes on Escape and contains keys arriving from outside", () => {
    expect(dialogKeyAction("Escape", true)).toBe("close");
    expect(dialogKeyAction("Enter", false)).toBe("contain");
  });
});
