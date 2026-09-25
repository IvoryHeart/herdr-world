import { describe, expect, test } from "bun:test";
import {
  agentCheckoutSessionFingerprint,
  agentCheckoutTokens,
} from "../herdr/agent-checkout";
import {
  createAgentCheckoutContext,
  parseAgentCheckoutStatus,
  parseAgentCheckoutTokens,
} from "./checkout-context";
const session = {
  source: "herdr:codex",
  agent: "codex",
  kind: "id",
  value: "synthetic-session-a",
};

describe("agent checkout context", () => {
  test("only admits a complete report matching the exact current session", () => {
    const tokens = agentCheckoutTokens(
      session,
      "/worktrees/agent-a",
      "https://example.invalid/o/r/pull/1",
    );
    expect(parseAgentCheckoutTokens(tokens, session)).toEqual({
      path: "/worktrees/agent-a",
      reportedPr: "https://example.invalid/o/r/pull/1",
    });
    expect(
      parseAgentCheckoutTokens(tokens, {
        ...session,
        value: "synthetic-session-b",
      }),
    ).toBeNull();
    expect(
      parseAgentCheckoutTokens(
        { ...tokens, agent_checkout_path_2: "suffix" },
        session,
      ),
    ).toBeNull();
  });
  test("uses the live pane report and never a browser path", async () => {
    const context = createAgentCheckoutContext({
      herdr: {
        call: async () => ({
          pane_id: "p1",
          agent_session: session,
          tokens: agentCheckoutTokens(session, "/worktrees/agent-a"),
        }),
      },
      sshHost: () => undefined,
      shQuote: (value) => `'${value}'`,
      runProcessWithCodeTimeout: async () => ({
        code: 0,
        stdout:
          "/worktrees/agent-a\nagent-a\n/repo/.git/worktrees/agent-a\n M src/a.ts\n?? notes.txt\n",
        stderr: "",
      }),
    });
    const result = await context({
      pane_id: "p1",
      agent_session_fingerprint: agentCheckoutSessionFingerprint(session),
      checkout_path: "/browser-supplied",
    });
    expect(result).toMatchObject({
      available: true,
      checkout_path: "/worktrees/agent-a",
      branch: "agent-a",
      changed_count: 2,
    });
  });
  test("does not return a slow read after its agent session is replaced", async () => {
    let paneReads = 0;
    let started!: () => void;
    let finish!: (result: {
      code: number;
      stdout: string;
      stderr: string;
    }) => void;
    const queryStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const context = createAgentCheckoutContext({
      herdr: {
        call: async () => {
          paneReads += 1;
          return paneReads === 1
            ? {
                pane_id: "p1",
                agent_session: session,
                tokens: agentCheckoutTokens(session, "/worktrees/agent-a"),
              }
            : {
                pane_id: "p1",
                agent_session: { ...session, value: "synthetic-session-b" },
                tokens: agentCheckoutTokens(
                  { ...session, value: "synthetic-session-b" },
                  "/worktrees/agent-b",
                ),
              };
        },
      },
      sshHost: () => undefined,
      shQuote: (value) => `'${value}'`,
      runProcessWithCodeTimeout: async () => {
        started();
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    });
    const pending = context({
      pane_id: "p1",
      agent_session_fingerprint: agentCheckoutSessionFingerprint(session),
    });
    await queryStarted;
    finish({
      code: 0,
      stdout: "/worktrees/agent-a\nagent-a\n/repo/.git/worktrees/agent-a\n",
      stderr: "",
    });
    await expect(pending).resolves.toMatchObject({
      available: false,
      reason: expect.stringContaining("session changed"),
    });
    expect(paneReads).toBe(2);
  });
  test("does not return a slow read after its checkout report is replaced", async () => {
    let paneReads = 0;
    let started!: () => void;
    let finish!: (result: {
      code: number;
      stdout: string;
      stderr: string;
    }) => void;
    const queryStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const context = createAgentCheckoutContext({
      herdr: {
        call: async () => {
          paneReads += 1;
          return {
            pane_id: "p1",
            agent_session: session,
            tokens: agentCheckoutTokens(
              session,
              paneReads === 1 ? "/worktrees/agent-a" : "/worktrees/agent-b",
            ),
          };
        },
      },
      sshHost: () => undefined,
      shQuote: (value) => `'${value}'`,
      runProcessWithCodeTimeout: async () => {
        started();
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    });
    const pending = context({
      pane_id: "p1",
      agent_session_fingerprint: agentCheckoutSessionFingerprint(session),
    });
    await queryStarted;
    finish({
      code: 0,
      stdout: "/worktrees/agent-a\nagent-a\n/repo/.git/worktrees/agent-a\n",
      stderr: "",
    });
    await expect(pending).resolves.toMatchObject({
      available: false,
      reason: expect.stringContaining("report changed"),
    });
  });
  test("bounds changed-file output", () => {
    expect(
      parseAgentCheckoutStatus(`/repo\nHEAD\nfalse\n${"?? x\n".repeat(201)}`),
    ).toMatchObject({
      worktree: "detached",
      changed_count: 201,
      truncated: true,
    });
  });
  test("makes missing metadata and a replaced session unavailable", async () => {
    const context = createAgentCheckoutContext({
      herdr: {
        call: async () => ({
          pane_id: "p1",
          agent_session: { ...session, value: "synthetic-session-b" },
          tokens: {},
        }),
      },
      sshHost: () => undefined,
      shQuote: (value) => value,
      runProcessWithCodeTimeout: async () => ({
        code: 1,
        stdout: "",
        stderr: "",
      }),
    });
    await expect(
      context({
        pane_id: "p1",
        agent_session_fingerprint: agentCheckoutSessionFingerprint(session),
      }),
    ).resolves.toMatchObject({ available: false });
  });
});
