import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { createRpcDispatcher } from "../service/rpc-dispatch";
import type { RpcServices } from "../rpc/context";
import { createLegacyRoutingLogger } from "../connections/protocol";
import { registeredVerb } from "./registry";

function setup() {
  const ws = {} as ServerWebSocket<unknown>;
  const replies: Record<string, any>[] = [];
  const calls: string[] = [];
  let acquisitions = 0;
  const clients = new Set([ws]);
  let current = true;
  let retireBeforeSend = false;
  let rejectAfterSend = false;
  const runtime = {
    remotePlatform: "linux",
    sshHost: () => undefined,
    herdr: {
      call: async (
        method: string,
        _params: unknown,
        _timeout: number,
        beforeSend?: () => void,
      ) => {
        if (retireBeforeSend) current = false;
        beforeSend?.();
        calls.push(method);
        if (rejectAfterSend) throw new Error("acknowledgement lost");
        return { ok: true };
      },
    },
  };
  const services = {
    clients,
    snapshotAdmission: { acknowledge: () => false },
    connectionManager: {
      has: () => true,
      defaultId: () => "example",
      readyRuntimeLease: () => {
        acquisitions++;
        return {
          connectionId: "example",
          generation: 3,
          runtime,
          isCurrent: () => current,
        };
      },
    },
    focusedAcquisition: { recordReply: () => {} },
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
  return {
    calls,
    replies,
    clients,
    ws,
    acquisitions: () => acquisitions,
    retire: () => {
      retireBeforeSend = true;
    },
    loseAck: () => {
      rejectAfterSend = true;
    },
    run: (method: string, params: unknown = {}) =>
      dispatch(
        ws,
        JSON.stringify({
          id: "request",
          method,
          params,
          connection_id: "example",
          connection_generation: 3,
        }),
      ),
  };
}

test("RPC refuses unknown methods and invalid input before acquiring a runtime", async () => {
  const s = setup();
  await s.run("pane.unregistered");
  expect(s.replies.at(-1)?.error.message).toContain("unregistered");
  await s.run("agent_conversation.send", { pane_id: 7 });
  expect(s.replies.at(-1)?.error.message).toContain("invalid parameters");
  expect(s.calls).toEqual([]);
  expect(s.acquisitions()).toBe(0);
});

test("RPC requires current socket authority and rechecks the runtime at native send", async () => {
  const revoked = setup();
  revoked.clients.delete(revoked.ws);
  await revoked.run("workspace.rename", {
    workspace_id: "w1",
    label: "Example",
  });
  expect(revoked.replies.at(-1)?.error.message).toContain("revoked");
  expect(revoked.calls).toEqual([]);
  const retired = setup();
  retired.retire();
  await retired.run("workspace.rename", {
    workspace_id: "w1",
    label: "Example",
  });
  expect(retired.calls).toEqual([]);
  expect(retired.replies.at(-1)?.error).toBeDefined();
});

test("RPC dispatch distinguishes acknowledged native effects from uncertain input", async () => {
  const sent = setup();
  await sent.run("workspace.rename", { workspace_id: "w1", label: "Example" });
  expect(sent.calls).toEqual(["workspace.rename"]);
  expect(sent.replies.at(-1)?.command_evidence).toEqual({
    stage: "sent",
    connection_id: "example",
    connection_generation: 3,
  });
  const uncertain = setup();
  uncertain.loseAck();
  await uncertain.run("pane.send_text", { pane_id: "w1:p1", text: "Example" });
  expect(uncertain.calls).toEqual(["pane.send_text"]);
  expect(uncertain.replies.at(-1)?.command_evidence).toEqual({
    stage: "uncertain",
    connection_id: "example",
    connection_generation: 3,
    reason: "acknowledgement lost",
  });
});

test("native link resolution dispatches as a read without claiming a sent effect", async () => {
  const s = setup();
  await s.run("pane.link.resolve", { pane_id: "w1:p1", row: 1, col: 2 });
  expect(s.calls).toEqual(["pane.link.resolve"]);
  expect(s.replies.at(-1)?.result).toEqual({ ok: true });
  expect(s.replies.at(-1)?.command_evidence).toEqual({ stage: "accepted" });
  expect(registeredVerb("rpc", "pane.link.resolve")!.recovery).toBe("read");
});
