import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
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
import { CORE_NO_SESSION } from "./agent-sessions";
import { createCoreHostRuntime } from "./host-runtime";
import { coreWorld, until } from "./testing/core-world";

/**
 * A core agent's Chat, History and Details answer through the same
 * handlers as a Herdr agent's (one Chat for both runtimes): the transcript
 * reads the same, and every input goes through core's own send or keys to
 * the program the person saw, never without it.
 */

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

// The real per-process records live in the developer's home: never read.
const files = {
  ...localAgentSessionFiles,
  findClaudeSessionForProcess: async () => null,
};

async function setup(kind = "claude", status = "idle", resume = true) {
  const root = await mkdtemp(join(tmpdir(), "hcw-chat-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const fixture = fixtures.find((item) => item.agent === "claude")!;
  const transcript = await fixture.write(root);
  const w = await coreWorld();
  cleanups.push(w.dispose);
  await w.connect();
  const program = `/opt/example/bin/${kind}`;
  const argv =
    kind === "claude" && resume ? [program, "--resume", transcript] : [program];
  const pid = 70_000 + w.fake.currentSeq;
  const t = w.fake.create({
    argv,
    pid,
    keep: true,
    reported: true,
    status: { state: status, app: kind },
    foreground: { pid, name: kind, argv, cwd: root },
  });
  await w.settle();
  const host = createCoreHostRuntime({
    lease: w.lease(),
    host: null,
    readSettings: async () => defaultGuiSettings(),
    agentSessionFiles: files,
  });
  cleanups.push(async () => host.retire());
  const { panes } = await w.rows();
  const recipient = panes.find((p) => p.pane_id === t)?.core_recipient;
  if (typeof recipient !== "string") throw new Error("no recipient");
  const call = (method: string, params: Record<string, unknown> = {}) =>
    callCoreHost(host, method, { pane_id: t, ...params });
  return { w, t, host, recipient, transcript, call };
}

const sends = (w: Awaited<ReturnType<typeof setup>>["w"]) =>
  w.fake.calls.filter(
    (c) => c.method === "terminal.send" || c.method === "terminal.keys",
  );

describe("one Chat for both runtimes", () => {
  test("a core agent's conversation reads as a Herdr agent's does", async () => {
    const { t, call, transcript, w } = await setup();
    const shown = (await call("agent_conversation.get")) as {
      status: string;
      agent: string;
      session_fingerprint: string | null;
      messages: Array<{ text: string }>;
    };
    expect(shown.status).toBe("ok");
    expect(shown.agent).toBe("claude");
    expect(shown.session_fingerprint).toBeString();
    expect(shown.messages.map((m) => m.text)).toEqual(
      expect.arrayContaining([QUESTION, ANSWER]),
    );
    // The same handlers fed Herdr's report of the same session.
    const tui = createAgentSessionHandlers({
      herdrCall: async (method) => {
        if (method !== "agent.get") throw new Error(method);
        return {
          agent: {
            pane_id: t,
            agent: "claude",
            agent_status: "idle",
            agent_session: {
              source: "herdr",
              agent: "claude",
              kind: "path",
              value: transcript,
            },
          },
        };
      },
      files,
    });
    cleanups.push(async () => tui.conversationWatch.stop());
    const history = (await call("agent_history.get", {
      history_version: 2,
    })) as { entries: unknown[] };
    const herdr = (await tui.readHistoryRequest({
      pane_id: t,
      history_version: 2,
    })) as {
      entries: unknown[];
    };
    expect(history.entries.length).toBeGreaterThan(0);
    expect(history.entries).toEqual(herdr.entries);
    // Reading never types into the agent.
    expect(sends(w)).toEqual([]);
  });

  test("a message goes through core's send to the program the person saw", async () => {
    const { w, t, call, recipient } = await setup();
    const shown = (await call("agent_conversation.get")) as {
      session_fingerprint: string;
    };
    const result = await call("agent_conversation.send", {
      text: "Check the tests",
      session_fingerprint: shown.session_fingerprint,
      recipient,
    });
    expect(result).toMatchObject({ status: "sent" });
    expect(sends(w)).toEqual([
      expect.objectContaining({
        method: "terminal.send",
        params: expect.objectContaining({
          terminal: t,
          text: "Check the tests",
        }),
      }),
    ]);
  });

  test("without the recipient, or after another program took the terminal, nothing is sent", async () => {
    const { w, t, call, recipient } = await setup();
    const shown = (await call("agent_conversation.get")) as {
      session_fingerprint: string;
    };
    await expect(
      call("agent_conversation.send", {
        text: "Hello",
        session_fingerprint: shown.session_fingerprint,
      }),
    ).resolves.toMatchObject({ status: "refused" });
    await expect(
      call("agent_conversation.send", { text: "Hello" }),
    ).resolves.toMatchObject({ status: "refused" });
    w.fake.replaceWithShell(t);
    await w.settle();
    await expect(
      call("agent_conversation.send", { text: "Hello", recipient }),
    ).resolves.toMatchObject({ status: "refused" });
    expect(sends(w)).toEqual([]);
  });

  test("a harness Chat cannot read still takes messages through core", async () => {
    const { w, t, call, recipient } = await setup("opencode");
    const shown = (await call("agent_conversation.get")) as {
      status: string;
    };
    expect(shown.status).toBe("unavailable");
    const result = await call("agent_conversation.send", {
      text: "Status?",
      session_fingerprint: "",
      recipient,
    });
    expect(result).toMatchObject({
      status: "sent",
      delivery: { state: "unverified" },
    });
    expect(sends(w)).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({ terminal: t, text: "Status?" }),
      }),
    ]);
  });

  test("a conversation core cannot find gets core's advice, not Herdr's", async () => {
    const { call } = await setup("claude", "working", false);
    const shown = (await call("agent_conversation.get")) as {
      status: string;
      unavailable: { reason: string; detail: string; command?: string };
    };
    expect(shown.status).toBe("unavailable");
    expect(shown.unavailable).toEqual({
      reason: "no_session",
      detail: CORE_NO_SESSION,
    });
    expect(JSON.stringify(shown)).not.toContain("integration install");
  });

  test("a watched conversation is told when core reports a change", async () => {
    const { w, t, host } = await setup();
    const changed: string[] = [];
    const owner = {};
    await callCoreHost(
      host,
      "agent_conversation.watch",
      { pane_id: t },
      { owner, conversationChanged: (pane) => changed.push(pane) },
    );
    await Bun.sleep(300);
    changed.length = 0;
    w.fake.status(t, "working");
    await until(() => changed.length > 0);
    expect(changed).toContain(t);
    await callCoreHost(
      host,
      "agent_conversation.unwatch",
      { pane_id: t },
      { owner, conversationChanged: () => {} },
    );
  });

  test("Chat's trust answer is not offered for core", async () => {
    const { call } = await setup();
    await expect(
      call("agent_conversation.trust", { choice: "yes" }),
    ).resolves.toMatchObject({ status: "refused" });
  });
});
