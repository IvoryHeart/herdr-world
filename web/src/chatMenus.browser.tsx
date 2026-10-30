import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/vendor.css";
import { AgentChat } from "./components/AgentChat";
import type { PendingPrompt } from "./components/chat/types";
import { bridge } from "./api";
import type { Pane } from "./types";

// A command menu (`/model`), its keys, its field and the composer's key
// controls, through the whole Chat callback/RPC chain.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.body.appendChild(document.createElement("main"));
container.style.cssText = "display:flex;height:820px;width:100%";
const root = createRoot(container);
const failures: string[] = [];
const check = (condition: unknown, message: string) => {
  if (!condition) failures.push(message);
};
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

const modelMenu: PendingPrompt = {
  question: ["Select model"],
  request: ["Switch between Claude models.", "… +3 models"],
  fingerprint: "model-menu",
  options: [
    { number: "1", label: "Default (recommended)", key: "" },
    { number: "2", label: "Opus 5.5 ✔", key: "2", cursor: true },
    { number: "3", label: "Fable 5.1", key: "3" },
  ],
  menu: {
    footer:
      "Enter to set as default · s to use this session only · Esc to cancel",
    after: [],
    controls: [
      { key: "enter", label: "Enter", action: "set as default" },
      { key: "s", label: "s", action: "use this session only" },
      { key: "esc", label: "Esc", action: "cancel" },
      { key: "up", label: "↑", action: "move" },
      { key: "down", label: "↓", action: "move" },
    ],
  },
};
const ruleMenu: PendingPrompt = {
  question: ["Add allow permission rule"],
  request: ["Permission rules are a tool name."],
  fingerprint: "rule-menu",
  options: [],
  menu: {
    footer: "Enter to submit · Esc to cancel",
    after: [],
    controls: [
      { key: "enter", label: "Enter", action: "submit" },
      { key: "esc", label: "Esc", action: "cancel" },
    ],
    field: "Enter permission rule…",
  },
};

