import { describe, expect, test } from "bun:test";
import {
  agentCheckoutSessionFingerprint,
  agentCheckoutTokens,
  runAgentCheckoutCommand,
} from "./agent-checkout";

const session = {
  source: "herdr:codex",
  agent: "codex",
  kind: "id",
  value: "synthetic-session-a",
};
const config = () => ({ socketPath: "/tmp/synthetic-herdr.sock" }) as never;

describe("agent-checkout", () => {
  test("reports all fifteen session-bound tokens in one no-TTL request", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> =
      [];
    const code = await runAgentCheckoutCommand(
      [
        "agent-checkout",
        "/worktrees/agent-a",
        "--pane",
        "w1:p1",
        "--pr",
        "https://example.invalid/org/repo/pull/7",
      ],
      "0.0.0",
      {
        loadConfig: config,
        log: () => undefined,
        createClient: () => ({
          call: async (method, params = {}) => {
            calls.push({ method, params });
            return method === "pane.get"
              ? { pane_id: "w1:p1", agent_session: session }
              : {};
          },
        }),
      },
    );
    expect(code).toBe(0);
    expect(calls).toHaveLength(2);
    const report = calls[1]!.params;
    expect(report).not.toHaveProperty("ttl_ms");
    expect(Object.keys(report.tokens as object)).toHaveLength(15);
    expect(
      (report.tokens as Record<string, unknown>).agent_checkout_session,
    ).toBe(agentCheckoutSessionFingerprint(session));
  });
  test("rejects clear and TTL before loading a transport", async () => {
    let loaded = 0;
    for (const args of [
      ["agent-checkout", "--clear"],
      ["agent-checkout", "/repo", "--ttl-ms", "1", "--pane", "w1:p1"],
    ])
      expect(
        await runAgentCheckoutCommand(args, "0.0.0", {
          loadConfig: () => {
            loaded += 1;
            return config();
          },
          error: () => undefined,
        }),
      ).toBe(2);
    expect(loaded).toBe(0);
  });
  test("cannot clear a newer session's complete report", async () => {
    const sessionB = { ...session, value: "synthetic-session-b" };
    const reports: Array<Record<string, unknown>> = [];
    await runAgentCheckoutCommand(
      ["agent-checkout", "/worktrees/agent-b", "--pane", "w1:p1"],
      "0.0.0",
      {
        loadConfig: config,
        log: () => undefined,
        createClient: () => ({
          call: async (method, params = {}) => {
            if (method === "pane.get") {
              return { pane_id: "w1:p1", agent_session: sessionB };
            }
            reports.push(params);
            return {};
          },
        }),
      },
    );
    let calls = 0;
    expect(
      await runAgentCheckoutCommand(["agent-checkout", "--clear"], "0.0.0", {
        error: () => undefined,
        loadConfig: () => {
          calls += 1;
          return config();
        },
      }),
    ).toBe(2);
    expect(calls).toBe(0);
    expect(reports[0]?.tokens).toMatchObject({
      agent_checkout_session: agentCheckoutSessionFingerprint(sessionB),
    });
  });
  test("bounds values and clears stale chunks when a shorter report replaces one", () => {
    const long = agentCheckoutTokens(
      session,
      "/" + "a".repeat(200),
      "https://example.invalid/org/repo/pull/123",
    );
    const short = agentCheckoutTokens(session, "/repo");
    expect(long.agent_checkout_path_3).toBeString();
    expect(short.agent_checkout_path_1).toBeNull();
    expect(short.agent_checkout_pr_0).toBeNull();
    expect(() => agentCheckoutTokens(session, "relative")).toThrow("absolute");
  });
  test("returns a bounded failure when SSH tunnel cleanup rejects", async () => {
    const errors: string[] = [];
    const reports: string[] = [];
    const code = await runAgentCheckoutCommand(
      ["agent-checkout", "/worktrees/agent-a", "--pane", "w1:p1"],
      "0.0.0",
      {
        loadConfig: config,
        error: (message) => errors.push(message),
        log: (message) => reports.push(message),
        createTunnel: () => ({
          startAutoSshTunnel: async () => undefined,
          cleanupAutoSshTunnel: async () => {
            throw new Error("synthetic cleanup rejection");
          },
        }),
        createClient: () => ({
          call: async (method) =>
            method === "pane.get"
              ? { pane_id: "w1:p1", agent_session: session }
              : {},
        }),
      },
    );
    expect(code).toBe(1);
    expect(reports).toEqual([]);
    expect(errors).toEqual([
      "agent-checkout: unable to report to the requested Herdr pane",
    ]);
  });
});
