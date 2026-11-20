import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXIT_FAILURE, EXIT_OK } from "../cli/command";
import { createConnectionsCommand } from "../cli/connections";
import { runCli } from "../cli/index";
import { createTestCli } from "../cli/test-context";
import {
  browserSocket,
  login,
  startTestService,
  type TestService,
} from "./testing/services";

test("each CLI changes only its own live World, retaining registry-path authority and offline edits", async () => {
  const cli = createTestCli();
  const services: TestService[] = [];
  const browsers: Awaited<ReturnType<typeof browserSocket>>[] = [];
  const roots = [
    join(cli.home, ".config", "herdr-world"),
    join(cli.home, "preview"),
  ];
  const command = (args: string[]) =>
    runCli(["connections", ...args], cli.context, [createConnectionsCommand()]);
  const registry = (index: number) =>
    readFileSync(join(roots[index]!, "connections.json"), "utf8");
  try {
    for (const root of roots) {
      mkdirSync(root, { recursive: true, mode: 0o700 });
      writeFileSync(
        join(root, "connections.json"),
        JSON.stringify({
          version: 2,
          default_connection_id: "baseline",
          profiles: [
            {
              id: "baseline",
              label: "Baseline",
              type: "local",
              runtime: "herdr-core",
              core_session: "default",
              core_state_dir: "",
              auto_connect: false,
            },
          ],
        }),
        { mode: 0o600 },
      );
      const started = await startTestService(root, {
        hasExplicitSocketPath: false,
        hasExplicitClientSocketPath: false,
      });
      services.push(started);
      await started.connected;
      browsers.push(
        await browserSocket(
          started.base,
          await login(started.base, "world-service-test-password"),
        ),
      );
      expect(
        JSON.parse(readFileSync(join(root, "instance.lock"), "utf8")),
      ).toEqual({
        pid: process.pid,
        host: "127.0.0.1",
        port: started.service.port,
        tls: false,
      });
    }
    cli.writeConfig(`HOST=127.0.0.1\nPORT=${services[0]!.service.port}\n`);
    for (const index of [0, 1]) {
      const sibling = 1 - index;
      cli.context.runtime.env = {
        HERDR_WORLD_DATA_DIR: roots[index]!,
        // An agent-supplied URL/token cannot redirect a registry edit.
        HERDR_WORLD_URL: services[sibling]!.base,
        HERDR_WORLD_TOKEN: "wrong-agent-token",
      };
      const before = registry(sibling);
      const siblingCatalogue =
        await browsers[sibling]!.call("connections.list");
      expect({
        code: await command(["add", "added-core", "--core"]),
        errors: cli.errors,
      }).toEqual({ code: EXIT_OK, errors: [] });
      expect(
        (await browsers[index]!.call("connections.list")).core_connections.map(
          (p: { id: string }) => p.id,
        ),
      ).toEqual(["baseline", "added-core"]);
      expect(await command(["set-default", "added-core"])).toBe(EXIT_OK);
      expect(JSON.parse(registry(index)).default_connection_id).toBe(
        "added-core",
      );
      expect(await command(["remove", "baseline"])).toBe(EXIT_OK);
      expect(
        (await browsers[index]!.call("connections.list")).core_connections.map(
          (p: { id: string }) => p.id,
        ),
      ).toEqual(["added-core"]);
      expect(registry(sibling)).toBe(before);
      expect(await browsers[sibling]!.call("connections.list")).toEqual(
        siblingCatalogue,
      );
    }

    const saved = roots.map((_, index) => registry(index));
    cli.context.runtime.env.HERDR_WORLD_CONNECTIONS_PATH = join(
      roots[0]!,
      "connections.json",
    );
    expect(await command(["add", "wrong-registry", "--core"])).toBe(
      EXIT_FAILURE,
    );
    expect(cli.errors.at(-1)).toContain(services[1]!.base);
    expect(cli.errors.at(-1)).toContain("different connection registry");
    expect(roots.map((_, index) => registry(index))).toEqual(saved);

    delete cli.context.runtime.env.HERDR_WORLD_CONNECTIONS_PATH;
    await services[1]!.service.stop();
    expect(await command(["add", "offline-core", "--core"])).toBe(EXIT_OK);
    expect(
      JSON.parse(registry(1)).profiles.map((p: { id: string }) => p.id),
    ).toEqual(["added-core", "offline-core"]);
    expect(registry(0)).toBe(saved[0]);
  } finally {
    for (const browser of browsers) browser.close();
    for (const service of services) await service.service.stop();
    cli.cleanup();
  }
});
