import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { VERIFIED_HERDR_PROTOCOL, VERIFIED_HERDR_VERSION } from "./release";
import {
  compareHerdrVersions,
  describeHerdrUpgrade,
  type HerdrUpgradeDeps,
  parseIntegrationStates,
  planHerdrUpgrade,
  upgradeHerdr,
  WORLD_PLUGIN_ID,
} from "./upgrade";

const trash: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "herdr-world-herdr-upgrade-"));
  trash.push(dir);
  return dir;
}
afterEach(() => {
  while (trash.length) {
    const dir = trash.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/** A fake Herdr binary: a shell script that reports a version. */
function fakeHerdr(version: string): string {
  return `#!/bin/sh\necho "herdr ${version}"\n`;
}
const verifiedBinary = fakeHerdr(VERIFIED_HERDR_VERSION);
const verifiedSha256 = createHash("sha256")
  .update(verifiedBinary)
  .digest("hex");

function installHerdr(version: string) {
  const homeDir = scratch();
  const bin = join(homeDir, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  const binaryPath = join(bin, "herdr");
  writeFileSync(binaryPath, fakeHerdr(version), { mode: 0o755 });
  return { homeDir, binaryPath };
}

/** Agent commands on PATH, as empty executables. */
function agentPath(...commands: string[]): string {
  const dir = scratch();
  for (const command of commands)
    writeFileSync(join(dir, command), "", { mode: 0o755 });
  return dir;
}

const STATUS = [
  "pi: current (v9) (/home/example/.pi/agent/extensions/herdr-agent-state.ts)",
  "claude: outdated (v9 < v10) (/home/example/.claude/hooks/herdr-agent-state.sh)",
  "codex: current (v8) (/home/example/.codex/herdr-agent-state.sh)",
  "omp: not installed (/home/example/.omp/agent/extensions/herdr-omp-agent-state.ts)",
  "letta (experimental): not installed (/home/example/.letta/hooks/herdr-agent-session.sh)",
].join("\n");

function pluginList(version: string, kind = "github") {
  return JSON.stringify({
    id: "cli:plugin",
    result: {
      plugins: [
        { plugin_id: "other.plugin", version: "1.0.0", source: { kind } },
        { plugin_id: WORLD_PLUGIN_ID, version, source: { kind } },
      ],
    },
  });
}

/** Records Herdr CLI calls and answers status/list from fixtures. */
function fakeCli(
  options: { status?: string; plugins?: string; fail?: string[] } = {},
) {
  const calls: string[][] = [];
  const run: HerdrUpgradeDeps["run"] = async (argv) => {
    calls.push(argv.slice(1));
    const verb = argv.slice(1).join(" ");
    if (options.fail?.some((prefix) => verb.startsWith(prefix)))
      return { code: 1, stdout: "", stderr: `${verb} failed` };
    if (verb === "integration status")
      return { code: 0, stdout: options.status ?? STATUS, stderr: "" };
    if (verb === "plugin list --json")
      return {
        code: 0,
        stdout: options.plugins ?? pluginList("0.2.6"),
        stderr: "",
      };
    return { code: 0, stdout: "", stderr: "" };
  };
  return { calls, run };
}

/** A local Herdr server that serves `version` and may hand off. */
function fakeServer(
  version: string,
  options: {
    liveHandoff?: boolean;
    supervised?: boolean;
    handOff?: boolean;
  } = {},
) {
  let running: string | null = version;
  const handoffs: Record<string, unknown>[] = [];
  return {
    handoffs,
    server: {
      supervised: options.supervised ?? false,
      ping: async () => {
        if (!running) throw new Error("ENOENT");
        return {
          version: running,
          protocol: 22,
          capabilities: { live_handoff: options.liveHandoff ?? true },
        };
      },
      call: async (method: string, params: Record<string, unknown>) => {
        expect(method).toBe("server.live_handoff");
        handoffs.push(params);
        if (options.handOff ?? true) running = VERIFIED_HERDR_VERSION;
        // The old server closes the request connection as it exits.
        throw new Error("ECONNRESET");
      },
    },
  };
}

function deps(
  homeDir: string,
  overrides: Partial<HerdrUpgradeDeps> = {},
): HerdrUpgradeDeps {
  return {
    worldVersion: "0.3.0",
    platform: "linux",
    arch: "x64",
    homeDir,
    binPathEnv: "",
    installDir: undefined,
    pathEnv: join(homeDir, ".local", "bin"),
    expectedSha256: verifiedSha256,
    download: async (_url, path) => writeFileSync(path, verifiedBinary),
    sleep: () => Promise.resolve(),
    handoffConfirmTimeoutMs: 0,
    ...overrides,
  };
}

describe("compareHerdrVersions", () => {
  test("orders releases and pre-releases", () => {
    expect(compareHerdrVersions("0.9.3", "0.9.5")).toBeLessThan(0);
    expect(compareHerdrVersions("0.10.0", "0.9.5")).toBeGreaterThan(0);
    expect(compareHerdrVersions("0.9.5", "0.9.5")).toBe(0);
    expect(compareHerdrVersions("0.9.5-rc.1", "0.9.5")).toBeLessThan(0);
  });
});

describe("parseIntegrationStates", () => {
  test("reads Herdr's status lines, including experimental targets", () => {
    expect([...parseIntegrationStates(STATUS)]).toEqual([
      ["pi", "current"],
      ["claude", "outdated"],
      ["codex", "current"],
      ["omp", "not installed"],
      ["letta", "not installed"],
    ]);
  });
});

describe("planHerdrUpgrade", () => {
  test("classifies installed versions against the verified release", () => {
    expect(planHerdrUpgrade(deps(scratch()))).toEqual({ state: "missing" });
    for (const [version, state] of [
      ["0.9.3", "outdated"],
      [VERIFIED_HERDR_VERSION, "current"],
      ["0.10.0", "newer"],
    ] as const) {
      const { homeDir, binaryPath } = installHerdr(version);
      expect(planHerdrUpgrade(deps(homeDir))).toEqual({
        state,
        binaryPath,
        version,
      });
    }
  });

  test("defers package-manager installs to their manager", () => {
    const root = scratch();
    const cellar = join(root, "Cellar", "herdr", "0.9.3", "bin");
    mkdirSync(cellar, { recursive: true });
    writeFileSync(join(cellar, "herdr"), fakeHerdr("0.9.3"), { mode: 0o755 });
    const bin = join(root, "bin");
    mkdirSync(bin);
    symlinkSync(join(cellar, "herdr"), join(bin, "herdr"));
    expect(planHerdrUpgrade(deps(scratch(), { pathEnv: bin }))).toEqual({
      state: "package-managed",
      binaryPath: join(bin, "herdr"),
      version: "0.9.3",
      command: "brew update && brew upgrade herdr",
    });
  });

  test("leaves a binary alone when it reports no version", () => {
    const { homeDir, binaryPath } = installHerdr("0.9.3");
    writeFileSync(binaryPath, "#!/bin/sh\nexit 1\n");
    expect(planHerdrUpgrade(deps(homeDir))).toMatchObject({
      state: "unknown",
      binaryPath,
    });
  });
});

describe("upgradeHerdr", () => {
  test("upgrades the binary, hands off the server, then integrations and the plugin", async () => {
    const { homeDir, binaryPath } = installHerdr("0.9.3");
    const { server, handoffs } = fakeServer("0.9.3");
    const cli = fakeCli();
    const report = await upgradeHerdr(
      deps(homeDir, {
        server,
        run: cli.run,
        pathEnv: `${join(homeDir, ".local", "bin")}:${agentPath("codex", "claude")}`,
      }),
    );
    expect(report).toMatchObject({
      binary: "upgraded",
      binaryPath,
      version: VERIFIED_HERDR_VERSION,
      backupPath: `${binaryPath}.previous`,
      server: { outcome: "handed-off" },
    });
    expect(await Bun.file(binaryPath).text()).toBe(verifiedBinary);
    expect(await Bun.file(`${binaryPath}.previous`).text()).toBe(
      fakeHerdr("0.9.3"),
    );
    expect(handoffs).toEqual([
      {
        import_exe: binaryPath,
        expected_version: VERIFIED_HERDR_VERSION,
        expected_protocol: VERIFIED_HERDR_PROTOCOL,
      },
    ]);
    // After an upgrade every present agent's integration is reinstalled,
    // including a "current" Codex; Pi is not on PATH.
    expect(report.integrations).toEqual([
      { target: "codex", action: "updated" },
      { target: "claude", action: "updated" },
    ]);
    expect(report.plugin).toEqual({
      target: WORLD_PLUGIN_ID,
      action: "updated",
      detail: "v0.3.0",
    });
    expect(cli.calls).toEqual([
      ["integration", "status"],
      ["integration", "install", "codex"],
      ["integration", "install", "claude"],
      ["plugin", "list", "--json"],
      [
        "plugin",
        "install",
        "IvoryHeart/herdr-world",
        "--ref",
        "v0.3.0",
        "--yes",
      ],
    ]);
    expect(describeHerdrUpgrade(report)).toEqual([
      `Upgraded Herdr 0.9.3 -> ${VERIFIED_HERDR_VERSION} at ${binaryPath}.`,
      `Previous Herdr binary: ${binaryPath}.previous`,
      "The running Herdr server handed its panes to the new version.",
      "Integration codex: updated",
      "Integration claude: updated",
      "Herdr World plugin: updated (v0.3.0)",
    ]);
  });

  for (const [name, options, reason] of [
    ["a supervised server", { supervised: true }, "supervised service"],
    [
      "a server without live handoff",
      { liveHandoff: false },
      "does not support live handoff",
    ],
    ["a failed handoff", { handOff: false }, "old server kept your panes"],
  ] as const) {
    test(`reports a required restart for ${name} and keeps its panes`, async () => {
      const { homeDir } = installHerdr("0.9.3");
      const { server, handoffs } = fakeServer("0.9.3", options);
      const report = await upgradeHerdr(
        deps(homeDir, { server, run: fakeCli().run }),
      );
      expect(report.binary).toBe("upgraded");
      expect(report.server.outcome).toBe("restart-required");
      expect(report.server.detail).toContain(reason);
      expect(report.server.detail).toContain("ends running pane processes");
      expect(handoffs).toHaveLength("handOff" in options ? 1 : 0);
    });
  }

  test("never hands off on Windows", async () => {
    const homeDir = scratch();
    const localAppDataDir = join(homeDir, "Local");
    const binDir = join(localAppDataDir, "Programs", "Herdr", "bin");
    mkdirSync(binDir, { recursive: true });
    const binaryPath = join(binDir, "herdr.exe");
    writeFileSync(binaryPath, "exe");
    let installed = false;
    const { server, handoffs } = fakeServer("0.9.3");
    const report = await upgradeHerdr(
      deps(homeDir, {
        platform: "win32",
        localAppDataDir,
        pathEnv: "",
        server,
        run: fakeCli().run,
        expectedInstallerSha256: createHash("sha256")
          .update("ps1")
          .digest("hex"),
        download: async (url, path) =>
          writeFileSync(
            path,
            url.endsWith("install.ps1") ? "ps1" : verifiedBinary,
          ),
        runCommand: () => {
          installed = true;
          return 0;
        },
        readVersion: () =>
          `herdr ${installed ? VERIFIED_HERDR_VERSION : "0.9.3"}`,
      }),
    );
    expect(report).toMatchObject({
      binary: "upgraded",
      binaryPath,
      server: { outcome: "restart-required" },
    });
    expect(report.server.detail).toContain("no live handoff on Windows");
    expect(handoffs).toEqual([]);
  });

  test("a current Herdr only installs missing or outdated integrations", async () => {
    const { homeDir } = installHerdr(VERIFIED_HERDR_VERSION);
    const cli = fakeCli({ plugins: pluginList("0.3.0") });
    const report = await upgradeHerdr(
      deps(homeDir, {
        server: fakeServer(VERIFIED_HERDR_VERSION).server,
        run: cli.run,
        pathEnv: agentPath("codex", "claude", "pi"),
        binPathEnv: join(homeDir, ".local", "bin", "herdr"),
      }),
    );
    expect(report).toMatchObject({
      binary: "unchanged",
      version: VERIFIED_HERDR_VERSION,
      server: { outcome: "current" },
      plugin: { action: "current" },
    });
    expect(report.integrations).toEqual([
      { target: "codex", action: "current" },
      { target: "claude", action: "updated" },
      { target: "pi", action: "current" },
    ]);
    expect(describeHerdrUpgrade(report)).toEqual([
      `Herdr ${VERIFIED_HERDR_VERSION} is the version this Herdr World recommends.`,
      "Integration claude: updated",
    ]);
  });

  test("hands off a server left on an older version by an earlier upgrade", async () => {
    const { homeDir } = installHerdr(VERIFIED_HERDR_VERSION);
    const { server, handoffs } = fakeServer("0.9.3");
    const report = await upgradeHerdr(
      deps(homeDir, { server, integrations: false, plugin: false }),
    );
    expect(report.server.outcome).toBe("handed-off");
    expect(handoffs).toHaveLength(1);
  });

  test("leaves a newer or package-managed Herdr untouched", async () => {
    const { homeDir, binaryPath } = installHerdr("0.10.0");
    const { server, handoffs } = fakeServer("0.10.0");
    const report = await upgradeHerdr(
      deps(homeDir, { server, integrations: false, plugin: false }),
    );
    expect(report).toMatchObject({
      binary: "unchanged",
      server: { outcome: "skipped" },
    });
    expect(handoffs).toEqual([]);
    expect(await Bun.file(binaryPath).text()).toBe(fakeHerdr("0.10.0"));
    expect(describeHerdrUpgrade(report)).toEqual([
      `Herdr 0.10.0 is newer than the ${VERIFIED_HERDR_VERSION} this Herdr World verified; it was left unchanged.`,
    ]);
  });

  test("installs a missing Herdr only when asked", async () => {
    const homeDir = scratch();
    const binaryPath = join(homeDir, ".local", "bin", "herdr");
    expect(
      await upgradeHerdr(deps(homeDir, { integrations: false, plugin: false })),
    ).toMatchObject({ binary: "unchanged", before: { state: "missing" } });
    expect(existsSync(binaryPath)).toBe(false);
    const report = await upgradeHerdr(
      deps(homeDir, {
        installMissing: true,
        server: fakeServer("0.9.3").server,
        run: fakeCli({ status: "" }).run,
      }),
    );
    expect(report).toMatchObject({
      binary: "installed",
      binaryPath,
      version: VERIFIED_HERDR_VERSION,
    });
    expect(await Bun.file(binaryPath).text()).toBe(verifiedBinary);
  });

  test("the plugin follows published World releases from GitHub only", async () => {
    const { homeDir } = installHerdr(VERIFIED_HERDR_VERSION);
    for (const [worldVersion, plugins, action, detail] of [
      ["0.3.0", pluginList("0.2.6", "local"), "skipped", "locally linked"],
      [
        "0.3.0-rc.1",
        pluginList("0.2.6"),
        "skipped",
        "Herdr World 0.3.0-rc.1 is not a published release",
      ],
      [
        "0.3.0",
        JSON.stringify({ result: { plugins: [] } }),
        "skipped",
        "not installed",
      ],
    ] as const) {
      const cli = fakeCli({ plugins });
      const report = await upgradeHerdr(
        deps(homeDir, { worldVersion, run: cli.run, integrations: false }),
      );
      expect(report.plugin).toEqual({
        target: WORLD_PLUGIN_ID,
        action,
        detail,
      });
      expect(cli.calls).toEqual([["plugin", "list", "--json"]]);
    }
  });

  test("reports integration and plugin failures without hiding the upgrade", async () => {
    const { homeDir } = installHerdr("0.9.3");
    const report = await upgradeHerdr(
      deps(homeDir, {
        run: fakeCli({ fail: ["integration install codex", "plugin install"] })
          .run,
        pathEnv: `${join(homeDir, ".local", "bin")}:${agentPath("codex")}`,
      }),
    );
    expect(report.binary).toBe("upgraded");
    expect(report.integrations).toEqual([
      {
        target: "codex",
        action: "failed",
        detail: "integration install codex failed",
      },
    ]);
    expect(report.plugin).toMatchObject({ action: "failed" });
  });
});
