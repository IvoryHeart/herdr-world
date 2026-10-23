import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runningTool } from "./conversation";
import { createHerdrConversationSource } from "./herdr-conversation";
import { localAgentSessionFiles } from "./session-file-access";
import type { HistoryEntry } from "./session-history";
import { createSessionProjectionCache } from "./session-projection-cache";
import { createAgentSessionResolverContext } from "./session-resolver";
import type { HerdrCall } from "./session-types";

// What runs now: the tool call the agent has started and not finished, and
// the task its terminal title names. Synthetic transcripts only.

const call = (
  id: string,
  name: string,
  input: unknown,
  at = "2026-10-22T09:00:00Z",
): HistoryEntry => ({
  id: `call:${id}`,
  role: "tool",
  kind: "tool_call",
  text: JSON.stringify(input),
  sent_at: at,
  tool_name: name,
  source_call_id: id,
});
const result = (id: string): HistoryEntry => ({
  id: `result:${id}`,
  role: "tool",
  kind: "tool_result",
  text: "ok",
  sent_at: "2026-10-22T09:00:05Z",
  source_call_id: id,
});

describe("the running tool", () => {
  test("is the newest call with no result, summarised by its command", () => {
    expect(
      runningTool([
        call("a", "Read", { file_path: "src/a.ts" }),
        result("a"),
        call("b", "Bash", {
          command: "bun test server\necho done",
          timeout: 600,
        }),
      ]),
    ).toEqual({
      id: "b",
      name: "Bash",
      summary: "bun test server",
      started_at: "2026-10-22T09:00:00Z",
    });
  });

  test("prefers a call's own description", () => {
    expect(
      runningTool([
        call("c", "Bash", { command: "git push", description: "Push it" }),
      ])?.summary,
    ).toBe("Push it");
  });

  test("is null when every call has its result", () => {
    expect(
      runningTool([call("a", "Edit", { file_path: "x" }), result("a")]),
    ).toBeNull();
  });

  test("names nothing when the arguments are not JSON", () => {
    expect(
      runningTool([{ ...call("d", "Task", {}), text: "plain" }])?.summary,
    ).toBeNull();
  });
});

let root = "";
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "herdr-world-now-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("a conversation read while the agent works", () => {
  test("carries the open call and the terminal title", async () => {
    const transcript = join(root, "working.jsonl");
    const now = new Date().toISOString();
    await writeFile(
      transcript,
      [
        {
          type: "user",
          timestamp: now,
          message: { role: "user", content: "Run the tests" },
        },
        {
          type: "assistant",
          timestamp: now,
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_1",
                name: "Bash",
                input: { command: "bun test server/src/link" },
              },
            ],
          },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n") + "\n",
    );
    const herdrCall: HerdrCall = async (method) => {
      if (method === "agent.get")
        return {
          agent: {
            pane_id: "w1:p1",
            agent: "claude",
            agent_status: "working",
            terminal_title: "✳ Running tests",
            agent_session: {
              source: "herdr:claude",
              agent: "claude",
              kind: "path",
              value: transcript,
            },
          },
        };
      throw new Error(`unexpected ${method}`);
    };
    const source = createHerdrConversationSource({
      herdrCall,
      files: localAgentSessionFiles,
      context: createAgentSessionResolverContext(),
      cache: createSessionProjectionCache(localAgentSessionFiles),
    });
    const read = await source.read({ pane_id: "w1:p1" });
    expect(read.terminal_title).toBe("✳ Running tests");
    expect(read.running_tool).toMatchObject({
      id: "toolu_1",
      name: "Bash",
      summary: "bun test server/src/link",
    });
  });
});
