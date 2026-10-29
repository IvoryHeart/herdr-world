import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { conversationRpc } from "./conversation-rpc";
import type { ConversationSource } from "./conversation";
import { parseCommandMenu } from "./pending-prompt";
import { createPromptActions } from "./prompt-answer";

const fixture = (name: string) =>
  readFileSync(
    new URL(`./fixtures/pending-prompts/${name}.txt`, import.meta.url),
    "utf8",
  );

/** A pane showing `name`, whose screen follows the keys it is sent. */
function harness(name: string, next: Record<string, string> = {}) {
  const agent = name.includes("codex") ? "codex" : "claude";
  const state = {
    screen: fixture(name),
    status: agent === "codex" ? "done" : "idle",
    session: "fixture",
    terminal: "terminal",
    seq: 3,
    bound: "bound-session",
    /** Runs between the first and second check of the pane. */
    onInfo: (() => {}) as (count: number) => void,
    /** Holds every read of the pane until it settles. */
    hold: null as Promise<void> | null,
  };
  const sent: Record<string, unknown>[] = [];
  let infos = 0;
  const info = () => {
    state.onInfo(++infos);
    return {
      agent,
      agent_status: state.status,
      agent_session: state.session,
      terminal_id: state.terminal,
      state_change_seq: state.seq,
      terminal_title: "Fixture",
      revision: 1,
    };
  };
  const read = async () =>
    parseCommandMenu(agent, state.screen, {
      session: state.session,
      seq: state.seq,
    });
  const actions = createPromptActions({
    agentInfo: async () => {
      if (state.hold) await state.hold;
      return info();
    },
    readPrompt: async () => null,
    readMenu: async () => read(),
    isCodexBound: async () => true,
    sessionFingerprint: async () => state.bound,
    delay: async () => {},
    herdrCall: async (method, params = {}) => {
      if (method === "pane.send_input") {
        sent.push(params);
        const key = (params.keys as string[])[0] ?? `text:${params.text}`;
        if (next[key] !== undefined) state.screen = next[key]!;
      }
      return {};
    },
  });
  return { state, sent, actions, read };
}

test("a menu key goes only to the session and menu Chat showed", async () => {
  const pane = harness("menu-codex-permissions", {
    "3": fixture("menu-codex-full-access"),
  });
  const shown = (await pane.read())!;
  const result = await pane.actions.press({
    pane_id: "p1",
    key: "3",
    session_fingerprint: "bound-session",
    menu_fingerprint: shown.fingerprint,
  });
  expect(pane.sent).toEqual([{ pane_id: "p1", text: "", keys: ["3"] }]);
  // The reply carries the next step: Codex asks to confirm full access.
  expect(result).toMatchObject({
    status: "sent",
    key: "3",
    menu: { question: ["Enable full access?"] },
  });
});

test("Escape closing the menu returns no menu", async () => {
  const pane = harness("menu-claude-model", {
    esc: fixture("menu-claude-closed"),
  });
  const result = await pane.actions.press({
    pane_id: "p1",
    key: "esc",
    session_fingerprint: "bound-session",
    menu_fingerprint: (await pane.read())!.fingerprint,
  });
  expect(result).toEqual({ status: "sent", key: "esc", menu: null });
});

test("another session, a changed menu or a key the menu does not name sends nothing", async () => {
  const pane = harness("menu-claude-model");
  const shown = (await pane.read())!;
  const press = (key: string, extra: Record<string, string> = {}) =>
    pane.actions.press({
      pane_id: "p1",
      key,
      session_fingerprint: "bound-session",
      menu_fingerprint: shown.fingerprint,
      ...extra,
    });
  pane.state.bound = "another-session";
  expect(await press("2")).toMatchObject({
    status: "refused",
    reason: "changed",
  });
  pane.state.bound = "bound-session";
  // "1" would start "10" in this list, and "x" is no key the menu names.
  expect(await press("1")).toMatchObject({ reason: "unknown_option" });
  expect(await press("x")).toMatchObject({ reason: "unknown_option" });
  expect(await press("", { text: "opus" })).toMatchObject({
    reason: "invalid_text",
  });
  pane.state.screen = fixture("menu-claude-model-scrolled");
  const changed = await press("2");
  expect(changed).toMatchObject({ status: "refused", reason: "changed" });
  // The refusal carries the menu now shown, so Chat can replace its card.
  expect(
    (changed as { menu: { fingerprint: string } }).menu.fingerprint,
  ).not.toBe(shown.fingerprint);
  pane.state.screen = fixture("menu-claude-closed");
  expect(await press("2")).toMatchObject({
    reason: "changed",
    message: "The menu is no longer open. Nothing was sent.",
    menu: null,
  });
  expect(pane.sent).toEqual([]);
});

