import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSessionHandlers } from "../agent/agent-sessions";
import {
  type AgentSessionFileAccess,
  localAgentSessionFiles,
} from "../agent/session-file-access";
import {
  ANSWER,
  QUESTION,
  fixtures,
} from "../agent/testing/conversation-fixtures";
import { defaultGuiSettings } from "../config/gui-settings";
import { callCoreHost } from "../rpc/core-host";
import { CORE_CODEX_UNLINKED, CORE_NO_SESSION } from "./agent-sessions";
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

// The real per-process records and Codex sessions live in the developer's
// home: never read.
const files: AgentSessionFileAccess = {
  ...localAgentSessionFiles,
  findClaudeSessionForProcess: async () => null,
  findCodexSessionById: async () => null,
  findCodexSessionByPrefix: async () => null,
  listCodexThreads: async () => [],
  listCodexThreadBatch: async (cwds) => new Map(cwds.map((cwd) => [cwd, []])),
};

async function setup(
  kind = "claude",
  status = "idle",
  resume = true,
  access: typeof files = files,
) {
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
    agentSessionFiles: access,
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

  test("a core agent's desk read names what it made on core's own connection", async () => {
    const { t, call, transcript } = await setup();
    const report = join(transcript, "..", "core-report.md");
    await writeFile(report, "# Report\n");
    const record = {
      type: "assistant",
      uuid: "core-write",
      cwd: join(transcript, ".."),
      timestamp: "2026-11-23T10:00:00.000Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_core_write",
            name: "Write",
            input: { file_path: "core-report.md", content: "# Report" },
          },
        ],
      },
    };
    await writeFile(
      transcript,
      `${await readFile(transcript, "utf8")}${JSON.stringify(record)}\n`,
    );
    const { quests } = (await call("agent_quest.list", {
      pane_ids: [t],
    })) as {
      quests: Array<{
        pane_id: string;
        artefacts?: Array<{
          title: string;
          exists: boolean;
          made_by: { connection_id: string; pane_id: string; agent: string };
        }>;
      }>;
    };
    const [entry] = quests;
    expect(entry?.pane_id).toBe(t);
    const made = entry?.artefacts?.find((a) => a.title === "core-report.md");
    expect(made?.exists).toBe(true);
    expect(made?.made_by.pane_id).toBe(t);
    expect(made?.made_by.agent).toBe("claude");
    expect(made?.made_by.connection_id).toBeTruthy();
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
    // The watcher's first check only records a baseline and says nothing,
    // and nothing shows when it has: change the status until a change is told.
    let working = false;
    await until(() => {
      if (changed.length === 0) {
        working = !working;
        w.fake.status(t, working ? "working" : "idle");
      }
      return changed.includes(t);
    });
    expect(changed).toContain(t);
    await callCoreHost(
      host,
      "agent_conversation.unwatch",
      { pane_id: t },
      { owner, conversationChanged: () => {} },
    );
  });

  test("an answer to an earlier question never answers the same question asked on a later turn", async () => {
    const { w, t, call, recipient } = await setup("claude", "blocked");
    w.fake.readScreens.set(
      t,
      await readFile(
        new URL(
          "../agent/fixtures/pending-prompts/claude-question.txt",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const asked = async () =>
      (
        (await call("agent_conversation.get")) as {
          pending_prompt: {
            fingerprint: string;
            options: Array<{ key: string }>;
          } | null;
        }
      ).pending_prompt!;
    const first = await asked();
    expect(first.fingerprint).toBeString();
    // The agent goes on working, then asks the identical question again.
    w.fake.report(t, { state: "working" });
    w.fake.report(t, { state: "blocked" });
    await until(async () => (await asked()).fingerprint !== first.fingerprint);
    await expect(
      call("agent_conversation.answer", {
        key: first.options[0]!.key,
        prompt_fingerprint: first.fingerprint,
        recipient,
      }),
    ).resolves.toMatchObject({ status: "refused" });
    expect(sends(w)).toEqual([]);
  });

  test("Chat's key controls and Stop reach a core agent at any status, through core's keys", async () => {
    const { w, t, call, recipient } = await setup("claude", "idle");
    const shown = (await call("agent_conversation.get")) as {
      session_fingerprint: string;
    };
    const press = (key: string, extra: Record<string, unknown> = {}) =>
      call("agent_conversation.press", {
        key,
        session_fingerprint: shown.session_fingerprint,
        recipient,
        ...extra,
      });
    await expect(press("enter")).resolves.toMatchObject({ status: "sent" });
    await expect(press("ctrl+c")).resolves.toMatchObject({ status: "sent" });
    // Stop: Esc while the agent works.
    w.fake.report(t, { state: "working" });
    await until(
      async () =>
        (
          (await call("agent_conversation.latest")) as {
            agent_status?: string;
          }
        ).agent_status === "working",
    );
    await expect(press("esc")).resolves.toMatchObject({ status: "sent" });
    expect(sends(w).map((c) => (c.params as { keys: string[] }).keys)).toEqual([
      ["enter"],
      ["ctrl+c"],
      ["esc"],
    ]);
    // Never without the recipient, and never to another program.
    await expect(
      call("agent_conversation.press", {
        key: "esc",
        session_fingerprint: shown.session_fingerprint,
      }),
    ).resolves.toMatchObject({ status: "refused" });
    w.fake.replaceWithShell(t);
    await w.settle();
    await expect(press("esc")).resolves.toMatchObject({ status: "refused" });
    expect(sends(w)).toHaveLength(3);
  });

  test("a harness Chat cannot read still takes Stop's Esc through core", async () => {
    const { w, t, call, recipient } = await setup("opencode", "working");
    await expect(
      call("agent_conversation.press", {
        key: "esc",
        session_fingerprint: "",
        recipient,
      }),
    ).resolves.toMatchObject({ status: "sent" });
    await expect(
      call("agent_conversation.press", {
        key: "ctrl+shift+alt+ctrl+x",
        session_fingerprint: "",
        recipient,
      }),
    ).resolves.toMatchObject({ status: "refused" });
    expect(sends(w)).toEqual([
      expect.objectContaining({
        method: "terminal.keys",
        params: expect.objectContaining({ terminal: t, keys: ["esc"] }),
      }),
    ]);
  });

  test("a session Claude's process record names is read under the configured Claude directory", async () => {
    const config = await mkdtemp(join(tmpdir(), "hcw-claude-config-"));
    cleanups.push(() => rm(config, { recursive: true, force: true }));
    const before = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = config;
    cleanups.push(async () => {
      if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = before;
    });
    const id = "0b3e8a52-6f4c-4d1e-9a7b-2c5d8e1f4a60";
    const project = join(config, "projects", "-example-project");
    await mkdir(project, { recursive: true });
    const written = await fixtures
      .find((item) => item.agent === "claude")!
      .write(project);
    await rename(written, join(project, `${id}.jsonl`));
    const { call, host, t } = await setup("claude", "idle", false, {
      ...files,
      findClaudeSessionForProcess: async () => id,
    });
    const shown = (await call("agent_conversation.get")) as {
      status: string;
      messages: Array<{ text: string }>;
    };
    expect(shown.status).toBe("ok");
    // Apartments keeps the same session for the agent once it finishes.
    expect(await host.agentSessions().knownSession(t, "claude")).toMatchObject({
      id,
    });
    expect(shown.messages.map((m) => m.text)).toEqual(
      expect.arrayContaining([QUESTION, ANSWER]),
    );
  });

  test("a Codex rollout its process holds open names the session a move resumes", async () => {
    // The shape the real process record gave for an idle Codex on core,
    // started by typing `codex` into the terminal's shell.
    const id = "019a0000-0000-7000-8000-0000000000b2";
    const rollout = `/home/example/.codex/sessions/2026/11/22/rollout-2026-11-22T14-41-23-${id}.jsonl`;
    const { host, t } = await setup("codex", "idle", false, {
      ...files,
      findAgentSessionForProcess: async (agent) =>
        agent === "codex" ? { kind: "path", value: rollout } : null,
    });
    expect(await host.agentSessions().knownSession(t, "codex")).toMatchObject({
      id,
    });
  });

  test("a Codex session the person links is read for that program only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hcw-codex-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const id = "019a0000-0000-7000-8000-0000000000a1";
    const written = await fixtures
      .find((item) => item.agent === "codex")!
      .write(dir);
    const path = join(dir, `rollout-2026-10-22T09-00-00-${id}.jsonl`);
    await writeFile(
      path,
      `${JSON.stringify({
        type: "session_meta",
        payload: { id, cwd: "/work/demo" },
      })}\n${await readFile(written, "utf8")}`,
    );
    const { w, t, call, recipient, host } = await setup(
      "codex",
      "idle",
      false,
      {
        ...files,
        findCodexSessionById: async (asked) =>
          asked === id
            ? { path, mtimeMs: (await stat(path)).mtimeMs, identity: "fixture" }
            : null,
      },
    );
    const before = (await call("agent_conversation.get")) as {
      status: string;
      unavailable: { reason: string; detail: string };
    };
    expect(before.unavailable).toMatchObject({
      reason: "codex_unlinked",
      detail: CORE_CODEX_UNLINKED,
    });
    // Without the recipient the person saw, nothing is linked.
    const preview = (await call("agent_session.link_preview", {
      session_id: id,
      recipient,
    })) as { token: string; path: string };
    expect(preview.path).toBe(path);
    await expect(
      call("agent_session.link", { token: preview.token }),
    ).rejects.toThrow();
    const again = (await call("agent_session.link_preview", {
      session_id: id,
      recipient,
    })) as { token: string };
    await expect(
      call("agent_session.link", { token: again.token, recipient }),
    ).resolves.toEqual({ session_id: id });
    const shown = (await call("agent_conversation.get")) as {
      status: string;
      messages: Array<{ text: string }>;
    };
    expect(shown.status).toBe("ok");
    expect(shown.messages.length).toBeGreaterThan(0);
    const known = await host.agentSessions().knownSession(t, "codex");
    expect(known).toMatchObject({ id });
    // Linking reads; it types nothing.
    expect(sends(w)).toEqual([]);
    // Another program in the terminal does not inherit the link.
    w.fake.replaceWithShell(t);
    await w.settle();
    const after = await host.agentSessions().knownSession(t, "codex");
    expect(after?.id).toBeNull();
    expect(after?.holder).not.toBe(known?.holder);
    await expect(call("agent_conversation.get")).resolves.not.toMatchObject({
      status: "ok",
    });
  });

  test("Chat's trust answer is not offered for core", async () => {
    const { call } = await setup();
    await expect(
      call("agent_conversation.trust", { choice: "yes" }),
    ).resolves.toMatchObject({ status: "refused" });
  });
});

