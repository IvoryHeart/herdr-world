import { describe, expect, test } from "bun:test";
import {
  preferredOfficeConnectorAnchor,
  worldConnectorPath,
  worldConnectorTargetPoint,
} from "./worldConnectorGeometry";

describe("World Inspector connector geometry", () => {
  test("uses the centre of the Inspector's right edge", () => {
    const windowBounds = { left: 100, top: 100, right: 500, bottom: 500 };
    expect(worldConnectorTargetPoint(windowBounds)).toEqual({
      x: 500,
      y: 300,
    });
  });

  test("connects to the agent centre before falling back to its desk", () => {
    const agent = { x: 420, y: 210, visible: true, edge: null } as const;
    const workbench = { x: 420, y: 280, visible: true, edge: null } as const;
    expect(preferredOfficeConnectorAnchor({ agent, workbench })).toBe(agent);
    expect(preferredOfficeConnectorAnchor({ agent: null, workbench })).toBe(
      workbench,
    );
  });

  test("curves toward either horizontal direction without reversing first", () => {
    expect(worldConnectorPath({ x: 640, y: 300 }, { x: 500, y: 300 })).toBe(
      "M 640 300 C 577 300, 563 300, 500 300",
    );
    expect(worldConnectorPath({ x: 100, y: 300 }, { x: 500, y: 300 })).toBe(
      "M 100 300 C 280 300, 320 300, 500 300",
    );
  });
});
