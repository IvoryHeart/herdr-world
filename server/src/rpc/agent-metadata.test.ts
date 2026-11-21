import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { createRpcDispatcher } from "../service/rpc-dispatch";
import { createLegacyRoutingLogger } from "../connections/protocol";
import type { RpcServices } from "./context";
import { callCoreHost } from "./core-host";
import type { CoreHostRuntime } from "../herdr-core/host-runtime";

test.each(["agent_commands.get", "agent_artifacts.get"])(
  "%s reads only its captured runtime and drops retired replies",
  async (method) => {
    const gate = Promise.withResolvers<unknown>();
    const entered = Promise.withResolvers<void>();
    const result =
      method === "agent_commands.get"
        ? { commands: [{ name: "example" }] }
        : {
            artifacts: [
              { url: "https://example.test/artifact", title: "Example" },
            ],
          };
    let current = true;
    const seen: unknown[] = [];
    const read = async (params: unknown) => {
      seen.push(params);
      entered.resolve();
      return gate.promise;
    };
    const runtime = {
      agentSessions: { readCommands: read, readArtifacts: read },
    };
    const ws = {} as ServerWebSocket<unknown>;
    const replies: Record<string, any>[] = [];
    const services = {
      clients: new Set([ws]),
      snapshotAdmission: { acknowledge: () => false },
      focusedAcquisition: { recordReply: () => {} },
      connectionManager: {
        has: () => true,
        defaultId: () => "alpha",
        readyRuntimeLease: (id: string) =>
          id === "alpha"
            ? {
                connectionId: "alpha",
                generation: 3,
                runtime,
                isCurrent: () => current,
              }
            : null,
      },
      safeSend: (_ws: unknown, payload: string) => {
        replies.push(JSON.parse(payload));
        return true;
      },
      markRpcError: () => {},
    } as unknown as RpcServices;
    const dispatch = createRpcDispatcher(
      services,
      createLegacyRoutingLogger({ log: () => {} }),
    );
    const request = (generation: number) =>
      dispatch(
        ws,
        JSON.stringify({
          id: "metadata",
          method,
          params: { pane_id: "pane-one" },
          connection_id: "alpha",
          connection_generation: generation,
        }),
      );
    await request(4);
    expect(seen).toEqual([]);
    replies.length = 0;
    const pending = request(3);
    await entered.promise;
    current = false;
    gate.resolve(result);
    await pending;
    expect(seen).toEqual([{ pane_id: "pane-one" }]);
    expect(replies.some((reply) => reply.result !== undefined)).toBe(false);
    const core = {
      agentSessions: () => ({
        readCommands: async () => result,
        readArtifacts: async () => result,
      }),
    } as unknown as CoreHostRuntime;
    expect(await callCoreHost(core, method, { pane_id: "core-pane" })).toEqual(
      result,
    );
  },
);
