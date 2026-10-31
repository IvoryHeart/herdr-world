import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHerdrConversationSource } from "./herdr-conversation";
import { localAgentSessionFiles } from "./session-file-access";
import { createSessionProjectionCache } from "./session-projection-cache";
import { createAgentSessionResolverContext } from "./session-resolver";

test("real conversation replies preserve status/session provenance through a missing transcript and never send from saved claims", async () => {
  const root = await mkdtemp(join(tmpdir(), "conversation-claims-"));
  const path = join(root, "synthetic.jsonl");
  let present = true,
    prompts = 0;
  const native = {
    source: "synthetic",
    agent: "claude",
    kind: "path",
    value: path,
  };
  const source = createHerdrConversationSource({
    herdrCall: async (method) => {
      if (method === "agent.get")
        return {
          agent: {
            pane_id: "pane-a",
            terminal_id: "terminal-a",
            agent: "claude",
            agent_status: "idle",
            agent_session: present ? native : null,
            state_change_seq: 4,
          },
        };
      if (method === "agent.prompt") {
        prompts++;
        throw new Error("unexpected native input");
      }
      throw new Error(`unexpected ${method}`);
    },
    files: localAgentSessionFiles,
    context: createAgentSessionResolverContext(),
    cache: createSessionProjectionCache(localAgentSessionFiles),
  });
  try {
    await writeFile(
      path,
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "synthetic-call",
              name: "Bash",
              input: { command: "synthetic-task" },
            },
          ],
        },
      }) + "\n",
    );
    const first = await source.read({ pane_id: "pane-a" });
    expect(first.status).toBe("ok");
    expect(first.agent_status).toBe("idle");
    expect(
      first.field_claims!.agent_status.claims.map((claim) => claim.value),
    ).toEqual(["idle", "working"]);
    expect(first.field_claims!.agent_status.display[0]!.value).toBe("idle");
    expect(first.field_claims!.session.claims).toHaveLength(2);
    expect(first.field_claims!.session.claims[0]!.value).toEqual(native);
    const inferred = first.field_claims!.agent_status.claims[1];
    await unlink(path);
    const failed = await source.read({ pane_id: "pane-a" });
    expect(failed.status).toBe("unavailable");
    expect(failed.field_claims!.agent_status.claims[1]).toEqual(inferred);
    present = false;
    expect(
      await source.send({
        pane_id: "pane-a",
        text: "synthetic",
        session_fingerprint: first.session_fingerprint!,
      }),
    ).toMatchObject({ status: "refused" });
    expect(prompts).toBe(0);
  } finally {
    source.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
