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
import { TERMINAL_SIZE_FLOOR } from "../../../shared/terminalSize";

// Chat sends by typing into the pane. With a harness menu open, typed text is
// taken as keys and can pick the menu's options, so Chat must never send then.

const menuScreen = readFileSync(
  new URL(
    "./fixtures/pending-prompts/menu-claude-permission-where.txt",
    import.meta.url,
  ),
  "utf8",
);
const promptScreen = ["❯ ", "──────", "  ? for shortcuts"].join("\n");

let root = "";
let transcript = "";
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "herdr-world-send-menu-"));
  transcript = join(root, "demo.jsonl");
  await writeFile(
    transcript,
    `${JSON.stringify({
      type: "user",
      timestamp: new Date().toISOString(),
      message: { role: "user", content: "Tidy the README" },
    })}\n`,
  );
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function fakeHerdr() {
  const state = {
    status: "idle",
    screen: promptScreen,
    prompts: [] as string[],
    rows: 24 as unknown,
    terminal: "term-1",
    sizePane: "w1:p1",
    sequence: 3,
    sessionFile: transcript,
    reported: true,
    agent: "claude",
    alive: true,
    onSize: null as (() => void | Promise<void>) | null,
  };
  const agent = () => ({
    pane_id: "w1:p1",
    agent: state.agent,
    agent_status: state.status,
    state_change_seq: state.sequence,
    terminal_id: state.terminal,
    terminal_title: "claude",
    agent_session: state.reported
      ? {
          source: "herdr:claude",
          agent: "claude",
          kind: "path",
          value: state.sessionFile,
        }
      : undefined,
  });
  const call: HerdrCall = async (method, params) => {
    if (!state.alive) throw new Error("captured runtime retired");
    if (method === "agent.get") return { agent: agent() };
    if (method === "pane.get") {
      await state.onSize?.();
      return {
        pane: {
          pane_id: state.sizePane,
          scroll: { viewport_rows: state.rows },
        },
      };
    }
    if (method === "pane.read")
      return { read: { pane_id: "w1:p1", text: state.screen } };
    if (method === "agent.prompt") {
      state.prompts.push(String((params as { text: string }).text));
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
  return { state, source };
}

test("menu size note uses measured rows and the shared floor only after a current command", async () => {
  const { state, source } = fakeHerdr();
  try {
    const target = { pane_id: "w1:p1", menus: true };
    state.rows = 2;
    expect((await source.latest(target)).menu_unreadable).toBeUndefined();
    const shown = await source.latest(target);
    expect(
      (
        await source.send({
          pane_id: target.pane_id,
          text: "/model",
          session_fingerprint: shown.session_fingerprint!,
        })
      ).status,
    ).toBe("sent");
    state.screen = "Select model\n…";
    for (const rows of [
      2,
      TERMINAL_SIZE_FLOOR.rows,
      9,
      24,
      undefined,
      null,
      "2",
      0,
      -1,
      NaN,
      1.5,
    ]) {
      state.rows = rows;
      expect((await source.latest(target)).menu_unreadable).toEqual(
        rows === 2 ? { reason: "terminal_too_small", rows: 2 } : undefined,
      );
    }
    state.rows = 2;
    state.screen = menuScreen;
    const menu = await source.latest(target);
    expect(menu.pending_prompt?.menu).toBeTruthy();
    expect(menu.menu_unreadable).toBeUndefined();
    state.screen = promptScreen;
    expect(
      (
        await source.send({
          pane_id: target.pane_id,
          text: "Continue",
          session_fingerprint: shown.session_fingerprint!,
        })
      ).status,
    ).toBe("sent");
    state.screen = "Select model\n…";
    expect((await source.latest(target)).menu_unreadable).toBeUndefined();
  } finally {
    source.dispose();
  }
});

test("late size reads cannot describe a changed native witness, session, command or runtime", async () => {
  for (const change of [
    "terminal",
    "pane",
    "sequence",
    "session",
    "unbound",
    "codex",
    "command",
    "runtime",
    "read-error",
  ]) {
    const { state, source } = fakeHerdr();
    try {
      const target = { pane_id: "w1:p1", menus: true };
      const shown = await source.latest(target);
      const fingerprint = shown.session_fingerprint!;
      await source.send({
        pane_id: target.pane_id,
        text: "/model",
        session_fingerprint: fingerprint,
      });
      state.rows = 2;
      state.screen = "Select model\n…";
      state.onSize = async () => {
        state.onSize = null;
        if (change === "terminal") state.terminal = "term-2";
        if (change === "pane") state.sizePane = "w1:p2";
        if (change === "sequence") state.sequence++;
        if (change === "session")
          state.sessionFile = join(root, "replacement.jsonl");
        if (change === "unbound") state.reported = false;
        if (change === "codex") {
          state.agent = "codex";
          state.reported = false;
        }
        if (change === "runtime") state.alive = false;
        if (change === "read-error") throw new Error("size unavailable");
        if (change === "command") {
          state.screen = promptScreen;
          await source.send({
            pane_id: target.pane_id,
            text: "/permissions",
            session_fingerprint: fingerprint,
          });
        }
      };
      expect((await source.latest(target)).menu_unreadable).toBeUndefined();
    } finally {
      source.dispose();
    }
  }
});

test("an open menu refuses a message and a command; nothing is typed", async () => {
  const { state, source } = fakeHerdr();
  const shown = await source.latest({ pane_id: "w1:p1" });
  const fingerprint = shown.session_fingerprint!;
  state.screen = menuScreen;
  for (const text of ["Please continue", "/permissions"]) {
    const result = await source.send({
      pane_id: "w1:p1",
      text,
      session_fingerprint: fingerprint,
    });
    expect(result).toMatchObject({ status: "refused", reason: "menu" });
    expect(result.status === "refused" && result.message).toContain(
      "Add allow permission rule",
    );
  }
  expect(state.prompts).toEqual([]);
  // Once the menu has closed, the same message goes.
  state.screen = promptScreen;
  expect(
    await source.send({
      pane_id: "w1:p1",
      text: "Please continue",
      session_fingerprint: fingerprint,
    }),
  ).toMatchObject({ status: "sent" });
  expect(state.prompts).toEqual(["Please continue"]);
  source.dispose();
});

test("a command queued while the agent is busy is not queued twice", async () => {
  const { state, source } = fakeHerdr();
  const fingerprint = (await source.latest({ pane_id: "w1:p1" }))
    .session_fingerprint!;
  state.status = "working";
  const send = (text: string) =>
    source.send({ pane_id: "w1:p1", text, session_fingerprint: fingerprint });
  expect(await send("/permissions")).toMatchObject({ status: "sent" });
  expect(await send("/permissions")).toMatchObject({
    status: "refused",
    reason: "duplicate",
  });
  // A different command, or a message, still queues.
  expect(await send("/model")).toMatchObject({ status: "sent" });
  // Once the agent is free, sending it again is the user's choice.
  state.status = "idle";
  expect(await send("/permissions")).toMatchObject({ status: "sent" });
  expect(state.prompts).toEqual(["/permissions", "/model", "/permissions"]);
  source.dispose();
});

test("a queued command's waiting state follows the service, not the receipt", async () => {
  const { state, source } = fakeHerdr();
  const fingerprint = (await source.latest({ pane_id: "w1:p1" }))
    .session_fingerprint!;
  state.status = "working";
  const sent = await source.send({
    pane_id: "w1:p1",
    text: "/permissions",
    session_fingerprint: fingerprint,
  });
  if (sent.status !== "sent") throw new Error("not sent");
  const waiting = (await source.latest({ pane_id: "w1:p1" })).deliveries;
  expect(waiting.find((d) => d.id === sent.delivery.id)?.waiting).toBe(true);
  // Dismissing the notice does not cancel the command in the agent's queue.
  source.dismiss({ pane_id: "w1:p1", delivery_id: sent.delivery.id });
  expect(
    await source.send({
      pane_id: "w1:p1",
      text: "/permissions",
      session_fingerprint: fingerprint,
    }),
  ).toMatchObject({ status: "refused", reason: "duplicate" });
  // Once the agent is seen not working, the command is no longer waiting.
  state.status = "idle";
  const after = (await source.latest({ pane_id: "w1:p1" })).deliveries;
  expect(after.some((d) => d.waiting)).toBe(false);
  source.dispose();
});
