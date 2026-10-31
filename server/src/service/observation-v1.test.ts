import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  browserSocket,
  startTestService,
  type TestService,
} from "./testing/services";
import { AcquisitionHost } from "./testing/shared-acquisition-runtime";
import { configureServerLogger } from "../utils/logger";

async function fixture(root: string) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const hosts = new Map(
    ["alpha", "beta"].map((id) => [id, new AcquisitionHost(id)]),
  );
  writeFileSync(
    join(root, "connections.json"),
    JSON.stringify({
      version: 2,
      default_connection_id: "alpha",
      profiles: [...hosts.keys()].map((id) => ({
        id,
        label: id,
        type: "local",
        control_socket_path: join(root, `${id}-control.sock`),
        client_socket_path: join(root, `${id}-render.sock`),
        auto_connect: true,
      })),
    }),
    { mode: 0o600 },
  );
  const started = await startTestService(
    root,
    {
      password: undefined,
      authRequired: false,
      hasExplicitSocketPath: false,
      hasExplicitClientSocketPath: false,
    },
    {},
    {
      clock: { now: () => 1000000, monotonic: () => performance.now() },
      adapters: {
        herdr: {
          createRuntime: (options) =>
            hosts.get(options.identity!.id)!.runtime(options),
        },
      },
    },
  );
  await started.connected;
  return { ...started, hosts };
}
function baseOf(reply: any) {
  return {
    service_incarnation: reply.service_incarnation,
    hosts: reply.connections
      .filter((host: any) => host.token !== null)
      .map((host: any) => ({
        connection_id: host.connection_id,
        generation: host.generation,
        token: host.token,
      })),
  };
}

test("real hello and RPC: complete compatibility, changed-host replacement, validation and restart", async () => {
  configureServerLogger("error");
  const top = mkdtempSync(join(tmpdir(), "world-observation-v1-"));
  const services: TestService[] = [];
  const sockets: Awaited<ReturnType<typeof browserSocket>>[] = [];
  try {
    const first = await fixture(join(top, "first"));
    services.push(first);
    const browser = await browserSocket(first.base, "");
    sockets.push(browser);
    expect(browser.hello.capabilities.world_observation_v1).toBe(true);
    expect(browser.hello.service_incarnation).toBeTruthy();
    const initial = await browser.call("world.snapshot", {});
    expect(initial.service_incarnation).toBe(browser.hello.service_incarnation);
    expect(initial.connections).toHaveLength(2);
    expect(initial.connections.map((c: any) => c.generation)).toEqual([1, 1]);
    expect(
      initial.connections.every(
        (c: any) => c.snapshot && c.token.length === 64,
      ),
    ).toBe(true);
    const base = baseOf(initial);
    const unchanged = await browser.call("world.snapshot", { base });
    expect(
      unchanged.connections.every(
        (c: any) => c.unchanged && !("snapshot" in c),
      ),
    ).toBe(true);
    const calls = [...first.hosts.values()].map((host) => host.calls.length);
    await expect(
      browser.call("world.snapshot", {
        base: { ...base, hosts: [...base.hosts, base.hosts[0]] },
      }),
    ).rejects.toThrow("invalid World observation base");
    expect([...first.hosts.values()].map((host) => host.calls.length)).toEqual(
      calls,
    );
    const alpha = first.hosts.get("alpha")!;
    alpha.pane("a").agent_status = "blocked";
    alpha.emit("pane.agent_status_changed", {
      pane_id: alpha.pane("a").pane_id,
    });
    const changed = await browser.call("world.snapshot", { base });
    expect(changed.connections[0].snapshot).toBeTruthy();
    expect(changed.connections[0].token).not.toBe(initial.connections[0].token);
    expect(changed.connections[1].unchanged).toBe(true);
    const complete = await browser.call("world.snapshot", {});
    expect(changed.connections[0]).toEqual(complete.connections[0]);
    expect(complete.connections[1].snapshot).toEqual(
      initial.connections[1].snapshot,
    );

    const second = await fixture(join(top, "second"));
    services.push(second);
    const replacement = await browserSocket(second.base, "");
    sockets.push(replacement);
    expect(replacement.hello.service_incarnation).not.toBe(
      browser.hello.service_incarnation,
    );
    const restarted = await replacement.call("world.snapshot", { base });
    expect(restarted.service_incarnation).toBe(
      replacement.hello.service_incarnation,
    );
    expect(restarted.connections.map((c: any) => c.generation)).toEqual([1, 1]);
    expect(
      restarted.connections.every((c: any) => c.snapshot && !c.unchanged),
    ).toBe(true);
  } finally {
    for (const socket of sockets) socket.close();
    for (const started of services) await started.service.stop();
    rmSync(top, { recursive: true, force: true });
    configureServerLogger("info");
  }
});