const requests: { method: string; params: Record<string, unknown> }[] = [];
let menu: PendingPrompt | null = null;
let session = "a".repeat(64);
let pressReply: (params: Record<string, unknown>) => unknown = () => ({
  status: "sent",
  key: "",
  menu: null,
});
const client = {
  connectionId: "menu-host",
  generation: 1,
  serverRuntimeGeneration: 7,
  isCurrent: () => true,
  acceptsServerGeneration: () => true,
  call: async (method: string, params: Record<string, unknown> = {}) => {
    requests.push({ method, params });
    if (method === "agent_conversation.latest")
      return {
        conversation_version: 1,
        pane_id: "p",
        agent: "claude",
        agent_status: "idle",
        session_binding: "reported",
        session_fingerprint: session,
        session_label: "Synthetic session",
        status: "ok",
        unavailable: null,
        latest: null,
        pending_prompt: menu,
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
    if (method === "agent_conversation.press") return pressReply(params);
    if (method === "agent_conversation.send") {
      // The command opens its menu a moment after it lands.
      setTimeout(() => (menu = modelMenu), 300);
      return { status: "sent" };
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
bridge.connection = () => client as never;
bridge.onControl = () => () => {};
const pane: Pane = {
  pane_id: "p",
  terminal_id: "terminal",
  workspace_id: "Example",
  tab_id: "tab",
  focused: true,
  agent: "claude",
  agent_status: "idle",
  revision: 1,
};
const chat = (key = "chat") =>
  act(async () =>
    root.render(h(AgentChat, { key, pane, active: true, onClose() {} })),
  );
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  );
const presses = () =>
  requests
    .filter((request) => request.method === "agent_conversation.press")
    .map((request) => request.params);
const last = () => presses()[presses().length - 1];
const setValue = (
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) => {
  Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(element),
    "value",
  )!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
};
const settle = () => act(async () => sleep(50));

try {
  await chat();
  await settle();
  check(
    requests.find((request) => request.method === "agent_conversation.latest")
      ?.params.menus === true,
    "Chat asks for command menus",
  );
  check(!document.querySelector(".agent-chat-menu"), "No menu, no card");

  // A slash command: Chat rereads until the menu it opened shows.
  const textarea = document.querySelector("textarea")!;
  await act(async () => setValue(textarea, "/model"));
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Send"]')!
      .click(),
  );
  await act(async () => sleep(1000));
  const card = document.querySelector<HTMLElement>(".agent-chat-menu");
  check(card, "The menu opened by /model appears without a manual refresh");
  check(
    card?.querySelector("h3")?.textContent === "Select model",
    "The card shows the menu's title",
  );
  check(
    card?.querySelector("[aria-current]")?.textContent?.includes("Opus 5.5"),
    "The harness's cursor is marked",
  );
  check(
    button("Default (recommended)")?.disabled,
    "An option no digit can pick is reached with the arrows only",
  );

  // A draft typed while the menu is open survives its steps.
  await act(async () => setValue(textarea, "keep this draft"));
  pressReply = (params) => {
    menu = null;
    return { status: "sent", key: params.key, menu: null };
  };
  await act(async () => button("Fable 5.1")!.click());
  await settle();
  check(
    JSON.stringify(presses()[0]) ===
      JSON.stringify({
        pane_id: "p",
        key: "3",
        session_fingerprint: session,
        menu_fingerprint: "model-menu",
      }),
    "An option presses its digit for this session and this menu",
  );
  check(!document.querySelector(".agent-chat-menu"), "A closed menu retires");
  check(
    document.querySelector("textarea")!.value === "keep this draft",
    "The composer draft survives the menu",
  );

  // Keys on the focused card, and a refusal that names the change.
  menu = modelMenu;
  await chat("chat-2");
  await settle();
  pressReply = () => ({
    status: "refused",
    reason: "changed",
    message: "The menu changed. Nothing was sent; check it and try again.",
    menu: modelMenu,
  });
  const focused = document.querySelector<HTMLElement>(".agent-chat-menu")!;
  await act(async () => {
    focused.focus();
    focused.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
  });
  await settle();
  check(
    last()?.key === "down",
    "Arrow keys on the focused card press the menu's arrows",
  );
  check(
    document.body.textContent?.includes("The menu changed. Nothing was sent"),
    "A refused key says nothing was sent",
  );
  await act(async () =>
    focused.dispatchEvent(
      new KeyboardEvent("keydown", { key: "x", bubbles: true }),
    ),
  );
  check(last()?.key === "down", "Keys the menu does not name stay");
  check(
    document.documentElement.scrollWidth <= window.innerWidth,
    "The menu card fits the viewport",
  );

  // Keyboard navigation across steps: each sent key redraws the menu with a
  // new fingerprint, and focus stays on the card for the next key.
  let step = 0;
  pressReply = (params) => {
    step += 1;
    menu = {
      ...modelMenu,
      fingerprint: `model-menu-${step}`,
      options: modelMenu.options.map((option, index) => ({
        ...option,
        cursor: index === Math.min(step, 2) || undefined,
      })),
    };
    return { status: "sent", key: params.key, menu };
  };
  const before = presses().length;
  for (const key of ["ArrowDown", "ArrowDown", "Enter"]) {
    const card =
      document.activeElement?.closest<HTMLElement>(".agent-chat-menu");
    check(card, `Focus is on the menu card before ${key}`);
    await act(async () =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      ),
    );
    await settle();
  }
  check(
    JSON.stringify(
      presses()
        .slice(before)
        .map((press) => press.key),
    ) === JSON.stringify(["down", "down", "enter"]) &&
      presses()
        .slice(before)
        .every((press, index) =>
          index === 0
            ? press.menu_fingerprint === "model-menu"
            : press.menu_fingerprint === `model-menu-${index}`,
        ),
    "Successive keys reach successive menus from the keyboard",
  );
  // A clicked control is disabled while its key is sent; focus returns to
  // the card afterwards.
  const moveDown = button("move");
  moveDown?.focus();
  await act(async () => moveDown!.click());
  await settle();
  check(
    document.activeElement?.classList.contains("agent-chat-menu"),
    "After a clicked key, keyboard focus is back on the card",
  );
  // Focus moved to the composer while a key is pending stays there, so the
  // next key typed reaches the composer, not the menu.
  let release = () => {};
  pressReply = (params) =>
    new Promise((resolve) => {
      release = () => {
        step += 1;
        menu = { ...modelMenu, fingerprint: `model-menu-${step}` };
        resolve({ status: "sent", key: params.key, menu });
      };
    });
  const pending = presses().length;
  button("move")!.focus();
  await act(async () => button("move")!.click());
  const composer = document.querySelector("textarea")!;
  await act(async () => composer.focus());
  await act(async () => release());
  await settle();
  check(
    document.activeElement === composer,
    "Focus moved to the composer while a key was pending stays there",
  );
  await act(async () =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "1", bubbles: true }),
    ),
  );
  await settle();
  check(
    presses().length === pending + 1,
    "A key typed in the composer afterwards presses nothing in the menu",
  );

  // A new session retires the card's notice; its keys go to that session.
  session = "b".repeat(64);
  await chat("chat-2");
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Refresh conversation"]',
      )!
      .click(),
  );
  await settle();
  check(
    !document.body.textContent?.includes("The menu changed. Nothing was sent"),
    "A session change retires the last menu notice",
  );
  pressReply = (params) => ({ status: "sent", key: params.key, menu: null });
  await act(async () => button("cancel")!.click());
  await settle();
  check(
    last()?.session_fingerprint === session && last()?.key === "esc",
    "After the switch, keys carry the new session",
  );

  // A text field: one line typed without Enter, then its own Enter.
  menu = ruleMenu;
  await chat("chat-3");
  await settle();
  const field = document.querySelector<HTMLInputElement>(
    ".agent-chat-menu .agent-chat-ask-text input",
  )!;
  check(
    document.querySelector(".agent-chat-menu q")?.textContent ===
      "Enter permission rule…",
    "The card shows what the field shows",
  );
  await act(async () => setValue(field, "Bash(ls *)"));
  await act(async () =>
    document
      .querySelector<HTMLFormElement>(".agent-chat-menu .agent-chat-ask-text")!
      .requestSubmit(),
  );
  await settle();
  check(
    last()?.text === "Bash(ls *)" &&
      last()?.key === "" &&
      last()?.menu_fingerprint === "rule-menu",
    "Field text goes to that menu's field alone",
  );

  // The composer's key controls, behind its vertical ellipsis.
  menu = null;
  await chat("chat-4");
  await settle();
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>(
        'button[aria-label="More composer controls"]',
      )!
      .click(),
  );
  await settle();
  const ctrlC = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Press Ctrl+C"]',
  );
  check(ctrlC && !ctrlC.disabled, "The composer offers the Terminal's Ctrl+C");
  check(
    document.querySelector<HTMLButtonElement>(
      'button[aria-label^="Press Page Up"]',
    )?.disabled,
    "Paging, which Herdr cannot press, is shown disabled",
  );
  // A composer key's redraw can land after the service replied: Chat
  // rereads shortly after, so the menu it opened still appears.
  pressReply = (params) => {
    setTimeout(() => (menu = modelMenu), 100);
    return { status: "sent", key: params.key, menu: null };
  };
  await act(async () => ctrlC!.click());
  await settle();
  check(
    !document.querySelector(".agent-chat-menu"),
    "The redraw has not landed yet",
  );
  await act(async () => sleep(500));
  check(
    document.querySelector(".agent-chat-menu"),
    "A redraw after a composer key appears without a manual refresh",
  );
  check(
    JSON.stringify(last()) ===
      JSON.stringify({
        pane_id: "p",
        key: "ctrl+c",
        session_fingerprint: session,
      }),
    "A composer key goes to the session with no menu fingerprint",
  );
  check(
    document.querySelector('[aria-label="Keys"]'),
    "The key controls stay open for the next key",
  );
  const popover = document.querySelector(".chat-composer-tools-popover");
  check(
    popover && popover.getBoundingClientRect().right <= window.innerWidth,
    "The key controls fit the viewport",
  );
} catch (error) {
  failures.push(String(error));
}
await fetch("/result", { method: "POST", body: JSON.stringify({ failures }) });
