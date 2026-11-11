import { describe, expect, test } from "bun:test";
import {
  type CoreGrid,
  CoreWatchScreen,
  type CoreWatchReply,
  watchGridText,
} from "./coreWatch";

const surface = () => {
  const resizes: string[] = [];
  return {
    resizes,
    surface: {
      resize: (cols: number, rows: number) => resizes.push(`${cols}x${rows}`),
      write: () => {},
    },
  };
};
const grid = (cols: number, rows: number): CoreGrid => ({ cols, rows });
// World's attach moved an unviewed 100x30 terminal to core's headless grid.
const movedReply: CoreWatchReply = {
  grid: grid(200, 120),
  moved_from: grid(100, 30),
};
const line = (screen: CoreWatchScreen) =>
  watchGridText(screen.grid, screen.moved);

describe("the grid line after World's attach moved a terminal", () => {
  test("names the move while core holds the headless grid it moved to", () => {
    const { surface: s } = surface();
    const screen = new CoreWatchScreen(s);
    screen.apply({ stream: "w", grid: grid(200, 120) });
    screen.opened(movedReply);
    expect(line(screen)).toBe(
      "200×120: herdr-core moved it from 100×30 to its headless size when World started watching, because no Herdr app has it open",
    );
  });

  test("a desktop pane that opens later owns the grid and the line says so", () => {
    const { surface: s, resizes } = surface();
    const screen = new CoreWatchScreen(s);
    screen.apply({ stream: "w", grid: grid(200, 120) });
    screen.opened(movedReply);
    screen.apply({ stream: "w", grid: grid(80, 24) });
    expect(resizes).toEqual(["200x120", "80x24"]);
    expect(screen.moved).toBeNull();
    expect(line(screen)).toBe(
      "80×24: the size of the Herdr app or terminal that has it open",
    );
    // The pane closes: headless again, but World's attach did not cause it.
    screen.apply({ stream: "w", grid: grid(200, 120) });
    expect(line(screen)).toBe(
      "200×120: herdr-core's headless size, used while no Herdr app has it open",
    );
  });

  test("a reply arriving after a later grid does not revive the move", () => {
    const { surface: s } = surface();
    const screen = new CoreWatchScreen(s);
    screen.apply({ stream: "w", grid: grid(200, 120) });
    screen.apply({ stream: "w", grid: grid(80, 24) });
    screen.opened(movedReply);
    expect(screen.moved).toBeNull();
    expect(line(screen)).toBe(
      "80×24: the size of the Herdr app or terminal that has it open",
    );
    // Even back on the headless grid, the move is history.
    screen.apply({ stream: "w", grid: grid(200, 120) });
    expect(screen.moved).toBeNull();
  });

  test("a reply before the first grid applies once that grid arrives", () => {
    const { surface: s } = surface();
    const screen = new CoreWatchScreen(s);
    screen.opened(movedReply);
    expect(line(screen)).toBe("Waiting for its size…");
    screen.apply({ stream: "w", grid: grid(200, 120) });
    expect(line(screen)).toContain("moved it from 100×30");
  });

  test("an unmoved or malformed reply records no move", () => {
    const { surface: s } = surface();
    const screen = new CoreWatchScreen(s);
    screen.apply({ stream: "w", grid: grid(120, 40) });
    screen.opened({ grid: grid(120, 40), moved_from: null });
    screen.opened({ grid: grid(120, 40), moved_from: { cols: "1" } });
    screen.opened(null);
    expect(screen.moved).toBeNull();
    expect(line(screen)).toBe(
      "120×40: the size of the Herdr app or terminal that has it open",
    );
  });
});
