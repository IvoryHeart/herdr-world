import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CODEX_DAEMON_ISSUE,
  createHerdrConversationSource,
  paneBinding,
} from "./herdr-conversation";
import type { Conversation } from "./conversation";
import {
  localAgentSessionFiles,
  type AgentSessionFileAccess,
} from "./session-file-access";
import { createSessionProjectionCache } from "./session-projection-cache";
import { createAgentSessionResolverContext } from "./session-resolver";
import type { HerdrCall } from "./session-types";

// One synthetic conversation per harness World reads, each in the harness's
// own transcript format: a question, one tool call and result, an answer.
// No model runs; Herdr is a fake that reports the agent and its session.

import { fixtures, QUESTION, ANSWER } from "./testing/conversation-fixtures";

let root = "";

function herdr(agent: Record<string, unknown> | null, prompts: unknown[] = []) {
  const call: HerdrCall = async (method, params) => {
    if (method === "pane.read") return { read: { text: "❯ " } };
    if (method === "agent.get") return { agent };
    if (method === "agent.list") return { agents: agent ? [agent] : [] };
    if (method === "agent.prompt") {
      prompts.push(params);
      // Herdr 0.9 replies with the pane's agent snapshot at submission.
      return { agent };
    }
    throw new Error(`unexpected ${method}`);
  };
  return call;
}

function source(
  call: HerdrCall,
  options: {
    remote?: boolean;
    platform?: string;
    files?: AgentSessionFileAccess;
  } = {},
) {
  const files =
    options.files ??
    (options.remote
      ? { ...localAgentSessionFiles, remote: true }
      : localAgentSessionFiles);
  return createHerdrConversationSource({
    herdrCall: call,
    files,
    context: createAgentSessionResolverContext(),
    cache: createSessionProjectionCache(files),
    remotePlatform: options.platform,
  });
}

function pane(agent: string, session?: Record<string, unknown>) {
  return {
    pane_id: "w1:p1",
    workspace_id: "w1",
    tab_id: "w1:t1",
    agent,
    agent_status: "done",
    cwd: "/work/demo",
    ...(session ? { agent_session: session } : {}),
  };
}

const unavailable = (conversation: Conversation) =>
  conversation.status === "unavailable" ? conversation.unavailable : null;

// Directory and ID fallbacks must search an empty home, never the real one.
const HOME_VARIABLES = [
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "GROK_HOME",
  "ANTIGRAVITY_HOME",
  "GEMINI_HOME",
  "XDG_DATA_HOME",
  "PI_CODING_AGENT_DIR",
] as const;
const savedHome = new Map<string, string | undefined>();

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "herdr-world-conversation-"));
  for (const name of HOME_VARIABLES) {
    savedHome.set(name, process.env[name]);
    process.env[name] = join(root, "home", name.toLowerCase());
  }
});
afterAll(async () => {
  for (const [name, value] of savedHome) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(root, { recursive: true, force: true });
});

