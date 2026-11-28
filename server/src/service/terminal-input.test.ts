import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { terminalComposerRequest } from "../../../web/src/terminalComposer";
import { terminalPasteRequest } from "../../../web/src/terminalPaste";
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

for (const foreground of ["bash", "vim", "ssh"])
  for (const hasAgent of [false, true])
    test(`Terminal composer and paste reach ${foreground} with ${hasAgent ? "stale" : "no"} agent metadata`, async () => {
      const manager = new ConnectionManager<LegacyConnectionRuntime>("alpha");
      const ws = {} as ServerWebSocket<unknown>;
      const clients = new Set([ws]);
      const replies: any[] = [];
      const writes: unknown[] = [];
      const clipboardTargets: string[] = [];
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
          if (method === "pane.process_info")
            return {
              process_info: {
                pane_id: "w1:p1",
                shell_pid: 10,
                foreground_process_group_id: 20,
                foreground_processes: [{ pid: 20, name: foreground }],
              },
            };
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
        await expect(
          withAgentInput(hasAgent ? agent : null, () =>
            tui.call(requests[0].method, requests[0].params),
          ),
        ).rejects.toThrow("agent_not_ready:");
        expect(writes).toEqual([]);
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
      } finally {
        await manager.stopAll();
      }
    });
