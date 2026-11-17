import { afterEach, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createLegacyRoutingLogger } from "../connections/protocol";
import { runCli } from "../cli/index";
import { createTestCli, type TestCli } from "../cli/test-context";
import { WORLD_HARNESSES } from "../cli/integration-paths";
import { createRpcDispatcher } from "../service/rpc-dispatch";
import { registeredVerb } from "../verbs/registry";
import { ACTORS } from "../verbs/types";
import type { RpcServices } from "./context";

let cli: TestCli;
afterEach(() => cli?.cleanup());

function harness() {
  cli = createTestCli();
  const ws = {} as ServerWebSocket<unknown>;
  const replies: any[] = [];
  const services = {
    clients: new Set([ws]),
    snapshotAdmission: { acknowledge: () => false },
    worldIntegrationRuntime: () => cli.context.runtime,
    safeSend: (_ws: unknown, payload: string) => {
      replies.push(JSON.parse(payload));
      return true;
    },
    markRpcError() {},
    connectionManager: {
      readyRuntimeLease() {
        throw new Error("must not route through a Herdr connection");
      },
    },
  } as unknown as RpcServices;
  const dispatch = createRpcDispatcher(
    services,
    createLegacyRoutingLogger({ log() {} }),
  );
  let next = 0;
  const call = async (method: string, params?: unknown) => {
    const id = `r${++next}`;
    await dispatch(ws, JSON.stringify({ id, method, params }));
    const reply = replies.find((candidate) => candidate.id === id);
    if (reply.error) throw new Error(reply.error.message);
    return reply.result;
  };
  const cliStatus = async (name: string) => {
    cli.output.length = 0;
    expect(await runCli(["integration", "status", name], cli.context)).toBe(0);
    return cli.output[0];
  };
  return { call, cliStatus, services, ws, dispatch, replies };
}

test("Settings list, install and uninstall run the CLI's installer and match its status", async () => {
  const { call, cliStatus } = harness();
  const { integrations } = await call("world.integration.list");
  expect(integrations.map((row: any) => row.harness)).toEqual([
    ...WORLD_HARNESSES,
  ]);
  expect(integrations.find((row: any) => row.harness === "omp")).toEqual({
    harness: "omp",
    state: "unsupported",
    reason: "no documented skill folder",
    available_version: 2,
    shared_with: [],
  });
  expect(integrations.find((row: any) => row.harness === "codex")).toEqual({
    harness: "codex",
    state: "not_installed",
    path: "~/.agents/skills/herdr-world/SKILL.md",
    available_version: 2,
    shared_with: ["pi", "kimi"],
  });
  expect(await cliStatus("codex")).toBe(
    "codex: not installed (~/.agents/skills/herdr-world/SKILL.md)",
  );

  await expect(
    call("world.integration.install", { harness: "codex" }),
  ).rejects.toThrow("~/.codex does not exist. Run codex first");
  mkdirSync(join(cli.home, ".codex"));
  const installed = await call("world.integration.install", {
    harness: "codex",
  });
  expect(installed.integration).toMatchObject({
    harness: "codex",
    state: "current",
    version: 2,
  });
  expect(await cliStatus("codex")).toBe(
    "codex: current (v2) (~/.agents/skills/herdr-world/SKILL.md)",
  );
  // The shared file serves Pi and Kimi too.
  expect(
    (await call("world.integration.list")).integrations.find(
      (row: any) => row.harness === "kimi",
    ).state,
  ).toBe("current");

  const removed = await call("world.integration.uninstall", {
    harness: "codex",
  });
  expect(removed.integration.state).toBe("not_installed");
  expect(existsSync(join(cli.home, ".agents/skills/herdr-world"))).toBe(false);
  expect(await cliStatus("codex")).toBe(
    "codex: not installed (~/.agents/skills/herdr-world/SKILL.md)",
  );

  // Settings removal carries the same durable preference as CLI removal.
  expect(await runCli(["integration", "sync"], cli.context)).toBe(0);
  expect(existsSync(join(cli.home, ".agents/skills/herdr-world"))).toBe(false);
  await call("world.integration.install", { harness: "codex" });
  expect(await runCli(["integration", "sync"], cli.context)).toBe(0);
  expect(existsSync(join(cli.home, ".agents/skills/herdr-world"))).toBe(true);

  await expect(
    call("world.integration.install", { harness: "omp" }),
  ).rejects.toThrow("omp: unsupported");
  await expect(
    call("world.integration.install", { harness: "bogus" }),
  ).rejects.toThrow("unknown harness");
  await expect(call("world.integration.install", {})).rejects.toThrow(
    "invalid parameters",
  );
});

test("World integration verbs are operator-only: agents and unauthenticated sockets are refused", async () => {
  for (const name of [
    "world.integration.list",
    "world.integration.install",
    "world.integration.uninstall",
  ]) {
    const verb = registeredVerb("rpc", name)!;
    expect(verb.capabilities).toEqual(["world"]);
    for (const actor of ACTORS)
      expect(verb.policy[actor]).toBe(actor === "browser" ? "allow" : "deny");
  }
  const { dispatch, replies, services, ws } = harness();
  mkdirSync(join(cli.home, ".codex"));
  services.clients.delete(ws);
  await dispatch(
    ws,
    JSON.stringify({
      id: "stranger",
      method: "world.integration.install",
      params: { harness: "codex" },
    }),
  );
  expect(replies[0]).toMatchObject({ command_evidence: { stage: "refused" } });
  expect(existsSync(join(cli.home, ".agents"))).toBe(false);
});
