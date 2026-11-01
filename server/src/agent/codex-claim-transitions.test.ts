import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHerdrConversationSource } from "./herdr-conversation";
import { localAgentSessionFiles } from "./session-file-access";
import { createSessionProjectionCache } from "./session-projection-cache";
import { createAgentSessionResolverContext } from "./session-resolver";

const ids = {
  a: "019a0000-0000-7000-8000-0000000000a1",
  b: "019b0000-0000-7000-8000-0000000000b2",
};
const cases = (["reported", "titled"] as const).flatMap((initial) =>
  ([null, "a", "b"] as const).flatMap((title) =>
    ([null, "a", "b"] as const).flatMap((report) =>
      [false, true].map((readable) => ({ initial, title, report, readable })),
    ),
  ),
);

for (const scenario of cases)
  test(`Codex claims from ${scenario.initial}: title=${scenario.title} report=${scenario.report} readable=${scenario.readable}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-claims-"));
    const paths = {
      a: join(root, `rollout-${ids.a}.jsonl`),
      b: join(root, `rollout-${ids.b}.jsonl`),
    };
    let report: keyof typeof ids | null = "a";
    let title: keyof typeof ids | null =
      scenario.initial === "titled" ? "a" : null;
    let readable = true;
    const pane = () => ({
      pane_id: "pane-a",
      terminal_id: "terminal-a",
      agent: "codex",
      agent_status: "idle",
      agent_session: report
        ? {
            source: "herdr:codex",
            agent: "codex",
            kind: "id",
            value: ids[report],
          }
        : null,
      terminal_title: title ? `Synthetic · ${ids[title]}` : "Synthetic",
    });
    const files = {
      ...localAgentSessionFiles,
      statFile: async (path: string) =>
        readable ? localAgentSessionFiles.statFile(path) : null,
      findCodexSessionById: async (id: string) =>
        readable && Object.values(ids).includes(id)
          ? localAgentSessionFiles.statFile(id === ids.a ? paths.a : paths.b)
          : null,
      findCodexSessionByPrefix: async (prefix: string) =>
        readable && Object.values(ids).some((id) => id.startsWith(prefix))
          ? localAgentSessionFiles.statFile(
              ids.a.startsWith(prefix) ? paths.a : paths.b,
            )
          : null,
      listCodexThreads: async () => [],
      listCodexThreadBatch: async () => new Map(),
    };
    const source = createHerdrConversationSource({
      herdrCall: async (method) => {
        if (method === "agent.get") return { agent: pane() };
        if (method === "agent.list") return { agents: [pane()] };
        throw new Error(`unexpected native call ${method}`);
      },
      files,
      context: createAgentSessionResolverContext(),
      cache: createSessionProjectionCache(files),
    });
    try {
      for (const path of Object.values(paths))
        await writeFile(
          path,
          JSON.stringify({
            type: "response_item",
            timestamp: "2026-01-01T00:00:00Z",
            payload: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "Synthetic task" }],
            },
          }) + "\n",
        );
      const before = await source.read({ pane_id: "pane-a" });
      expect(before.status).toBe("ok");
      expect(before.field_claims!.agent_status.claims).toHaveLength(2);
      report = scenario.report;
      title = scenario.title;
      readable = scenario.readable;
      const after = await source.read({ pane_id: "pane-a" });
      // The existing Codex binding contract selects a named title, then a native report.
      const selected = title ?? report;
      const inferred =
        selected === null || selected === "a" || readable
          ? [ids[selected ?? "a"]]
          : [];
      expect(
        after
          .field_claims!.session.claims.filter(
            (claim) => claim.source === "world.transcript",
          )
          .map((claim) => claim.value.value),
      ).toEqual(inferred);
      expect(
        after
          .field_claims!.agent_status.claims.filter(
            (claim) => claim.source === "world.transcript",
          )
          .map((claim) => claim.value),
      ).toEqual(inferred.length ? ["working"] : []);
      expect(
        after
          .field_claims!.session.claims.filter(
            (claim) => claim.source === "herdr.agent",
          )
          .map((claim) => claim.value.value),
      ).toEqual(report ? [ids[report]] : []);
      if (selected) expect(after.session_label).toContain(ids[selected]);
    } finally {
      source.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
