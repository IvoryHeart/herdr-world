import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TownBuildingMove, TownBuildingName } from "./TownBuildingMove";
import type { TownRoomActions } from "./townRoomActions";

const ORDER = ["a", "b", "c"];
const LABELS: Record<string, string> = { a: "Alpha", b: "Beta", c: "Gamma" };

const actions = (moved: [string, number][]) =>
  ({
    buildingMoveNeighbor: (hostKey: string, step: -1 | 1) => {
      const next = ORDER[ORDER.indexOf(hostKey) + step];
      return next ? { label: LABELS[next]! } : null;
    },
    onMoveBuilding: (hostKey: string, step: -1 | 1) =>
      moved.push([hostKey, step]),
  }) as unknown as TownRoomActions;

test("a building's sign offers Move before and after its neighbours", () => {
  const html = (hostKey: string) =>
    renderToStaticMarkup(
      createElement(TownBuildingMove, {
        hostKey,
        label: LABELS[hostKey]!,
        roomActions: actions([]),
      }),
    );
  expect(html("b")).toContain('aria-label="Move building Beta before Alpha"');
  expect(html("b")).toContain('aria-label="Move building Beta after Gamma"');
  // At either end only the one way.
  expect(html("a")).not.toContain("before");
  expect(html("a")).toContain('aria-label="Move building Alpha after Beta"');
  expect(html("c")).not.toContain(" after ");
});

test("no Move buttons without a way to move buildings", () => {
  const html = renderToStaticMarkup(
    createElement(TownBuildingMove, {
      hostKey: "b",
      label: "Beta",
      roomActions: {} as TownRoomActions,
    }),
  );
  expect(html).toBe("");
});

test("the sign's name is a handle only when the building can move", () => {
  const movable = renderToStaticMarkup(
    createElement(TownBuildingName, {
      hostKey: "b",
      label: "Beta",
      roomActions: actions([]),
      onPress: () => true,
    }),
  );
  expect(movable).toContain('title="Drag to move Beta"');
  const still = renderToStaticMarkup(
    createElement(TownBuildingName, {
      hostKey: "b",
      label: "Beta",
      roomActions: {} as TownRoomActions,
      onPress: () => true,
    }),
  );
  expect(still).toBe("<strong>Beta</strong>");
});
