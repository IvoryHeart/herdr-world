import { expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pin from "../tools/chrome/test-chrome.json";
import {
  appArmorProfile,
  installTestChrome,
  smokeTestChrome,
  userNamespacesRestricted,
  verifyArchive,
} from "./test-chrome";

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

test("the sandbox profile allows user namespaces for exactly the pinned path", () => {
  const profile = appArmorProfile("/example/cache/chrome-linux64/chrome");
  expect(profile).toContain(
    'profile herdr-test-chrome "/example/cache/chrome-linux64/chrome" flags=(unconfined) {',
  );
  expect(profile).toContain("  userns,");
  expect(profile.startsWith("abi <abi/4.0>,")).toBe(true);
});

test("only an enabled AppArmor restriction needs the profile", () => {
  expect(userNamespacesRestricted((() => "1\n") as never)).toBe(true);
  expect(userNamespacesRestricted((() => "0\n") as never)).toBe(false);
  expect(
    userNamespacesRestricted((() => {
      throw new Error("absent");
    }) as never),
  ).toBe(false);
});

test.skipIf(process.platform === "win32")(
  "installation fails when the browser cannot start headless, not at the first test",
  () => {
    const directory = mkdtempSync(join(tmpdir(), "test-chrome-smoke-"));
    try {
      const fake = (name: string, body: string) => {
        const path = join(directory, name);
        writeFileSync(path, `#!/bin/sh\n${body}\n`);
        chmodSync(path, 0o755);
        return path;
      };
      expect(() =>
        smokeTestChrome(
          fake("aborts", "echo 'No usable sandbox!' >&2; exit 134"),
        ),
      ).toThrow("No usable sandbox!");
      expect(() => smokeTestChrome(fake("silent", "exit 0"))).toThrow(
        "did not start headless",
      );
      smokeTestChrome(fake("starts", "echo '<html><head></head></html>'"));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
