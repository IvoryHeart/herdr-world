import { expect, test } from "bun:test";
import { holdTownOverlay, TOWN_OVERLAY_HOLD_CSS } from "./overlayHold";

test("the overlay stays unpainted until reveal, then two real frames pass", async () => {
  const appended: unknown[] = [];
  const style = {
    textContent: null as string | null,
    removed: false,
    remove() {
      this.removed = true;
    },
  };
  const reveal = holdTownOverlay({
    createElement: () => style,
    head: { append: (node) => appended.push(node) },
  });
  expect(appended).toEqual([style]);
  expect(style.textContent).toBe(TOWN_OVERLAY_HOLD_CSS);
  expect(TOWN_OVERLAY_HOLD_CSS).toContain(
    ".town-world, .town-world * { visibility: hidden !important; }",
  );
  expect(style.removed).toBe(false);

  const frames: (() => void)[] = [];
  let revealed = false;
  const done = reveal((callback) => frames.push(callback)).then(() => {
    revealed = true;
  });
  expect(style.removed).toBe(true);
  expect(frames).toHaveLength(1);
  frames.shift()!();
  await Promise.resolve();
  expect(revealed).toBe(false);
  expect(frames).toHaveLength(1);
  frames.shift()!();
  await done;
  expect(revealed).toBe(true);
});
