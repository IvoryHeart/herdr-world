import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from "./command";
import {
  type ConnectionsDependencies,
  createConnectionsCommand,
} from "./connections";
import { runCli } from "./index";
import { createTestCli, type TestCli } from "./test-context";

let cli: TestCli;
afterEach(() => cli?.cleanup());

const idle: ConnectionsDependencies = {
  probe: async () => false,
  herdrInstalled: async () => true,
};

function registry(testCli: TestCli) {
  return JSON.parse(
    readFileSync(
      join(testCli.home, ".config", "herdr-world", "connections.json"),
      "utf8",
    ),
  );
}

async function connections(args: string[], dependencies = idle) {
  return runCli(["connections", ...args], cli.context, [
    createConnectionsCommand(dependencies),
  ]);
}

describe("herdr-world connections", () => {
  test("lists the implicit default from the service config", async () => {
    cli = createTestCli();
    cli.writeConfig("");
    expect(await connections(["list", "--json"])).toBe(EXIT_OK);
    const listed = JSON.parse(cli.output.join("\n"));
    expect(listed.default_connection_id).toBe("startup-default");
    expect(listed.profiles[0]).toMatchObject({
      saved: false,
      control_socket_path: join(cli.home, ".config", "herdr", "herdr.sock"),
    });
  });

  test("the first saved profile keeps the local server, like the web UI", async () => {
    cli = createTestCli();
    cli.writeConfig("");
    expect(
      await connections([
        "add",
        "box",
        "--ssh",
        "me@box",
        "--label",
        "Box",
        "--auto-connect",
      ]),
    ).toBe(EXIT_OK);
    const saved = registry(cli);
    expect(saved.default_connection_id).toBe("local");
    expect(saved.profiles.map((profile: { id: string }) => profile.id)).toEqual(
      ["local", "box"],
    );
    expect(saved.profiles[1]).toEqual({
      id: "box",
      label: "Box",
      type: "ssh",
      ssh_destination: "me@box",
      remote_control_socket_path: "",
      remote_client_socket_path: "",
      auto_connect: true,
    });
  });

  test("a new profile named local seeds localhost instead", async () => {
    cli = createTestCli();
    cli.writeConfig("");
    await connections(["add", "local", "--ssh", "me@box", "--default"]);
    const saved = registry(cli);
    expect(saved.profiles[0].id).toBe("localhost");
    expect(saved.default_connection_id).toBe("local");
  });

  test("--core saves a herdr-core connection; the default stays Herdr", async () => {
    cli = createTestCli();
    cli.writeConfig("");
    expect(
      await connections([
        "add",
        "core-local",
        "--core",
        "--auto-connect",
        "--label",
        "herdr-core on this computer",
      ]),
    ).toBe(EXIT_OK);
    expect(
      await connections([
        "add",
        "core-dev",
        "--core",
        "--ssh",
        "dev.example.com",
        "--session",
        "work",
      ]),
    ).toBe(EXIT_OK);
    const saved = registry(cli);
    expect(saved.default_connection_id).toBe("local");
    expect(saved.profiles.slice(1)).toEqual([
      {
        id: "core-local",
        label: "herdr-core on this computer",
        type: "local",
        runtime: "herdr-core",
        core_session: "default",
        core_state_dir: "",
        auto_connect: true,
      },
      {
        id: "core-dev",
        label: "core-dev",
        type: "ssh",
        runtime: "herdr-core",
        ssh_destination: "dev.example.com",
        core_session: "work",
        core_state_dir: "",
        auto_connect: false,
      },
    ]);
    for (const extra of [["--windows"], ["--herdr-path", "/x"]])
      expect(await connections(["add", "c", "--core", ...extra])).toBe(
        EXIT_USAGE,
      );
  });

  test("the installers' core registration on a computer without the Herdr TUI saves core alone, as the default", async () => {
    // The exact arguments the standalone installer and Homebrew run (#935).
    const bootstrap = readFileSync(
      join(import.meta.dir, "../../../scripts/homebrew-herdr-bootstrap.sh"),
      "utf8",
    );
    const line = bootstrap.match(
      /"\$world" connections add (core-local [^>]*?) >\/dev\/null/,
    )?.[1];
    expect(line).toBeDefined();
    const args = line!
      .match(/'[^']*'|\S+/g)!
      .map((word) => word.replace(/^'|'$/g, ""));
    for (const installed of [false, true]) {
      cli = createTestCli();
      cli.writeConfig("");
      const asked: string[] = [];
      expect(
        await connections(["add", ...args], {
          ...idle,
          herdrInstalled: async (implicit) => {
            asked.push(implicit.control_socket_path);
            return installed;
          },
        }),
      ).toBe(EXIT_OK);
      expect(asked).toEqual([join(cli.home, ".config", "herdr", "herdr.sock")]);
      const saved = registry(cli);
      expect(saved.default_connection_id).toBe("core-local");
      // A Herdr TUI, should one be present after all, stays listed.
      expect(
        saved.profiles.map((profile: { id: string }) => profile.id),
      ).toEqual(installed ? ["local", "core-local"] : ["core-local"]);
      cli.cleanup();
    }
    // Without --default and without the Herdr TUI, core is still the default:
    // there is no Herdr connection to be one.
    cli = createTestCli();
    cli.writeConfig("");
    expect(
      await connections(["add", "core-local", "--core"], {
        ...idle,
        herdrInstalled: async () => false,
      }),
    ).toBe(EXIT_OK);
    expect(registry(cli)).toMatchObject({
      default_connection_id: "core-local",
      profiles: [{ id: "core-local", runtime: "herdr-core" }],
    });
  });

  test("enforces the same removal and default rules as the server", async () => {
    cli = createTestCli();
    cli.writeConfig("");
    await connections(["add", "box", "--ssh", "me@box"]);
    expect(await connections(["remove", "local"])).toBe(EXIT_USAGE);
    expect(cli.errors.at(-2)).toContain("cannot remove the default connection");
    expect(await connections(["set-default", "box"])).toBe(EXIT_OK);
    expect(await connections(["remove", "local"])).toBe(EXIT_OK);
    // The last saved profile is always the default, as on the server.
    expect(await connections(["remove", "box"])).toBe(EXIT_USAGE);
    expect(cli.errors.at(-2)).toContain("cannot remove the default connection");
    expect(await connections(["add", "box", "--ssh", "me@other"])).toBe(
      EXIT_USAGE,
    );
    expect(cli.errors.at(-2)).toContain("already exists");
  });

  test("rejects invalid profiles as usage errors", async () => {
    cli = createTestCli();
    cli.writeConfig("");
    expect(await connections(["add", "x"])).toBe(EXIT_USAGE);
    expect(
      await connections(["add", "x", "--windows", "--control-socket", "/a"]),
    ).toBe(EXIT_USAGE);
    expect(
      await connections(["add", "x", "--ssh", "-oProxyCommand=evil"]),
    ).toBe(EXIT_USAGE);
    expect(
      existsSync(join(cli.home, ".config", "herdr-world", "connections.json")),
    ).toBe(false);
  });

  test.each(["127.0.0.1", "localhost", "::1", "0.0.0.0", "::"])(
    "sends running-service edits on %s through live admission without writing locally",
    async (host) => {
      cli = createTestCli();
      cli.writeConfig(`HOST=${host}\n`);
      const calls: unknown[] = [];
      const serving: ConnectionsDependencies = {
        probe: async () => true,
        applyLive: async (_context, _setup, change) => {
          calls.push(change);
        },
      };
      expect(
        await connections(
          ["add", "box", "--ssh", "box.example", "--default"],
          serving,
        ),
      ).toBe(EXIT_OK);
      // These IDs need not exist in the CLI's stale disk snapshot.
      expect(await connections(["set-default", "from-settings"], serving)).toBe(
        EXIT_OK,
      );
      expect(await connections(["remove", "from-settings"], serving)).toBe(
        EXIT_OK,
      );
      expect(calls).toMatchObject([
        { action: "add", profile: { id: "box" }, make_default: true },
        { action: "set-default", id: "from-settings" },
        { action: "remove", id: "from-settings" },
      ]);
      expect(
        existsSync(
          join(cli.home, ".config", "herdr-world", "connections.json"),
        ),
      ).toBe(false);
      expect(cli.commands).toEqual([]);
    },
  );

  test("never falls back to a disk edit after live admission fails", async () => {
    cli = createTestCli();
    cli.writeConfig("");
    expect(
      await connections(["add", "box", "--ssh", "box.example", "--restart"], {
        probe: async () => true,
        applyLive: async () => {
          throw new Error("service refused this change");
        },
      }),
    ).toBe(EXIT_FAILURE);
    expect(cli.errors.join("\n")).toContain("service refused this change");
    expect(
      existsSync(join(cli.home, ".config", "herdr-world", "connections.json")),
    ).toBe(false);
    expect(cli.commands).toEqual([]);
  });

  for (const host of ["192.0.2.10", "2001:db8::10"]) {
    for (const action of ["add", "remove", "set-default"]) {
      test(`${action} on ${host} requires --restart without changing the registry`, async () => {
        cli = createTestCli();
        cli.writeConfig(`HOST=${host}\n`);
        await connections(["add", "existing", "--ssh", "existing.example"]);
        const before = registry(cli);
        const args =
          action === "add"
            ? [action, "box", "--ssh", "box.example"]
            : [action, "existing"];
        expect(await connections(args, { probe: async () => true })).toBe(
          EXIT_USAGE,
        );
        expect(cli.errors.join("\n")).toContain("--restart");
        expect(registry(cli)).toEqual(before);
        expect(cli.commands).toEqual([]);
      });

      test(`${action} on ${host} saves then restarts with --restart`, async () => {
        let savedAtRestart: unknown;
        cli = createTestCli({
          runCommand: (argv) => {
            if (argv.includes("herdr-gui.service")) return 4;
            if (argv.includes("restart")) savedAtRestart = registry(cli);
            return 0;
          },
        });
        cli.writeConfig(`HOST=${host}\n`);
        mkdirSync(join(cli.home, ".config", "systemd", "user"), {
          recursive: true,
        });
        writeFileSync(
          join(cli.home, ".config", "systemd", "user", "herdr-world.service"),
          "# Generated by herdr-world service install.\n",
        );
        await connections(["add", "existing", "--ssh", "existing.example"]);
        const args =
          action === "add"
            ? [action, "box", "--ssh", "box.example", "--auto-connect"]
            : [action, "existing"];
        const liveCalls: unknown[] = [];
        expect(
          await connections([...args, "--restart"], {
            probe: async () => true,
            applyLive: async (_context, _setup, change) => {
              liveCalls.push(change);
            },
          }),
        ).toBe(EXIT_OK);
        expect(liveCalls).toEqual([]);
        const saved = registry(cli);
        expect(savedAtRestart).toEqual(saved);
        expect(saved.default_connection_id).toBe(
          action === "set-default" ? "existing" : "local",
        );
        expect(
          saved.profiles.map((profile: { id: string }) => profile.id),
        ).toEqual(
          action === "add"
            ? ["local", "existing", "box"]
            : action === "remove"
              ? ["local"]
              : ["local", "existing"],
        );
        if (action === "add") expect(saved.profiles[2].auto_connect).toBe(true);
        expect(cli.commands.filter((argv) => argv.includes("restart"))).toEqual(
          [["systemctl", "--user", "restart", "herdr-world.service"]],
        );
      });
    }
  }

  test("--restart still restarts a running managed service after live admission", async () => {
    cli = createTestCli({
      runCommand: (argv) => (argv.includes("herdr-gui.service") ? 4 : 0),
    });
    cli.writeConfig("");
    mkdirSync(join(cli.home, ".config", "systemd", "user"), {
      recursive: true,
    });
    writeFileSync(
      join(cli.home, ".config", "systemd", "user", "herdr-world.service"),
      "# Generated by herdr-world service install.\n",
    );
    const calls: unknown[] = [];
    expect(
      await connections(["add", "box", "--ssh", "box.example", "--restart"], {
        probe: async () => true,
        applyLive: async (_context, _setup, change) => {
          calls.push(change);
        },
      }),
    ).toBe(EXIT_OK);
    expect(calls).toHaveLength(1);
    expect(cli.commands).toContainEqual([
      "systemctl",
      "--user",
      "restart",
      "herdr-world.service",
    ]);
  });

  test("non-loopback fallback reports restart failure after saving", async () => {
    cli = createTestCli({
      runCommand: (argv) => {
        if (argv.includes("herdr-gui.service")) return 4;
        return argv.includes("restart") ? 17 : 0;
      },
    });
    cli.writeConfig("HOST=192.0.2.10\n");
    mkdirSync(join(cli.home, ".config", "systemd", "user"), {
      recursive: true,
    });
    writeFileSync(
      join(cli.home, ".config", "systemd", "user", "herdr-world.service"),
      "# Generated by herdr-world service install.\n",
    );
    expect(
      await connections(["add", "box", "--ssh", "box.example", "--restart"], {
        ...idle,
        probe: async () => true,
      }),
    ).toBe(17);
    expect(
      registry(cli).profiles.map((profile: { id: string }) => profile.id),
    ).toEqual(["local", "box"]);
    expect(cli.output).not.toContain("Restarted the service.");
  });

  test("test reports each profile and fails when any is unreachable", async () => {
    cli = createTestCli();
    cli.writeConfig("");
    await connections(["add", "box", "--ssh", "me@box"]);
    cli.output.length = 0;
    const code = await connections(["test", "--json"], {
      ...idle,
      test: async (profile) => {
        if (profile.type === "ssh") throw new Error("ssh: connection refused");
        return { ok: true, version: "0.9.4", protocol: 7 };
      },
    });
    expect(code).toBe(EXIT_FAILURE);
    expect(JSON.parse(cli.output.join("\n")).results).toEqual([
      { id: "local", ok: true, version: "0.9.4", protocol: 7 },
      { id: "box", ok: false, error: "ssh: connection refused" },
    ]);
    expect(await connections(["test", "nope"])).toBe(EXIT_USAGE);
  });

  test("explicit Herdr settings stay out of a saved registry", async () => {
    cli = createTestCli();
    cli.writeConfig("");
    await connections(["add", "box", "--ssh", "me@box"]);
    cli.writeConfig("HERDR_SESSION=work\n");
    expect(await connections(["add", "lab", "--ssh", "me@lab"])).toBe(EXIT_OK);
    expect(await connections(["remove", "box"])).toBe(EXIT_OK);
    const saved = registry(cli);
    expect(saved.profiles.map((profile: { id: string }) => profile.id)).toEqual(
      ["local", "lab"],
    );
    cli.output.length = 0;
    await connections(["list", "--json"]);
    const listed = JSON.parse(cli.output.join("\n"));
    expect(listed.default_connection_id).toBe("startup-default");
    expect(listed.profiles[0]).toMatchObject({
      id: "startup-default",
      saved: false,
      control_socket_path: join(
        cli.home,
        ".config",
        "herdr",
        "sessions",
        "work",
        "herdr.sock",
      ),
    });
  });
});
