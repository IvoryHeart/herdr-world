import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  assertManagedSetupAllowed,
  detectHerdrSetup,
  findHerdrBinary,
  setupHerdr,
} from "./bootstrap";
import { herdrDefaultBinaryPath, VERIFIED_HERDR_VERSION } from "./release";

const trash: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "herdr-world-herdr-bootstrap-"));
  trash.push(dir);
  return dir;
}
afterEach(() => {
  while (trash.length) {
    const dir = trash.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const reachablePing = () =>
  Promise.resolve({ version: VERIFIED_HERDR_VERSION, protocol: 22 });
const failingPing = () => Promise.reject(new Error("ENOENT: no socket"));

describe("assertManagedSetupAllowed", () => {
  test("rejects non-local or customized Herdr targets", () => {
    expect(() => assertManagedSetupAllowed({ sshHost: "box" })).toThrow(
      "only available for the local Herdr server",
    );
    expect(() => assertManagedSetupAllowed({ session: "work" })).toThrow(
      "default Herdr session",
    );
    expect(() =>
      assertManagedSetupAllowed({ hasExplicitSocketPath: true }),
    ).toThrow("default Herdr socket paths");
    expect(() =>
      assertManagedSetupAllowed({ hasExplicitClientSocketPath: true }),
    ).toThrow("default Herdr socket paths");
    expect(() => assertManagedSetupAllowed({})).not.toThrow();
  });
});

describe("findHerdrBinary", () => {
  // Herdr exports HERDR_BIN_PATH to the processes it starts; keep it out.
  const isolated = { binPathEnv: "", installDir: undefined };

  test("prefers the binary Herdr names in HERDR_BIN_PATH", () => {
    const homeDir = scratch();
    const named = join(scratch(), "herdr");
    writeFileSync(named, "named");
    const pathDir = scratch();
    writeFileSync(join(pathDir, "herdr"), "path");
    expect(
      findHerdrBinary({
        platform: "linux",
        homeDir,
        pathEnv: pathDir,
        binPathEnv: named,
      }),
    ).toBe(named);
    // A stale or relative value is ignored.
    for (const binPathEnv of [join(homeDir, "gone"), "herdr"])
      expect(
        findHerdrBinary({
          platform: "linux",
          homeDir,
          pathEnv: pathDir,
          binPathEnv,
        }),
      ).toBe(join(pathDir, "herdr"));
  });

  test("prefers whatever is on PATH over the default location", () => {
    const homeDir = scratch();
    const official = herdrDefaultBinaryPath({ platform: "linux", homeDir });
    mkdirSync(join(official, ".."), { recursive: true });
    writeFileSync(official, "official");
    const pathDir = scratch();
    writeFileSync(join(pathDir, "herdr"), "path");
    expect(
      findHerdrBinary({
        ...isolated,
        platform: "linux",
        homeDir,
        pathEnv: pathDir,
      }),
    ).toBe(join(pathDir, "herdr"));
  });

  test("falls back to the official installer location, honoring HERDR_INSTALL_DIR", () => {
    const homeDir = scratch();
    const localBin = join(homeDir, ".local", "bin");
    mkdirSync(localBin, { recursive: true });
    writeFileSync(join(localBin, "herdr"), "local");
    expect(
      findHerdrBinary({ ...isolated, platform: "linux", homeDir, pathEnv: "" }),
    ).toBe(join(localBin, "herdr"));
    const installDir = scratch();
    writeFileSync(join(installDir, "herdr"), "custom");
    expect(
      findHerdrBinary({
        binPathEnv: "",
        platform: "linux",
        homeDir,
        pathEnv: "",
        installDir,
      }),
    ).toBe(join(installDir, "herdr"));
  });

  test("returns null when no herdr binary exists", () => {
    expect(
      findHerdrBinary({
        ...isolated,
        platform: "linux",
        homeDir: scratch(),
        pathEnv: "",
      }),
    ).toBeNull();
  });

  test("looks for herdr.exe on Windows in Herdr's layout, then the legacy World directory", () => {
    const homeDir = scratch();
    const pathDir = scratch();
    writeFileSync(join(pathDir, "herdr.exe"), "exe");
    expect(
      findHerdrBinary({
        ...isolated,
        platform: "win32",
        homeDir,
        pathEnv: pathDir,
      }),
    ).toBe(join(pathDir, "herdr.exe"));

    const windowsHome = scratch();
    const env = {
      ...isolated,
      platform: "win32",
      homeDir: windowsHome,
      localAppDataDir: join(windowsHome, "Local"),
      appDataDir: join(windowsHome, "Roaming"),
      pathEnv: "",
    };
    // Herdr World 0.2.6 installed Herdr 0.9.4 here, outside PATH.
    const legacy = join(
      windowsHome,
      "Roaming",
      "herdr-world",
      "herdr",
      "0.9.4",
      "herdr.exe",
    );
    mkdirSync(join(legacy, ".."), { recursive: true });
    writeFileSync(legacy, "legacy");
    expect(findHerdrBinary(env)).toBe(legacy);
    const official = herdrDefaultBinaryPath(env);
    mkdirSync(join(official, ".."), { recursive: true });
    writeFileSync(official, "official");
    expect(findHerdrBinary(env)).toBe(official);
  });
});

describe("detectHerdrSetup", () => {
  test("reports a reachable server as running", async () => {
    const state = await detectHerdrSetup({ ping: reachablePing });
    expect(state).toEqual({
      state: "running",
      version: VERIFIED_HERDR_VERSION,
      protocol: 22,
    });
  });

  test("distinguishes installed-but-down from missing", async () => {
    const homeDir = scratch();
    const pathDir = scratch();
    writeFileSync(join(pathDir, "herdr"), "path");
    const deps = {
      ping: failingPing,
      platform: "linux",
      homeDir,
      binPathEnv: "",
      pathEnv: pathDir,
    };
    expect(await detectHerdrSetup(deps)).toEqual({
      state: "installed",
      binaryPath: join(pathDir, "herdr"),
    });
    expect(
      await detectHerdrSetup({
        ...deps,
        homeDir: scratch(),
        pathEnv: "",
        binPathEnv: "",
      }),
    ).toEqual({ state: "missing" });
  });
});

describe("setupHerdr", () => {
  test("does nothing when Herdr is already running", async () => {
    let installs = 0;
    const result = await setupHerdr({
      ping: reachablePing,
      installRelease: async () => {
        installs += 1;
        return { binaryPath: "/unused" };
      },
      installService: () => {
        installs += 1;
      },
    });
    expect(result.outcome).toBe("already-running");
    expect(installs).toBe(0);
  });

  test("starts an installed binary as a service without downloading", async () => {
    const homeDir = scratch();
    const pathDir = scratch();
    const binaryPath = join(pathDir, "herdr");
    writeFileSync(binaryPath, "path");
    const serviced: string[] = [];
    let releaseInstalls = 0;
    let pings = 0;
    const result = await setupHerdr({
      platform: "linux",
      homeDir,
      binPathEnv: "",
      pathEnv: pathDir,
      ping: () => {
        pings += 1;
        return pings < 2 ? failingPing() : reachablePing();
      },
      installRelease: async () => {
        releaseInstalls += 1;
        return { binaryPath: "/unused" };
      },
      installService: (path) => {
        serviced.push(path);
      },
      sleep: () => Promise.resolve(),
    });
    expect(result).toEqual({
      outcome: "started",
      binaryPath,
      version: VERIFIED_HERDR_VERSION,
      protocol: 22,
    });
    expect(serviced).toEqual([binaryPath]);
    expect(releaseInstalls).toBe(0);
  });

  test("installs the verified release when no binary exists", async () => {
    const homeDir = scratch();
    const managed = herdrDefaultBinaryPath({ platform: "linux", homeDir });
    const serviced: string[] = [];
    let pings = 0;
    const result = await setupHerdr({
      platform: "linux",
      homeDir,
      binPathEnv: "",
      pathEnv: "",
      ping: () => {
        pings += 1;
        return pings < 2 ? failingPing() : reachablePing();
      },
      installRelease: async () => ({ binaryPath: managed }),
      installService: (path) => {
        serviced.push(path);
      },
      sleep: () => Promise.resolve(),
    });
    expect(result.outcome).toBe("installed-and-started");
    expect(serviced).toEqual([managed]);
  });

  test("fails when the server never becomes reachable", async () => {
    await expect(
      setupHerdr({
        ping: failingPing,
        installRelease: async () => ({ binaryPath: "/managed/herdr" }),
        installService: () => {},
        startTimeoutMs: 1,
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toThrow("did not become reachable");
  });

  test("fails fast for SSH or customized setups", async () => {
    await expect(
      setupHerdr({ guard: { sshHost: "box" }, ping: failingPing }),
    ).rejects.toThrow("only available for the local Herdr server");
  });
});
