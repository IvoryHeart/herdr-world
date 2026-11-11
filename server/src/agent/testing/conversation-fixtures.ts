import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Synthetic native transcript formats shared by the TUI and core readers.
export const QUESTION = "What does the README say?";
export const ANSWER = "It describes the demo project.";
const at = (second: number) =>
  new Date(Date.UTC(2026, 9, 22, 9, 0, second)).toISOString();
const jsonl = (records: unknown[]) =>
  `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;

type Fixture = {
  agent: string;
  /** Writes the transcript and returns the path Herdr would report. */
  write(dir: string): Promise<string>;
  /** False where the format carries no tool records in this fixture. */
  tools?: boolean;
  /** Shown entries expected before the question, such as a compaction. */
  lead?: string[];
};

export const fixtures: Fixture[] = [
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

// OMP uses the same transcript format; exercise its own reported harness binding.
fixtures.push({
  ...fixtures.find((fixture) => fixture.agent === "pi")!,
  agent: "omp",
});
