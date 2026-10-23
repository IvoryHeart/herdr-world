import { describe, expect, test } from "bun:test";
import type { CodexDaemonThread } from "./codex-app-server";
import { createHerdrConversationSource } from "./herdr-conversation";
import type { AgentSessionFileAccess } from "./session-file-access";
import { createSessionProjectionCache } from "./session-projection-cache";
import {
  createAgentSessionResolverContext,
  resolveAgentSession,
} from "./session-resolver";
import type { HerdrCall } from "./session-types";

const ID = "019f0000-1111-7222-8333-444455556666";
const OTHER = "019f0000-1111-7222-8333-444455559999";

function fixture(remote = false) {
  const pane: Record<string, unknown> = {
    pane_id: "w1:p1",
    agent: "codex",
    agent_status: "working",
    terminal_id: "term-demo",
    terminal_title: "Codex",
    cwd: "/work/demo",
    agent_session: null,
  };
  const state = {
    pane,
    panes: [pane],
    threads: [
      {
        id: ID,
        cwd: "/work/demo",
        createdAt: Date.now() - 60000,
        updatedAt: Date.now(),
        status: "active",
        waiting: false,
      },
    ] as CodexDaemonThread[] | null,
    lookups: [] as string[],
    listCalls: 0,
    sends: [] as string[],
    onThreads: () => {},
  };
  const file = {
    path: `/fixture/rollout-${ID}.jsonl`,
    mtimeMs: Date.now(),
    size: 100,
  };
  const files: AgentSessionFileAccess = {
    remote,
    async statFile() {
      return file;
    },
    async readText() {
      return (
        JSON.stringify({
          type: "response_item",
          timestamp: new Date().toISOString(),
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Synthetic reply" }],
          },
        }) + "\n"
      );
    },
    async readPrefix() {
      return new Uint8Array();
    },
    async readDownloadBody() {
      return "";
    },
    async findPiSessionById() {
      throw new Error("wrong harness");
    },
    async findCodexSessionById(id) {
      state.lookups.push(id);
      return { ...file, path: `/fixture/rollout-${id}.jsonl` };
    },
    async findCodexSessionByPrefix(prefix) {
      return {
        ...file,
        path: `/fixture/rollout-${prefix === OTHER ? OTHER : ID}.jsonl`,
      };
    },
    async listCodexThreads(cwd) {
      expect(cwd).toBe("/work/demo");
      state.onThreads();
      return state.threads;
    },
    ...(remote
      ? {
          async clockOffset() {
            return { offsetMs: 0, uncertaintyMs: 1 };
          },
        }
      : {}),
  };
  const call: HerdrCall = async (method) => {
    if (method === "agent.get") return { agent: state.pane };
    if (method === "agent.list") {
      state.listCalls++;
      return { agents: state.panes };
    }
    state.sends.push(method);
    throw new Error(`Unexpected mutation or screen read: ${method}`);
  };
  const context = createAgentSessionResolverContext();
  const resolve = () =>
    resolveAgentSession(
      { pane_id: String(state.pane.pane_id) },
      call,
      files,
      context,
    );
  const source = () =>
    createHerdrConversationSource({
      herdrCall: call,
      files,
      context,
      cache: createSessionProjectionCache(files),
    });
  return { state, files, resolve, source };
}

