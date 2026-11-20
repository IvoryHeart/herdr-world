import { afterAll, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { findHelpTarget } from "./helpTry";

const browser = new Window();
const hadStyle = "getComputedStyle" in globalThis;
beforeAll(() => {
  if (!hadStyle)
    Object.assign(globalThis, {
      getComputedStyle: browser.getComputedStyle.bind(browser),
    });
});
afterAll(() => {
  if (!hadStyle) Reflect.deleteProperty(globalThis, "getComputedStyle");
});

/** happy-dom lays nothing out: mark which elements have a box. */
function stage(html: string, shown: string[]) {
  const document = browser.document;
  document.body.innerHTML = html;
  for (const element of document.querySelectorAll("[id]"))
    Object.assign(element, {
      getClientRects: () => (shown.includes(element.id) ? [{}] : []),
    });
  return document as unknown as Document;
}

test("Try finds the control itself when it is on screen", () => {
  const document = stage(
    `<button id="hidden" data-help="board.next"></button>
     <button id="shown" data-help="board.next"></button>`,
    ["shown"],
  );
  expect(findHelpTarget("board.next", document)?.id).toBe("shown");
});

test("a control in a closed menu is found through the button that opens it", () => {
  const document = stage(
    `<button id="menu" data-help-opens="board.lenses board.camera"></button>`,
    ["menu"],
  );
  expect(findHelpTarget("board.lenses", document)?.id).toBe("menu");
  expect(findHelpTarget("board.lens", document)).toBeNull();
});

test("nothing is found when the control is not on this screen", () => {
  const document = stage(
    `<button id="gone" data-help="town.zoom"></button>`,
    [],
  );
  expect(findHelpTarget("town.zoom", document)).toBeNull();
});
