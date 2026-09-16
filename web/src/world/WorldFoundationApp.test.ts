import { describe, expect, test } from "bun:test";
import { parseWorldView } from "./WorldFoundationApp";

describe("World view preference", () => {
  test("admits only canonical native views", () => {
    expect(parseWorldView("office")).toBe("office");
    expect(parseWorldView("tree")).toBe("tree");
    expect(parseWorldView("graph")).toBe("graph");
    expect(parseWorldView("spaces")).toBe("spaces");
    expect(parseWorldView("legacy-world")).toBe("spaces");
    expect(parseWorldView(null)).toBe("spaces");
  });
});
