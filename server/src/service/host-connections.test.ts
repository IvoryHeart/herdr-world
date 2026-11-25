import { afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createConnectionsCommand } from "../cli/connections";
import { runCli } from "../cli/index";
import { createTestCli, type TestCli } from "../cli/test-context";
import { readWorldCliToken } from "../config/session-secret";
import { hostId } from "../connections/hosts";
import type { ConnectionProfile } from "../connections/profiles";
import {
  browserSocket,
  login,
  startTestService,
  type TestService,
} from "./testing/services";
import { AcquisitionHost } from "./testing/shared-acquisition-runtime";

let cli: TestCli;
let started: TestService;
let browser: Awaited<ReturnType<typeof browserSocket>>;
afterEach(async () => {
  browser?.close();
  await started?.service.stop();
  cli?.cleanup();
});

async function fixture() {
  cli = createTestCli();
  const root = join(cli.home, "data");
  mkdirSync(root, { mode: 0o700 });
  const profile: ConnectionProfile = {
    id: "local-existing",
    label: "Local",
    type: "local",
    auto_connect: true,
    control_socket_path: join(root, "control.sock"),
    client_socket_path: join(root, "render.sock"),
  };
  writeFileSync(
    join(root, "connections.json"),
    JSON.stringify({
      version: 2,
      default_connection_id: profile.id,
      profiles: [profile],
    }),
    { mode: 0o600 },
  );
  let installed = true;
  const runtimes = new Map<string, AcquisitionHost>();
  started = await startTestService(
    root,
    { hasExplicitSocketPath: false, hasExplicitClientSocketPath: false },
    {},
    {
      adapters: {
        herdr: {
          discoverHost: async (host, existing) =>
            host.type === "local"
              ? existing.map((profile) => ({ profile, version: "0.9.5" }))
              : installed
                ? [
                    {
                      profile: {
                        id: `${host.id}-herdr`,
                        label: "Herdr TUI",
                        type: "ssh",
                        ssh_destination: host.ssh_destination!,
                        remote_control_socket_path: "",
                        remote_client_socket_path: "",
                        auto_connect: true,
                      },
                      version: "0.9.5",
                    },
                  ]
                : [],
          createRuntime(options) {
            const id = options.identity!.id;
            const host = runtimes.get(id) ?? new AcquisitionHost(id);
            runtimes.set(id, host);
            return host.runtime(options);
          },
        },
      },
    },
  );
  await started.connected;
  cli.context.runtime.env.HERDR_WORLD_DATA_DIR = root;
  cli.writeConfig(`HOST=127.0.0.1\nPORT=${started.service.port}\n`);
  const cookie = await login(started.base, "world-service-test-password");
  browser = await browserSocket(started.base, cookie);
  return {
    command: (args: string[]) =>
      runCli(["connections", ...args], cli.context, [
        createConnectionsCommand(),
      ]),
    installed: (value: boolean) => {
      installed = value;
    },
    cookie,
    async ls(command = "ls") {
      return (
        await fetch(`${started.base}/api/world/cli`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${readWorldCliToken(started.service.paths.sessionSecret)}`,
          },
          body: JSON.stringify({ command, params: {} }),
        })
      ).json();
    },
  };
}

test("a runtime-free CLI add discovers the host, lists rooms, and preserves the per-connection API", async () => {
  const f = await fixture();
  expect(await f.command(["add", "sample@remote.example"])).toBe(0);
  expect(cli.errors).toEqual([]);
  expect(cli.output.join("\n")).toContain("herdr 0.9.5 — ready");
  const catalogue = await browser.call("connections.list");
  expect(catalogue.hosts).toHaveLength(2);
  expect(catalogue.connections).toHaveLength(2);
  const snapshot = await browser.call("world.snapshot");
  const remote = snapshot.hosts.find(
    (host: { type: string }) => host.type === "ssh",
  );
  expect(remote.runtimes[0]).toMatchObject({
    kind: "herdr",
    version: "0.9.5",
    actionable: true,
    stale: false,
  });
  const connection = snapshot.connections.find(
    (connection: { connection_id: string }) =>
      connection.connection_id === remote.runtimes[0].connection_id,
  );
  expect(connection.snapshot.workspaces.length).toBeGreaterThan(0);
  expect(cli.output.join("\n")).toContain(
    connection.snapshot.workspaces[0].label,
  );
  const ls = await f.ls();
  expect(ls).toMatchObject({ ok: true });
  expect(ls.result.hosts).toHaveLength(2);
  expect(ls.result.connections).toHaveLength(2);
  expect(ls.result.hosts[1].runtimes[0].workspaces).toEqual(
    ls.result.connections[1].workspaces,
  );
  const inventory = await f.ls("runtime ls");
  expect(inventory).toMatchObject({ ok: true });
  expect(inventory.result.connections).toHaveLength(2);
  expect(inventory.result.connections[1]).toMatchObject({
    kind: "herdr",
    version: "0.9.5",
    actionable: true,
    agent_verbs: ["ls", "read"],
    manual: "herdr --skill",
  });
  const agents = await f.ls("agent ls");
  expect(agents).toMatchObject({ ok: true });
  expect(agents.result.agents.length).toBeGreaterThan(0);
  expect(agents.result.agents[0].target).toContain("/");
});

test("empty hosts survive reconnect and Integrations alone offers additional runtimes", async () => {
  const f = await fixture();
  f.installed(false);
  expect(await f.command(["add", "sample@empty.example"])).toBe(0);
  expect(cli.output.join("\n")).toContain(
    "No runtime installed. Install herdr-core or Herdr TUI",
  );
  const id = hostId({ type: "ssh", ssh_destination: "sample@empty.example" });
  let host = (await browser.call("connections.list")).hosts.find(
    (host: { host_id: string }) => host.host_id === id,
  );
  expect(host.state).toBe("empty");
  f.installed(true);
  host = await browser.call("connections.discover_host", { host_id: id });
  expect(host).toMatchObject({ state: "ready", installable_runtimes: [] });
  const integrations = await (
    await fetch(`${started.base}/api/world/integrations`, {
      headers: { cookie: f.cookie },
    })
  ).json();
  expect(
    integrations.hosts.find((host: { host_id: string }) => host.host_id === id)
      .available_runtimes,
  ).toEqual([{ kind: "herdr-core", label: "herdr-core" }]);
  cli.output.length = 0;
  expect(await f.command(["list", "--json"])).toBe(0);
  expect(
    JSON.parse(cli.output.join("\n")).hosts.find(
      (host: { host_id: string }) => host.host_id === id,
    ).runtimes[0].state,
  ).toBe("ready");
});

test("the CLI preview switch exercises empty-host onboarding without a remote machine", async () => {
  const f = await fixture();
  expect(
    await f.command(["add", "runtime-fixture.example", "--preview-empty"]),
  ).toBe(0);
  const catalogue = await browser.call("connections.list");
  const host = catalogue.hosts.find(
    (host: { preview_fixture?: string }) => host.preview_fixture,
  );
  expect(host).toMatchObject({
    state: "empty",
    runtimes: [],
    auto_connect: false,
  });
  expect(await f.command(["remove", host.host_id])).toBe(0);
  expect((await browser.call("connections.list")).hosts).toHaveLength(1);
});
