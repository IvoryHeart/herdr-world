import { expect, test } from "bun:test";
import type { AgentWorktreeTarget } from "../../shared/agentWorktree";
import type { ConnectionClient } from "./api";
import {
  agentWorktreeClient,
  agentWorktreeHttpEndpoint,
} from "./agentWorktreeClient";
import { workspaceFileUrl } from "./workspaceFileUrl";
import { filePreviewCacheKey } from "./components/fileExplorerResources";

const target: AgentWorktreeTarget = {
  subject: {
    connectionId: "alpha",
    generation: 7,
    paneId: "pane",
    sessionFingerprint: "a".repeat(64),
  },
  revision: "revision",
  candidateId: "candidate",
};
const calls: { method: string; params?: Record<string, unknown> }[] = [];
const base: ConnectionClient = {
  connectionId: "alpha",
  generation: 1,
  serverRuntimeGeneration: 7,
  isCurrent: () => true,
  acceptsServerGeneration: () => true,
  async call(method, params) {
    calls.push({ method, params });
    return {};
  },
};

test("Files and Changes carry the same selection, while conversation sends retain their adapter", async () => {
  const client = agentWorktreeClient(base, target);
  for (const method of [
    "file.list",
    "file.read",
    "git.diff_summary",
    "git.diff_file",
    "git.file_action",
  ]) {
    await client.call(method, { workspace_id: "workspace", path: "file.txt" });
    expect(calls[calls.length - 1]?.params?.agent_worktree).toBe(target);
  }
  await client.call("agent_conversation.send", { text: "hello" });
  expect(calls[calls.length - 1]?.params).toEqual({ text: "hello" });
  await expect(
    agentWorktreeClient(base, null).call("file.list", {
      workspace_id: "workspace",
    }),
  ).rejects.toThrow("Choose");
});

test("HTTP previews and downloads preserve selected subject/revision, and root switches isolate caches", () => {
  const client = agentWorktreeClient(base, target);
  const url = new URL(
    workspaceFileUrl(client, "workspace", "image.png", { inline: true }),
    "https://world.example.test",
  );
  expect(url.searchParams.get("connection_generation")).toBe("7");
  expect(JSON.parse(url.searchParams.get("agent_worktree")!)).toEqual(target);
  expect(agentWorktreeHttpEndpoint(base, "/file/download")).toBe(
    "/file/download",
  );
  expect(() =>
    agentWorktreeHttpEndpoint(
      agentWorktreeClient(base, null),
      "/file/download",
    ),
  ).toThrow("Choose");
  const other = agentWorktreeClient(base, {
    ...target,
    candidateId: "another",
  });
  expect(filePreviewCacheKey(client, "workspace", "file.txt")).not.toBe(
    filePreviewCacheKey(other, "workspace", "file.txt"),
  );
});
