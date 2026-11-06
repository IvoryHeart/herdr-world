import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import {
  assertValidAuthPassword,
  authTokenPrintCommand,
  isShortAuthPassword,
  defaultAuthTokenPath,
  loadOrCreateAuthToken,
  rotateAuthToken,
} from "./auth-token";

const tempDirs: string[] = [];

function tempHome(): string {
  const path = mkdtempSync(join(tmpdir(), "herdr-gui-auth-token-"));
  tempDirs.push(path);
  return path;
}

function tempAuthTokenPath(homeDir = tempHome()): string {
  return defaultAuthTokenPath(
    homeDir,
    process.platform,
    join(homeDir, "AppData", "Roaming"),
    {},
  );
}

afterEach(() => {
  for (const path of tempDirs.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("generated authentication token", () => {
  test("requires 8 to 1024 Unicode characters for login secrets", () => {
    for (const password of [
      "",
      "a".repeat(7),
      "\u{1f600}".repeat(7),
      "a".repeat(1025),
      "\u{1f600}".repeat(1025),
    ]) {
      expect(() => assertValidAuthPassword(password)).toThrow(
        "at least 8 characters and at most 1024 characters",
      );
    }
    for (const password of [
      "a".repeat(8),
      "\u{1f600}".repeat(8),
      "a".repeat(1024),
      "\u{1f600}".repeat(1024),
    ]) {
      expect(() => assertValidAuthPassword(password)).not.toThrow();
    }
  });

  test("flags passwords shorter than the recommended length", () => {
    expect(isShortAuthPassword("a".repeat(14))).toBe(true);
    expect(isShortAuthPassword("\u{1f600}".repeat(14))).toBe(true);
    expect(isShortAuthPassword("a".repeat(15))).toBe(false);
    expect(isShortAuthPassword("\u{1f600}".repeat(15))).toBe(false);
  });

  test("uses APPDATA for the Windows token", () => {
    const home = join("C:", "Users", "tester");
    const appData = join(home, "AppData", "Roaming");
    expect(defaultAuthTokenPath(home, "win32", appData, {})).toBe(
      join(appData, "herdr-world", "auth-token"),
    );
  });

  test("prints the token without revealing the account name", () => {
    const home = join("C:", "Users", "tester");
    const appData = join(home, "AppData", "Roaming");
    expect(
      authTokenPrintCommand(
        join(appData, "herdr-world", "auth-token"),
        home,
        "win32",
        appData,
      ),
    ).toBe('Get-Content "$env:APPDATA\\herdr-world\\auth-token"');
    expect(
      authTokenPrintCommand(
        join(home, ".config", "herdr-world", "auth-token"),
        home,
        "win32",
        undefined,
      ),
    ).toBe('Get-Content "$HOME\\.config\\herdr-world\\auth-token"');
    expect(
      authTokenPrintCommand(
        "/home/tester/.config/herdr-world/auth-token",
        "/home/tester",
        "linux",
      ),
    ).toBe("cat ~/.config/herdr-world/auth-token");
    expect(
      authTokenPrintCommand(
        "/Users/tester/.config/herdr-world/auth-token",
        "/Users/tester",
        "darwin",
      ),
    ).toBe("cat ~/.config/herdr-world/auth-token");
  });

  test("prints the default token command with trailing HOME separators", () => {
    const home = tempHome();
    for (const suffix of [sep, sep.repeat(2)]) {
      const homeWithSeparator = home + suffix;
      const path = defaultAuthTokenPath(
        homeWithSeparator,
        process.platform,
        join(home, "AppData", "Roaming"),
        {},
      );
      expect(
        authTokenPrintCommand(path, homeWithSeparator, process.platform, ""),
      ).toBe(
        process.platform === "win32"
          ? 'Get-Content "$HOME\\AppData\\Roaming\\herdr-world\\auth-token"'
          : "cat ~/.config/herdr-world/auth-token",
      );
    }
  });

  test("handles filesystem-root HOME without losing the boundary", () => {
    expect(
      authTokenPrintCommand("/.config/herdr-world/auth-token", "/", "linux"),
    ).toBe("cat ~/.config/herdr-world/auth-token");
    expect(
      authTokenPrintCommand("relative/auth-token", "/", "linux"),
    ).toBeUndefined();
  });

  // These are command-string tests, not execution in a Windows shell.
  test("prints Windows commands with trailing APPDATA or HOME separators", () => {
    const home = "C:\\Users\\tester";
    const appData = `${home}\\AppData\\Roaming`;
    for (const suffix of ["\\", "\\\\", "/"]) {
      expect(
        authTokenPrintCommand(
          `${appData}\\herdr-world\\auth-token`,
          home,
          "win32",
          appData + suffix,
        ),
      ).toBe('Get-Content "$env:APPDATA\\herdr-world\\auth-token"');
      expect(
        authTokenPrintCommand(
          `${home}\\.config\\herdr-world\\auth-token`,
          home + suffix,
          "win32",
          "",
        ),
      ).toBe('Get-Content "$HOME\\.config\\herdr-world\\auth-token"');
      expect(
        authTokenPrintCommand(
          `${appData}Extra\\auth-token`,
          "C:\\OtherUser",
          "win32",
          appData + suffix,
        ),
      ).toBeUndefined();
    }
  });

  test("keeps adjacent prefixes and unsafe shell paths omitted", () => {
    expect(
      authTokenPrintCommand(
        "/home/tester-other/auth-token",
        "/home/tester/",
        "linux",
      ),
    ).toBeUndefined();
    for (const name of ["token name", "token;echo", "token$HOME"]) {
      expect(
        authTokenPrintCommand(`/home/tester/${name}`, "/home/tester/", "linux"),
      ).toBeUndefined();
    }
    for (const name of ['token"', "token`", "token$HOME"]) {
      expect(
        authTokenPrintCommand(
          `C:\\Users\\tester\\${name}`,
          "C:\\Users\\tester\\",
          "win32",
          "",
        ),
      ).toBeUndefined();
    }
  });

  test("omits the token command outside the home directory", () => {
    expect(
      authTokenPrintCommand(
        "/srv/herdr-world/auth-token",
        "/home/tester",
        "linux",
      ),
    ).toBeUndefined();
    expect(
      authTokenPrintCommand(
        "/home/testerx/auth-token",
        "/home/tester",
        "linux",
      ),
    ).toBeUndefined();
  });

  test("creates a persistent random token with private permissions", () => {
    const path = tempAuthTokenPath();
    const first = loadOrCreateAuthToken(path);
    const second = loadOrCreateAuthToken(path);

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
    expect(readFileSync(path, "utf8")).toBe(`${first}\n`);
    if (process.platform !== "win32") {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
  });

  test("repairs permissions on an existing valid token", () => {
    if (process.platform === "win32") return;
    const path = tempAuthTokenPath();
    const token = "a".repeat(64);
    loadOrCreateAuthToken(path);
    writeFileSync(path, `${token}\n`);
    chmodSync(path, 0o644);

    expect(loadOrCreateAuthToken(path)).toBe(token);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("rejects a malformed persisted token", () => {
    const path = tempAuthTokenPath();
    loadOrCreateAuthToken(path);
    writeFileSync(path, "not-a-token\n");

    expect(() => loadOrCreateAuthToken(path)).toThrow(
      "invalid generated auth token",
    );
  });

  test("does not follow a generated-token symlink", () => {
    const home = tempHome();
    const path = tempAuthTokenPath(home);
    const target = join(home, "shared-secret");
    loadOrCreateAuthToken(path);
    writeFileSync(target, `${"b".repeat(64)}\n`);
    rmSync(path);
    symlinkSync(target, path);

    expect(() => loadOrCreateAuthToken(path)).toThrow(
      "data path contains a symlink",
    );
  });
});

describe("rotateAuthToken", () => {
  test("replaces the token atomically with private permissions", () => {
    const path = tempAuthTokenPath();
    const original = loadOrCreateAuthToken(path);
    const rotated = rotateAuthToken(path);
    expect(rotated).toMatch(/^[a-f0-9]{64}$/);
    expect(rotated).not.toBe(original);
    expect(readFileSync(path, "utf8")).toBe(`${rotated}\n`);
    if (process.platform !== "win32")
      expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("refuses symlinked token paths", () => {
    const home = tempHome();
    const path = tempAuthTokenPath(home);
    loadOrCreateAuthToken(path);
    const link = join(home, "link-token");
    symlinkSync(path, link);
    expect(() => rotateAuthToken(link)).toThrow("symlink");
  });
});
