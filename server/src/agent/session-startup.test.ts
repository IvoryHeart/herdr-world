import { expect, test } from "bun:test";
import {
  createAgentSessionResolverContext,
  resolveAgentSessionInfo,
} from "./session-resolver";
import type { AgentSessionFileAccess } from "./session-file-access";
const files = { remote: false } as AgentSessionFileAccess;
for (const agent_status of ["blocked", "unknown"]) {
  test(`${agent_status} without a session describes startup instead of an integration failure`, async () => {
    const resolved = await resolveAgentSessionInfo(
      { pane_id: "pane" },
      {
        agent: "claude",
        agent_status,
        terminal_id: "terminal",
        launch_pending: true,
      },
      files,
      createAgentSessionResolverContext(),
    );
    expect(resolved.reason).toBe("no_session");
    expect(resolved.detail.toLowerCase()).not.toContain("install");
    expect(resolved.detail).toContain("Terminal");
    expect(resolved.command).toBeUndefined();
  });
}

import { createSessionStartupTracker } from "./session-startup";
test("integration advice requires a continuing running terminal and a grace period", async () => {
  let now = 0;
  const context = createAgentSessionResolverContext();
  context.sessionStartup = createSessionStartupTracker(() => now);
  const info = {
    agent: "claude",
    agent_status: "working",
    terminal_id: "terminal",
    interactive_ready: true,
  };
  const read = () =>
    resolveAgentSessionInfo({ pane_id: "pane" }, info, files, context);
  expect((await read()).command).toBeUndefined();
  now = 29_999;
  expect((await read()).command).toBeUndefined();
  now = 30_000;
  expect((await read()).command).toContain("integration install");
  info.agent_status = "blocked";
  expect((await read()).command).toBeUndefined();
  info.agent_status = "idle";
  expect((await read()).command).toBeUndefined();
  now += 30_000;
  expect((await read()).command).toContain("integration install");
  info.terminal_id = "replacement";
  expect((await read()).command).toBeUndefined();
});
test("pending launches, missing terminal evidence, bounded eviction and explicit reset never inherit grace", () => {
  let now = 0;
  const tracker = createSessionStartupTracker(() => now, 2);
  const info = {
    agent_status: "idle",
    terminal_id: "terminal",
    interactive_ready: true,
  };
  expect(tracker.message("one", "claude", info)).not.toBeNull();
  now = 30_000;
  expect(tracker.message("one", "claude", info)).toBeNull();
  expect(
    tracker.message("one", "claude", { ...info, launch_pending: true }),
  ).not.toBeNull();
  expect(tracker.message("one", "claude", info)).not.toBeNull();
  tracker.message("two", "claude", info);
  tracker.message("three", "claude", info);
  now += 30_000;
  expect(tracker.message("one", "claude", info)).not.toBeNull();
  tracker.clear("one");
  expect(tracker.message("one", "claude", info)).not.toBeNull();
  expect(
    tracker.message("missing", "claude", { agent_status: "idle" }),
  ).not.toBeNull();
});

test("idle labels alone do not prove a running harness", () => {
  let now = 0;
  const tracker = createSessionStartupTracker(() => now);
  const info = { agent_status: "idle", terminal_id: "terminal" };
  tracker.message("pane", "claude", info);
  now = 60_000;
  expect(tracker.message("pane", "claude", info)).not.toBeNull();
});

test("a continuing Codex harness retains title/integration guidance after grace", async () => {
  let now = 0;
  const context = createAgentSessionResolverContext();
  context.sessionStartup = createSessionStartupTracker(() => now);
  const info = {
    agent: "codex",
    agent_status: "working",
    terminal_id: "terminal",
  };
  const read = () =>
    resolveAgentSessionInfo({ pane_id: "codex-pane" }, info, files, context);
  expect((await read()).command).toBeUndefined();
  now = 30_000;
  const resolved = await read();
  expect(resolved.detail).toContain("/title");
  expect(resolved.detail).toContain("--no-daemon");
  expect(resolved.command).toBe("herdr integration install codex");
});