describe("conversation read model across harnesses", () => {
  for (const fixture of fixtures) {
    describe(fixture.agent, () => {
      test("reads messages and the latest assistant message", async () => {
        const dir = await mkdtemp(join(root, `${fixture.agent}-`));
        const path = await fixture.write(dir);
        const conversation = await source(
          herdr(
            pane(fixture.agent, {
              source: `herdr:${fixture.agent}`,
              agent: fixture.agent,
              kind: "path",
              value: path,
            }),
          ),
        ).read({ pane_id: "w1:p1" });
        expect(unavailable(conversation)).toBeNull();
        expect(conversation.agent).toBe(fixture.agent);
        expect(conversation.agent_status).toBe("done");
        expect(conversation.session_fingerprint).toMatch(/^[a-f0-9]{64}$/);
        const shape = conversation.messages.map((message) =>
          message.kind === "activity"
            ? `tool:${message.tools?.length}`
            : message.kind === "notice"
              ? `notice:${message.text}`
              : `${message.role}:${message.text}`,
        );
        expect(shape).toEqual([
          ...(fixture.lead ?? []),
          `user:${QUESTION}`,
          ...(fixture.tools === false ? [] : ["tool:1"]),
          `assistant:${ANSWER}`,
        ]);
        expect(conversation.session_binding).toBe("reported");
        expect(conversation.latest?.text).toBe(ANSWER);
      });

      test("reports a missing transcript", async () => {
        const conversation = await source(
          herdr(
            pane(fixture.agent, {
              source: `herdr:${fixture.agent}`,
              agent: fixture.agent,
              kind: "path",
              value: join(root, "absent", "gone.jsonl"),
            }),
          ),
        ).read({ pane_id: "w1:p1" });
        expect(conversation.messages).toEqual([]);
        expect(conversation.latest).toBeNull();
        expect(unavailable(conversation)?.reason).toBe("file_missing");
      });

      test("reports a pane with no reported session", async () => {
        const conversation = await source(herdr(pane(fixture.agent))).read({
          pane_id: "w1:p1",
        });
        expect(conversation.messages).toEqual([]);
        expect(unavailable(conversation)).toMatchObject({
          reason: fixture.agent === "codex" ? "codex_unlinked" : "no_session",
          detail: expect.any(String),
        });
        if (fixture.agent === "codex")
          expect(unavailable(conversation)?.issue).toBe(CODEX_DAEMON_ISSUE);
      });

      test("sends only to the conversation it read", async () => {
        const dir = await mkdtemp(join(root, `${fixture.agent}-send-`));
        const path = await fixture.write(dir);
        const prompts: unknown[] = [];
        const reported = pane(fixture.agent, {
          source: `herdr:${fixture.agent}`,
          agent: fixture.agent,
          kind: "path",
          value: path,
        });
        const chat = source(herdr(reported, prompts));
        const { session_fingerprint } = await chat.read({ pane_id: "w1:p1" });
        expect(
          await chat.send({
            pane_id: "w1:p1",
            text: "Thanks",
            session_fingerprint: session_fingerprint!,
          }),
        ).toMatchObject({ status: "sent", delivery: { state: "pending" } });
        expect(prompts).toEqual([{ target: "w1:p1", text: "Thanks" }]);
        expect(
          await chat.send({
            pane_id: "w1:p1",
            text: "Again",
            session_fingerprint: "0".repeat(64),
          }),
        ).toMatchObject({ status: "refused", reason: "changed" });
        expect(prompts).toHaveLength(1);
      });
    });
  }
});

