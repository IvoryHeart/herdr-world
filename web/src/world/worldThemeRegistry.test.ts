import { describe, expect, it } from "vitest";

import {
  WorldThemeRegistry,
  worldThemeRegistry,
} from "./worldThemeRegistry";
import type { WorldThemeDefinition, WorldThemeId } from "./worldThemeRegistry";

describe("World theme registry", () => {
  it("ships Office and Graph exactly once while keeping Mindcraft unavailable", () => {
    expect(worldThemeRegistry.list().map(({ id, label, semanticIcon }) => ({
      id,
      label,
      semanticIcon,
    }))).toEqual([
      { id: "office", label: "Office", semanticIcon: "pixel-office" },
      { id: "graph", label: "Graph", semanticIcon: "project-graph" },
    ]);
    expect(worldThemeRegistry.get("mindcraft")).toBeNull();
  });

  it("requires Office and rejects duplicate or malformed IDs", () => {
    const office = definition("office");
    expect(() => new WorldThemeRegistry([office, office])).toThrow(/duplicate/iu);
    expect(() => new WorldThemeRegistry([
      { ...office, id: "World SDK" as WorldThemeId },
    ])).toThrow(/invalid/iu);
    expect(() => new WorldThemeRegistry([definition("graph")])).toThrow(/Office/iu);
  });
});

function definition(id: WorldThemeId): WorldThemeDefinition {
  return {
    id,
    label: id,
    semanticIcon: id,
    load: async () => ({ default: () => null }),
  };
}
