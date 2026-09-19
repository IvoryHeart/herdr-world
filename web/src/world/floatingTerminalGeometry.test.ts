import { describe, expect, test } from "bun:test";
import {
  clampFloatingTerminalPosition,
  defaultFloatingTerminalGeometry,
  floatingTerminalContainingViewport,
  moveFloatingTerminalPosition,
  resizeFloatingTerminalGeometry,
} from "./floatingTerminalGeometry";

describe("floating terminal geometry", () => {
  test("cascades new windows from the lower-left inside the viewport", () => {
    expect(
      defaultFloatingTerminalGeometry(2, { width: 1200, height: 900 }),
    ).toEqual({ left: 88, top: 308, width: 760, height: 520 });
  });

  test("moves while keeping the desktop title region reachable", () => {
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
    ).toEqual({ left: 372, top: 536 });
  });

  test("keeps compact windows fully contained", () => {
    expect(
      moveFloatingTerminalPosition(
        { left: 8, top: 8 },
        10_000,
        10_000,
        { width: 390, height: 640 },
        { width: 374, height: 624 },
      ),
    ).toEqual({ left: 8, top: 8 });
  });

  test("accounts for a fixed-position containing block below the mobile header", () => {
    expect(
      floatingTerminalContainingViewport(
        { width: 390, height: 844 },
        { left: 0, top: 49 },
      ),
    ).toEqual({ width: 390, height: 795 });
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
