import { memoryRuntimeStatus } from "../storage/testing/runtime-status";
import { expect, spyOn, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectionManager } from "./manager";
import { CONNECTION_CHANGED_DURING_REQUEST } from "./protocol";
import { dispatchAgentSessionLink, resolveRpcRoute } from "./rpc-routing";
import {
  createLegacyConnectionRuntime,
  type LegacyConnectionRuntime,
} from "./runtime";
import { createGuiSettingsStore } from "../config/gui-settings";

const settings = createGuiSettingsStore(
  join(mkdtempSync(join(tmpdir(), "runtime-settings-")), "settings.json"),
);

if (process.env.HERDR_WORLD_LINK_ROUTING_TEST !== "1") {
  test("session links consume real runtime leases in an isolated process", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, HERDR_WORLD_LINK_ROUTING_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(out + err);
    expect(code).toBe(0);
  });
} else {
  test("routes duplicate pane IDs and refuses replacement before report dispatch", async () => {
    const root = await mkdtemp(join(tmpdir(), "world-codex-route-"));
    const oldHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = root;
    const sessionId = "00000000-0000-4000-8000-000000000001";
    await mkdir(join(root, "sessions"));
    await writeFile(
      join(root, "sessions", `rollout-${sessionId}.jsonl`),
      JSON.stringify({
        type: "session_meta",
        payload: { id: sessionId, cwd: "/example/repo" },
      }) + "\n",
    );
    const manager = new ConnectionManager<LegacyConnectionRuntime>("a");
    const reports: string[] = [];
    let beforeProcessReply: (() => Promise<void>) | undefined;
    let beforeReportSend: (() => Promise<void>) | undefined;
    const identity = (id: string) => ({ id, label: id, source: "test" });
    const factory = (id: string) => () => {
      const runtime = createLegacyConnectionRuntime({
        runtimeStatus: memoryRuntimeStatus(),
        settings,
        identity: identity(id),
        config: {
          socketPath: "/tmp/example-control.sock",
          clientSocketPath: "/tmp/example-client.sock",
          hasExplicitSocketPath: true,
          hasExplicitClientSocketPath: true,
        },
        safeSend: () => true,
        clientLabel: () => "test",
        markRpcError: () => {},
        onEvent: () => {},
      });
      // Only the external transport is replaced: actual manager, router, runtime
      // handler, filesystem lookup and linker run together.
      runtime.startTransport = async () => {};
      runtime.startBackground = () => {};
      let session: unknown = null;
      spyOn(runtime.herdr, "call").mockImplementation(
        async (method, params, _timeout, beforeSend) => {
          if (method === "pane.report_agent_session") {
            const action = beforeReportSend;
            beforeReportSend = undefined;
            await action?.();
          }
          beforeSend?.();
          if (method === "agent.get")
            return {
              agent: {
                agent: "codex",
                terminal_id: "same-terminal",
                agent_session: session,
              },
            };
          if (method === "pane.process_info") {
            const action = beforeProcessReply;
            beforeProcessReply = undefined;
            await action?.();
            return {
              process_info: {
                foreground_process_group_id: 42,
                foreground_processes: [{ pid: 42, name: "codex" }],
              },
            };
          }
          if (method === "pane.report_agent_session") {
            expect(params?.pane_id).toBe("same-pane");
            reports.push(id);
            session = { kind: "id", value: sessionId };
            return {};
          }
          throw new Error(`Unexpected RPC ${method}`);
        },
      );
      return runtime;
    };
    const route = (id: string, method: string) => {
      const result = resolveRpcRoute({
        request: {
          id: "test",
          method,
          connection_id: id,
          connection_generation: manager.status(id)!.generation,
        },
        registry: manager,
        legacyClient: {},
      });
      if (result.scope !== "connection")
        throw new Error("Expected captured connection");
      return result;
    };
    const preview = async (id: string) => {
      const result = await dispatchAgentSessionLink(
        route(id, "agent_session.link_preview"),
        "agent_session.link_preview",
        { pane_id: "same-pane", session_id: sessionId },
      );
      if (!("token" in result) || typeof result.token !== "string")
        throw new Error("Expected a preview token");
      return { token: result.token };
    };
    try {
      for (const id of ["a", "b"]) {
        manager.register({
          identity: identity(id),
          createRuntime: factory(id),
        });
        await manager.start(id);
      }
      const a = await preview("a");
      const b = await preview("b");
      await expect(
        dispatchAgentSessionLink(
          route("b", "agent_session.link"),
          "agent_session.link",
          { pane_id: "same-pane", token: a.token },
        ),
      ).rejects.toThrow("expired");
      await dispatchAgentSessionLink(
        route("b", "agent_session.link"),
        "agent_session.link",
        { pane_id: "same-pane", token: b.token },
      );
      expect(reports).toEqual(["b"]);
      await dispatchAgentSessionLink(
        route("a", "agent_session.link"),
        "agent_session.link",
        { pane_id: "same-pane", token: a.token },
      );
      expect(reports).toEqual(["b", "a"]);

      // Replacement during the asynchronous confirmation checks invalidates the
      // captured lease; it must not reach report_agent_session on either runtime.
      for (const boundary of ["process-reply", "transport-send"] as const) {
        const p = await preview("a");
        const captured = route("a", "agent_session.link");
        const replace = () =>
          manager.replace({
            identity: identity("a"),
            createRuntime: factory("a"),
          });
        if (boundary === "process-reply") beforeProcessReply = replace;
        else beforeReportSend = replace;
        await expect(
          dispatchAgentSessionLink(captured, "agent_session.link", {
            pane_id: "same-pane",
            token: p.token,
          }),
        ).rejects.toThrow(CONNECTION_CHANGED_DURING_REQUEST);
        expect(reports).toEqual(["b", "a"]);
        await manager.start("a");
        expect(() =>
          dispatchAgentSessionLink(captured, "agent_session.link", {
            pane_id: "same-pane",
            token: p.token,
          }),
        ).toThrow(CONNECTION_CHANGED_DURING_REQUEST);
        await expect(
          dispatchAgentSessionLink(
            route("a", "agent_session.link"),
            "agent_session.link",
            { pane_id: "same-pane", token: p.token },
          ),
        ).rejects.toThrow("expired");
      }
    } finally {
      await manager.stopAll();
      if (oldHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = oldHome;
      await rm(root, { recursive: true, force: true });
    }
  });
}
