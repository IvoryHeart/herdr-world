import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { observeDialogsForGlobalMenu } from "./useCloseGlobalMenuForDialog";

// happy-dom does not paint stacking contexts. Guard the intended ordering here;
// real elementFromPoint overlap checks remain part of phone browser acceptance.
test("menus cover the editor without blocking More-to-Tabs navigation", async () => {
  const css = await Bun.file(
    new URL("../styles/layout/mobile-nav.css", import.meta.url),
  ).text();
  const topbar = await Bun.file(
    new URL("../styles/layout/topbar.css", import.meta.url),
  ).text();
  const connection = await Bun.file(
    new URL("./ConnectionSwitcher.css", import.meta.url),
  ).text();
  const controls = await Bun.file(
    new URL("./MobileControls.css", import.meta.url),
  ).text();
  expect(topbar).toMatch(/\.topbar\s*\{[^}]*z-index: 120;/);
  expect(controls).toMatch(/\.mobile-more-backdrop\s*\{[^}]*z-index: 79;/);
  expect(controls).toMatch(/\.mobile-controls-stack\s*\{[^}]*z-index: 80;/);
  expect(connection).toMatch(
    /\.connection-switcher-popover\s*\{[^}]*z-index: 140;/,
  );
  expect(css.includes(".mobile-nav")).toBe(true);
});

test("global menus yield to nested, new and revealed dialogs, and unsubscribe", async () => {
  const browser = new Window();
  try {
    const root = browser.document.body;
    root.innerHTML =
      '<div class="app"><div class="modal-backdrop" hidden></div></div>';
    const dialog = root.querySelector(".modal-backdrop")!;
    let closes = 0;
    const stop = observeDialogsForGlobalMenu(
      root as unknown as HTMLElement,
      () => closes++,
    );
    expect(closes).toBe(0);
    dialog.removeAttribute("hidden");
    await browser.happyDOM.whenAsyncComplete();
    expect(closes).toBe(1);
    stop();
    dialog.remove();
    root.firstElementChild!.appendChild(dialog);
    await browser.happyDOM.whenAsyncComplete();
    expect(closes).toBe(1);
    const stopExisting = observeDialogsForGlobalMenu(
      root as unknown as HTMLElement,
      () => closes++,
    );
    expect(closes).toBe(2);
    stopExisting();
    dialog.remove();
    const stopNew = observeDialogsForGlobalMenu(
      root as unknown as HTMLElement,
      () => closes++,
    );
    root.firstElementChild!.appendChild(dialog);
    await browser.happyDOM.whenAsyncComplete();
    expect(closes).toBe(3);
    stopNew();
  } finally {
    await browser.happyDOM.close();
  }
});
