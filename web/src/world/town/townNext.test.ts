import { expect, test } from "bun:test";
import { townKeyIgnored, townNextLabel, townNextStep } from "./townNext";

const items = ["ask:1", "leaf:blocked", "leaf:done"];

test("N steps through Needs you's order and wraps; Shift+N goes back", () => {
  let cursor = townNextStep(items, null, 1);
  expect(cursor).toEqual({ key: "ask:1", index: 0 });
  cursor = townNextStep(items, cursor, 1);
  expect(cursor).toEqual({ key: "leaf:blocked", index: 1 });
  cursor = townNextStep(items, cursor, 1);
  expect(cursor).toEqual({ key: "leaf:done", index: 2 });
  cursor = townNextStep(items, cursor, 1);
  expect(cursor).toEqual({ key: "ask:1", index: 0 });
  cursor = townNextStep(items, cursor, -1);
  expect(cursor).toEqual({ key: "leaf:done", index: 2 });
  expect(townNextStep(items, null, -1)).toEqual({ key: "leaf:done", index: 2 });
});

test("after an item is answered, N goes on from where it stood", () => {
  const shown = { key: "leaf:blocked", index: 1 };
  // leaf:blocked was answered: the item after it now stands at its place.
  const left = ["ask:1", "leaf:done", "leaf:later"];
  expect(townNextStep(left, shown, 1)).toEqual({ key: "leaf:done", index: 1 });
  expect(townNextStep(left, shown, -1)).toEqual({ key: "ask:1", index: 0 });
  // The last item answered: N wraps to the first.
  expect(townNextStep(["ask:1"], { key: "leaf:done", index: 2 }, 1)).toEqual({
    key: "ask:1",
    index: 0,
  });
  // New items arriving before it do not lose the place.
  expect(
    townNextStep(["ask:0", ...items], { key: "leaf:blocked", index: 1 }, 1),
  ).toEqual({ key: "leaf:done", index: 3 });
});

test("with nothing waiting, Next has nowhere to go", () => {
  expect(townNextStep([], null, 1)).toBeNull();
  expect(townNextStep([], { key: "ask:1", index: 0 }, -1)).toBeNull();
});

test("the label shows the position and Next's key", () => {
  expect(townNextLabel(1, 7, "N")).toBe("2 of 7 · N next");
  expect(townNextLabel(0, 3, "")).toBe("1 of 3");
});

test("Town's keys stay silent while typing, in a terminal or a menu", () => {
  const element = (tagName: string, inside: string | null = null) => ({
    tagName,
    isContentEditable: false,
    closest: (selector: string) =>
      inside && selector.includes(inside) ? {} : null,
  });
  expect(townKeyIgnored(element("INPUT"))).toBe(true);
  expect(townKeyIgnored(element("TEXTAREA"))).toBe(true);
  expect(townKeyIgnored(element("SELECT"))).toBe(true);
  expect(townKeyIgnored({ ...element("DIV"), isContentEditable: true })).toBe(
    true,
  );
  // xterm's own input is a textarea; anything else inside a terminal too.
  expect(townKeyIgnored(element("DIV", ".xterm"))).toBe(true);
  expect(townKeyIgnored(element("BUTTON", '[role="menu"]'))).toBe(true);
  expect(townKeyIgnored(element("BUTTON", '[role="dialog"]'))).toBe(true);
  // The Town canvas, a button over it or the page itself.
  expect(townKeyIgnored(element("DIV"))).toBe(false);
  expect(townKeyIgnored(element("BUTTON"))).toBe(false);
  expect(townKeyIgnored(null)).toBe(false);
  expect(townKeyIgnored({})).toBe(false);
});
