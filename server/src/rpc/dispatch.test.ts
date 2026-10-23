import { describe, expect, test } from "bun:test";
import { handleAgentRpc } from "./agent";
import { handleBoardTownRpc } from "./board-town";
import { handleBridgeRpc } from "./bridge";
import { handleConnectionsRpc } from "./connections";
import type { BridgeRpcContext, ConnectionRpcContext } from "./context";
import { handleFilesRpc } from "./files";
import { handleGitRpc } from "./git";
import { handleLauncherRpc } from "./launcher";
import { handleWorldRpc } from "./world";

const handlers = [
  handleBridgeRpc,
  handleConnectionsRpc,
  handleWorldRpc,
  handleLauncherRpc,
  handleBoardTownRpc,
  handleAgentRpc,
  handleFilesRpc,
  handleGitRpc,
];

describe("RPC namespace admission", () => {
  test("pass-through and pre-step methods decline synchronously without reading a runtime", () => {
    for (const method of [
      "workspace.list",
      "workspace.create",
      "tab.create",
      "terminal.input",
      "settings.get",
      "integration.list",
      "file.unknown",
      "agent.unknown",
      "git.unknown",
    ]) {
      const rpc = new Proxy(
        { method },
        {
          get(target, key) {
            if (key === "method") return target.method;
            throw new Error(`Unmatched handler accessed ${String(key)}`);
          },
        },
      ) as ConnectionRpcContext;
      for (const handle of handlers) expect(handle(rpc)).toBe(false);
    }
  });

  test("a file operation starts before a queued generation change", async () => {
    let current = true;
    let startedCurrent: boolean | undefined;
    const replies: unknown[] = [];
    const rpc = {
      method: "file.mkdir",
      id: "request",
      params: { path: "example" },
      connection: {
        files: {
          createWorkspaceDirectory: async () => {
            startedCurrent = current;
            return { ok: true };
          },
        },
      },
      sendReply: (reply: unknown) => {
        replies.push(reply);
        return true;
      },
      sendError: (_context: string, error: unknown) => {
        throw error;
      },
    } as unknown as ConnectionRpcContext;
    queueMicrotask(() => {
      current = false;
    });
    let pending: false | Promise<false | void> = false;
    for (const handle of handlers) {
      pending = handle(rpc);
      if (pending !== false) break;
    }
    expect(startedCurrent).toBe(true);
    expect(pending).not.toBe(false);
    await pending;
    expect(current).toBe(false);
    expect(replies).toEqual([{ id: "request", result: { ok: true } }]);
  });

  test("bridge replies start synchronously and stop dispatch", async () => {
    let replied = false;
    const result = handleBridgeRpc({
      method: "bridge.ping",
      id: "request",
      services: {},
      sendReply: () => {
        replied = true;
        return true;
      },
    } as unknown as BridgeRpcContext);
    expect(replied).toBe(true);
    expect(result).not.toBe(false);
    expect(await result).toBeUndefined();
  });
});
