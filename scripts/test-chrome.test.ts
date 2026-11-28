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
  localTestChrome,
  chromeProfileLauncher,
  smokeTestChrome,
  userNamespacesRestricted,
  verifyArchive,
} from "./test-chrome";

test("local Linux browser gates use CI's pin, including explicitly selected paths", async () => {
  const installs: string[] = [];
  const install = async (directory: string) => {
    installs.push(directory);
    return "/synthetic/pinned-chrome";
  };
  expect(
    await localTestChrome(
      { XDG_CACHE_HOME: "/synthetic/cache" },
      "linux",
      "x64",
      install,
      (chrome) => chrome,
    ),
  ).toBe("/synthetic/pinned-chrome");
  expect(installs).toEqual(["/synthetic/cache/herdr-test-chrome"]);
  expect(
    await localTestChrome(
      { CHROME_BIN: "/synthetic/override" },
      "linux",
      "x64",
      install,
      (chrome) => chrome,
      () => `Google Chrome for Testing ${pin.version}`,
    ),
  ).toBe("/synthetic/override");
  expect(await localTestChrome({}, "darwin", "arm64", install)).toBeUndefined();
  expect(installs).toHaveLength(1);
});

test("the existing-profile launcher quotes executable paths and keeps every Chrome argument", () => {
  const directory = mkdtempSync(join(tmpdir(), "chrome-launcher-"));
  try {
    const aaExec = join(directory, "aa exec' fixture");
    const launcher = join(directory, "launcher");
    writeFileSync(aaExec, '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
    writeFileSync(
      launcher,
      chromeProfileLauncher("/fixture/chrome's binary", aaExec),
      { mode: 0o755 },
    );
    const result = Bun.spawnSync([launcher, "--headless=new", "two words"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe(
      "-p\nchrome\n--\n/fixture/chrome's binary\n--headless=new\ntwo words\n",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

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

test("an explicit Chrome from another version is refused before any browser fixture runs", async () => {
  let installs = 0;
  await expect(
    localTestChrome(
      { CHROME_BIN: "/synthetic/chrome-157" },
      "linux",
      "x64",
      async () => {
        installs++;
        return "/synthetic/pin";
      },
      (chrome) => chrome,
      () => "Google Chrome 157.0.0.0",
    ),
  ).rejects.toThrow(`expected pinned Chrome ${pin.version}`);
  expect(installs).toBe(0);
});
