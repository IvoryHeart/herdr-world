import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { terminalComposerRequest } from "../../../web/src/terminalComposer";
import { terminalPasteRequest } from "../../../web/src/terminalPaste";
import { agentInputRequest } from "../../../web/src/agentInput";
import {
  createHerdrControlPorts,
  createTuiPassThrough,
} from "../adapters/herdr-runtime";
import { withAgentInput } from "../adapters/agent-input";
import { ConnectionManager } from "../connections/manager";
import { createLegacyRoutingLogger } from "../connections/protocol";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import type { RpcServices } from "../rpc/context";
import { createRpcDispatcher } from "./rpc-dispatch";

for (const foreground of ["bash", "vim", "ssh", "claude"])
  for (const hasAgent of [false, true])
    test(`Terminal composer and paste reach ${foreground} with ${hasAgent ? "stale" : "no"} agent metadata`, async () => {
      const manager = new ConnectionManager<LegacyConnectionRuntime>("alpha");
      const ws = {} as ServerWebSocket<unknown>;
      const clients = new Set([ws]);
      const replies: any[] = [];
      const writes: unknown[] = [];
      const clipboardTargets: string[] = [];
      let afterForegroundRead: (() => void) | null = null;
      const agent = {
        pane_id: "w1:p1",
        terminal_id: "terminal-1",
        agent: "claude",
        agent_session: {
          source: "herdr:claude",
          agent: "claude",
          kind: "id",
          value: "original",
        },
      };
      const client = {
        async call(
          method: string,
          params?: Record<string, unknown>,
          _timeout?: number,
          beforeSend?: () => void,
        ) {
          if (method === "pane.get")
            return { pane: { terminal_id: "terminal-1" } };
          if (method === "agent.get") return { agent: hasAgent ? agent : null };
          if (method === "pane.process_info") {
            afterForegroundRead?.();
            return {
              process_info: {
                pane_id: "w1:p1",
                shell_pid: 10,
                foreground_process_group_id: 20,
                foreground_processes: [{ pid: 20, name: foreground }],
              },
            };
          }
          beforeSend?.();
          writes.push({ method, params });
          return { sent: true };
        },
      };
      const tui = createTuiPassThrough("herdr", client);
      const identity = { id: "alpha", label: "Alpha", source: "test" };
      manager.register({
        identity,
        createRuntime: () =>
          ({
            identity,
            async startTransport() {},
            startBackground() {},
            async stop() {},
            tui,
            operations: createHerdrControlPorts(client).operations,
            sshHost: () => null,
            terminalBridge: {
              noteTerminalInput: (_ws: unknown, id: string) =>
                clipboardTargets.push(id),
            },
          }) as unknown as LegacyConnectionRuntime,
      });
      await manager.start("alpha");
      const generation = manager.readyRuntimeLease("alpha")!.generation;
      const dispatch = createRpcDispatcher(
        {
          clients,
          connectionManager: manager,
          snapshotAdmission: { acknowledge: () => false },
          focusedAcquisition: { recordReply() {} },
          markRpcError() {},
          safeSend(_ws: unknown, line: string) {
            replies.push(JSON.parse(line));
            return true;
          },
        } as unknown as RpcServices,
        createLegacyRoutingLogger({ log() {} }),
      );
      const requests = [
        terminalComposerRequest("w1:p1", "printf composer", true),
        terminalComposerRequest("w1:p1", "draft\ninsert", false),
        terminalPasteRequest("w1:p1", "pasted\ntext"),
      ];
      try {
        // Identical World-originated input still refuses, with no write/replay.
        const guarded = withAgentInput(hasAgent ? agent : null, () =>
          tui.call(requests[0].method, requests[0].params),
        );
        if (foreground === "claude") await guarded;
        else await expect(guarded).rejects.toThrow("agent_not_ready:");
        writes.length = 0;
        // Town replies/menu keys and review prefill opt into the same final
        // check. Stale pane.agent labels must never authorize raw input.
        for (const [index, request] of [
          agentInputRequest("w1:p1", "rm the tmp dir", true),
          agentInputRequest(
            "w1:p1",
            "Review feedback:\n\n`src/example.ts`\n> quoted\n\nPlease fix this",
            false,
          ),
          agentInputRequest("w1:p1", "1", false),
        ].entries()) {
          await dispatch(
            ws,
            JSON.stringify({
              id: `agent-input-${index}`,
              ...request,
              connection_id: "alpha",
              connection_generation: generation,
            }),
          );
          if (foreground === "claude") {
            expect(replies.at(-1).error).toBeUndefined();
            const { agent_input, ...native } = request.params;
            expect(agent_input).toBe(true);
            expect(writes.at(-1)).toEqual({
              method: request.method,
              params: native,
            });
          } else {
            expect(replies.at(-1).error.message).toContain("agent_not_ready:");
            expect(writes).toEqual([]);
          }
        }
        writes.length = 0;
        clipboardTargets.length = 0;
        for (const [index, request] of requests.entries()) {
          await dispatch(
            ws,
            JSON.stringify({
              id: `input-${index}`,
              ...request,
              connection_id: "alpha",
              connection_generation: generation,
            }),
          );
          expect(replies.at(-1).error).toBeUndefined();
          expect(replies.at(-1).result).toEqual({ sent: true });
        }
        expect(writes).toEqual(requests);
        expect(clipboardTargets).toEqual(requests.map(() => "terminal-1"));
        if (foreground === "claude") {
          // Browser authority may retire during the additional asynchronous
          // foreground read. The final native beforeSend still fences it.
          afterForegroundRead = () => clients.delete(ws);
          await dispatch(
            ws,
            JSON.stringify({
              id: "revoked-during-foreground-check",
              ...agentInputRequest("w1:p1", "racing reply", true),
              connection_id: "alpha",
              connection_generation: generation,
            }),
          );
          expect(replies.at(-1).error).toBeDefined();
          expect(writes).toHaveLength(requests.length);
          expect(clipboardTargets).toHaveLength(requests.length);
          afterForegroundRead = null;
          clients.add(ws);
        }
        await dispatch(
          ws,
          JSON.stringify({
            id: "retired-agent-input",
            ...agentInputRequest("w1:p1", "stale reply", true),
            connection_id: "alpha",
            connection_generation: generation + 1,
          }),
        );
        expect(replies.at(-1).error).toBeDefined();
        expect(writes).toHaveLength(requests.length);
        clients.delete(ws);
        await dispatch(
          ws,
          JSON.stringify({
            id: "revoked",
            ...requests[0],
            connection_id: "alpha",
            connection_generation: generation,
          }),
        );
        expect(replies.at(-1).error).toBeDefined();
        expect(writes).toHaveLength(requests.length);
        await dispatch(
          ws,
          JSON.stringify({
            id: "revoked-agent-input",
            ...agentInputRequest("w1:p1", "revoked reply", true),
            connection_id: "alpha",
            connection_generation: generation,
          }),
        );
        expect(replies.at(-1).error).toBeDefined();
        expect(writes).toHaveLength(requests.length);
      } finally {
        await manager.stopAll();
      }
    });
