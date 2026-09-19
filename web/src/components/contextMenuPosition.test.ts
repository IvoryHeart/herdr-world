import { describe, expect, test } from "bun:test";
import { clampContextMenuPosition } from "./contextMenuPosition";

describe("context menu positioning", () => {
  test("keeps an anchor position when the rendered menu fits", () => {
    expect(
      clampContextMenuPosition(
        { left: 120, top: 80 },
        { width: 244, height: 320 },
        { width: 1280, height: 800 },
      ),
    ).toEqual({ left: 120, top: 80 });
  });

  test("clamps the rendered dimensions against the viewport edges", () => {
    expect(
      clampContextMenuPosition(
        { left: 1200, top: 740 },
        { width: 244, height: 625 },
        { width: 1280, height: 768 },
      ),
    ).toEqual({ left: 1028, top: 135 });
  });

  test("keeps the margin when the menu is as large as the viewport", () => {
    expect(
      clampContextMenuPosition(
        { left: -20, top: -30 },
        { width: 400, height: 600 },
        { width: 390, height: 590 },
      ),
    ).toEqual({ left: 8, top: 8 });
  });
});
