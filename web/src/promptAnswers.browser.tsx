import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { ChatAfterBlocks } from "./components/chat/blocks/after";
import type { PendingPrompt } from "./components/chat/types";
import { AgentChat } from "./components/AgentChat";
import { bridge } from "./api";
import type { Pane } from "./types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
document.body.style.cssText =
  "margin:0;padding:12px;background:#12151c;color:#eff1f7;font:14px system-ui;--text:#eff1f7;--bg:#12151c;--input-bg:#1d2330;--border-soft:#596376;--muted:#a7b0c0;--accent:#78b6ff;--warning-text:#f5c673;--warning-soft:#242219;box-sizing:border-box";
const root = createRoot(
  document.body.appendChild(document.createElement("main")),
);
const calls: { key: string; text?: string }[] = [];
const failures: string[] = [];
const check = (condition: unknown, message: string) => {
  if (!condition) failures.push(message);
};
let prompt: PendingPrompt = {
  question: ["Which color should the badge use?"],
  request: [],
  fingerprint: "question-one",
  steps: [
    { label: "Color", answered: false },
    { label: "Size", answered: false },
  ],
  options: [
    { number: "1", label: "Red", key: "1" },
    { number: "2", label: "Blue", key: "2" },
    { number: "3", label: "Type something.", key: "3", input: "text" },
    { number: "4", label: "Chat about this", key: "4", input: "chat" },
  ],
};
let answering = false;
let answered: Parameters<typeof ChatAfterBlocks>[0]["answered"] = null;
const render = () =>
  act(async () =>
    root.render(
      h(ChatAfterBlocks, {
        running: null,
        clock: 0,
        answered,
        prompt,
        agent: "Claude Code",
        answering,
        notice: "",
        onAnswer: (key: string, text?: string) =>
          calls.push({ key, ...(text !== undefined ? { text } : {}) }),
      }),
    ),
  );
const click = async (text: string) =>
  act(async () =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.includes(text))!
      .click(),
  );
