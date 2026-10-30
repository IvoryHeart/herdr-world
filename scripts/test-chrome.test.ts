import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pin from "../tools/chrome/test-chrome.json";
import { installTestChrome, verifyArchive } from "./test-chrome";

test("the pin names one Chrome for Testing build and its checksum", () => {
  expect(pin.url).toBe(
    `https://storage.googleapis.com/chrome-for-testing-public/${pin.version}/linux64/chrome-linux64.zip`,
  );
  expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/);
});

test("an archive that does not match the pinned checksum is refused before it is unpacked", async () => {
  expect(() => verifyArchive(new TextEncoder().encode("synthetic"))).toThrow(
    "checksum mismatch",
  );
  const directory = mkdtempSync(join(tmpdir(), "test-chrome-"));
  try {
    await expect(
      installTestChrome(directory, async () =>
        new TextEncoder().encode("synthetic archive"),
      ),
    ).rejects.toThrow("checksum mismatch");
    expect(readdirSync(join(directory, pin.version))).toEqual([]);
    expect(existsSync(join(directory, pin.version, "chrome-linux64"))).toBe(
      false,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
