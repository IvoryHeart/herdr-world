import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupHerdr } from "./bootstrap";
import { runHerdrCommand } from "./cli";
import { VERIFIED_HERDR_VERSION } from "./release";
import type { HerdrUpgradeReport } from "./upgrade";
import type { LocalCoreSetup } from "../herdr-core/local-setup";

function fakeConfig() {
  return {
    sshHost: undefined,
    session: undefined,
    hasExplicitSocketPath: false,
    hasExplicitClientSocketPath: false,
    socketPath: "/tmp/test-herdr.sock",
  };
}

/** A Herdr is installed, so setup and --install keep it (no core step). */
const herdrInstalled = async () => ({
  state: "installed" as const,
  binaryPath: "/example/herdr",
});

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    log: (message: string) => out.push(message),
    error: (message: string) => err.push(message),
  };
}

describe("runHerdrCommand", () => {
  test("explicit CLI setup reports persistent registration for a running runtime", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "herdr-cli-setup-"));
    const binaryPath = join(homeDir, "herdr");
    writeFileSync(binaryPath, "synthetic binary", { mode: 0o755 });
    const registrations: unknown[] = [];
    const io = capture();
    try {
      const code = await runHerdrCommand(["herdr", "setup"], "0.0.0", {
        ...io,
        loadConfig: () => fakeConfig() as never,
        detect: herdrInstalled,
        setup: () =>
          setupHerdr({
            platform: "linux",
            homeDir,
            binPathEnv: "",
            pathEnv: homeDir,
            ping: async () => ({
              version: VERIFIED_HERDR_VERSION,
              protocol: 22,
            }),
            installService: (...args) => {
              registrations.push(args);
            },
          }),
      });
      expect(code).toBe(0);
      expect(registrations).toEqual([[binaryPath, { start: false }]]);
      expect(io.out.join("\n")).toContain(
        "user service registered for future logins",
      );
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("ignores non-herdr commands", async () => {
    expect(await runHerdrCommand(["service", "install"], "0.0.0")).toBeNull();
    expect(await runHerdrCommand([], "0.0.0")).toBeNull();
  });

  test("prints help for bare or unknown herdr commands", async () => {
    const help = capture();
    expect(await runHerdrCommand(["herdr"], "0.0.0", help)).toBe(0);
    expect(help.out.join("\n")).toContain("herdr-world herdr setup");

    const unknown = capture();
    expect(await runHerdrCommand(["herdr", "restart"], "0.0.0", unknown)).toBe(
      1,
    );
    expect(unknown.err.join("\n")).toContain("unknown herdr action");
  });

  test("status reports a running server", async () => {
    const io = capture();
    const code = await runHerdrCommand(["herdr", "status"], "0.0.0", {
      ...io,
      loadConfig: () => fakeConfig() as never,
      detect: () =>
        Promise.resolve({
          state: "running",
          version: VERIFIED_HERDR_VERSION,
          protocol: 22,
        }),
      serviceStatus: () => ({ installed: true, active: true }),
    });
    expect(code).toBe(0);
    expect(io.out.join("\n")).toContain(
      `running (version ${VERIFIED_HERDR_VERSION}`,
    );
    expect(io.out.join("\n")).toContain("installed, active");
  });

  test("status points missing installs at setup", async () => {
    const io = capture();
    const code = await runHerdrCommand(["herdr", "status"], "0.0.0", {
      ...io,
      loadConfig: () => fakeConfig() as never,
      detect: () => Promise.resolve({ state: "missing" }),
      serviceStatus: () => ({ installed: false, active: false }),
    });
    expect(code).toBe(0);
    expect(io.out.join("\n")).toContain("not installed");
    expect(io.out.join("\n")).toContain("herdr-world herdr setup");
  });

  test("setup prints the outcome", async () => {
    const io = capture();
    const code = await runHerdrCommand(["herdr", "setup"], "0.0.0", {
      ...io,
      loadConfig: () => fakeConfig() as never,
      detect: herdrInstalled,
      setup: () =>
        Promise.resolve({
          outcome: "installed-and-started",
          binaryPath: "/managed/herdr",
          version: VERIFIED_HERDR_VERSION,
          protocol: 22,
        }),
    });
    expect(code).toBe(0);
    expect(io.out.join("\n")).toContain(
      `Installed Herdr ${VERIFIED_HERDR_VERSION}`,
    );
    expect(io.out.join("\n")).toContain("/managed/herdr");
  });

  test("setup failures print the reason and exit 1", async () => {
    const io = capture();
    const code = await runHerdrCommand(["herdr", "setup"], "0.0.0", {
      ...io,
      loadConfig: () => fakeConfig() as never,
      detect: herdrInstalled,
      setup: () => Promise.reject(new Error("checksum does not match")),
    });
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain("checksum does not match");
  });

  function upgradeReport(
    overrides: Partial<HerdrUpgradeReport> = {},
  ): HerdrUpgradeReport {
    return {
      before: {
        state: "outdated",
        binaryPath: "/example/herdr",
        version: "0.9.3",
      },
      binary: "upgraded",
      binaryPath: "/example/herdr",
      version: VERIFIED_HERDR_VERSION,
      backupPath: "/example/herdr.previous",
      server: { outcome: "handed-off" },
      integrations: [{ target: "codex", action: "updated" }],
      plugin: { target: "ivoryheart.herdr-world", action: "current" },
      ...overrides,
    };
  }

  test("upgrade passes its options and prints each step", async () => {
    const io = capture();
    const received: unknown[] = [];
    const code = await runHerdrCommand(
      ["herdr", "upgrade", "--install", "--no-plugin"],
      "0.3.0",
      {
        ...io,
        loadConfig: () => fakeConfig() as never,
        serviceStatus: () => ({ installed: false, active: false }),
        upgrade: async (options) => {
          received.push(options);
          return upgradeReport();
        },
      },
    );
    expect(code).toBe(0);
    expect(received).toEqual([
      { installMissing: true, integrations: true, plugin: false },
    ]);
    expect(io.out).toEqual([
      `Upgraded Herdr 0.9.3 -> ${VERIFIED_HERDR_VERSION} at /example/herdr.`,
      "Previous Herdr binary: /example/herdr.previous",
      "The running Herdr server handed its panes to the new version.",
      "codex harness integration: updated",
    ]);
  });

  describe("setup and upgrade --install with no Herdr go core first", () => {
    const missing = async () => ({ state: "missing" as const });
    const run = (
      args: string[],
      core: LocalCoreSetup,
      extra: Record<string, unknown> = {},
    ) => {
      const io = capture();
      let upgrades = 0;
      let setups = 0;
      const coreCalls: Array<{ setUp: boolean; platform?: string }> = [];
      const done = runHerdrCommand(["herdr", ...args], "0.3.0", {
        ...io,
        loadConfig: () => fakeConfig() as never,
        detect: missing,
        platform: "linux",
        coreSetup: async (options) => {
          coreCalls.push({ setUp: options.setUp, platform: options.platform });
          options.log("herdr-core is running.");
          return core;
        },
        upgrade: async () => {
          upgrades++;
          return upgradeReport();
        },
        setup: async () => {
          setups++;
          return {
            outcome: "installed-and-started" as const,
            binaryPath: "/example/herdr",
            version: VERIFIED_HERDR_VERSION,
            protocol: 22,
          };
        },
        ...extra,
      });
      return done.then((code) => ({
        code,
        io,
        coreCalls,
        upgrades: () => upgrades,
        setups: () => setups,
      }));
    };
    const installed: LocalCoreSetup = {
      outcome: "set-up",
      core: "/example/.local/bin/herdr-core",
      installed: true,
    };
    const kept: LocalCoreSetup = {
      outcome: "kept",
      core: "/example/.local/bin/herdr-core",
    };

    test.each([[["upgrade", "--install", "--only-if-missing"]], [["setup"]]])(
      "%s installs and starts core, and never the Herdr TUI",
      async (args: string[]) => {
        const result = await run(args, installed);
        expect(result.code).toBe(0);
        expect(result.upgrades()).toBe(0);
        expect(result.setups()).toBe(0);
        expect(result.coreCalls).toEqual([
          { setUp: args[0] === "setup", platform: "linux" },
        ]);
        expect(result.io.out).toEqual([
          "herdr-core is running.",
          "herdr-core is installed and running, and starts at login; no Herdr was installed.",
          "To connect World to it, use Install herdr-core on This computer in Hosts > Manage connections; an installed core is set up, never replaced.",
        ]);
      },
    );

    test("an installed core is kept by upgrade --install and started by setup", async () => {
      const upgrade = await run(["upgrade", "--install"], kept);
      expect(upgrade.code).toBe(0);
      expect(upgrade.upgrades()).toBe(0);
      expect(upgrade.io.out).toContain(
        "herdr-core is installed at /example/.local/bin/herdr-core; it is kept as it is, so no Herdr was installed.",
      );
      const setup = await run(["setup"], {
        outcome: "set-up",
        core: "/example/.local/bin/herdr-core",
        installed: false,
      });
      expect(setup.setups()).toBe(0);
      expect(setup.io.out).toContain(
        "herdr-core at /example/.local/bin/herdr-core is running and starts at login; it was not replaced, and no Herdr was installed.",
      );
    });

    test("a failure is said plainly and exits 1; --json reports it", async () => {
      const result = await run(["upgrade", "--install", "--json"], {
        outcome: "failed",
        core: null,
        error: "could not reach releases.herdr.dev",
      });
      expect(result.code).toBe(1);
      expect(JSON.parse(result.io.out.join("\n"))).toEqual({
        runtime: "herdr-core",
        outcome: "failed",
        core: null,
        error: "could not reach releases.herdr.dev",
      });
      expect(result.io.err).toContain(
        "herdr-world herdr: could not reach releases.herdr.dev",
      );
    });

    test.each([[["upgrade", "--install"]], [["setup"]]])(
      "Windows: %s sets up herdr-core and never Herdr",
      async (args: string[]) => {
        const core =
          "C:\\Users\\example\\AppData\\Local\\Programs\\herdr-core\\herdr-core.exe";
        for (const outcome of [
          { outcome: "kept", core },
          { outcome: "set-up", core, installed: true },
        ] as LocalCoreSetup[]) {
          const result = await run(args, outcome, { platform: "win32" });
          expect(result.code).toBe(0);
          expect(result.coreCalls).toEqual([
            { setUp: args[0] === "setup", platform: "win32" },
          ]);
          expect(result.upgrades() + result.setups()).toBe(0);
          expect(result.io.out.join("\n")).not.toContain("World sets up Herdr");
          expect(result.io.out.at(-1)).toContain(
            "Install herdr-core on This computer",
          );
        }
      },
    );

    const keeps: Array<[string, Record<string, unknown>, string[]]> = [
      [
        "upgrade with an installed Herdr",
        { detect: herdrInstalled },
        ["upgrade", "--install"],
      ],
      ["setup with an installed Herdr", { detect: herdrInstalled }, ["setup"]],
      ["upgrade without --install", {}, ["upgrade"]],
      [
        "a remote default connection",
        {
          loadConfig: () =>
            ({ ...fakeConfig(), sshHost: "dev.example.com" }) as never,
        },
        ["upgrade", "--install"],
      ],
    ];
    test.each(keeps)("%s keeps the Herdr path", async (_name, extra, args) => {
      const result = await run(args, installed, extra);
      expect(result.coreCalls).toHaveLength(0);
      expect(result.upgrades() + result.setups()).toBe(1);
    });
  });

  test("upgrade --json prints the report and failed steps exit 1", async () => {
    const io = capture();
    const report = upgradeReport({
      plugin: {
        target: "ivoryheart.herdr-world",
        action: "failed",
        detail: "offline",
      },
    });
    const code = await runHerdrCommand(
      ["herdr", "upgrade", "--json"],
      "0.3.0",
      {
        ...io,
        loadConfig: () => fakeConfig() as never,
        serviceStatus: () => ({ installed: false, active: false }),
        upgrade: async () => report,
      },
    );
    expect(code).toBe(1);
    expect(JSON.parse(io.out.join("\n"))).toEqual(report);
  });

  test("a handoff that loses the server exits 1", async () => {
    const io = capture();
    const code = await runHerdrCommand(["herdr", "upgrade"], "0.3.0", {
      ...io,
      loadConfig: () => fakeConfig() as never,
      upgrade: async () =>
        upgradeReport({ server: { outcome: "lost", detail: "No server." } }),
    });
    expect(code).toBe(1);
    expect(io.out.at(-1)).toBe(
      "Not completed: Herdr server handoff. Run `herdr-world herdr upgrade` to retry.",
    );
  });

  test("rejects unknown options before doing anything", async () => {
    const io = capture();
    let upgrades = 0;
    for (const args of [
      ["herdr", "upgrade", "--force"],
      ["herdr", "setup", "--install"],
    ]) {
      expect(
        await runHerdrCommand(args, "0.3.0", {
          ...io,
          upgrade: async () => {
            upgrades += 1;
            return upgradeReport();
          },
        }),
      ).toBe(1);
    }
    expect(upgrades).toBe(0);
    expect(io.err.join("\n")).toContain(
      "unknown herdr upgrade option: --force",
    );
    expect(io.err.join("\n")).toContain(
      "unknown herdr setup option: --install",
    );
  });
});
