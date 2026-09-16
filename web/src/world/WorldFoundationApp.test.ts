import { describe, expect, test } from "bun:test";
import { parseWorldView, worldViewFromPath } from "./WorldFoundationApp";

describe("World view preference", () => {
  test("admits only canonical native views", () => {
    expect(parseWorldView("office")).toBe("office");
    expect(parseWorldView("tree")).toBe("tree");
    expect(parseWorldView("graph")).toBe("graph");
    expect(parseWorldView("spaces")).toBe("spaces");
    expect(parseWorldView("legacy-world")).toBe("spaces");
    expect(parseWorldView(null)).toBe("spaces");
  });

  test("maps canonical paths without accepting arbitrary routes", () => {
    expect(worldViewFromPath("/spaces")).toBe("spaces");
    expect(worldViewFromPath("/office")).toBe("office");
    expect(worldViewFromPath("/tree")).toBe("tree");
    expect(worldViewFromPath("/graph")).toBe("graph");
    expect(worldViewFromPath("/other")).toBe("spaces");
  });
});
