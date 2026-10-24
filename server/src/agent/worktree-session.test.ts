import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSessionHandlers } from "./agent-sessions";
import { localAgentSessionFiles } from "./session-file-access";
import { agentCheckoutSessionFingerprint } from "../herdr/agent-checkout";
import { expect, test } from "bun:test";
import { sessionWorktreeMetadata } from "./worktree-session";
import { parseWorktreeList } from "./worktree-git";

test("Codex uses its latest native rollout cwd, retaining its own reported branch", () => {
  expect(
    sessionWorktreeMetadata("codex", [
      {
        type: "session_meta",
        payload: { cwd: "/project/main", git: { branch: "agent/topic" } },
      },
      { type: "turn_context", payload: { cwd: "/project/linked" } },
      { type: "response_item", payload: { cwd: "/other-agent" } },
    ]),
  ).toEqual({
    cwd: "/project/linked",
    branch: "agent/topic",
    sourceRef: "Codex rollout cwd",
  });
});

test("native transcript fields are evidence; nested tool arguments and prose are not", () => {
  expect(
    sessionWorktreeMetadata("claude", [
      { cwd: "/project/main", gitBranch: "main" },
      { cwd: "/project/linked", gitBranch: "agent/topic" },
      { message: { cwd: "/other-agent", content: "I work in /other-agent" } },
    ]),
  ).toEqual({
    cwd: "/project/linked",
    branch: "agent/topic",
    sourceRef: "Bound transcript cwd",
  });
  expect(
    sessionWorktreeMetadata("claude", [
      { cwd: "relative" },
      { cwd: "/bad\0path" },
    ]),
  ).toBeNull();
  expect(
    sessionWorktreeMetadata("codex", [
      { type: "tool_result", payload: { cwd: "/other-agent" } },
    ]),
  ).toBeNull();
});

test("NUL-delimited Git worktree output preserves paths, detached roots and unusable entries", () => {
  expect(
    parseWorktreeList(
      "worktree /project/main\0HEAD abc\0branch refs/heads/main\0\0worktree /project/with spaces\0HEAD def\0detached\0\0worktree /project/old\0prunable missing\0\0",
    ),
  ).toEqual([
    { path: "/project/main", branch: "main" },
    { path: "/project/with spaces", branch: null },
    { path: "/project/old", branch: null, prunable: true },
  ]);
});

test("only the bound session's native metadata reaches the worktree resolver", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worktree-session-fixture-"));
  try {
    for (const agent of ["claude", "codex"]) {
      const path = join(directory, `${agent}.jsonl`);
      const records =
        agent === "codex"
          ? [
              {
                type: "session_meta",
                payload: {
                  id: "synthetic-codex",
                  cwd: "/project/main",
                  git: { branch: "agent/topic" },
                },
              },
              { type: "turn_context", payload: { cwd: "/project/agent" } },
            ]
          : [
              {
                type: "user",
                uuid: "synthetic-user",
                cwd: "/project/agent",
                gitBranch: "agent/topic",
                timestamp: "2026-01-01T00:00:00Z",
                message: { role: "user", content: "Example" },
              },
            ];
      await writeFile(
        path,
        records.map((record) => JSON.stringify(record)).join("\n") + "\n",
      );
      const session = {
        source: `herdr:${agent}`,
        agent,
        kind: "path",
        value: path,
      };
      const pane = {
        pane_id: "pane",
        workspace_id: "workspace",
        agent,
        agent_session: session,
        cwd: "/project/main",
      };
      const herdrCall = async (method: string) => {
        if (method === "agent.get") return { agent: pane };
        if (method === "pane.get") return { pane };
        throw new Error(method);
      };
      const handlers = createAgentSessionHandlers({
        herdrCall,
        files: localAgentSessionFiles,
      });
      try {
        const expected = agentCheckoutSessionFingerprint(session);
        expect(
          await handlers.readWorktreeMetadata("pane", expected),
        ).toMatchObject({ cwd: "/project/agent", branch: "agent/topic" });
        pane.agent_session = {
          ...session,
          value: join(directory, "another-session.jsonl"),
        };
        expect(
          await handlers.readWorktreeMetadata("pane", expected),
        ).toBeNull();
      } finally {
        handlers.conversationWatch.stop();
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
