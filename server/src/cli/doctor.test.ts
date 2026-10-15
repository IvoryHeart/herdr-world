import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXIT_FAILURE, EXIT_OK } from "./command";
import { createDoctorCommand, type DoctorDependencies } from "./doctor";
import {
  ConnectionProfileStore,
  type ConnectionProfile,
} from "../connections/profiles";
import { createTestCli, type TestCli } from "./test-context";

let cli: TestCli;
afterEach(() => cli?.cleanup());

const healthy: DoctorDependencies = {
  probe: async () => true,
  portInUse: () => true,
  testSockets: async () => ({ ok: true, version: "0.9.4", protocol: 7 }),
  herdrService: () => ({ installed: false, active: false }),
  latestVersion: async () => "1.2.3",
  lanIPs: () => ["192.0.2.20"],
};

async function doctor(dependencies: DoctorDependencies, args = ["--json"]) {
  const code = await createDoctorCommand(dependencies).run(args, cli.context);
  const result = JSON.parse(cli.output.join("\n"));
  const check = (name: string) =>
    result.checks.find((entry: { name: string }) => entry.name === name);
  return { code, result, check };
}

describe("herdr-world doctor", () => {
  test("passes a healthy foreground installation and redacts the token", async () => {
    cli = createTestCli();
    cli.writeConfig("HOST=0.0.0.0\nPORT=8787\n");
    writeFileSync(
      join(cli.home, ".config", "herdr-world", "auth-token"),
      "c".repeat(64),
    );
    const { code, result, check } = await doctor(healthy);
    expect(code).toBe(EXIT_OK);
    expect(result.ok).toBe(true);
    expect(check("Herdr").detail).toContain("Herdr 0.9.4, protocol 7");
    expect(check("Network").detail).toContain("http://192.0.2.20:8787");
    expect(check("Service").status).toBe("warn");
    expect(check("Updates").status).toBe("ok");
    expect(JSON.stringify(result)).not.toContain("c".repeat(64));
  });

  test("fails on an invalid service config with a fix", async () => {
    cli = createTestCli();
    cli.writeConfig("PORT=0\n");
    const { code, check } = await doctor(healthy);
    expect(code).toBe(EXIT_FAILURE);
    expect(check("Service config")).toMatchObject({ status: "fail" });
    expect(check("Service config").hint).toContain("herdr-world config edit");
  });

  test("explains a port held by another process", async () => {
    cli = createTestCli();
    cli.writeConfig("");
    const { check } = await doctor({ ...healthy, probe: async () => false });
    expect(check("Listener")).toMatchObject({ status: "fail" });
    expect(check("Listener").detail).toContain("port 8787 is held");
  });

  test("reports an unreachable Herdr with the setup command", async () => {
    cli = createTestCli();
    cli.writeConfig("");
    const { code, check } = await doctor({
      ...healthy,
      testSockets: async () => {
        throw new Error("ENOENT");
      },
    });
    expect(code).toBe(EXIT_FAILURE);
    expect(check("Herdr").detail).toContain(
      join(cli.home, ".config", "herdr", "herdr.sock"),
    );
    expect(check("Herdr").hint).toContain("herdr-world herdr setup");
  });

  test("skips SSH Herdr, disabled push and offline update checks", async () => {
    cli = createTestCli();
    cli.writeConfig("HERDR_SSH_HOST=me@box\nHERDR_WORLD_WEB_PUSH_SUBJECT=\n");
    const { check } = await doctor(healthy, ["--json", "--offline"]);
    expect(check("Herdr").status).toBe("skip");
    expect(check("Web Push").status).toBe("skip");
    expect(check("Updates").status).toBe("skip");
  });

  function saveDefault(profile: ConnectionProfile) {
    return new ConnectionProfileStore({
      path: join(cli.home, ".config", "herdr-world", "connections.json"),
    }).save({
      version: 2,
      default_connection_id: profile.id,
      profiles: [profile],
    });
  }

  const remote: ConnectionProfile = {
    id: "remote",
    label: "Remote",
    type: "ssh",
    ssh_destination: "host.example",
    remote_control_socket_path: "/tmp/herdr.sock",
    remote_client_socket_path: "/tmp/herdr-client.sock",
    auto_connect: true,
  };

  test("a saved SSH default needs no unused local Herdr", async () => {
    cli = createTestCli();
    cli.writeConfig("");
    await saveDefault(remote);
    let probes = 0;
    const { code, check } = await doctor({
      ...healthy,
      testSockets: async () => {
        probes++;
        throw new Error("ENOENT");
      },
    });
    expect(code).toBe(EXIT_OK);
    expect(check("Herdr").status).toBe("skip");
    expect(check("Herdr").detail).toContain("host.example");
    expect(probes).toBe(0);
  });

  test("a saved local default probes its own sockets", async () => {
    cli = createTestCli();
    cli.writeConfig("");
    const control = join(cli.home, "custom.sock"),
      client = join(cli.home, "custom-client.sock");
    await saveDefault({
      id: "local",
      label: "Local",
      type: "local",
      control_socket_path: control,
      client_socket_path: client,
      auto_connect: true,
    });
    const probes: string[][] = [];
    const { code } = await doctor({
      ...healthy,
      testSockets: async (...paths) => {
        probes.push(paths);
        return { ok: true, version: null, protocol: 7 };
      },
    });
    expect(code).toBe(EXIT_OK);
    expect(probes).toEqual([[control, client]]);
  });

  test("an explicit SSH target wins over a saved local default", async () => {
    cli = createTestCli();
    cli.writeConfig("HERDR_SSH_HOST=explicit.example\n");
    await saveDefault({
      id: "local",
      label: "Local",
      type: "local",
      control_socket_path: "/tmp/custom.sock",
      client_socket_path: "/tmp/custom-client.sock",
      auto_connect: true,
    });
    const { code, check } = await doctor({
      ...healthy,
      testSockets: async () => {
        throw new Error("must not probe local");
      },
    });
    expect(code).toBe(EXIT_OK);
    expect(check("Herdr").status).toBe("skip");
    expect(check("Herdr").detail).toContain("explicit.example");
  });

  test.each([
    "HERDR_SOCKET_PATH=/tmp/explicit.sock",
    "HERDR_CLIENT_SOCKET_PATH=/tmp/explicit-client.sock",
    "HERDR_SESSION=example",
  ])("startup override %s wins over saved SSH default", async (override) => {
    cli = createTestCli();
    cli.writeConfig(override + "\n");
    await saveDefault(remote);
    let probes = 0;
    const { check } = await doctor({
      ...healthy,
      testSockets: async () => {
        probes++;
        return { ok: true, version: null, protocol: 7 };
      },
    });
    expect(check("Herdr").status).toBe("ok");
    expect(probes).toBe(1);
  });

  test("warns about available updates", async () => {
    cli = createTestCli();
    cli.writeConfig("");
    const { check } = await doctor({
      ...healthy,
      latestVersion: async () => "1.3.0",
    });
    expect(check("Updates")).toMatchObject({
      status: "warn",
      hint: "Run `herdr-world update`.",
    });
  });

  test.skipIf(!Bun.which("openssl"))(
    "warns about a certificate that expires soon",
    async () => {
      cli = createTestCli();
      const cert = join(cli.home, "cert.pem");
      const key = join(cli.home, "key.pem");
      const generated = Bun.spawnSync(
        [
          "openssl",
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-days",
          "3",
          "-subj",
          "/CN=herdr-world.test",
          "-keyout",
          key,
          "-out",
          cert,
        ],
        { stdout: "ignore", stderr: "ignore" },
      );
      expect(generated.exitCode).toBe(0);
      cli.writeConfig(
        `HOST=0.0.0.0\nHERDR_WORLD_TLS_CERT=${cert}\nHERDR_WORLD_TLS_KEY=${key}\n`,
      );
      const { check } = await doctor(healthy);
      expect(check("TLS certificate").status).toBe("warn");
      expect(check("TLS certificate").detail).toContain("CN=herdr-world.test");
      expect(check("Network").detail).toContain("HTTPS");
    },
  );

  test("flags an invalid connection registry", async () => {
    cli = createTestCli();
    cli.writeConfig("");
    mkdirSync(join(cli.home, ".config", "herdr-world"), { recursive: true });
    writeFileSync(
      join(cli.home, ".config", "herdr-world", "connections.json"),
      "{",
      {
        mode: 0o600,
      },
    );
    const { check } = await doctor(healthy);
    expect(check("Connections")).toMatchObject({ status: "fail" });
  });

  test("prints a readable summary", async () => {
    cli = createTestCli();
    cli.writeConfig("");
    const code = await createDoctorCommand(healthy).run([], cli.context);
    expect(code).toBe(EXIT_OK);
    // Not installed as a service, and no login token has been created yet.
    expect(cli.output.at(-1)).toMatch(/^\d+ ok, 2 warnings, 0 failures$/);
    expect(cli.output).toContain(
      "                      Run `herdr-world service install` to start Herdr World at login.",
    );
  });

  test("fails on a corrupt token with the rotate command", async () => {
    cli = createTestCli();
    cli.writeConfig("");
    writeFileSync(
      join(cli.home, ".config", "herdr-world", "auth-token"),
      "x\n",
    );
    const { code, check } = await doctor(healthy);
    expect(code).toBe(EXIT_FAILURE);
    expect(check("Login").hint).toContain("herdr-world auth rotate");
  });

  test("a loaded but crashed LaunchAgent is not reported as running", async () => {
    cli = createTestCli({
      runtime: { platform: "darwin" },
      captureCommand: () => ({
        code: 0,
        stdout:
          "gui/501/dev.herdr-world = {\n\tstate = waiting\n\tendpoints = {\n\t\tstate = active\n\t}\n}\n",
      }),
    });
    cli.writeConfig("");
    const agents = join(cli.home, "Library", "LaunchAgents");
    mkdirSync(agents, { recursive: true });
    writeFileSync(join(agents, "dev.herdr-world.plist"), "<plist/>");
    const { check } = await doctor({
      ...healthy,
      probe: async () => false,
      portInUse: () => false,
    });
    expect(check("Service")).toMatchObject({
      status: "fail",
      detail: "installed but not running",
    });
  });
});
