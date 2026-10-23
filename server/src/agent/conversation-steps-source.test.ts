import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHerdrConversationSource } from "./herdr-conversation";
import { localAgentSessionFiles } from "./session-file-access";
import { createSessionProjectionCache } from "./session-projection-cache";
import { createAgentSessionResolverContext } from "./session-resolver";
import type { HerdrCall } from "./session-types";

// Chat asks for the step model of the calls in History's window, by the
// harness's call ID. Synthetic transcript only.

let root = "";
let transcript = "";
const at = (second: number) =>
  new Date(Date.UTC(2026, 9, 22, 9, 0, second)).toISOString();
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "herdr-world-steps-"));
  transcript = join(root, "demo.jsonl");
  const lines = [
    {
      type: "user",
      timestamp: at(0),
      message: { role: "user", content: "Run the tests" },
    },
    {
      type: "assistant",
      timestamp: at(1),
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "Bash",
            input: { command: "bun test src", description: "Run tests" },
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
            content: " 12 pass\n 1 fail",
          },
        ],
      },
    },
  ];
  await writeFile(
    transcript,
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test("steps are read by call ID, and unknown IDs are left out", async () => {
  const call: HerdrCall = async (method) => {
    if (method === "agent.get")
      return {
        agent: {
          pane_id: "w1:p1",
          agent: "claude",
          agent_status: "idle",
          state_change_seq: 1,
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
    herdrCall: call,
    files: localAgentSessionFiles,
    context: createAgentSessionResolverContext(),
    cache: createSessionProjectionCache(localAgentSessionFiles),
  });
  const steps = await source.steps({
    pane_id: "w1:p1",
    call_ids: ["toolu_1", "toolu_missing"],
  });
  expect(steps).toHaveLength(1);
  expect(steps[0]).toMatchObject({
    call_id: "toolu_1",
    label: "Run tests",
    state: "failed",
    test: { runner: "bun", passed: 12, failed: 1 },
  });
  // Asked again with nothing changed, the same step object comes back.
  const again = await source.steps({ pane_id: "w1:p1", call_ids: ["toolu_1"] });
  expect(again[0]).toBe(steps[0]);
});
