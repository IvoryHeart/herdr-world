// Safety and lifecycle boundaries of Chat's send admission, adopted from the
// independent #629 review (fake Herdr; no real harness): a failed, malformed,
// cut-off or stale observation, or a menu opened during preparation, never
// authorizes typing; identical commands are reserved once per session and
// busy interval, independent of dismissible receipts.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHerdrConversationSource } from "./herdr-conversation";
import { localAgentSessionFiles } from "./session-file-access";
import { createSessionProjectionCache } from "./session-projection-cache";
import { createAgentSessionResolverContext } from "./session-resolver";
import type { HerdrCall } from "./session-types";

const prompt = ["❯ ", "──────", "  ? for shortcuts"].join("\n");
let root = "";
let transcript = "";
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "review-629-"));
  transcript = join(root, "first.jsonl");
  const line =
    JSON.stringify({
      type: "user",
      timestamp: "2026-10-01T00:00:00Z",
      message: { role: "user", content: "Tidy the README" },
    }) + "\n";
  await writeFile(transcript, line);
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function setup() {
  const state = {
    status: "idle",
    screen: prompt,
    file: transcript,
    readFails: false,
    readMalformed: false,
    loseAck: false,
    badNextInfo: false,
    rejectNextPrompt: "",
    holdNextInfo: false,
    infoGate: Promise.resolve() as Promise<void>,
    infoStarted: () => {},
    prompts: [] as string[],
  };
  const agent = () => ({
    pane_id: "w1:p1",
    agent: "claude",
    agent_status: state.status,
    state_change_seq: 3,
    terminal_title: "claude",
    agent_session: {
      source: "herdr:claude",
      agent: "claude",
      kind: "path",
      value: state.file,
    },
  });
  const call: HerdrCall = async (method, params) => {
    if (method === "agent.get") {
      if (state.badNextInfo) {
        state.badNextInfo = false;
        return {};
      }
      const info = agent();
      if (state.holdNextInfo) {
        state.holdNextInfo = false;
        state.infoStarted();
        await state.infoGate;
      }
      return { agent: info };
    }
    if (method === "pane.read") {
      if (state.readFails) throw new Error("synthetic pane read failure");
      return state.readMalformed
        ? { read: {} }
        : { read: { pane_id: "w1:p1", text: state.screen } };
    }
    if (method === "agent.prompt") {
      if (state.rejectNextPrompt) {
        const error = state.rejectNextPrompt;
        state.rejectNextPrompt = "";
        throw new Error(error);
      }
      state.prompts.push(String((params as { text: string }).text));
      if (state.loseAck) {
        state.loseAck = false;
        throw new Error("synthetic lost prompt acknowledgement");
      }
      return { agent: agent() };
    }
    throw new Error(`unexpected ${method}`);
  };
  const source = createHerdrConversationSource({
    herdrCall: call,
    files: localAgentSessionFiles,
    context: createAgentSessionResolverContext(),
    cache: createSessionProjectionCache(localAgentSessionFiles),
  });
  return { source, state };
}

test("review repair: a malformed observation must not retire a live reservation", async () => {
  const { source, state } = setup();
  try {
    const fp = (await source.latest({ pane_id: "w1:p1" })).session_fingerprint!;
    state.status = "working";
    const send = () =>
      source.send({
        pane_id: "w1:p1",
        text: "/permissions",
        session_fingerprint: fp,
      });
    expect((await send()).status).toBe("sent");
    state.badNextInfo = true;
    const result = await send();
    expect(result).toMatchObject({ status: "refused", reason: "duplicate" });
    expect(state.prompts).toEqual(["/permissions"]);
  } finally {
    source.dispose();
  }
});

test("review repair: an idle read started before admission cannot clear the queued command", async () => {
  const { source, state } = setup();
  let release = () => {};
  try {
    const fp = (await source.latest({ pane_id: "w1:p1" })).session_fingerprint!;
    const started = Promise.withResolvers<void>();
    state.holdNextInfo = true;
    state.infoGate = new Promise<void>((r) => {
      release = r;
    });
    state.infoStarted = () => started.resolve();
    const oldRead = source.latest({ pane_id: "w1:p1" });
    await started.promise;
    state.status = "working";
    const send = () =>
      source.send({
        pane_id: "w1:p1",
        text: "/permissions",
        session_fingerprint: fp,
      });
    expect((await send()).status).toBe("sent");
    release();
    const old = await oldRead;
    expect(old.deliveries?.[0]?.waiting).toBe(true);
    const result = await send();
    expect(result).toMatchObject({ status: "refused", reason: "duplicate" });
    expect(state.prompts).toEqual(["/permissions"]);
  } finally {
    release();
    source.dispose();
  }
});

test("review repair: a definite native non-submission permits the same command to retry", async () => {
  const { source, state } = setup();
  try {
    const fp = (await source.latest({ pane_id: "w1:p1" })).session_fingerprint!;
    state.status = "working";
    state.rejectNextPrompt =
      "agent_not_ready: no longer the pane foreground process";
    const send = () =>
      source.send({
        pane_id: "w1:p1",
        text: "/permissions",
        session_fingerprint: fp,
      });
    await expect(send()).rejects.toThrow("agent_not_ready");
    expect(state.prompts).toEqual([]);
    const result = await send();
    expect(result.status).toBe("sent");
    expect(state.prompts).toEqual(["/permissions"]);
  } finally {
    source.dispose();
  }
});

for (const status of ["", "unknown", "blocked"]) {
  test(`an observed ${JSON.stringify(status)} state cannot retire a waiting command`, async () => {
    const { source, state } = setup();
    try {
      const fp = (await source.latest({ pane_id: "w1:p1" }))
        .session_fingerprint!;
      state.status = "working";
      await source.send({
        pane_id: "w1:p1",
        text: "/permissions",
        session_fingerprint: fp,
      });
      state.status = status;
      const shown = await source.latest({ pane_id: "w1:p1" });
      expect(shown.deliveries?.[0]?.waiting).toBe(true);
      expect(
        await source.send({
          pane_id: "w1:p1",
          text: "/permissions",
          session_fingerprint: fp,
        }),
      ).toMatchObject({ status: "refused", reason: "duplicate" });
      expect(state.prompts).toEqual(["/permissions"]);
    } finally {
      source.dispose();
    }
  });
}

for (const error of [
  "agent_not_found: no agent",
  "agent_blocked: question open",
]) {
  test(`a definite ${error.split(":")[0]} rejection releases its reservation`, async () => {
    const { source, state } = setup();
    try {
      const fp = (await source.latest({ pane_id: "w1:p1" }))
        .session_fingerprint!;
      state.status = "working";
      state.rejectNextPrompt = error;
      const send = () =>
        source.send({
          pane_id: "w1:p1",
          text: "/permissions",
          session_fingerprint: fp,
        });
      if (error.startsWith("agent_blocked:"))
        expect(await send()).toMatchObject({
          status: "refused",
          reason: "blocked",
        });
      else await expect(send()).rejects.toThrow(error);
      expect(state.prompts).toEqual([]);
      expect((await send()).status).toBe("sent");
      expect(state.prompts).toEqual(["/permissions"]);
    } finally {
      source.dispose();
    }
  });
}
