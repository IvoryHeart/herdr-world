import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CODEX_DAEMON_ISSUE,
  createHerdrConversationSource,
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
};

const fixtures: Fixture[] = [
  {
    agent: "codex",
    async write(dir) {
      const path = join(
        dir,
        "rollout-2026-10-22T09-00-00-019a0000-0000-7000-8000-000000000001.jsonl",
      );
      await writeFile(
        path,
        jsonl([
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
    async write(dir) {
      const path = join(dir, "claude-session.jsonl");
      await writeFile(
        path,
        jsonl([
          {
            type: "user",
            timestamp: at(1),
            message: { role: "user", content: QUESTION },
          },
          {
            type: "assistant",
            timestamp: at(2),
            message: {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  id: "toolu_1",
                  name: "Read",
                  input: { file_path: "README.md" },
                },
              ],
            },
          },
          {
            type: "user",
            timestamp: at(3),
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "toolu_1",
                  content: "# Demo",
                },
              ],
            },
          },
          {
            type: "assistant",
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
            : `${message.role}:${message.text}`,
        );
        expect(shape).toEqual(
          fixture.tools === false
            ? [`user:${QUESTION}`, `assistant:${ANSWER}`]
            : [`user:${QUESTION}`, "tool:1", `assistant:${ANSWER}`],
        );
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

    test("a named thread without a transcript has no messages yet", async () => {
      const conversation = await source(
        herdr({
          ...pane("codex"),
          terminal_title: title("019b0000-0000-7000-8000-0000000000d2"),
        }),
      ).read({ pane_id: "w1:p1" });
      expect(unavailable(conversation)?.reason).toBe("no_messages_yet");
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
