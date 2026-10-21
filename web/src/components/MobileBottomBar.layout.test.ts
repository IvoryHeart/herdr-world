import { expect, test } from "bun:test";

const terminal = await Bun.file(
  new URL("./TerminalView.css", import.meta.url),
).text();
const controls = await Bun.file(
  new URL("./MobileControls.css", import.meta.url),
).text();

test("World mobile controls and terminal input keep touch targets at every supported zoom", () => {
  expect(terminal.includes("max(44px, calc(44px / var(--ui-scale, 1)))")).toBe(
    true,
  );
  expect(terminal.includes("max(48px, calc(48px / var(--ui-scale, 1)))")).toBe(
    true,
  );
  expect(controls.includes("48px")).toBe(true);
  for (let percent = 80; percent <= 150; percent++) {
    const scale = percent / 100;
    expect(Math.max(44, 44 / scale) * scale).toBeGreaterThanOrEqual(44 - 1e-10);
    expect(Math.max(48, 48 / scale) * scale).toBeGreaterThan(
      Math.max(44, 44 / scale) * scale,
    );
  }
});