describe("conversation availability", () => {
  // Herdr detects these harnesses, but World has no transcript reader yet.
  const HERDR_ONLY = [
    "gemini",
    "cursor",
    "devin",
    "cline",
    "mastracode",
    "opencode",
    "copilot",
    "kiro",
    "droid",
    "amp",
    "hermes",
    "kilo",
    "qodercli",
    "qwen",
    "letta",
    "maki",
  ];
  for (const agent of HERDR_ONLY) {
    test(`${agent} is an unsupported harness`, async () => {
      const conversation = await source(herdr(pane(agent))).read({
        pane_id: "w1:p1",
      });
      expect(unavailable(conversation)?.reason).toBe("unsupported_harness");
      expect(conversation.agent).toBe(agent);
    });
  }

  test("a pane without an agent has no conversation", async () => {
    const conversation = await source(herdr(null)).read({ pane_id: "w1:p1" });
    expect(unavailable(conversation)?.reason).toBe("no_agent");
    // Herdr 0.9 rejects a shell pane as an agent target.
    const shell = await source(async () => {
      throw new Error("agent_not_found: agent target w1:p2 not found");
    }).read({ pane_id: "w1:p2" });
    expect(unavailable(shell)?.reason).toBe("no_agent");
  });

  test("a Windows host is reported, not read", async () => {
    const conversation = await source(herdr(pane("claude")), {
      platform: "windows",
    }).read({ pane_id: "w1:p1" });
    expect(unavailable(conversation)?.reason).toBe("unsupported_platform");
  });

  test("a remote ID lookup never searches this machine", async () => {
    for (const agent of ["kimi", "grok", "agy", "omp"]) {
      const conversation = await source(
        herdr(
          pane(agent, {
            source: `herdr:${agent}`,
            agent,
            kind: "id",
            value: "session-1",
          }),
        ),
        { remote: true },
      ).read({ pane_id: "w1:p1" });
      expect(unavailable(conversation)?.reason).toBe("remote_lookup");
    }
  });

  test("a remote Claude UUID uses only its supplied host lookup", async () => {
    const id = "019a0000-1111-7222-8333-444455556666";
    const lookups: string[] = [];
    const files = {
      ...localAgentSessionFiles,
      remote: true,
      async findClaudeSessionById(value: string) {
        lookups.push(value);
        return null;
      },
      async statFile(): Promise<never> {
        throw new Error(
          "A missing remote UUID must not fall back to a local path.",
        );
      },
      async readText(): Promise<never> {
        throw new Error("A missing remote UUID must not read local content.");
      },
    };
    const chat = createHerdrConversationSource({
      herdrCall: herdr(
        pane("claude", {
          source: "herdr:claude",
          agent: "claude",
          kind: "id",
          value: id,
        }),
      ),
      files,
      context: createAgentSessionResolverContext(),
      cache: createSessionProjectionCache(files),
    });
    const conversation = await chat.read({ pane_id: "w1:p1" });
    expect(unavailable(conversation)?.reason).toBe("file_missing");
    expect(lookups).toEqual([id]);
  });

  test("a transcript that cannot be read says so", async () => {
    const files = {
      ...localAgentSessionFiles,
      statFile: async (path: string) => ({ path, mtimeMs: 1 }),
      readText: async () => {
        throw new Error("permission denied");
      },
    };
    const chat = createHerdrConversationSource({
      herdrCall: herdr(
        pane("claude", {
          source: "herdr:claude",
          agent: "claude",
          kind: "path",
          value: "/work/demo/session.jsonl",
        }),
      ),
      files,
      context: createAgentSessionResolverContext(),
      cache: createSessionProjectionCache(files),
    });
    const conversation = await chat.read({ pane_id: "w1:p1" });
    expect(unavailable(conversation)).toMatchObject({
      reason: "read_failed",
      detail: expect.stringContaining("permission denied"),
    });
  });

  describe("Codex thread named by the pane title", () => {
    const thread = "019a0000-0000-7000-8000-0000000000c1";
    const title = (id: string) => `demo · ${id.slice(0, 29)}...`;

    test("reads the thread the title names", async () => {
      const dir = join(process.env.CODEX_HOME!, "sessions", "2026", "10", "22");
      await mkdir(dir, { recursive: true });
      const written = await fixtures[0]!.write(dir);
      const { rename } = await import("node:fs/promises");
      await rename(
        written,
        join(dir, `rollout-2026-10-22T09-00-00-${thread}.jsonl`),
      );
      const conversation = await source(
        herdr({ ...pane("codex"), terminal_title: title(thread) }),
      ).read({ pane_id: "w1:p1" });
      expect(conversation.status).toBe("ok");
      expect(conversation.latest?.text).toBe(ANSWER);
    });

    test("a new thread shows no messages and is not sent to until its ID resolves", async () => {
      const prompts: unknown[] = [];
      const chat = source(
        herdr(
          {
            ...pane("codex"),
            terminal_title: title("019b0000-0000-7000-8000-0000000000d2"),
          },
          prompts,
        ),
      );
      const conversation = await chat.read({ pane_id: "w1:p1" });
      // The title shows 29 ID characters; without a transcript there is no
      // complete thread ID to bind, so Chat must not guess one.
      expect(conversation).toMatchObject({
        status: "ok",
        session_binding: "title",
        session_fingerprint: null,
        messages: [],
        latest: null,
      });
      expect(
        await chat.send({
          pane_id: "w1:p1",
          text: "Start here",
          session_fingerprint: "",
        }),
      ).toMatchObject({ status: "refused", reason: "unavailable" });
      expect(prompts).toEqual([]);
    });
  });

  test("send refuses empty text, unreadable conversations and a blocked agent", async () => {
    const prompts: unknown[] = [];
    expect(
      await source(herdr(pane("claude"), prompts)).send({
        pane_id: "w1:p1",
        text: "  ",
        session_fingerprint: "",
      }),
    ).toMatchObject({ status: "refused", reason: "empty" });
    expect(
      await source(herdr(pane("opencode"), prompts)).send({
        pane_id: "w1:p1",
        text: "hello",
        session_fingerprint: "",
      }),
    ).toMatchObject({ status: "refused", reason: "unavailable" });
    expect(prompts).toEqual([]);

    const dir = await mkdtemp(join(root, "blocked-"));
    const path = await fixtures[1]!.write(dir);
    const reported = pane("claude", {
      source: "herdr:claude",
      agent: "claude",
      kind: "path",
      value: path,
    });
    const blocked: HerdrCall = async (method, params) => {
      if (method === "pane.read") return { read: { text: "❯ " } };
      if (method === "agent.prompt")
        throw new Error("agent_blocked: agent is blocked");
      return herdr(reported)(method, params);
    };
    const chat = source(blocked);
    const { session_fingerprint } = await chat.read({ pane_id: "w1:p1" });
    expect(
      await chat.send({
        pane_id: "w1:p1",
        text: "hello",
        session_fingerprint: session_fingerprint!,
      }),
    ).toMatchObject({ status: "refused", reason: "blocked" });
  });

  test("latest for every agent omits the message list", async () => {
    const dir = await mkdtemp(join(root, "latest-"));
    const path = await fixtures[1]!.write(dir);
    const [latest, ...rest] = await source(
      herdr(
        pane("claude", {
          source: "herdr:claude",
          agent: "claude",
          kind: "path",
          value: path,
        }),
      ),
    ).latestAll();
    expect(rest).toEqual([]);
    expect(latest).not.toHaveProperty("messages");
    expect(latest).toMatchObject({
      pane_id: "w1:p1",
      agent: "claude",
      agent_status: "done",
      status: "ok",
      latest: { role: "assistant", text: ANSWER },
    });
  });
});