/**
 * Which conversation a core agent's Chat reads: the agent's own process
 * record, then its launch arguments, never a guess or another program's.
 */
describe("finding a core agent's conversation", () => {
  const SESSION = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const LAUNCHED = "11111111-2222-4333-8444-555555555555";
  const PID = 77;

  type Shown = { status: string; messages?: Array<{ text: string }> };

  /** A host whose Claude records name `records[pid]` (read live, so a test
   * can change them), with transcripts only for the IDs in `transcripts`. */
  async function claudeHost(
    records: Map<number, string | Error>,
    transcripts: string[],
  ) {
    const root = await mkdtemp(join(tmpdir(), "hcw-chat-host-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const path = await fixtures
      .find((fixture) => fixture.agent === "claude")!
      .write(root);
    const lookups: number[] = [];
    // An SSH host's lookups: a session ID never resolves on this machine.
    const access: AgentSessionFileAccess = {
      ...files,
      remote: true,
      findClaudeSessionById: async (id: string) =>
        transcripts.includes(id) ? localAgentSessionFiles.statFile(path) : null,
      findClaudeSuccessor: async () => null,
      findClaudeSessionForProcess: async (pid: number) => {
        lookups.push(pid);
        const found = records.get(pid);
        if (found instanceof Error) throw found;
        return found ?? null;
      },
    };
    return { access, lookups };
  }

  async function claudeLaunched(
    access: AgentSessionFileAccess,
    argv: string[] = ["claude", "--session-id", LAUNCHED],
  ) {
    const chat = await setup("claude", "idle", false, access);
    chat.w.fake.foreground(chat.t, { pid: PID, name: "claude", argv });
    await chat.w.settle();
    return chat;
  }

  test("the process record outranks the launch ID after /clear", async () => {
    const { access, lookups } = await claudeHost(new Map([[PID, SESSION]]), [
      SESSION,
    ]);
    const { call } = await claudeLaunched(access);
    const shown = (await call("agent_conversation.get")) as Shown;
    expect(shown.status).toBe("ok");
    expect(shown.messages!.map((m) => m.text)).toEqual(
      expect.arrayContaining([QUESTION, ANSWER]),
    );
    expect(lookups).toContain(PID);
  });

  test("a conversation that has not started yet shows no messages", async () => {
    // The record names the launched session, which has no transcript yet.
    const { access } = await claudeHost(new Map([[PID, LAUNCHED]]), []);
    const { call } = await claudeLaunched(access);
    const shown = (await call("agent_conversation.get")) as Shown;
    expect(shown.status).not.toBe("ok");
    expect(shown.messages ?? []).toEqual([]);
  });

  test("without a record, the launch ID names the conversation", async () => {
    const { access } = await claudeHost(new Map(), [LAUNCHED]);
    const { call } = await claudeLaunched(access);
    const shown = (await call("agent_conversation.get")) as Shown;
    expect(shown.status).toBe("ok");
    expect(shown.messages!.map((m) => m.text)).toEqual(
      expect.arrayContaining([QUESTION, ANSWER]),
    );
  });

  test("without a matching record or launch ID, Chat asks for a link instead of guessing", async () => {
    for (const record of [undefined, new Error("permission denied")]) {
      const { access } = await claudeHost(
        new Map(record ? [[PID, record]] : []),
        [SESSION, LAUNCHED],
      );
      const { call } = await claudeLaunched(access, ["claude"]);
      const shown = (await call("agent_conversation.get")) as Shown & {
        unavailable?: { reason: string };
      };
      expect(shown.status).toBe("unavailable");
      expect(shown.unavailable?.reason).toBe("no_session");
    }
  });

  test("an agent killed and replaced at the same address never shows the old conversation", async () => {
    const { access, lookups } = await claudeHost(new Map([[PID, SESSION]]), [
      SESSION,
    ]);
    const { w, t, call } = await claudeLaunched(access, ["claude"]);
    expect(((await call("agent_conversation.get")) as Shown).status).toBe("ok");
    // The host keeps the old record; the new Claude has its own process,
    // which has none yet.
    w.fake.replaceWithShell(t);
    w.fake.foreground(t, { pid: PID + 1, name: "claude", argv: ["claude"] });
    await w.settle();
    const shown = (await call("agent_conversation.get")) as Shown;
    expect(lookups).toEqual([PID, PID + 1]);
    expect(shown.status).not.toBe("ok");
    expect(shown.messages ?? []).toEqual([]);
  });

  test("a replacement that reuses the pid never shows the old conversation", async () => {
    const records = new Map<number, string | Error>([[PID, SESSION]]);
    const { access, lookups } = await claudeHost(records, [SESSION]);
    const { w, t, call } = await claudeLaunched(access, ["claude"]);
    expect(((await call("agent_conversation.get")) as Shown).status).toBe("ok");
    // Within the lookup cache's moment, the new program gets the same pid.
    w.fake.replaceWithShell(t, { reusePid: true });
    w.fake.foreground(t, { pid: PID, name: "claude", argv: ["claude"] });
    // The new process has no record of its own yet.
    records.delete(PID);
    await w.settle();
    const shown = (await call("agent_conversation.get")) as Shown;
    expect(lookups).toEqual([PID, PID]);
    expect(shown.status).not.toBe("ok");
    expect(shown.messages ?? []).toEqual([]);
  });

  test("pi's launch session ID identifies its conversation", async () => {
    const root = await mkdtemp(join(tmpdir(), "hcw-chat-pi-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const path = await fixtures.find((f) => f.agent === "pi")!.write(root);
    const asked: string[] = [];
    const { w, t, call } = await setup("pi", "idle", false, {
      ...files,
      remote: true,
      findPiSessionById: async (id: string) => {
        asked.push(id);
        return localAgentSessionFiles.statFile(path);
      },
    });
    w.fake.foreground(t, {
      pid: PID,
      name: "pi",
      argv: ["pi", "--session-id", LAUNCHED],
    });
    await w.settle();
    const shown = (await call("agent_conversation.get")) as Shown;
    expect(shown.status).toBe("ok");
    expect(shown.messages!.map((m) => m.text)).toEqual(
      expect.arrayContaining([QUESTION, ANSWER]),
    );
    expect(asked).toContain(LAUNCHED);
  });

  // Every harness whose launch arguments can name a transcript path reads
  // the same transcript through core as through Herdr's report.
  for (const [agent, flag] of [
    ["claude", "--resume"],
    ["pi", "--session"],
    ["kimi", "--session"],
    ["omp", "--resume"],
    ["codex", "resume"],
  ] as const)
    test(`core ${agent} reads the same native transcript as TUI`, async () => {
      const fixture = fixtures.find((f) => f.agent === agent)!;
      const root = await mkdtemp(join(tmpdir(), "hcw-chat-native-"));
      cleanups.push(() => rm(root, { recursive: true, force: true }));
      const path = await fixture.write(root);
      const { w, t, call } = await setup(agent, "idle", false);
      w.fake.foreground(t, {
        pid: PID,
        name: agent,
        argv: [agent, flag, path],
      });
      await w.settle();
      const history = (await call("agent_history.get", {
        history_version: 2,
      })) as { entries: unknown[] };
      const tui = createAgentSessionHandlers({
        herdrCall: async (method) => {
          if (method !== "agent.get") throw new Error(method);
          return {
            agent: {
              pane_id: t,
              agent,
              agent_status: "idle",
              agent_session: {
                source: "herdr",
                agent,
                kind: "path",
                value: path,
              },
            },
          };
        },
        files,
      });
      cleanups.push(async () => tui.conversationWatch.stop());
      const herdr = (await tui.readHistoryRequest({
        pane_id: t,
        history_version: 2,
      })) as { entries: unknown[] };
      expect(history.entries.length).toBeGreaterThan(0);
      expect(history.entries).toEqual(herdr.entries);
      expect(sends(w)).toEqual([]);
    });
});
