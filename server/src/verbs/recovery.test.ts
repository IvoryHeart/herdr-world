import { expect, test } from "bun:test";
import { handleGitRpc } from "../rpc/git";
import { handleFilesRpc } from "../rpc/files";
import type { ConnectionRpcContext } from "../rpc/context";
import { registeredVerb } from "./registry";

test("PR status reads and file-manager launches retain their actual handler recovery classes", async () => {
  const calls: unknown[] = [];
  const replies: unknown[] = [];
  const params = { workspace_id: "w1", path: "example.txt" };
  const context = {
    id: "request",
    params,
    ws: { remoteAddress: "127.0.0.1" },
    services: {},
    connection: {
      files: {
        readWorkspacePullRequest: async (input: unknown) => {
          calls.push(["read", input]);
          return { pull_request: null };
        },
        revealWorkspaceFile: async (input: unknown, address: unknown) => {
          calls.push(["launch", input, address]);
          return { ok: true };
        },
      },
      status: {},
      worktreeHooks: {},
    },
    sendReply: (reply: unknown) => {
      replies.push(reply);
      return true;
    },
    sendError: (_context: string, error: unknown) => {
      throw error;
    },
  } as unknown as ConnectionRpcContext;
  await handleGitRpc({ ...context, method: "git.pull_request" });
  await handleFilesRpc({ ...context, method: "file.reveal" });
  expect(calls).toEqual([
    ["read", params],
    ["launch", params, "127.0.0.1"],
  ]);
  expect(replies).toEqual([
    { id: "request", result: { pull_request: null } },
    { id: "request", result: { ok: true } },
  ]);
  expect(registeredVerb("rpc", "git.pull_request")!.recovery).toBe("read");
  expect(registeredVerb("rpc", "file.reveal")!.recovery).toBe("opaque");
});
