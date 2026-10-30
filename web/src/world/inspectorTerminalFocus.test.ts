import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { inspectorFocusBlocked } from "./inspectorTerminalFocus";

test("an open popover, such as the title's pane map, keeps the deferred terminal focus out", () => {
  const { document } = new Window();
  expect(inspectorFocusBlocked(document)).toBe(false);
  document.body.innerHTML =
    '<div data-radix-popper-content-wrapper><div role="dialog" aria-label="Panes in this tab"></div></div>';
  expect(inspectorFocusBlocked(document)).toBe(true);
  for (const layer of [
    '<div class="world-hosts-menu"></div>',
    '<div class="command-popover"></div>',
    '<div class="modal-backdrop"></div>',
    '<div role="menu"></div>',
  ]) {
    document.body.innerHTML = layer;
    expect(inspectorFocusBlocked(document)).toBe(true);
  }
});
