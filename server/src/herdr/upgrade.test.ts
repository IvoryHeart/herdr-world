import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  lstatSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  herdrDefaultBinaryPath,
  VERIFIED_HERDR_PROTOCOL,
  VERIFIED_HERDR_VERSION,
} from "./release";
import { detectServerSupervision } from "./supervision";
import {
  compareHerdrVersions,
  describeHerdrUpgrade,
  failedHerdrSteps,
  type HerdrUpgradeDeps,
  herdrUpgradeChangedAnything,
  isPublishedWorldVersion,
  parseIntegrationStates,
  pendingHerdrSteps,
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

/** Where Herdr World 0.2.6 installed Windows Herdr 0.9.4, outside PATH. */
function v026LegacyHerdr(appDataDir: string): string {
  return join(appDataDir, "herdr-world", "herdr", "0.9.4", "herdr.exe");
}

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

/** Harness commands on PATH, as empty executables. */
function harnessPath(...commands: string[]): string {
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
    handOff?: boolean;
    disappear?: boolean;
  } = {},
) {
  let running: string | null = version;
  const handoffs: Record<string, unknown>[] = [];
  return {
    handoffs,
    server: {
      socketPath: "/run/example/herdr.sock",
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
        if (options.disappear) running = null;
        else if (options.handOff ?? true) running = VERIFIED_HERDR_VERSION;
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
    supervision: async () => "unsupervised",
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

describe("isPublishedWorldVersion", () => {
  test("follows releases and published candidates, not previews or source builds", () => {
    for (const version of ["0.3.0", "0.3.0-rc.1", "1.0.0-rc.12"])
      expect(isPublishedWorldVersion(version)).toBe(true);
    for (const version of [
      "0.0.0-rc.42",
      "0.3.0-4-gabc1234",
      "0.3.0-dev",
      "v0.3.0",
    ])
      expect(isPublishedWorldVersion(version)).toBe(false);
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

  test("never replaces a version-manager shim", async () => {
    // mise puts links to its own executable on PATH, which then picks the
    // project's Herdr version.
    const root = scratch();
    const mise = join(root, "mise-bin", "mise");
    mkdirSync(join(root, "mise-bin"));
    writeFileSync(mise, fakeHerdr("0.9.3"), { mode: 0o755 });
    const shims = join(root, "share", "mise", "shims");
    mkdirSync(shims, { recursive: true });
    symlinkSync(mise, join(shims, "herdr"));
    const misePlan = planHerdrUpgrade(deps(scratch(), { pathEnv: shims }));
    expect(misePlan).toMatchObject({
      state: "package-managed",
      command: "mise upgrade herdr",
    });
    // Any link to a program that is not herdr is treated the same way.
    const other = join(root, "other");
    mkdirSync(other);
    symlinkSync(mise, join(other, "herdr"));
    expect(planHerdrUpgrade(deps(scratch(), { pathEnv: other }))).toMatchObject(
      {
        state: "package-managed",
      },
    );
    const report = await upgradeHerdr(
      deps(scratch(), { pathEnv: shims, integrations: false, plugin: false }),
    );
    expect(report.binary).toBe("unchanged");
    expect(lstatSync(join(shims, "herdr")).isSymbolicLink()).toBe(true);
  });

  test("leaves a binary alone when it reports no version", () => {
    const { homeDir, binaryPath } = installHerdr("0.9.3");
    writeFileSync(binaryPath, "#!/bin/sh\nexit 1\n");
    expect(planHerdrUpgrade(deps(homeDir))).toMatchObject({
      state: "unknown",
      binaryPath,
    });
  });

  test("on Windows upgrades only Herdr's own location or World's legacy copy", () => {
    const homeDir = scratch();
    const env = {
      platform: "win32",
      homeDir,
      localAppDataDir: join(homeDir, "Local"),
      appDataDir: join(homeDir, "Roaming"),
      pathEnv: "",
      readVersion: () => "herdr 0.9.3",
    };
    const place = (path: string) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "exe");
      return path;
    };
    const custom = place(join(homeDir, "tools", "herdr.exe"));
    expect(
      planHerdrUpgrade(deps(homeDir, { ...env, binPathEnv: custom })),
    ).toMatchObject({
      state: "unknown",
      binaryPath: custom,
    });
    // A real v0.2.6 layout: the managed copy is found off PATH.
    const legacy = place(v026LegacyHerdr(env.appDataDir));
    expect(planHerdrUpgrade(deps(homeDir, env))).toEqual({
      state: "outdated",
      binaryPath: legacy,
      version: "0.9.3",
      legacyWindows: true,
    });
    const official = place(herdrDefaultBinaryPath(env));
    expect(planHerdrUpgrade(deps(homeDir, env))).toEqual({
      state: "outdated",
      binaryPath: official,
      version: "0.9.3",
    });
    // install.ps1 puts the active release directory itself on PATH.
    const release = place(
      join(
        homeDir,
        ".herdr",
        "packages",
        "standalone",
        "releases",
        "0.9.3-x86_64-pc-windows-msvc",
        "herdr.exe",
      ),
    );
    expect(
      planHerdrUpgrade(deps(homeDir, { ...env, pathEnv: dirname(release) })),
    ).toEqual({ state: "outdated", binaryPath: release, version: "0.9.3" });
  });
});

describe("upgradeHerdr", () => {
  test("upgrades the binary, hands off the server, then harness integrations and the plugin", async () => {
    const { homeDir, binaryPath } = installHerdr("0.9.3");
    const { server, handoffs } = fakeServer("0.9.3");
    const cli = fakeCli();
    const report = await upgradeHerdr(
      deps(homeDir, {
        server,
        run: cli.run,
        pathEnv: `${join(homeDir, ".local", "bin")}:${harnessPath("codex", "claude")}`,
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
    // After an upgrade every present harness integration is reinstalled,
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
    expect(failedHerdrSteps(report)).toEqual([]);
    expect(describeHerdrUpgrade(report)).toEqual([
      `Upgraded Herdr 0.9.3 -> ${VERIFIED_HERDR_VERSION} at ${binaryPath}.`,
      `Previous Herdr binary: ${binaryPath}.previous`,
      "The running Herdr server handed its panes to the new version.",
      "codex harness integration: updated",
      "claude harness integration: updated",
      "Herdr World plugin: updated (v0.3.0)",
    ]);
  });

  for (const [name, options, supervision, reason] of [
    [
      "a server run by a service manager",
      {},
      "supervised",
      "runs under a service manager",
    ],
    [
      "a server whose supervisor is unknown",
      {},
      "unknown",
      "could not confirm",
    ],
    [
      "a server without live handoff",
      { liveHandoff: false },
      "unsupervised",
      "does not support live handoff",
    ],
    [
      "a failed handoff",
      { handOff: false },
      "unsupervised",
      "old server kept your panes",
    ],
  ] as const) {
    test(`reports a required restart for ${name} and keeps its panes`, async () => {
      const { homeDir } = installHerdr("0.9.3");
      const { server, handoffs } = fakeServer("0.9.3", options);
      const report = await upgradeHerdr(
        deps(homeDir, {
          server,
          run: fakeCli().run,
          supervision: async () => supervision,
        }),
      );
      expect(report.binary).toBe("upgraded");
      expect(report.server.outcome).toBe("restart-required");
      expect(report.server.detail).toContain(reason);
      expect(report.server.detail).toContain("ends running pane processes");
      expect(handoffs).toHaveLength("handOff" in options ? 1 : 0);
    });
  }

  test("detects an operator's own systemd unit through the real supervision probe", async () => {
    // Fake procfs: the server listening on the socket runs in herdr.service.
    const { homeDir } = installHerdr("0.9.3");
    const { server, handoffs } = fakeServer("0.9.3");
    const proc = scratch();
    mkdirSync(join(proc, "net"));
    writeFileSync(
      join(proc, "net", "unix"),
      `Num       RefCount Protocol Flags    Type St Inode Path\n0000: 00000002 00000000 00010000 0001 01 4242 ${server.socketPath}\n`,
    );
    mkdirSync(join(proc, "321", "fd"), { recursive: true });
    symlinkSync("socket:[4242]", join(proc, "321", "fd", "7"));
    writeFileSync(
      join(proc, "321", "cgroup"),
      "0::/user.slice/user-1.slice/user@1.service/app.slice/herdr.service\n",
    );
    const report = await upgradeHerdr(
      deps(homeDir, {
        server,
        run: fakeCli().run,
        supervision: (socketPath) =>
          detectServerSupervision(socketPath, {
            platform: "linux",
            procRoot: proc,
          }),
      }),
    );
    expect(report.server.outcome).toBe("restart-required");
    expect(report.server.detail).toContain("runs under a service manager");
    expect(handoffs).toEqual([]);
  });

  test("reports a handoff that leaves no server as a failure", async () => {
    const { homeDir } = installHerdr("0.9.3");
    const report = await upgradeHerdr(
      deps(homeDir, {
        server: fakeServer("0.9.3", { disappear: true }).server,
        run: fakeCli().run,
      }),
    );
    expect(report.server.outcome).toBe("lost");
    expect(failedHerdrSteps(report)).toEqual(["Herdr server handoff"]);
    expect(describeHerdrUpgrade(report).at(-1)).toBe(
      "Not completed: Herdr server handoff. Run `herdr-world herdr upgrade` to retry.",
    );
  });

  test("never hands a newer or unidentified server to the verified release", async () => {
    const { homeDir } = installHerdr(VERIFIED_HERDR_VERSION);
    for (const [running, detail] of [
      ["0.10.0", "is newer than"],
      ["not-a-version", "did not report a version"],
    ]) {
      const { server, handoffs } = fakeServer(running);
      const report = await upgradeHerdr(
        deps(homeDir, { server, integrations: false, plugin: false }),
      );
      expect(report.server.outcome).toBe("left-unchanged");
      expect(report.server.detail).toContain(detail);
      expect(handoffs).toEqual([]);
    }
  });

  test("never hands off on Windows and moves World's legacy Herdr with its task", async () => {
    const homeDir = scratch();
    const env = {
      platform: "win32",
      homeDir,
      localAppDataDir: join(homeDir, "Local"),
      appDataDir: join(homeDir, "Roaming"),
      pathEnv: "",
    };
    const legacy = v026LegacyHerdr(env.appDataDir);
    mkdirSync(dirname(legacy), { recursive: true });
    writeFileSync(legacy, "legacy exe");
    const official = herdrDefaultBinaryPath(env);
    const rebinds: string[][] = [];
    const { server, handoffs } = fakeServer("0.9.3");
    const report = await upgradeHerdr(
      deps(homeDir, {
        ...env,
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
          mkdirSync(dirname(official), { recursive: true });
          writeFileSync(official, "new exe");
          return 0;
        },
        readVersion: (path) =>
          `herdr ${path === official ? VERIFIED_HERDR_VERSION : "0.9.3"}`,
        rebindTask: (from, to) => {
          rebinds.push([from, to]);
          return true;
        },
      }),
    );
    expect(report).toMatchObject({
      binary: "upgraded",
      binaryPath: official,
      migratedFrom: legacy,
      taskRebound: true,
      server: { outcome: "restart-required" },
    });
    expect(rebinds).toEqual([[legacy, official]]);
    expect(await Bun.file(legacy).text()).toBe("legacy exe");
    expect(report.server.detail).toContain("no live handoff on Windows");
    expect(handoffs).toEqual([]);
    const lines = describeHerdrUpgrade(report);
    expect(lines).toContain(
      `Moved Herdr to Herdr's default location. The copy older Herdr World releases installed stays at ${dirname(legacy)} as a backup; delete it once Herdr ${VERIFIED_HERDR_VERSION} works.`,
    );
    expect(lines).toContain(
      "Herdr World's Herdr task now starts the new location at the next logon or restart.",
    );
  });

  test("a Windows upgrade that moves Herdr repoints World's task, legacy or not", async () => {
    // install.ps1 puts its active release directory on PATH, and herdr setup
    // may have registered World's task with that absolute path.
    for (const fromRelease of [true, false]) {
      const homeDir = scratch();
      const env = {
        platform: "win32",
        homeDir,
        localAppDataDir: join(homeDir, "Local"),
        appDataDir: join(homeDir, "Roaming"),
      };
      const official = herdrDefaultBinaryPath(env);
      const release = join(
        homeDir,
        ".herdr",
        "packages",
        "standalone",
        "releases",
        "0.9.3-x86_64-pc-windows-msvc",
        "herdr.exe",
      );
      const found = fromRelease ? release : official;
      mkdirSync(dirname(found), { recursive: true });
      writeFileSync(found, "old exe");
      const rebinds: string[][] = [];
      let installed = false;
      const report = await upgradeHerdr(
        deps(homeDir, {
          ...env,
          pathEnv: dirname(found),
          integrations: false,
          plugin: false,
          expectedInstallerSha256: createHash("sha256")
            .update("ps1")
            .digest("hex"),
          download: async (url, path) =>
            writeFileSync(
              path,
              url.endsWith("install.ps1") ? "ps1" : verifiedBinary,
            ),
          runCommand: () => {
            mkdirSync(dirname(official), { recursive: true });
            writeFileSync(official, "new exe");
            installed = true;
            return 0;
          },
          readVersion: () =>
            `herdr ${installed ? VERIFIED_HERDR_VERSION : "0.9.3"}`,
          rebindTask: (from, to) => {
            rebinds.push([from, to]);
            return true;
          },
        }),
      );
      expect(report).toMatchObject({
        binary: "upgraded",
        binaryPath: official,
      });
      expect(report.migratedFrom).toBeUndefined();
      if (fromRelease) {
        expect(rebinds).toEqual([[release, official]]);
        expect(report.taskRebound).toBe(true);
        expect(describeHerdrUpgrade(report)).toContain(
          `Herdr World's Herdr task now starts ${official} instead of ${release} at the next logon or restart.`,
        );
      } else {
        // Already at the default location: nothing moves, no task changes.
        expect(rebinds).toEqual([]);
        expect(report.taskRebound).toBeUndefined();
      }
    }
  });

  test("a current Herdr only installs missing or outdated harness integrations", async () => {
    const { homeDir } = installHerdr(VERIFIED_HERDR_VERSION);
    const cli = fakeCli({ plugins: pluginList("0.3.0") });
    const report = await upgradeHerdr(
      deps(homeDir, {
        server: fakeServer(VERIFIED_HERDR_VERSION).server,
        run: cli.run,
        pathEnv: harnessPath("codex", "claude", "pi"),
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
      "claude harness integration: updated",
    ]);
  });

  test("a World update that keeps the same Herdr still pins the plugin to the new release", async () => {
    const { homeDir } = installHerdr(VERIFIED_HERDR_VERSION);
    const options = {
      server: fakeServer(VERIFIED_HERDR_VERSION).server,
      pathEnv: harnessPath("claude"),
      binPathEnv: join(homeDir, ".local", "bin", "herdr"),
    };
    const pending = await pendingHerdrSteps(
      join(homeDir, ".local", "bin", "herdr"),
      deps(homeDir, { ...options, run: fakeCli().run }),
    );
    expect(pending).toEqual(["claude", WORLD_PLUGIN_ID]);
    const cli = fakeCli();
    const report = await upgradeHerdr(
      deps(homeDir, { ...options, run: cli.run }),
    );
    expect(report.binary).toBe("unchanged");
    expect(report.plugin).toMatchObject({
      action: "updated",
      detail: "v0.3.0",
    });
    expect(herdrUpgradeChangedAnything(report)).toBe(true);
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

  test("leaves a newer Herdr untouched", async () => {
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
    expect(herdrUpgradeChangedAnything(report)).toBe(false);
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

  test("the plugin follows published World releases and candidates from GitHub only", async () => {
    const { homeDir } = installHerdr(VERIFIED_HERDR_VERSION);
    const rc = fakeCli();
    expect(
      (
        await upgradeHerdr(
          deps(homeDir, {
            worldVersion: "0.3.0-rc.1",
            run: rc.run,
            integrations: false,
          }),
        )
      ).plugin,
    ).toEqual({
      target: WORLD_PLUGIN_ID,
      action: "updated",
      detail: "v0.3.0-rc.1",
    });
    expect(rc.calls.at(-1)).toEqual([
      "plugin",
      "install",
      "IvoryHeart/herdr-world",
      "--ref",
      "v0.3.0-rc.1",
      "--yes",
    ]);
    for (const [worldVersion, plugins, action, detail] of [
      ["0.3.0", pluginList("0.2.6", "local"), "skipped", "locally linked"],
      [
        "0.0.0-rc.42",
        pluginList("0.2.6"),
        "skipped",
        "Herdr World 0.0.0-rc.42 is not a published release",
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

  test("reports harness integration and plugin failures without hiding the upgrade", async () => {
    const { homeDir } = installHerdr("0.9.3");
    const report = await upgradeHerdr(
      deps(homeDir, {
        run: fakeCli({ fail: ["integration install codex", "plugin install"] })
          .run,
        pathEnv: `${join(homeDir, ".local", "bin")}:${harnessPath("codex")}`,
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
    expect(failedHerdrSteps(report)).toEqual([
      "codex harness integration",
      "Herdr World plugin",
    ]);
  });
});
