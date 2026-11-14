import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localAgentSessionFiles } from "../agent/session-file-access";
import {
  fixtures,
  QUESTION,
  ANSWER,
} from "../agent/testing/conversation-fixtures";
import { readSessionProjection } from "../agent/session-projection-cache";
import { readCoreHistory } from "./history";
import { coreWorld } from "./testing/core-world";
import { coreHarnessNames, harnessName } from "./harness";
import inventory from "./testing/harness-inventory.json";
import { coreRecipientToken } from "./recipient";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup(kind = "claude") {
  const w = await coreWorld();
  cleanups.push(w.dispose);
  await w.connect();
  const t = w.fake.create({
    argv: [kind],
    foreground: { pid: 77, name: kind, argv: [kind] },
  });
  await w.settle();
  const token = coreRecipientToken(
    w.lease().runtime.core.epoch!.coreId,
    w.lease().runtime.core.terminal(t),
    w.lease().runtime.core.occupancy(t),
  )!;
  return { w, t, token };
}

for (const fixture of fixtures)
  test(`core ${fixture.agent} reads the same native transcript as TUI`, async () => {
    const root = await mkdtemp(join(tmpdir(), "hcw-history-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const path = await fixture.write(root);
    const { w, t, token } = await setup(
      fixture.agent === "agy" ? "agy" : fixture.agent,
    );
    const result = await readCoreHistory(w.lease(), t, token, {
      files: localAgentSessionFiles,
      session: { kind: "path", value: path },
    });
    expect(result.status).toBe("ok");
    expect(result.entries.map((e) => e.text)).toEqual(
      expect.arrayContaining([QUESTION, ANSWER]),
    );
    const file = (await localAgentSessionFiles.statFile(path))!;
    const tui = await readSessionProjection(
      fixture.agent,
      file,
      localAgentSessionFiles,
    );
    expect(result.entries).toEqual(tui.entries);
    expect(
      w.fake.calls.some((c) =>
        ["terminal.send", "terminal.keys", "terminal.label"].includes(c.method),
      ),
    ).toBe(false);
  });

test("history never falls back from remote ID to local discovery", async () => {
  const { w, t, token } = await setup("kimi");
  const files = {
    ...localAgentSessionFiles,
    remote: true,
    statFile: async () => {
      throw new Error("local read");
    },
  };
  const result = await readCoreHistory(w.lease(), t, token, {
    files,
    session: { kind: "id", value: "synthetic-id" },
  });
  expect(result).toMatchObject({
    status: "unavailable",
    reason: "remote_lookup",
    entries: [],
  });
});

test("replacement during a transcript read cannot publish old conversation", async () => {
  const { w, t, token } = await setup();
  const files = {
    ...localAgentSessionFiles,
    statFile: async (path: string) => ({ path, mtimeMs: 1 }),
    readText: async () => {
      w.fake.replaceWithShell(t);
      await w.settle();
      return "";
    },
  };
  await expect(
    readCoreHistory(w.lease(), t, token, {
      files,
      session: { kind: "path", value: "/work/example/chat.jsonl" },
    }),
  ).rejects.toThrow();
});

test("unknown harness and Windows transcripts are explicit unavailable states", async () => {
  const { w, t, token } = await setup("gemini");
  expect(
    await readCoreHistory(w.lease(), t, token, {
      files: localAgentSessionFiles,
    }),
  ).toMatchObject({ reason: "unsupported_harness", entries: [] });
  expect(
    await readCoreHistory(w.lease(), t, token, {
      files: localAgentSessionFiles,
      windows: true,
    }),
  ).toMatchObject({ reason: "unsupported_platform", entries: [] });
});

test("a native resume argument identifies the transcript without a World session report", async () => {
  const { w, t } = await setup("claude");
  const path = "/work/example/conversation.jsonl";
  w.fake.foreground(t, {
    pid: 77,
    name: "claude",
    argv: ["claude", "--resume", path],
  });
  await w.settle();
  const token = coreRecipientToken(
    w.lease().runtime.core.epoch!.coreId,
    w.lease().runtime.core.terminal(t),
    w.lease().runtime.core.occupancy(t),
  )!;
  const files = {
    ...localAgentSessionFiles,
    statFile: async () => ({ path, mtimeMs: 1 }),
    readText: async () => "",
  };
  expect(await readCoreHistory(w.lease(), t, token, { files })).toMatchObject({
    status: "ok",
    source: "native",
  });
});

for (const fault of ["foreground", "title", "disconnect"] as const)
  test(`${fault} changing during a history read rejects publication`, async () => {
    const { w, t, token } = await setup();
    const files = {
      ...localAgentSessionFiles,
      statFile: async (path: string) => ({ path, mtimeMs: 1 }),
      readText: async () => {
        if (fault === "foreground") w.fake.foreground(t, null);
        else if (fault === "title") w.fake.title(t, "different conversation");
        else await w.service.disconnect("box");
        if (fault !== "disconnect") await w.settle();
        return "";
      },
    };
    await expect(
      readCoreHistory(w.lease(), t, token, {
        files,
        session: { kind: "path", value: "/work/example/chat.jsonl" },
      }),
    ).rejects.toThrow();
  });

test("core catalog equals the raw TUI, desktop and World inventory union", () => {
  const names = [
    ...inventory.world_profiles,
    ...inventory.tui_detection,
    ...inventory.desktop_agents,
  ].map(harnessName);
  expect(names).not.toContain(null);
  expect(coreHarnessNames().sort()).toEqual(
    [...new Set(names.filter((name): name is string => name !== null))].sort(),
  );
});

const SESSION = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const LAUNCHED = "11111111-2222-4333-8444-555555555555";

/** A host whose Claude records name `records[pid]`, and whose transcripts
 * exist for the IDs in `transcripts` (the Claude fixture's text). */
async function claudeHost(
  records: Record<number, string | Error>,
  transcripts: string[] = [SESSION],
) {
  const root = await mkdtemp(join(tmpdir(), "hcw-history-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const path = await fixtures
    .find((fixture) => fixture.agent === "claude")!
    .write(root);
  const lookups: number[] = [];
  const files = {
    ...localAgentSessionFiles,
    remote: true,
    findClaudeSessionById: async (id: string) =>
      transcripts.includes(id) ? localAgentSessionFiles.statFile(path) : null,
    findClaudeSuccessor: async () => null,
    findClaudeSessionForProcess: async (pid: number) => {
      lookups.push(pid);
      const found = records[pid];
      if (found instanceof Error) throw found;
      return found ?? null;
    },
  };
  return { files, lookups };
}
const tokenOf = (w: Awaited<ReturnType<typeof setup>>["w"], t: string) =>
  coreRecipientToken(
    w.lease().runtime.core.epoch!.coreId,
    w.lease().runtime.core.terminal(t),
    w.lease().runtime.core.occupancy(t),
  )!;

test("Claude's own process record identifies the conversation without a link", async () => {
  const { w, t, token } = await setup("claude");
  const { files, lookups } = await claudeHost({ 77: SESSION });
  const result = await readCoreHistory(w.lease(), t, token, { files });
  expect(result).toMatchObject({ status: "ok", source: "native" });
  expect(result.entries.map((e) => e.text)).toEqual(
    expect.arrayContaining([QUESTION, ANSWER]),
  );
  expect(lookups).toEqual([77]);
});

test("the process record outranks the launch ID after /clear, and a link outranks both", async () => {
  const { w, t } = await setup("claude");
  w.fake.foreground(t, {
    pid: 77,
    name: "claude",
    argv: ["claude", "--session-id", LAUNCHED],
  });
  await w.settle();
  const { files, lookups } = await claudeHost({ 77: SESSION });
  expect(
    await readCoreHistory(w.lease(), t, tokenOf(w, t), { files }),
  ).toMatchObject({ status: "ok", source: "native" });
  // A conversation that has not started yet has no transcript.
  const fresh = await claudeHost({ 77: LAUNCHED });
  expect(
    await readCoreHistory(w.lease(), t, tokenOf(w, t), { files: fresh.files }),
  ).toMatchObject({
    status: "unavailable",
    reason: "no_messages_yet",
    entries: [],
  });
  // Without a record, the launch ID still names the conversation.
  const unrecorded = await claudeHost({}, [LAUNCHED]);
  expect(
    await readCoreHistory(w.lease(), t, tokenOf(w, t), {
      files: unrecorded.files,
    }),
  ).toMatchObject({ status: "ok", source: "native" });
  // A link is the person's choice and skips the record.
  lookups.length = 0;
  expect(
    await readCoreHistory(w.lease(), t, tokenOf(w, t), {
      files,
      session: { kind: "id", value: SESSION },
    }),
  ).toMatchObject({ status: "ok", source: "linked" });
  expect(lookups).toEqual([]);
});

test("without a matching record Chat asks for a link instead of guessing", async () => {
  const { w, t, token } = await setup("claude");
  for (const record of [undefined, new Error("permission denied")]) {
    const { files } = await claudeHost(record ? { 77: record } : {});
    expect(await readCoreHistory(w.lease(), t, token, { files })).toMatchObject(
      { status: "unavailable", reason: "no_session", entries: [] },
    );
  }
});

test("an agent killed and replaced at the same address never shows the old conversation", async () => {
  const { w, t, token } = await setup("claude");
  // The host keeps the old record; the new process (same pid) does not match
  // it, so the lookup finds nothing for it (claude-process-session.test.ts).
  const { files } = await claudeHost({ 77: SESSION });
  expect(await readCoreHistory(w.lease(), t, token, { files })).toMatchObject({
    status: "ok",
  });
  w.fake.replaceWithShell(t);
  w.fake.foreground(t, { pid: 77, name: "claude", argv: ["claude"] });
  await w.settle();
  // The Chat opened for the old agent is refused outright.
  await expect(
    readCoreHistory(w.lease(), t, token, { files }),
  ).rejects.toThrow();
  const replaced = await claudeHost({});
  const result = await readCoreHistory(w.lease(), t, tokenOf(w, t), {
    files: replaced.files,
  });
  expect(result).toMatchObject({ status: "unavailable", entries: [] });
});

test("pi's launch session ID identifies its conversation", async () => {
  const { w, t } = await setup("pi");
  w.fake.foreground(t, {
    pid: 77,
    name: "pi",
    argv: ["pi", "--session-id", LAUNCHED],
  });
  await w.settle();
  const root = await mkdtemp(join(tmpdir(), "hcw-history-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const path = await fixtures.find((f) => f.agent === "pi")!.write(root);
  const asked: string[] = [];
  const files = {
    ...localAgentSessionFiles,
    remote: true,
    findPiSessionById: async (id: string) => {
      asked.push(id);
      return localAgentSessionFiles.statFile(path);
    },
  };
  expect(
    await readCoreHistory(w.lease(), t, tokenOf(w, t), { files }),
  ).toMatchObject({ status: "ok", source: "native" });
  expect(asked).toEqual([LAUNCHED]);
});
