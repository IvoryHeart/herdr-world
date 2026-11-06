// Safety and lifecycle boundaries of Chat's send admission, adopted from the
// independent #629 review (fake Herdr; no real harness): a failed, malformed,
// cut-off or stale observation, or a menu opened during preparation, never
// authorizes typing; identical commands are reserved once per session and
// busy interval, independent of dismissible receipts.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHerdrConversationSource } from "./herdr-conversation";
import { localAgentSessionFiles } from "./session-file-access";
import { createSessionProjectionCache } from "./session-projection-cache";
import { createAgentSessionResolverContext } from "./session-resolver";
import type { HerdrCall } from "./session-types";

const menu = readFileSync(
  new URL(
    "./fixtures/pending-prompts/menu-claude-permission-where.txt",
    import.meta.url,
  ),
  "utf8",
);
const prompt = ["❯ ", "──────", "  ? for shortcuts"].join("\n");
let root = "";
let transcript = "";
let replacement = "";
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "review-629-"));
  transcript = join(root, "first.jsonl");
  replacement = join(root, "second.jsonl");
  const line =
    JSON.stringify({
      type: "user",
      timestamp: "2026-10-01T00:00:00Z",
      message: { role: "user", content: "Tidy the README" },
    }) + "\n";
  await Promise.all([
    writeFile(transcript, line),
    writeFile(replacement, line),
  ]);
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
    if (method === "agent.get") return { agent: agent() };
    if (method === "pane.read") {
      if (state.readFails) throw new Error("synthetic pane read failure");
      return state.readMalformed
        ? { read: {} }
        : { read: { pane_id: "w1:p1", text: state.screen } };
    }
    if (method === "agent.prompt") {
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

test("review: failed pane read cannot authorize text into a menu", async () => {
  const { source, state } = setup();
  try {
    const fp = (await source.latest({ pane_id: "w1:p1" })).session_fingerprint!;
    state.screen = menu;
    state.readFails = true;
    const result = await source.send({
      pane_id: "w1:p1",
      text: "2 please continue",
      session_fingerprint: fp,
    });
    expect(state.prompts).toEqual([]);
    expect(result.status).toBe("refused");
  } finally {
    source.dispose();
  }
});

test("review: malformed pane read cannot authorize text", async () => {
  const { source, state } = setup();
  try {
    const fp = (await source.latest({ pane_id: "w1:p1" })).session_fingerprint!;
    state.readMalformed = true;
    await source.send({
      pane_id: "w1:p1",
      text: "Please continue",
      session_fingerprint: fp,
    });
    expect(state.prompts).toEqual([]);
  } finally {
    source.dispose();
  }
});

test("review: a cut-off menu is unsafe even when no card can be offered", async () => {
  const { source, state } = setup();
  try {
    const fp = (await source.latest({ pane_id: "w1:p1" })).session_fingerprint!;
    state.screen = menu
      .split("\n")
      .filter((line) => !line.startsWith("▔"))
      .join("\n");
    await source.send({
      pane_id: "w1:p1",
      text: "2 please continue",
      session_fingerprint: fp,
    });
    expect(state.prompts).toEqual([]);
  } finally {
    source.dispose();
  }
});

test("review: a stale working status cannot authorize a visible menu", async () => {
  const { source, state } = setup();
  try {
    const fp = (await source.latest({ pane_id: "w1:p1" })).session_fingerprint!;
    state.status = "working";
    state.screen = menu;
    await source.send({
      pane_id: "w1:p1",
      text: "2 please continue",
      session_fingerprint: fp,
    });
    expect(state.prompts).toEqual([]);
  } finally {
    source.dispose();
  }
});

test("review: simultaneous identical commands admit one native prompt", async () => {
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
    const results = await Promise.all([send(), send()]);
    expect(state.prompts).toEqual(["/permissions"]);
    expect(
      results.filter((r) => r.status === "refused" && r.reason === "duplicate"),
    ).toHaveLength(1);
  } finally {
    source.dispose();
  }
});

