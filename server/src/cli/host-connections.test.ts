import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { ConnectionProfileStore } from "../connections/profiles";
import { createConnectionsCommand } from "./connections";
import { runCli } from "./index";
import { createTestCli, type TestCli } from "./test-context";

let cli: TestCli;
afterEach(() => cli?.cleanup());

test("offline add saves an empty host, reports choices, and no-argument connections lists it", async () => {
  cli = createTestCli();
  cli.writeConfig("");
  const command = createConnectionsCommand({
    probe: async () => false,
    discoverHost: async () => [],
  });
  expect(
    await runCli(["connections", "add", "sample@empty.example"], cli.context, [
      command,
    ]),
  ).toBe(0);
  expect(cli.errors).toEqual([]);
  expect(cli.output.join("\n")).toContain(
    "No runtime installed. Install herdr-core or Herdr TUI",
  );
  const saved = new ConnectionProfileStore({
    path: join(cli.home, ".config", "herdr-world", "connections.json"),
  }).load();
  expect(saved?.profiles[0]?.id).toBe("startup-default");
  expect(saved?.hosts).toHaveLength(2);
  cli.output.length = 0;
  expect(await runCli(["connections", "--json"], cli.context, [command])).toBe(
    0,
  );
  const list = JSON.parse(cli.output.join("\n"));
  expect(list.hosts).toHaveLength(2);
  expect(list.profiles).toHaveLength(1);
  expect(list.hosts[1].state).toBe("empty");
  expect(
    await runCli(
      ["connections", "remove", list.hosts[1].host_id],
      cli.context,
      [command],
    ),
  ).toBe(0);
});

test("a rejected live host addition cannot fall back to an offline file", async () => {
  cli = createTestCli();
  cli.writeConfig("");
  let discovered = false;
  const command = createConnectionsCommand({
    probe: async () => true,
    apply: async () => ({
      ok: false,
      code: "unavailable",
      error: "synthetic live failure",
    }),
    discoverHost: async () => {
      discovered = true;
      return [];
    },
  });
  expect(
    await runCli(["connections", "add", "sample@host.example"], cli.context, [
      command,
    ]),
  ).toBe(1);
  expect(discovered).toBeFalse();
  expect(
    new ConnectionProfileStore({
      path: join(cli.home, ".config", "herdr-world", "connections.json"),
    }).load(),
  ).toBeNull();
});

test("offline host additions never persist explicit startup socket settings", async () => {
  cli = createTestCli();
  cli.writeConfig(
    "HERDR_SOCKET_PATH=/synthetic/explicit.sock\nHERDR_CLIENT_SOCKET_PATH=/synthetic/explicit-client.sock\n",
  );
  const command = createConnectionsCommand({ probe: async () => false });
  expect(
    await runCli(
      ["connections", "add", "runtime-fixture.example", "--preview-empty"],
      cli.context,
      [command],
    ),
  ).toBe(0);
  const saved = new ConnectionProfileStore({
    path: join(cli.home, ".config", "herdr-world", "connections.json"),
  }).load();
  expect(saved?.profiles).toEqual([]);
  expect(saved?.hosts).toHaveLength(1);
});
