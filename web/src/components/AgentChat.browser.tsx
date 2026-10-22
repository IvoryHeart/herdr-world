import { createRoot } from "react-dom/client";
import { bridge } from "../api";
import type { Pane } from "../types";
import { AgentChat, type Conversation } from "./AgentChat";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/vendor.css";

const failures: string[] = [];
function check(condition: boolean, message: string) {
  if (!condition) failures.push(message);
}
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 80));
}

const conversation = (
  messages: Conversation["messages"],
  status = "idle",
): Conversation => ({
  conversation_version: 1,
  pane_id: "p",
  agent: "claude",
  agent_status: status,
  session_fingerprint: "a".repeat(64),
  status: "ok",
  unavailable: null,
  messages,
  latest:
    [...messages].reverse().find((message) => message.role === "assistant") ??
    null,
});

const message = (
  id: string,
  role: "user" | "assistant",
  text: string,
): Conversation["messages"][number] => ({
  id,
  role,
  kind: "message",
  text,
  sent_at: "2026-10-22T09:00:00Z",
});

async function run() {
  const originalConnection = bridge.connection;
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let reply: Conversation = conversation([
    message("u1", "user", "What does the README say?"),
    {
      id: "t1",
      role: "tool",
      kind: "activity",
      text: "Used Read",
      sent_at: "2026-10-22T09:00:01Z",
      tools: [{ name: "Read", calls: 1 }],
      failed: 0,
    },
    message("a1", "assistant", "It describes the **demo** project."),
  ]);
  let sendResult: unknown = { status: "sent" };
  bridge.connection = () => ({
    connectionId: "test",
    generation: 1,
    serverRuntimeGeneration: null,
    isCurrent: () => true,
    acceptsServerGeneration: () => true,
    call: async (method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params });
      if (method === "agent_conversation.send") return sendResult;
      if (method === "agent_conversation.get") return reply;
      throw new Error(`unexpected ${method}`);
    },
  });
  const container = document.createElement("div");
  container.style.cssText = "display:flex;height:600px;width:800px";
  document.body.append(container);
  const root = createRoot(container);
  const pane = (agent_status: string, state_change_seq?: number): Pane => ({
    pane_id: "p",
    terminal_id: "terminal",
    workspace_id: "Example",
    tab_id: "tab",
    focused: true,
    agent: "claude",
    agent_status,
    state_change_seq,
    revision: 1,
  });
  let terminalOpened = 0;
  const render = (status: string, active = true, sequence?: number) =>
    root.render(
      <AgentChat
        pane={pane(status, sequence)}
        active={active}
        onOpenTerminal={() => terminalOpened++}
        onClose={() => {}}
      />,
    );
  const reads = () =>
    calls.filter((call) => call.method === "agent_conversation.get").length;
  try {
    render("idle", false);
    await settle();
    check(reads() === 0, "A hidden Chat must not read the conversation");

    render("idle");
    await settle();
    check(reads() === 1, "Opening Chat must read the conversation once");
    const bubbles = [...container.querySelectorAll(".agent-chat-message")];
    check(
      bubbles.map((node) => node.getAttribute("data-role")).join() ===
        "user,assistant",
      "Chat must show user and assistant bubbles in order",
    );
    check(
      container.querySelector(".agent-chat-message.is-assistant strong")
        ?.textContent === "demo",
      "Assistant text must render as Markdown",
    );
    check(
      container.querySelector(".agent-chat-activity")?.textContent ===
        "Used Read",
      "Tool activity must render as one summary line",
    );
    check(
      !container.querySelector(".xterm, canvas, pre.terminal"),
      "Chat must never render terminal content",
    );

    // No timers: nothing rereads until Herdr reports a status change.
    await new Promise((resolve) => setTimeout(resolve, 600));
    check(reads() === 1, "Chat must not poll");
    reply = conversation(
      [
        ...reply.messages,
        message("u2", "user", "Thanks"),
        message("a2", "assistant", "You're welcome."),
      ],
      "working",
    );
    render("working");
    await settle();
    check(reads() === 2, "A status change must reread the conversation");
    // A fast turn can end on the status it started from; Herdr's state
    // sequence still moves.
    render("working", true, 7);
    await settle();
    check(
      reads() === 3,
      "A state sequence change must reread the conversation",
    );
    check(
      container.querySelectorAll(".agent-chat-message").length === 4,
      "A reread must show new messages",
    );

    const textarea = container.querySelector("textarea")!;
    const type = (value: string) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    };
    type("Run the tests");
    await settle();
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await settle();
    const sent = calls.find(
      (call) => call.method === "agent_conversation.send",
    );
    check(
      sent?.params.text === "Run the tests" &&
        sent.params.session_fingerprint === "a".repeat(64) &&
        sent.params.pane_id === "p",
      "Enter must send the draft with the session it was written for",
    );
    check(textarea.value === "", "A sent draft must clear");

    sendResult = {
      status: "refused",
      reason: "blocked",
      message: "The agent is waiting on a question; answer it first.",
    };
    type("Another");
    await settle();
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Send"]')!
      .click();
    await settle();
    check(
      container.querySelector(".agent-chat-notice")?.textContent ===
        "The agent is waiting on a question; answer it first.",
      "A refused send must say why",
    );
    check(textarea.value === "Another", "A refused draft must stay");

    reply = {
      ...conversation([]),
      status: "unavailable",
      session_fingerprint: null,
      unavailable: {
        reason: "codex_unlinked",
        detail: "This pane isn't linked to a Codex session.",
        issue: "https://example.com/issues/250",
      },
    } as Conversation;
    render("done");
    await settle();
    check(
      container
        .querySelector(".agent-chat-unavailable")
        ?.textContent?.includes(
          "This pane isn't linked to a Codex session.",
        ) === true,
      "An unavailable conversation must show its reason",
    );
    check(
      !container.querySelector("textarea"),
      "An unavailable conversation must not offer a composer",
    );
    [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Open Terminal"))
      ?.click();
    check(terminalOpened === 1, "Unavailable Chat must link to the Terminal");
  } finally {
    root.unmount();
    container.remove();
    bridge.connection = originalConnection;
  }
}

run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