test("review: a previous session command does not block the current session", async () => {
  const { source, state } = setup();
  try {
    const first = (await source.latest({ pane_id: "w1:p1" }))
      .session_fingerprint!;
    state.status = "working";
    await source.send({
      pane_id: "w1:p1",
      text: "/permissions",
      session_fingerprint: first,
    });
    state.file = replacement;
    const second = (await source.latest({ pane_id: "w1:p1" }))
      .session_fingerprint!;
    expect(second).not.toBe(first);
    const result = await source.send({
      pane_id: "w1:p1",
      text: "/permissions",
      session_fingerprint: second,
    });
    expect(result.status).toBe("sent");
  } finally {
    source.dispose();
  }
});

test("review: a lost acknowledgement cannot authorize an identical retry", async () => {
  const { source, state } = setup();
  try {
    const fp = (await source.latest({ pane_id: "w1:p1" })).session_fingerprint!;
    state.status = "working";
    state.loseAck = true;
    const send = () =>
      source.send({
        pane_id: "w1:p1",
        text: "/permissions",
        session_fingerprint: fp,
      });
    await expect(send()).rejects.toThrow(
      "synthetic lost prompt acknowledgement",
    );
    await send();
    expect(state.prompts).toEqual(["/permissions"]);
  } finally {
    source.dispose();
  }
});

test("review: a completed busy interval does not poison the next busy interval", async () => {
  const { source, state } = setup();
  try {
    const fp = (await source.latest({ pane_id: "w1:p1" })).session_fingerprint!;
    state.status = "working";
    await source.send({
      pane_id: "w1:p1",
      text: "/permissions",
      session_fingerprint: fp,
    });
    state.status = "idle";
    await source.latest({ pane_id: "w1:p1" });
    state.status = "working";
    const result = await source.send({
      pane_id: "w1:p1",
      text: "/permissions",
      session_fingerprint: fp,
    });
    expect(result.status).toBe("sent");
  } finally {
    source.dispose();
  }
});

test("review: dismissing a receipt cannot cancel the native pending command", async () => {
  const { source, state } = setup();
  try {
    const fp = (await source.latest({ pane_id: "w1:p1" })).session_fingerprint!;
    state.status = "working";
    const first = await source.send({
      pane_id: "w1:p1",
      text: "/permissions",
      session_fingerprint: fp,
    });
    if (first.status !== "sent") throw new Error("first send refused");
    expect(
      source.dismiss({ pane_id: "w1:p1", delivery_id: first.delivery.id }),
    ).toBe(true);
    const result = await source.send({
      pane_id: "w1:p1",
      text: "/permissions",
      session_fingerprint: fp,
    });
    expect(result).toMatchObject({ status: "refused", reason: "duplicate" });
    expect(state.prompts).toEqual(["/permissions"]);
  } finally {
    source.dispose();
  }
});

test("review: ordinary text, repeated messages and distinct commands remain allowed", async () => {
  const { source, state } = setup();
  try {
    const fp = (await source.latest({ pane_id: "w1:p1" })).session_fingerprint!;
    for (const text of [
      "Please continue",
      "Please continue",
      "/permissions",
      "/model",
    ]) {
      expect(
        (await source.send({ pane_id: "w1:p1", text, session_fingerprint: fp }))
          .status,
      ).toBe("sent");
      state.status = "working";
    }
    expect(state.prompts).toHaveLength(4);
  } finally {
    source.dispose();
  }
});

test("review: durable admission awaits cannot reuse an earlier menu-free pane", async () => {
  const { source, state } = setup();
  try {
    const fp = (await source.latest({ pane_id: "w1:p1" })).session_fingerprint!;
    await source.send({
      pane_id: "w1:p1",
      text: "2 please continue",
      session_fingerprint: fp,
      beforeSubmit: async () => {
        state.screen = menu;
        return true;
      },
    });
    expect(state.prompts).toEqual([]);
  } finally {
    source.dispose();
  }
});
