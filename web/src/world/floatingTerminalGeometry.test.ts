import { describe, expect, test } from "bun:test";
import {
  clampFloatingTerminalPosition,
  moveFloatingTerminalPosition,
  resizeFloatingTerminalGeometry,
} from "./floatingTerminalGeometry";

describe("floating terminal geometry", () => {
  test("moves inside the viewport without allowing the window to escape", () => {
    expect(
      moveFloatingTerminalPosition(
        { left: 100, top: 80 },
        40,
        -20,
        { width: 800, height: 600 },
        { width: 420, height: 300 },
      ),
    ).toEqual({ left: 140, top: 60 });
    expect(
      moveFloatingTerminalPosition(
        { left: 100, top: 80 },
        10_000,
        10_000,
        { width: 800, height: 600 },
        { width: 420, height: 300 },
      ),
    ).toEqual({ left: 372, top: 292 });
  });

  test("reclamps saved geometry when the viewport becomes compact", () => {
    expect(
      clampFloatingTerminalPosition(
        { left: 500, top: 400 },
        { width: 390, height: 640 },
        { width: 374, height: 624 },
      ),
    ).toEqual({ left: 8, top: 8 });
  });

  test("resizes within the viewport and preserves a usable minimum", () => {
    expect(
      resizeFloatingTerminalGeometry(
        { left: 100, top: 80, width: 420, height: 300 },
        500,
        500,
        { width: 800, height: 600 },
      ),
    ).toEqual({ left: 100, top: 80, width: 692, height: 512 });
    expect(
      resizeFloatingTerminalGeometry(
        { left: 100, top: 80, width: 620, height: 480 },
        -10_000,
        -10_000,
        { width: 800, height: 600 },
      ),
    ).toEqual({ left: 100, top: 80, width: 420, height: 280 });
  });
});
