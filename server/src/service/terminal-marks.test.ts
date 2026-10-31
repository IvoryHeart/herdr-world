import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startTestService, type TestService } from "./testing/services";
import { AcquisitionHost } from "./testing/shared-acquisition-runtime";
import { SocketBrowser } from "./testing/composed-acquisition-clients";
import { deskSessionFingerprint } from "../world/desk-observation";
import { configureServerLogger } from "../utils/logger";

test("two real browser sockets agree before and after restarting the real service over the same SQLite", async () => {
  configureServerLogger("error");
  const top = mkdtempSync(join(tmpdir(), "service-terminal-marks-")),
    root = join(top, "data");
  mkdirSync(root, { mode: 0o700 });
  writeFileSync(
    join(root, "connections.json"),
    JSON.stringify({
      version: 2,
      default_connection_id: "alpha",
      profiles: [
        {
          id: "alpha",
          label: "Synthetic alpha",
          type: "local",
          control_socket_path: join(top, "control.sock"),
          client_socket_path: join(top, "render.sock"),
          auto_connect: true,
        },
      ],
    }),
    { mode: 0o600 },
  );
  const host = new AcquisitionHost("alpha"),
    pane = host.pane("b");
  const start = () =>
    startTestService(
      root,
      {
        password: undefined,
        authRequired: false,
        taskNotificationSource: "status",
        hasExplicitSocketPath: false,
        hasExplicitClientSocketPath: false,
      },
      {},
      {
        adapters: {
          herdr: { createRuntime: (options) => host.runtime(options) },
        },
      },
    );
  let started: TestService | undefined,
    clients: SocketBrowser[] = [];
  try {
    started = await start();
    await started.connected;
    clients = [
      new SocketBrowser(started.base),
      new SocketBrowser(started.base),
    ];
    await Promise.all(clients.map((client) => client.hello));
    const identity = {
      connection_id: "alpha",
      connection_generation: host.instances.at(-1)!.connectionGeneration!,
      terminal_id: pane.terminal_id,
    };
    const desk = {
      ...identity,
      agent_session_fingerprint: deskSessionFingerprint(pane.agent_session),
    };
    const events = [
      "world_desk_changed",
      "world_watchlist_changed",
      "world_completion_seen_changed",
    ];
    for (const [index, method, params] of [
      [
        0,
        "world.desk.review",
        { ...desk, reviewed: true, stop_id: "synthetic-stop" },
      ],
      [1, "world.watchlist.pin", { ...identity, label: "Synthetic watch" }],
      [2, "world.completion_seen.mark", identity],
    ] as const) {
      const notice = clients[1]!.next(
        (control) => control.type === events[index],
      );
      await clients[0]!.call(method, params);
      await notice;
    }
    await clients[1]!.call("world.desk.open", desk);
    expect(await clients[0]!.call("world.desk.get")).toMatchObject({
      records: [
        { reviewed_stop: "synthetic-stop", opened_at: expect.any(Number) },
      ],
    });
    expect(await clients[1]!.call("world.watchlist.list")).toMatchObject({
      records: [{ terminal_id: pane.terminal_id }],
    });
    expect(await clients[1]!.call("world.completion_seen.list")).toMatchObject({
      records: [{ terminal_id: pane.terminal_id }],
    });
    const incarnation = (await clients[0]!.hello).service_incarnation;
    await Promise.all(clients.map((client) => client.close()));
    clients = [];
    await started.service.stop();
    started = await start();
    await started.connected;
    clients = [
      new SocketBrowser(started.base),
      new SocketBrowser(started.base),
    ];
    await Promise.all(clients.map((client) => client.hello));
    expect((await clients[0]!.hello).service_incarnation).not.toBe(incarnation);
    expect(await clients[0]!.call("world.desk.get")).toMatchObject({
      records: [],
    });
    expect(await clients[0]!.call("world.watchlist.list")).toMatchObject({
      records: [],
    });
    const restored = events.map((type) =>
      clients[1]!.next((control) => control.type === type),
    );
    await clients[0]!.call("world.snapshot");
    await Promise.all(restored);
    for (const client of clients) {
      expect(await client.call("world.desk.get")).toMatchObject({
        records: [
          { reviewed_stop: "synthetic-stop", opened_at: expect.any(Number) },
        ],
      });
      expect(await client.call("world.watchlist.list")).toMatchObject({
        records: [{ terminal_id: pane.terminal_id }],
      });
      expect(await client.call("world.completion_seen.list")).toMatchObject({
        records: [{ terminal_id: pane.terminal_id }],
      });
    }
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await started?.service.stop();
    rmSync(top, { recursive: true, force: true });
    configureServerLogger("info");
  }
}, 30_000);