const type = async (text: string) =>
  act(async () => {
    const input = document.querySelector<HTMLInputElement>(
      ".agent-chat-ask-text input",
    )!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
try {
  await render();
  await click("Type something.");
  check(
    document.querySelector("input") === document.activeElement,
    "Selecting a text option focuses its input",
  );
  check(calls.length === 0, "Opening a text option does not send its digit");
  await type("Badge 2 + 3");
  await act(async () =>
    document
      .querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "2", bubbles: true })),
  );
  check(
    calls.length === 0,
    "Typing digits in the input does not answer another option",
  );
  check(
    document.querySelector("input")!.value === "Badge 2 + 3",
    "Typing retains the whole draft",
  );
  await act(async () => document.querySelector("form")!.requestSubmit());
  check(
    JSON.stringify(calls[0]) ===
      JSON.stringify({ key: "3", text: "Badge 2 + 3" }),
    "Submitting carries the selected key and exact text",
  );
  answered = {
    number: "3",
    label: "Type something.",
    text: "Badge 2 + 3",
    acknowledged: false,
    unconfirmed_reason: "still_showing",
    question: prompt.question,
  };
  await render();
  check(
    document.querySelector(".agent-chat-answered q")?.textContent ===
      "Badge 2 + 3",
    "The receipt shows the literal text that was sent",
  );
  answered = null;
  await render();
  answering = true;
  await render();
  check(
    document.querySelector("input")!.disabled,
    "The pending answer disables editing",
  );
  check(
    [...document.querySelectorAll("button")].every((button) => button.disabled),
    "The pending answer disables other choices",
  );
  answering = false;
  await render();
  await click("Chat about this");
  await type("Discuss a violet badge.");
  await act(async () => document.querySelector("form")!.requestSubmit());
  check(
    calls[1]?.key === "4" && calls[1]?.text === "Discuss a violet badge.",
    "Discussion text uses its own selected option",
  );
  prompt = {
    ...prompt,
    question: ["How large should the badge be?"],
    fingerprint: "question-two",
  };
  await render();
  check(
    document.querySelector("input") === null,
    "A replacement question discards the old option and draft",
  );
  await click("Red");
  check(
    calls[2]?.key === "1" && calls[2]?.text === undefined,
    "Ordinary choices remain digit-only",
  );
  await click("Type something.");
  await type("Violet fixture badge");
  check(
    document.documentElement.scrollWidth <= window.innerWidth,
    "Text controls fit the viewport",
  );

  // Exercise the complete Chat callback/RPC chain, beyond the isolated card.
  const requests: Record<string, unknown>[] = [];
  let connectionId = "answer-host";
  const client = {
    get connectionId() {
      return connectionId;
    },
    generation: 1,
    serverRuntimeGeneration: 7,
    isCurrent: () => true,
    acceptsServerGeneration: () => true,
    call: async (method: string, params: Record<string, unknown> = {}) => {
      if (method === "agent_conversation.latest")
        return {
          conversation_version: 1,
          pane_id: "p",
          agent: "claude",
          agent_status: "blocked",
          session_binding: "reported",
          session_fingerprint: "a".repeat(64),
          session_label: "Synthetic session",
          status: "ok",
          unavailable: null,
          latest: null,
          pending_prompt: prompt,
          deliveries: [],
        };
      if (method === "agent_history.get")
        return {
          history_version: 2,
          mode: "snapshot",
          cursor: { epoch: "fixture", revision: 1 },
          window_limit: 200,
          agent: "claude",
          pane_id: "p",
          workspace_id: "Example",
          tab_id: "tab",
          updated_at: "2026-10-29T00:00:00Z",
          path: "",
          entries: [],
        };
      if (method === "agent_conversation.answer") {
        requests.push(params);
        return {
          status: "sent",
          number: "3",
          label: "Type something.",
          text: params.text,
          acknowledged: false,
          unconfirmed_reason: "still_showing",
          prompt_fingerprint: params.prompt_fingerprint,
        };
      }
      if (method === "agent_conversation.steps") return { steps: [] };
      if (
        method === "agent_conversation.watch" ||
        method === "agent_conversation.unwatch"
      )
        return { ok: true };
      throw new Error(`Unexpected Chat fixture method ${method}`);
    },
  };
  bridge.connection = () => client;
  bridge.onControl = () => () => {};
  const pane: Pane = {
    pane_id: "p",
    terminal_id: "terminal",
    workspace_id: "Example",
    tab_id: "tab",
    focused: true,
    agent: "claude",
    agent_status: "blocked",
    revision: 1,
  };
  const fullChat = () =>
    act(async () =>
      root.render(h(AgentChat, { pane, active: true, onClose() {} })),
    );
  await fullChat();
  await click("Type something.");
  await type("Draft for the first host");
  connectionId = "replacement-host";
  await fullChat();
  check(
    document.querySelector(".agent-chat-ask-text input") === null,
    "Changing host scope retires the text draft even with an identical prompt fingerprint",
  );
  await click("Type something.");
  const input = document.querySelector<HTMLInputElement>(
    ".agent-chat-ask-text input",
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "Exact Chat reply 2");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    document
      .querySelector<HTMLFormElement>(".agent-chat-ask-text")!
      .requestSubmit(),
  );
  check(
    requests.length === 1 &&
      requests[0]!.key === "3" &&
      requests[0]!.text === "Exact Chat reply 2" &&
      requests[0]!.prompt_fingerprint === prompt.fingerprint,
    "Full Chat forwards text through every callback to its qualified answer RPC",
  );
  check(
    document.querySelector(".agent-chat-answered q")?.textContent ===
      "Exact Chat reply 2",
    "Full Chat displays the literal text from its answer receipt",
  );
} catch (error) {
  failures.push(String(error));
}
await fetch("/result", { method: "POST", body: JSON.stringify({ failures }) });
