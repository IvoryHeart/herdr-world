import { expect, test } from "bun:test";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSessionHandlers } from "../agent/agent-sessions";
import { localAgentSessionFiles } from "../agent/session-file-access";
import {
  ANSWER,
  QUESTION,
  fixtures,
} from "../agent/testing/conversation-fixtures";
import { defaultGuiSettings } from "../config/gui-settings";
import { callCoreHost } from "../rpc/core-host";
import { createCoreFixture, CORE_FIXTURE_CONNECTION_ID } from "./fixture";
import { createCoreHostRuntime } from "./host-runtime";
import { coreWorld, until } from "./testing/core-world";

type Shown = { status: string; messages: { text: string }[] };

test.skipIf(process.platform !== "linux" && process.platform !== "darwin")(
  "headless preview reads live Codex/Claude Chat through real process evidence and the shared TUI readers",
  async () => {
    const w = await coreWorld();
    const fixture = createCoreFixture(() => w.service);
    let host: ReturnType<typeof createCoreHostRuntime> | undefined;
    try {
      await fixture.start("headless");
      await until(
        () =>
          w.core.manager.status(CORE_FIXTURE_CONNECTION_ID).state === "ready",
      );
      const lease = w.lease(CORE_FIXTURE_CONNECTION_ID);
      host = createCoreHostRuntime({
        lease,
        host: null,
        readSettings: async () => defaultGuiSettings(),
      });
      for (const [agent, name] of [
        ["codex", "builder"],
        ["claude", "reviewer"],
      ]) {
        const rows = await w.rows(CORE_FIXTURE_CONNECTION_ID);
        const pane = rows.panes.find(
          (row) =>
            row.title === name ||
            row.agent_name === name ||
            lease.runtime.core.terminal(row.pane_id)?.name === name,
        )!;
        expect(pane).toBeDefined();
        const pane_id = pane.pane_id;
        const call = (method: string) =>
          callCoreHost(host!, method, { pane_id, history_version: 2 });
        const shown = (await call("agent_conversation.get")) as Shown;
        expect(shown.status).toBe("ok");
        expect(shown.messages.map((m) => m.text)).toEqual(
          expect.arrayContaining([QUESTION, ANSWER]),
        );
        const summary = (await call("agent_session.get")) as {
          path?: string;
          session?: { path?: string };
        };
        // Capture the discovered path through the same public summary used by Details.
        const path = summary.path ?? summary.session?.path;
        expect(path).toBeString();
        const tui = createAgentSessionHandlers({
          files: localAgentSessionFiles,
          herdrCall: async () => ({
            agent: {
              pane_id,
              agent,
              agent_status: "idle",
              agent_session: {
                source: "herdr",
                agent,
                kind: "path",
                value: path,
              },
            },
          }),
        });
        try {
          const core = (await call("agent_history.get")) as {
            entries: unknown[];
          };
          const herdr = (await tui.readHistoryRequest({
            pane_id,
            history_version: 2,
          })) as { entries: unknown[] };
          expect(core.entries).toEqual(herdr.entries);
        } finally {
          tui.conversationWatch.stop();
        }
        if (agent === "codex") {
          await appendFile(
            path!,
            `${JSON.stringify({ type: "response_item", timestamp: "2026-11-20T09:01:00Z", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Live headless update." }] } })}\n`,
          );
          const refreshed = (await call("agent_conversation.get")) as Shown;
          expect(refreshed.messages.map((m) => m.text)).toContain(
            "Live headless update.",
          );
        }
      }
      fixture.replaceReviewer();
      await until(
        () => lease.runtime.core.terminal("t1")?.argv?.[0] === "/bin/sh",
      );
      const rows = await w.rows(CORE_FIXTURE_CONNECTION_ID);
      const reviewer = rows.panes.find(
        (p) => lease.runtime.core.terminal(p.pane_id)?.name === "reviewer",
      )!;
      expect(
        await callCoreHost(host, "agent_conversation.get", {
          pane_id: reviewer.pane_id,
        }),
      ).not.toMatchObject({ status: "ok" });
    } finally {
      host?.retire();
      await fixture.remove();
      await w.dispose();
    }
  },
);

test("a replacement during a delayed process lookup cannot publish the old conversation", async () => {
  const w = await coreWorld();
  const root = await mkdtemp(join(tmpdir(), "world-headless-replaced-"));
  let host: ReturnType<typeof createCoreHostRuntime> | undefined;
  try {
    const path = await fixtures
      .find((item) => item.agent === "codex")!
      .write(root);
    await w.connect();
    const terminal = w.fake.create({
      argv: ["codex", "exec"],
      pid: 4242,
      keep: true,
      reported: true,
      status: { state: "working", app: "codex" },
      foreground: {
        pid: 4242,
        name: "codex",
        argv: ["codex", "exec"],
        cwd: root,
      },
    });
    await w.synchronize();
    const entered = Promise.withResolvers<void>();
    const found = Promise.withResolvers<{ kind: "path"; value: string }>();
    host = createCoreHostRuntime({
      lease: w.lease(),
      host: null,
      readSettings: async () => defaultGuiSettings(),
      agentSessionFiles: {
        ...localAgentSessionFiles,
        findCodexSessionById: async () => null,
        listCodexThreads: async () => [],
        listCodexThreadBatch: async (cwds) =>
          new Map(cwds.map((cwd) => [cwd, []])),
        findAgentSessionForProcess: async () => {
          entered.resolve();
          return found.promise;
        },
      },
    });
    const pending = callCoreHost(host, "agent_conversation.get", {
      pane_id: terminal,
    });
    await entered.promise;
    w.fake.replaceWithShell(terminal, { reusePid: true });
    await w.synchronize();
    found.resolve({ kind: "path", value: path });
    expect(await pending).not.toMatchObject({ status: "ok" });
    expect(
      await callCoreHost(host, "agent_conversation.get", { pane_id: terminal }),
    ).not.toMatchObject({ status: "ok" });
  } finally {
    host?.retire();
    await w.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