test("a menu is not answered once Herdr reports the agent working", async () => {
  const pane = harness("menu-codex-model");
  const shown = (await pane.read())!;
  for (const status of ["working", "unknown"]) {
    pane.state.status = status;
    expect(
      await pane.actions.press({
        pane_id: "p1",
        key: "2",
        session_fingerprint: "bound-session",
        menu_fingerprint: shown.fingerprint,
      }),
    ).toMatchObject({ status: "refused", reason: "changed" });
  }
  expect(pane.sent).toEqual([]);
});

test("a change between Chat's checks refuses the key", async () => {
  const pane = harness("menu-codex-model");
  const shown = (await pane.read())!;
  pane.state.onInfo = (count) => {
    if (count === 2) pane.state.session = "replaced";
  };
  expect(
    await pane.actions.press({
      pane_id: "p1",
      key: "2",
      session_fingerprint: "bound-session",
      menu_fingerprint: shown.fingerprint,
    }),
  ).toMatchObject({ status: "refused", reason: "changed" });
  expect(pane.sent).toEqual([]);
});

test("field text is typed as one line, without pressing Enter", async () => {
  const pane = harness("menu-claude-permission-rule");
  const shown = (await pane.read())!;
  const type = (text: string) =>
    pane.actions.press({
      pane_id: "p1",
      key: "",
      text,
      session_fingerprint: "bound-session",
      menu_fingerprint: shown.fingerprint,
    });
  for (const bad of ["", "two\nlines", "x".repeat(501), "esc\u001b[A"])
    expect(await type(bad)).toMatchObject({ reason: "invalid_text" });
  expect(await type("Bash(ls *)")).toMatchObject({
    status: "sent",
    text: "Bash(ls *)",
  });
  expect(pane.sent).toEqual([{ pane_id: "p1", text: "Bash(ls *)", keys: [] }]);
});

test("composer key controls are bound to the session and Herdr's key names", async () => {
  const pane = harness("menu-claude-closed");
  const press = (key: string) =>
    pane.actions.press({
      pane_id: "p1",
      key,
      session_fingerprint: "bound-session",
    });
  for (const key of ["ctrl+c", "up", "esc", "shift+tab", "alt+up", "f5", "y"])
    expect(await press(key)).toMatchObject({ status: "sent", menu: null });
  for (const key of ["", "pageup", "home", "delete", "ctrl+", "hello"])
    expect(await press(key)).toMatchObject({ reason: "unknown_option" });
  pane.state.bound = "another-session";
  expect(await press("ctrl+c")).toMatchObject({ reason: "changed" });
  expect(pane.sent.map((write) => (write.keys as string[])[0])).toEqual([
    "ctrl+c",
    "up",
    "esc",
    "shift+tab",
    "alt+up",
    "f5",
    "y",
  ]);
});

test("one action per pane: a key waits for no answer in flight", async () => {
  const pane = harness("menu-claude-closed");
  let release = () => {};
  pane.state.hold = new Promise<void>((done) => (release = done));
  const first = pane.actions.press({
    pane_id: "p1",
    key: "up",
    session_fingerprint: "bound-session",
  });
  const second = await pane.actions.answer({
    pane_id: "p1",
    key: "1",
    prompt_fingerprint: "x",
  });
  expect(second).toMatchObject({ status: "refused", reason: "busy" });
  release();
  expect(await first).toMatchObject({ status: "sent" });
});

test("the RPC passes press parameters and asks for menus only when told", async () => {
  const calls: unknown[] = [];
  const source = {
    press: async (target: unknown) => {
      calls.push(target);
      return { status: "sent", key: "esc", menu: null };
    },
    latest: async (target: unknown) => {
      calls.push(target);
      return {};
    },
  } as unknown as ConversationSource;
  await conversationRpc(
    "agent_conversation.press",
    {
      pane_id: "p1",
      key: "esc",
      session_fingerprint: "s",
      menu_fingerprint: "m",
      text: 4,
    },
    source,
  );
  await conversationRpc("agent_conversation.latest", { pane_id: "p1" }, source);
  await conversationRpc(
    "agent_conversation.latest",
    { pane_id: "p1", menus: true },
    source,
  );
  expect(calls).toEqual([
    {
      pane_id: "p1",
      key: "esc",
      session_fingerprint: "s",
      menu_fingerprint: "m",
      text: "",
    },
    { pane_id: "p1", menus: false },
    { pane_id: "p1", menus: true },
  ]);
});