describe("quests", () => {
  const todo = (status: string) =>
    JSON.stringify({
      type: "assistant",
      uuid: "q1",
      timestamp: "2026-10-22T10:00:01Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_q1",
            name: "TodoWrite",
            input: { todos: [{ content: "Example step", status }] },
          },
        ],
      },
    });

  test("quests come with the conversation and in bulk, without messages", async () => {
    const dir = await mkdtemp(join(root, "quest-"));
    const path = join(dir, "session.jsonl");
    await writeFile(path, `${todo("in_progress")}\n`);
    const chat = source(
      herdr(
        pane("claude", {
          source: "herdr:claude",
          agent: "claude",
          kind: "path",
          value: path,
        }),
      ),
    );
    expect((await chat.read({ pane_id: "w1:p1" })).quest).toMatchObject({
      source: "todo",
      progress: { done: 0, total: 1 },
    });
    await writeFile(path, `${todo("completed")}\n`);
    expect(await chat.quests()).toEqual([
      {
        pane_id: "w1:p1",
        agent: "claude",
        session_binding: "reported",
        session_fingerprint: expect.any(String),
        quest: expect.objectContaining({
          status: "done",
          progress: { done: 1, total: 1 },
          set_by: "call_q1",
        }),
        usage_stop: null,
      },
    ]);
  });

  test.each(["conversation", "quests"] as const)(
    "a usage-limit stop clears after a same-metadata rewrite, reading %s first",
    async (firstRead) => {
      const dir = await mkdtemp(join(root, "quest-"));
      const path = join(dir, "session.jsonl");
      const refusal = (resetsAt: number) =>
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-10-22T10:00:02Z",
          isApiErrorMessage: true,
          error: "rate_limit",
          apiError: "usage_limit_reached",
          apiErrorParams: { rate_limit_info: { resetsAt } },
          message: {
            model: "<synthetic>",
            content: [{ type: "text", text: "SYNTHETIC" }],
          },
        });
      const resets = Math.floor(Date.now() / 1000) + 3600;
      await writeFile(path, `${todo("in_progress")}\n${refusal(resets)}\n`);
      const initial = await localAgentSessionFiles.statFile(path);
      expect(initial).not.toBeNull();
      // Filesystems can give rapid same-size writes identical mtime and ctime,
      // even at nanosecond precision. Force that collision without a timing race.
      const files: AgentSessionFileAccess = {
        ...localAgentSessionFiles,
        async statFile(candidate) {
          const file = await localAgentSessionFiles.statFile(candidate);
          return (
            file && {
              ...file,
              mtimeMs: initial!.mtimeMs,
              changeToken: initial!.changeToken,
            }
          );
        },
      };
      const chat = source(
        herdr(
          pane("claude", {
            source: "herdr:claude",
            agent: "claude",
            kind: "path",
            value: path,
          }),
        ),
        { files },
      );
      const stop = {
        harness: "claude" as const,
        at: Date.parse("2026-10-22T10:00:02Z"),
        resets_at: resets * 1000,
      };
      expect((await chat.read({ pane_id: "w1:p1" })).usage_stop).toEqual(stop);
      expect((await chat.quests())[0]?.usage_stop).toEqual(stop);
      // Once the reset has passed, the stop no longer holds.
      await writeFile(
        path,
        `${todo("in_progress")}\n${refusal(resets - 7200)}\n`,
      );
      expect(await files.statFile(path)).toEqual(initial);
      if (firstRead === "quests")
        expect((await chat.quests())[0]?.usage_stop).toBeNull();
      expect((await chat.read({ pane_id: "w1:p1" })).usage_stop).toBeNull();
      expect((await chat.quests())[0]?.usage_stop).toBeNull();
    },
  );

  test("a bulk read lists agents once instead of asking for each pane", async () => {
    const dir = await mkdtemp(join(root, "quest-"));
    const path = join(dir, "session.jsonl");
    await writeFile(path, `${todo("in_progress")}\n`);
    const inner = herdr(
      pane("claude", {
        source: "herdr:claude",
        agent: "claude",
        kind: "path",
        value: path,
      }),
    );
    const calls: string[] = [];
    let listFails = false;
    const chat = source(async (method, params) => {
      if (method === "pane.read") return { read: { text: "❯ " } };
      calls.push(method);
      if (method === "agent.list" && listFails) throw new Error("offline");
      return inner(method, params);
    });
    const quests = await chat.quests(["w1:p1", "w1:p2", "w1:p3"]);
    expect(calls).toEqual(["agent.list"]);
    expect(quests.map((entry) => [entry.pane_id, entry.quest?.source])).toEqual(
      [
        ["w1:p1", "todo"],
        ["w1:p2", undefined],
        ["w1:p3", undefined],
      ],
    );
    // Without the list, every asked pane keeps its last quest.
    listFails = true;
    expect(
      (await chat.quests(["w1:p1", "w1:p2"])).map((entry) => entry.read_failed),
    ).toEqual([true, true]);
  });

  test("a quest that cannot be read is marked, not reported as none", async () => {
    const files = {
      ...localAgentSessionFiles,
      statFile: async (path: string) => ({ path, mtimeMs: 1 }),
      readText: async () => {
        throw new Error("changed while reading");
      },
    };
    const chat = createHerdrConversationSource({
      herdrCall: herdr(
        pane("claude", {
          source: "herdr:claude",
          agent: "claude",
          kind: "path",
          value: "/work/demo/session.jsonl",
        }),
      ),
      files,
      context: createAgentSessionResolverContext(),
      cache: createSessionProjectionCache(files),
    });
    // The session is known, so the reply names it: a browser keeps the last
    // quest only if it came from this session.
    const [failed] = await chat.quests(["w1:p1"]);
    expect(failed).toEqual({
      pane_id: "w1:p1",
      agent: "claude",
      session_binding: "reported",
      session_fingerprint: expect.any(String),
      quest: null,
      read_failed: true,
    });
  });

  test("a pane without an agent has no quest", async () => {
    expect(await source(herdr(null)).quests(["w1:p9"])).toEqual([
      {
        pane_id: "w1:p9",
        agent: null,
        session_binding: null,
        session_fingerprint: null,
        quest: null,
      },
    ]);
  });
});

