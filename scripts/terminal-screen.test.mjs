import assert from "node:assert/strict";
import { test } from "node:test";
import { createTerminalScreen } from "./terminal-screen.mjs";

test("renders stateful ANSI updates as the terminal screen", async () => {
  const screen = await createTerminalScreen(20, 4);

  try {
    screen.write("old value");
    screen.write("\r\u001b[2Cw");
    assert.equal(screen.text().split("\n")[0], "olw value");

    screen.write("\u001b[2;1HSIZE_31101");
    assert.match(screen.text(), /SIZE_31101/);

    screen.resize(30, 5);
    screen.write("\u001b[3;1HRESIZED");
    assert.match(screen.text(), /RESIZED/);
  } finally {
    screen.close();
  }
});