describe("Codex shared-daemon inference", () => {
  test.each([false, true])(
    "unique pane and loaded thread work on their selected runtime (remote=%s)",
    async (remote) => {
      const { state, resolve } = fixture(remote);
      expect(await resolve()).toMatchObject({
        status: "ok",
        session: { source: "codex-daemon", value: ID },
      });
      expect(state.lookups).toEqual([ID]);
    },
  );

  test("title remains stronger than a stale hook and all daemon evidence", async () => {
    const { state, resolve } = fixture();
    state.pane.terminal_title = `Codex ${OTHER}`;
    state.pane.agent_session = {
      source: "herdr:codex",
      agent: "codex",
      kind: "id",
      value: ID,
    };
    state.onThreads = () => {
      throw new Error("title must not discover");
    };
    expect(await resolve()).toMatchObject({
      status: "ok",
      session: { source: "codex-title", value: OTHER },
    });
  });

  test("a reported ID is authoritative when no pane contradicts it", async () => {
    const { state, resolve } = fixture();
    state.pane.agent_session = {
      source: "herdr:codex",
      agent: "codex",
      kind: "id",
      value: ID,
    };
    state.onThreads = () => {
      throw new Error("report must not discover");
    };
    expect(await resolve()).toMatchObject({
      status: "ok",
      session: { source: "herdr:codex", value: ID },
    });
  });

  test("bulk quests reuse the listed pane snapshot for reported Codex bindings", async () => {
    const { state, source } = fixture(true);
    state.pane.agent_session = {
      source: "herdr:codex",
      agent: "codex",
      kind: "id",
      value: ID,
    };
    const chat = source();
    try {
      expect(await chat.quests(["w1:p1"])).toMatchObject([
        { session_binding: "reported" },
      ]);
      expect(state.listCalls).toBe(1);
    } finally {
      chat.dispose();
    }
  });

  test("duplicate daemon hook reports are discarded", async () => {
    const { state, resolve } = fixture();
    state.pane.agent_session = {
      source: "herdr:codex",
      agent: "codex",
      kind: "id",
      value: ID,
    };
    state.panes.push({
      ...state.pane,
      pane_id: "w1:p2",
      cwd: "/work/elsewhere",
    });
    expect(await resolve()).toMatchObject({
      status: "missing_session",
      reason: "ambiguous",
      session: null,
    });
    expect(state.lookups).toEqual([]);
  });

  test("a title on another pane contradicts a hook report, including truncated IDs", async () => {
    const { state, resolve } = fixture();
    state.pane.agent_session = {
      source: "herdr:codex",
      agent: "codex",
      kind: "id",
      value: ID,
    };
    state.panes.push({
      ...state.pane,
      pane_id: "w1:p2",
      cwd: "/work/other",
      agent_session: null,
      terminal_title: `Codex ${ID.slice(0, 29)}...`,
    });
    expect((await resolve()).reason).toBe("ambiguous");
  });

  test("an absent starter pane cannot retain the daemon's hook report", async () => {
    const { state, resolve } = fixture();
    state.pane.agent_session = {
      source: "herdr:codex",
      agent: "codex",
      kind: "id",
      value: ID,
    };
    state.panes = [];
    expect((await resolve()).reason).toBe("ambiguous");
  });

  test("a thread named by another pane is never inferred here", async () => {
    const { state, resolve } = fixture();
    state.panes.push({
      ...state.pane,
      pane_id: "w1:p2",
      cwd: "/work/other",
      terminal_title: `Codex ${ID.slice(0, 29)}...`,
    });
    expect((await resolve()).session).toBeNull();
  });

  test("a title without its saved thread never falls through to discovery", async () => {
    const { state, files, resolve } = fixture();
    state.pane.terminal_title = `Codex ${OTHER}`;
    files.findCodexSessionByPrefix = async () => null;
    state.onThreads = () => {
      throw new Error("no discovery through a title");
    };
    expect(await resolve()).toMatchObject({
      reason: "no_messages_yet",
      session: null,
    });
  });

  test("two panes in one cwd both remain unbound", async () => {
    const { state, resolve } = fixture();
    state.panes.push({ ...state.pane, pane_id: "w1:p2" });
    expect((await resolve()).session).toBeNull();
    state.pane = state.panes[1]!;
    expect((await resolve()).session).toBeNull();
  });

  test("an idle or old competing thread prevents a guess", async () => {
    const { state, resolve } = fixture();
    state.threads!.push({
      ...state.threads![0]!,
      id: OTHER,
      status: "idle",
      updatedAt: 1,
    });
    expect((await resolve()).session).toBeNull();
  });

  test.each([
    "old",
    "future",
    "wrong-cwd",
    "wrong-status",
    "unknown-status",
    "missing",
    "pane-changed",
    "competitor-appeared",
    "unknown-cwd-appeared",
    "clock-changed",
  ])("drops %s evidence", async (mode) => {
    const { state, files, resolve } = fixture();
    const thread = state.threads![0]!;
    if (mode === "old") {
      thread.createdAt = 1;
      thread.updatedAt = 2;
    }
    if (mode === "future") thread.updatedAt = Date.now() + 60000;
    if (mode === "wrong-cwd") thread.cwd = "/work/other";
    if (mode === "wrong-status") thread.status = "idle";
    if (mode === "unknown-status") state.pane.agent_status = "unknown";
    if (mode === "missing") state.threads = null;
    if (mode === "pane-changed")
      state.onThreads = () => {
        state.pane.terminal_title = "Changed";
      };
    if (mode === "competitor-appeared")
      state.onThreads = () => {
        state.panes.push({ ...state.pane, pane_id: "w1:p2" });
      };
    if (mode === "unknown-cwd-appeared")
      state.onThreads = () => {
        state.panes.push({ ...state.pane, pane_id: "w1:p2", cwd: null });
      };
    if (mode === "clock-changed")
      files.clockOffset = async () => {
        state.pane.terminal_title = "Changed while measuring the remote clock";
        return { offsetMs: 0, uncertaintyMs: 1 };
      };
    expect((await resolve()).session).toBeNull();
    expect(state.lookups).toEqual([]);
  });

  test("does not retain a guess after the candidate set changes", async () => {
    const { state, resolve } = fixture();
    expect((await resolve()).status).toBe("ok");
    state.threads!.push({ ...state.threads![0]!, id: OTHER });
    expect((await resolve()).session).toBeNull();
  });

  test("exhausts pane/thread cardinality and status agreement", async () => {
    for (const countPanes of [0, 1, 2])
      for (const countThreads of [0, 1, 2])
        for (const status of ["working", "blocked", "idle", "done", "unknown"])
          for (const threadStatus of ["active", "idle"] as const)
            for (const waiting of [false, true]) {
              const { state, resolve } = fixture();
              state.pane.agent_status = status;
              state.panes = Array.from({ length: countPanes }, (_, i) => ({
                ...state.pane,
                pane_id: `w1:p${i + 1}`,
              }));
              state.threads = Array.from({ length: countThreads }, (_, i) => ({
                ...state.threads![0]!,
                id: i ? OTHER : ID,
                status: threadStatus,
                waiting,
              }));
              const agrees =
                threadStatus === "idle"
                  ? ["idle", "done"].includes(status)
                  : status === (waiting ? "blocked" : "working");
              expect((await resolve()).status === "ok").toBe(
                countPanes === 1 && countThreads === 1 && agrees,
              );
            }
  });

  test("a connection with no daemon never reads another connection's transcript", async () => {
    const first = fixture();
    const second = fixture(true);
    expect((await first.resolve()).session?.value).toBe(ID);
    second.state.threads = null;
    expect((await second.resolve()).session).toBeNull();
    expect(second.state.lookups).toEqual([]);
  });

  test("Chat reads guesses but never sends or exposes answer keys", async () => {
    const { state, source } = fixture(true);
    const chat = source();
    try {
      expect(await chat.read({ pane_id: "w1:p1" })).toMatchObject({
        status: "ok",
        session_binding: "guessed",
        session_fingerprint: null,
        messages: [{ text: "Synthetic reply" }],
      });
      expect(
        (
          await chat.send({
            pane_id: "w1:p1",
            text: "Synthetic follow-up",
            session_fingerprint: "forged",
            baseline: [],
          })
        ).status,
      ).toBe("refused");
      state.pane.agent_status = "blocked";
      state.threads![0]!.waiting = true;
      expect((await chat.read({ pane_id: "w1:p1" })).pending_prompt).toBeNull();
      expect(
        (
          await chat.answer({
            pane_id: "w1:p1",
            key: "y",
            prompt_fingerprint: "forged",
          })
        ).status,
      ).toBe("refused");
      expect(state.sends).toEqual([]);
    } finally {
      chat.dispose();
    }
  });
});
