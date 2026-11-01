import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupHerdr } from "./bootstrap";
import { runHerdrCommand } from "./cli";
import { VERIFIED_HERDR_VERSION } from "./release";
import type { HerdrUpgradeReport } from "./upgrade";

function fakeConfig() {
  return {
    sshHost: undefined,
    session: undefined,
    hasExplicitSocketPath: false,
    hasExplicitClientSocketPath: false,
    socketPath: "/tmp/test-herdr.sock",
  };
}

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
