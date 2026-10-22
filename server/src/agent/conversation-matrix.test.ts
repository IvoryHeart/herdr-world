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
import { localAgentSessionFiles } from "./session-file-access";
import { createSessionProjectionCache } from "./session-projection-cache";
import { createAgentSessionResolverContext } from "./session-resolver";
import type { HerdrCall } from "./session-types";

// One synthetic conversation per harness World reads, each in the harness's
// own transcript format: a question, one tool call and result, an answer.
// No model runs; Herdr is a fake that reports the agent and its session.

const QUESTION = "What does the README say?";
const ANSWER = "It describes the demo project.";
const at = (second: number) =>
  new Date(Date.UTC(2026, 9, 22, 9, 0, second)).toISOString();
const jsonl = (records: unknown[]) =>
  `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;

let root = "";

type Fixture = {
  agent: string;
  /** Writes the transcript and returns the path Herdr would report. */
  write(dir: string): Promise<string>;
  /** False where the format carries no tool records in this fixture. */
  tools?: boolean;
  /** Shown entries expected before the question, such as a compaction. */
  lead?: string[];
};

const fixtures: Fixture[] = [
  {
    agent: "codex",
    // Injected instructions and environment are hidden; a wrapped answer to
    // the agent's question is shown as what the user wrote.
    lead: ["user:Yes, the demo."],
    async write(dir) {
      const path = join(
        dir,
        "rollout-2026-10-22T09-00-00-019a0000-0000-7000-8000-000000000001.jsonl",
      );
      const injected = (second: number, text: string) => ({
        type: "response_item",
        timestamp: at(second),
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        },
      });
      await writeFile(
        path,
        jsonl([
          // Codex writes repository instructions and its environment as
          // user items before the first prompt.
          injected(
            0,
            "# AGENTS.md instructions for /work/demo\n\n<INSTRUCTIONS>\nSynthetic.\n</INSTRUCTIONS>",
          ),
          injected(
            0,
            "<send_user_message_question_reply>\nYes, the demo.\n</send_user_message_question_reply>",
          ),
          injected(
            0,
            "<environment_context>\n  <cwd>/work/demo</cwd>\n</environment_context>",
          ),
          {
            type: "response_item",
            timestamp: at(1),
            payload: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: QUESTION }],
            },
          },
          {
            type: "response_item",
            timestamp: at(2),
            payload: {
              type: "function_call",
              call_id: "call-1",
              name: "read_file",
              arguments: '{"path":"README.md"}',
            },
          },
          {
            type: "response_item",
            timestamp: at(3),
            payload: {
              type: "function_call_output",
              call_id: "call-1",
              output: "# Demo",
            },
          },
          {
            type: "response_item",
            timestamp: at(4),
            payload: {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: ANSWER }],
            },
          },
        ]),
      );
      return path;
    },
  },
  {
    agent: "claude",
    // A compaction summary, a local-command caveat, a rewound prompt with its
    // answer and a sidechain record surround the live conversation.
    lead: [
      "notice:Conversation compacted",
      "user:/review the demo",
      "assistant:Reviewing.",
      "notice:Background task update",
    ],
    async write(dir) {
      const path = join(dir, "claude-session.jsonl");
      const record = (
        type: "user" | "assistant",
        uuid: string,
        parentUuid: string | null,
        second: number,
        content: unknown,
        extra: Record<string, unknown> = {},
      ) => ({
        type,
        uuid,
        parentUuid,
        timestamp: at(second),
        message: { role: type, content },
        ...extra,
      });
      await writeFile(
        path,
        jsonl([
          record("user", "summary", null, 0, "Synthetic earlier summary.", {
            isCompactSummary: true,
          }),
          record("user", "caveat", "summary", 0, "Caveat: synthetic.", {
            isMeta: true,
          }),
          record(
            "user",
            "command",
            "caveat",
            0,
            "<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>the demo</command-args>",
          ),
          record("assistant", "command-answer", "command", 0, [
            { type: "text", text: "Reviewing." },
          ]),
          record(
            "user",
            "notification",
            "command-answer",
            0,
            "<task-notification>\n<status>completed</status>\n</task-notification>",
          ),
          record("user", "rewound", "notification", 1, "An abandoned question"),
          record("assistant", "rewound-answer", "rewound", 1, [
            { type: "text", text: "An abandoned answer" },
          ]),
          record("user", "question", "notification", 1, QUESTION),
          record("assistant", "call", "question", 2, [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "Read",
              input: { file_path: "README.md" },
            },
          ]),
          record(
            "assistant",
            "side",
            "call",
            2,
            [{ type: "text", text: "Subagent chatter" }],
            { isSidechain: true },
          ),
          record("user", "result", "call", 3, [
            { type: "tool_result", tool_use_id: "toolu_1", content: "# Demo" },
          ]),
          record("assistant", "answer", "result", 4, [
            { type: "text", text: ANSWER },
          ]),
        ]),
      );
      return path;
    },
  },
  {
    agent: "kimi",
    async write(dir) {
      const path = join(dir, "wire.jsonl");
      const event = (second: number, value: Record<string, unknown>) => ({
        type: "context.append_loop_event",
        time: Date.parse(at(second)),
        event: { turnId: "turn-1", step: 1, ...value },
      });
      await writeFile(
        path,
        jsonl([
          {
            type: "context.append_message",
            time: Date.parse(at(1)),
            message: { role: "user", content: QUESTION },
          },
          event(2, {
            type: "tool.call",
            toolCallId: "call-1",
            name: "ReadFile",
            args: { path: "README.md" },
          }),
          event(3, {
            type: "tool.result",
            toolCallId: "call-1",
            result: { output: "# Demo" },
          }),
          event(4, {
            type: "content.part",
            part: { type: "text", text: ANSWER },
          }),
        ]),
      );
      return path;
    },
  },
  {
    agent: "grok",
    async write(dir) {
      const session = join(dir, "grok-session-1");
      await mkdir(session);
      await writeFile(
        join(session, "summary.json"),
        JSON.stringify({ info: { id: "grok-session-1", cwd: "/work/demo" } }),
      );
      await writeFile(
        join(session, "chat_history.jsonl"),
        jsonl([
          {
            type: "user",
            content: [
              {
                type: "text",
                text: `<user_info>synthetic</user_info>\n<user_query>${QUESTION}</user_query>`,
              },
            ],
          },
          {
            type: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call-1",
                name: "read_file",
                arguments: '{"target_file":"README.md"}',
              },
            ],
          },
          { type: "tool_result", tool_call_id: "call-1", content: "# Demo" },
          { type: "assistant", content: ANSWER },
        ]),
      );
      return join(session, "chat_history.jsonl");
    },
  },
  {
    agent: "pi",
    async write(dir) {
      const path = join(dir, "2026-10-22_pi-session.jsonl");
      await writeFile(
        path,
        jsonl([
          {
            type: "session",
            version: 3,
            id: "pi-session",
            timestamp: at(0),
            cwd: "/work/demo",
          },
          {
            type: "message",
            timestamp: at(1),
            message: {
              role: "user",
              content: [{ type: "text", text: QUESTION }],
            },
          },
          {
            type: "message",
            timestamp: at(2),
            message: {
              role: "assistant",
              content: [
                {
                  type: "toolCall",
                  id: "call-1",
                  name: "read",
                  arguments: { path: "README.md" },
                },
              ],
            },
          },
          {
            type: "message",
            timestamp: at(3),
            message: {
              role: "toolResult",
              toolCallId: "call-1",
              content: [{ type: "text", text: "# Demo" }],
            },
          },
          {
            type: "message",
            timestamp: at(4),
            message: {
              role: "assistant",
              content: [{ type: "text", text: ANSWER }],
            },
          },
        ]),
      );
      return path;
    },
  },
  {
    agent: "muse",
    async write(dir) {
      const path = join(dir, "muse-session.jsonl");
      const run = (second: number, event: Record<string, unknown>) => ({
        recorded_at: Date.parse(at(second)) * 1000,
        payload_type: "runtime.session",
        payload: { kind: "run", run_id: "run-1", event },
      });
      await writeFile(
        path,
        jsonl([
          run(1, { kind: "started", prompt: QUESTION }),
          run(2, {
            kind: "assistant_tool_calls_committed",
            tool_calls: [
              { call_id: "call-1", name: "read", args: { path: "README.md" } },
            ],
          }),
          run(3, {
            kind: "tool_result_batch_committed",
            results: [{ tool_call_id: "call-1", text: "# Demo" }],
          }),
          run(4, { kind: "assistant_message_committed", text: ANSWER }),
        ]),
      );
      return path;
    },
  },
  {
    agent: "agy",
    // The fixture writes the protobuf user and planner steps only.
    tools: false,
    async write(dir) {
      const { Database } = await import("bun:sqlite");
      const path = join(dir, "agy-session.db");
      const db = new Database(path);
      db.run(
        "CREATE TABLE trajectory_meta (trajectory_id text, cascade_id text, trajectory_type integer, source integer, PRIMARY KEY (trajectory_id))",
      );
      db.run(
        "CREATE TABLE steps (idx integer, step_type integer NOT NULL DEFAULT 0, status integer NOT NULL DEFAULT 0, has_subtrajectory numeric NOT NULL DEFAULT false, metadata blob, error_details blob, permissions blob, task_details blob, render_info blob, step_payload blob, step_format integer NOT NULL DEFAULT 0, PRIMARY KEY (idx))",
      );
      db.run(
        "CREATE TABLE gen_metadata (idx integer, data blob, size integer NOT NULL DEFAULT 0, PRIMARY KEY (idx))",
      );
      db.run(
        'CREATE TABLE trajectory_metadata_blob (id text DEFAULT "main", data blob, PRIMARY KEY (id))',
      );
      db.run("INSERT INTO trajectory_meta VALUES (?, ?, ?, ?)", [
        "traj-1",
        "agy-session",
        4,
        17,
      ]);
      // Length-delimited protobuf: field 19 (user input) and 20 (planner).
      const field = (tag: number[], inner: number, text: string) => {
        const body = Buffer.concat([
          Buffer.from([inner, text.length]),
          Buffer.from(text),
        ]);
        return Buffer.concat([Buffer.from([...tag, body.length]), body]);
      };
      const metadata = Buffer.from("\x0a\x06\x08\x80\xa4\xeb\xb5\x06");
      db.run(
        "INSERT INTO steps (idx, step_type, metadata, step_payload) VALUES (?, ?, ?, ?)",
        [0, 14, metadata, field([0x9a, 0x01], 0x12, QUESTION)],
      );
      db.run(
        "INSERT INTO steps (idx, step_type, metadata, step_payload) VALUES (?, ?, ?, ?)",
        [1, 15, metadata, field([0xa2, 0x01], 0x0a, ANSWER)],
      );
      db.close();
      return path;
    },
  },
];

function herdr(agent: Record<string, unknown> | null, prompts: unknown[] = []) {
  const call: HerdrCall = async (method, params) => {
    if (method === "agent.get") return { agent };
    if (method === "agent.list") return { agents: agent ? [agent] : [] };
    if (method === "agent.prompt") {
      prompts.push(params);
      return { agent: { pane_id: agent?.pane_id } };
    }
    throw new Error(`unexpected ${method}`);
  };
  return call;
}

function source(
  call: HerdrCall,
  options: { remote?: boolean; platform?: string } = {},
) {
  const files = options.remote
    ? { ...localAgentSessionFiles, remote: true }
    : localAgentSessionFiles;
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
        ).toEqual({ status: "sent" });
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
    "omp",
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
    for (const agent of ["claude", "kimi", "grok", "agy"]) {
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
      log.push(method);
      if (method === "agent.get") return { agent: current };
      if (method === "agent.prompt") return { agent: { pane_id: "w1:p1" } };
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
    expect(log).toEqual(["agent.get"]);
    // Unchanged, the check is the last Herdr call before the prompt.
    current = reported(path);
    log.length = 0;
    expect(
      await chat.send({
        pane_id: "w1:p1",
        text: "hello",
        session_fingerprint: session_fingerprint!,
      }),
    ).toEqual({ status: "sent" });
    expect(log).toEqual(["agent.get", "agent.prompt"]);
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
      if (method === "agent.get") return { agent: current };
      if (method === "agent.prompt") {
        prompts.push(params);
        return { agent: { pane_id: "w1:p1" } };
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
  });
});