describe("conversation binding and remote admission", () => {
  test("remote Grok and Antigravity paths are refused, never read locally", async () => {
    // A local file at the reported path must not stand in for the remote one.
    const dir = await mkdtemp(join(root, "remote-collision-"));
    const grok = await fixtures.find((f) => f.agent === "grok")!.write(dir);
    const agy = await fixtures.find((f) => f.agent === "agy")!.write(dir);
    for (const [agent, path] of [
      ["grok", grok],
      ["agy", agy],
    ] as const) {
      const files = {
        ...localAgentSessionFiles,
        remote: true,
        statFile: async (value: string) => ({
          path: value,
          mtimeMs: 1,
          size: 1,
        }),
        readText: async () => {
          throw new Error("remote read attempted");
        },
      };
      const chat = createHerdrConversationSource({
        herdrCall: herdr(
          pane(agent, {
            source: `herdr:${agent}`,
            agent,
            kind: "path",
            value: path,
          }),
        ),
        files,
        context: createAgentSessionResolverContext(),
        cache: createSessionProjectionCache(files),
      });
      const conversation = await chat.read({ pane_id: "w1:p1" });
      expect(unavailable(conversation)?.reason).toBe("remote_lookup");
      expect(conversation.messages).toEqual([]);
    }
  });

  test("a conversation found in the pane's folder is shown but cannot be sent to", async () => {
    const session = join(
      process.env.GROK_HOME!,
      "sessions",
      encodeURIComponent("/work/guess"),
      "folder-guess",
    );
    await mkdir(session, { recursive: true });
    const written = await fixtures
      .find((f) => f.agent === "grok")!
      .write(await mkdtemp(join(root, "grok-guess-")));
    const { copyFile } = await import("node:fs/promises");
    await copyFile(written, join(session, "chat_history.jsonl"));
    await writeFile(
      join(session, "summary.json"),
      JSON.stringify({ info: { id: "folder-guess", cwd: "/work/guess" } }),
    );
    const prompts: unknown[] = [];
    const chat = source(
      herdr({ ...pane("grok"), cwd: "/work/guess" }, prompts),
    );
    const conversation = await chat.read({ pane_id: "w1:p1" });
    expect(conversation).toMatchObject({
      status: "ok",
      session_binding: "guessed",
      session_fingerprint: null,
      latest: { text: ANSWER },
    });
    expect(
      await chat.send({
        pane_id: "w1:p1",
        text: "hello",
        session_fingerprint: "",
      }),
    ).toMatchObject({ status: "refused", reason: "unavailable" });
    expect(prompts).toEqual([]);
  });

  test("send rereads the pane immediately before prompting", async () => {
    const dir = await mkdtemp(join(root, "race-"));
    const path = await fixtures[1]!.write(dir);
    const reported = (value: string) =>
      pane("claude", {
        source: "herdr:claude",
        agent: "claude",
        kind: "path",
        value,
      });
    let current = reported(path);
    const log: string[] = [];
    const call: HerdrCall = async (method) => {
      if (method === "pane.read") return { read: { text: "❯ " } };
      log.push(method);
      if (method === "agent.get") return { agent: current };
      if (method === "agent.prompt") return { agent: current };
      throw new Error(`unexpected ${method}`);
    };
    const chat = source(call);
    const { session_fingerprint } = await chat.read({ pane_id: "w1:p1" });
    // The pane switches sessions after Chat read it: nothing is sent.
    current = reported(join(dir, "other.jsonl"));
    log.length = 0;
    expect(
      await chat.send({
        pane_id: "w1:p1",
        text: "hello",
        session_fingerprint: session_fingerprint!,
      }),
    ).toMatchObject({ status: "refused", reason: "changed" });
    expect(log.at(-1)).toBe("agent.get");
    expect(log).not.toContain("agent.prompt");
    // Unchanged, the check is the last Herdr call before the prompt.
    current = reported(path);
    log.length = 0;
    expect(
      await chat.send({
        pane_id: "w1:p1",
        text: "hello",
        session_fingerprint: session_fingerprint!,
      }),
    ).toMatchObject({ status: "sent", delivery: { state: "pending" } });
    expect(log.slice(-2)).toEqual(["agent.get", "agent.prompt"]);
  });

  test("a Codex title binds complete thread IDs only", async () => {
    const context = createAgentSessionResolverContext();
    const reported = {
      ...pane("codex"),
      agent_session: {
        source: "herdr:codex",
        agent: "codex",
        kind: "id",
        value: "019c0000-0000-7000-8000-000000000003",
      },
    };
    expect(paneBinding("codex", reported, context)?.binding).toBe("reported");
    const titled = (terminal_title: string) => ({
      ...reported,
      terminal_title,
    });
    // Two full IDs that share 29 characters are two threads.
    const first = paneBinding(
      "codex",
      titled("demo 019a0000-0000-7000-8000-000000000001"),
      context,
    );
    const second = paneBinding(
      "codex",
      titled("demo 019a0000-0000-7000-8000-000000000002"),
      context,
    );
    expect(first?.binding).toBe("title");
    expect(first?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(second?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first?.fingerprint).not.toBe(second?.fingerprint);
    // A truncated ID is unresolved until a read finds its one transcript;
    // the title still decides over a possibly stale report.
    const truncated = titled("demo · 019c0000-0000-7000-8000-00000...");
    expect(paneBinding("codex", truncated, context)).toEqual({
      binding: "title",
      fingerprint: null,
    });
    context.codexTitles.set("019c0000-0000-7000-8000-00000", {
      id: "019c0000-0000-7000-8000-000000000003",
      path: "/work/demo/rollout.jsonl",
    });
    expect(paneBinding("codex", truncated, context)?.fingerprint).toBe(
      paneBinding(
        "codex",
        titled("demo 019c0000-0000-7000-8000-000000000003"),
        context,
      )?.fingerprint,
    );
    // A title naming two threads binds nothing that can be sent to.
    expect(
      paneBinding(
        "codex",
        titled(
          "019c0000-0000-7000-8000-00000... 019d0000-0000-7000-8000-00000...",
        ),
        context,
      ),
    ).toEqual({ binding: "title", fingerprint: null });
    expect(paneBinding("grok", pane("grok"), context)).toBeNull();
  });

  test("a switch between two full Codex IDs is refused", async () => {
    const dir = join(process.env.CODEX_HOME!, "sessions", "2026", "10", "21");
    await mkdir(dir, { recursive: true });
    const { copyFile } = await import("node:fs/promises");
    const written = await fixtures[0]!.write(
      await mkdtemp(join(root, "full-")),
    );
    for (const id of [
      "019a0000-0000-7000-8000-0000000000e1",
      "019a0000-0000-7000-8000-0000000000e2",
    ])
      await copyFile(
        written,
        join(dir, `rollout-2026-10-21T09-00-00-${id}.jsonl`),
      );
    let current = {
      ...pane("codex"),
      terminal_title: "demo 019a0000-0000-7000-8000-0000000000e1",
    };
    const prompts: unknown[] = [];
    const call: HerdrCall = async (method, params) => {
      if (method === "pane.read") return { read: { text: "❯ " } };
      if (method === "agent.get") return { agent: current };
      if (method === "agent.prompt") {
        prompts.push(params);
        return { agent: current };
      }
      throw new Error(`unexpected ${method}`);
    };
    const chat = source(call);
    const read = await chat.read({ pane_id: "w1:p1" });
    expect(read).toMatchObject({ status: "ok", session_binding: "title" });
    current = {
      ...current,
      terminal_title: "demo 019a0000-0000-7000-8000-0000000000e2",
    };
    expect(
      await chat.send({
        pane_id: "w1:p1",
        text: "hello",
        session_fingerprint: read.session_fingerprint!,
      }),
    ).toMatchObject({ status: "refused", reason: "changed" });
    expect(prompts).toEqual([]);
  });

  test("watching reuses a resolved Codex title until it stops matching", async () => {
    const dir = join(process.env.CODEX_HOME!, "sessions", "2026", "10", "20");
    await mkdir(dir, { recursive: true });
    const { copyFile, rm: remove } = await import("node:fs/promises");
    const thread = "019e0000-0000-7000-8000-0000000000f1";
    const path = join(dir, `rollout-2026-10-20T09-00-00-${thread}.jsonl`);
    await copyFile(
      await fixtures[0]!.write(await mkdtemp(join(root, "watch-"))),
      path,
    );
    let searches = 0;
    const files = {
      ...localAgentSessionFiles,
      findCodexSessionByPrefix: async (prefix: string) => {
        searches += 1;
        return localAgentSessionFiles.findCodexSessionByPrefix(prefix);
      },
    };
    const chat = createHerdrConversationSource({
      herdrCall: herdr({
        ...pane("codex"),
        terminal_title: `demo · ${thread.slice(0, 29)}...`,
      }),
      files,
      context: createAgentSessionResolverContext(),
      cache: createSessionProjectionCache(files),
    });
    await chat.read({ pane_id: "w1:p1" });
    expect(searches).toBe(1);
    const first = await chat.identity({ pane_id: "w1:p1" });
    await chat.identity({ pane_id: "w1:p1" });
    expect(searches).toBe(1);
    // A read still searches, so a later colliding transcript is not missed.
    await chat.read({ pane_id: "w1:p1" });
    expect(searches).toBe(2);
    // A vanished transcript is searched for again.
    await remove(path);
    const gone = await chat.identity({ pane_id: "w1:p1" });
    expect(searches).toBe(3);
    expect(gone.key).not.toBe(first.key);
    chat.dispose();
  });
  test("a second transcript for a remembered Codex prefix is noticed and blocks send", async () => {
    // rev1's probe: a prefix resolves to one transcript, then another
    // transcript with the same 29 characters appears.
    const dir = join(process.env.CODEX_HOME!, "sessions", "2026", "10", "19");
    await mkdir(dir, { recursive: true });
    const { copyFile } = await import("node:fs/promises");
    const written = await fixtures[0]!.write(
      await mkdtemp(join(root, "collide-")),
    );
    const thread = "019f0000-0000-7000-8000-0000000000a1";
    await copyFile(
      written,
      join(dir, `rollout-2026-10-19T09-00-00-${thread}.jsonl`),
    );
    let searches = 0;
    const files = {
      ...localAgentSessionFiles,
      findCodexSessionByPrefix: async (prefix: string) => {
        searches += 1;
        return localAgentSessionFiles.findCodexSessionByPrefix(prefix);
      },
    };
    let changes = 0;
    const prompts: unknown[] = [];
    const chat = createHerdrConversationSource({
      herdrCall: herdr(
        {
          ...pane("codex"),
          terminal_title: `demo · ${thread.slice(0, 29)}...`,
        },
        prompts,
      ),
      files,
      context: createAgentSessionResolverContext(),
      cache: createSessionProjectionCache(files),
      onCodexSessionsChanged: () => {
        changes += 1;
      },
    });
    try {
      const read = await chat.read({ pane_id: "w1:p1" });
      expect(read.session_fingerprint).toMatch(/^[a-f0-9]{64}$/);
      const before = await chat.identity({ pane_id: "w1:p1" });
      const searchesBefore = searches;
      await copyFile(
        written,
        join(dir, `rollout-2026-10-19T09-00-01-${thread.slice(0, 29)}b2.jsonl`),
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(changes).toBeGreaterThan(0);
      const after = await chat.identity({ pane_id: "w1:p1" });
      expect(searches).toBeGreaterThan(searchesBefore);
      expect(after.key).not.toBe(before.key);
      expect(
        await chat.send({
          pane_id: "w1:p1",
          text: "hello",
          session_fingerprint: read.session_fingerprint!,
        }),
      ).toMatchObject({ status: "refused", reason: "unavailable" });
      expect(prompts).toEqual([]);
    } finally {
      chat.dispose();
    }
  });

  test("send searches a Codex title afresh even when a match is remembered", async () => {
    const context = createAgentSessionResolverContext();
    const thread = "019f1000-0000-7000-8000-0000000000c1";
    // A remembered match whose transcript no search can find any more.
    context.codexTitles.set(thread.slice(0, 29), {
      id: thread,
      path: join(root, "missing.jsonl"),
    });
    const title = `demo · ${thread.slice(0, 29)}...`;
    const fingerprint = paneBinding(
      "codex",
      { ...pane("codex"), terminal_title: title },
      context,
    )?.fingerprint;
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const prompts: unknown[] = [];
    const chat = createHerdrConversationSource({
      herdrCall: herdr({ ...pane("codex"), terminal_title: title }, prompts),
      files: localAgentSessionFiles,
      context,
      cache: createSessionProjectionCache(localAgentSessionFiles),
    });
    try {
      expect(
        await chat.send({
          pane_id: "w1:p1",
          text: "hello",
          session_fingerprint: fingerprint!,
        }),
      ).toMatchObject({ status: "refused", reason: "unavailable" });
      expect(prompts).toEqual([]);
    } finally {
      chat.dispose();
    }
  });

  test("a remote host never reuses a remembered Codex title match", async () => {
    const thread = "019f2000-0000-7000-8000-0000000000d1";
    const path = `/srv/codex/sessions/rollout-2026-10-19T09-00-00-${thread}.jsonl`;
    let searches = 0;
    const files = {
      ...localAgentSessionFiles,
      remote: true,
      statFile: async (value: string) => ({ path: value, mtimeMs: 1, size: 1 }),
      findCodexSessionByPrefix: async () => {
        searches += 1;
        return { path, mtimeMs: 1, size: 1 };
      },
    };
    const chat = createHerdrConversationSource({
      herdrCall: herdr({
        ...pane("codex"),
        terminal_title: `demo · ${thread.slice(0, 29)}...`,
      }),
      files,
      context: createAgentSessionResolverContext(),
      cache: createSessionProjectionCache(files),
    });
    await chat.identity({ pane_id: "w1:p1" });
    await chat.identity({ pane_id: "w1:p1" });
    expect(searches).toBe(2);
    chat.dispose();
  });
});
