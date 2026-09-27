import { expect, test } from "bun:test";
import { floatingTerminalClipPath } from "./WorldFloatingTerminal";

test("arranged Inspectors clip to the scroll viewport on every edge", () => {
  const bounds = { left: 20, top: 200, width: 500, height: 400 };
  expect(
    floatingTerminalClipPath(
      { left: -80, top: 150, width: 300, height: 300 },
      bounds,
    ),
  ).toBe("inset(50px 0px 0px 100px)");
  expect(
    floatingTerminalClipPath(
      { left: 400, top: 500, width: 200, height: 200 },
      bounds,
    ),
  ).toBe("inset(0px 80px 100px 0px)");
  expect(
    floatingTerminalClipPath(
      { left: 40, top: 220, width: 300, height: 300 },
      bounds,
    ),
  ).toBe("inset(0px 0px 0px 0px)");
});
