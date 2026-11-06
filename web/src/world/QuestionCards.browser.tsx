import { act } from "react";
import { createRoot } from "react-dom/client";
import { bridge } from "../api";
import { AgentChat } from "../components/AgentChat";
import { ChatAfterBlocks } from "../components/chat/blocks/after";
import type { PendingPrompt } from "../components/chat/types";
import type { Pane } from "../types";
import { WorldDeskStore } from "./deskStateStore";
import { NeedsYouList } from "./NeedsYouTab";
import type { WorldAsksStore } from "./worldAsks";
import type { WorldLeafObject, WorldObject } from "./worldObject";
import "../styles/tokens.css";
import "../styles/base.css";
import "./world.css";

// Synthetic Claude questions and a synthetic folder-trust question, shown in
// Chat and in Needs you. Nothing here reaches a runtime: every RPC is local.

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const failures: string[] = [];
const check = (condition: unknown, message: string) => {
  if (!condition) failures.push(message);
};
const parameters = new URLSearchParams(location.search);
const scene = parameters.get("scene");
let historyFailure = false;

const QUESTIONS: NonNullable<PendingPrompt["asked"]> = {
  call_id: "toolu_fixture",
  current: 0,
  questions: [
    {
      question: "Which checks should run before the release?",
      header: "Checks",
      multi_select: true,
      kind: "choice",
      options: [
        { label: "Unit tests", description: "Fast; every package" },
        { label: "Browser suites", description: "Slow; needs Chrome" },
        { label: "Native installers", description: "macOS and Linux" },
      ],
    },
    {
      question: "Which channel should announce it?",
      header: "Channel",
      multi_select: false,
      kind: "choice",
      options: [
        { label: "Release notes", description: "Only the changelog" },
        { label: "Discussion post", description: "A short summary too" },
      ],
    },
  ],
};
const asked: PendingPrompt = {
  question: [QUESTIONS.questions[0]!.question],
  request: [],
  options: [],
  asked: QUESTIONS,
  unanswerable:
    "Chat cannot pick several options safely yet. Answer this question in the Terminal.",
  fingerprint: "asked-fixture",
};
let screen: PendingPrompt = {
  question: ["line 7", "line 8"],
  request: [],
  options: [],
  screen: [
    " Pick a deployment target",
    "",
    ...Array.from(
      { length: 36 },
      (_, index) => `   ${index + 1}) target-${index + 1}.example.com`,
    ),
    "",
    " Press a number, or q to quit",
  ],
  unanswerable:
    "Chat does not recognise this prompt, so it shows it as the terminal does and does not answer it.",
  fingerprint: "screen-fixture",
};
let trustPrompt: PendingPrompt = {
  question: [
    "Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team). If not, take a moment to review what's in this folder first.",
    "Claude Code will be able to read, edit, and execute files here.",
  ],
  request: ["Accessing workspace:", "/work/example"],
  options: [
    { number: "", label: "No, exit", key: "cancel", cursor: true },
    { number: "", label: "Yes, I trust this folder", key: "confirm" },
  ],
  trust: { cursor: "cancel" },
  fingerprint: "trust-fixture",
};

const trustRequests: Record<string, unknown>[] = [];
let trustReply: Record<string, unknown> = {
  status: "refused",
  reason: "changed",
  message:
    "Claude's trust question changed, or Claude has started. Nothing was sent; check it and try again.",
  prompt: null,
};
const latest = (paneId: string) => {
  const trust = paneId.endsWith("trust");
  return {
    conversation_version: 1,
    pane_id: paneId,
    agent: "claude",
    agent_status: "blocked",
    session_binding: trust ? null : "reported",
    session_fingerprint: trust ? null : "a".repeat(64),
    session_label: trust ? null : "Synthetic session",
    status: trust ? "unavailable" : "ok",
    unavailable: trust
      ? {
          reason: "no_session",
          detail:
            "Claude is waiting for you in Terminal and has not reported a conversation yet.",
        }
      : null,
    latest: null,
    messages: [],
    pending_prompt: trust ? trustPrompt : asked,
    deliveries: [],
  };
};
const client = {
  connectionId: "local",
  generation: 1,
  serverRuntimeGeneration: 7,
  isCurrent: () => true,
  acceptsServerGeneration: () => true,
  call: async (method: string, params: Record<string, unknown> = {}) => {
    const paneId = String(params.pane_id ?? "");
    if (method === "agent_conversation.latest") return latest(paneId);
    if (method === "agent_conversation.trust") {
      trustRequests.push(params);
      return trustReply;
    }
    if (method === "agent_history.get") {
      if (historyFailure) throw new Error("synthetic history failure");
      return {
        history_version: 2,
        mode: "snapshot",
        cursor: { epoch: "fixture", revision: 1 },
        window_limit: 200,
        agent: "claude",
        pane_id: paneId,
        workspace_id: "Example",
        tab_id: "tab",
        updated_at: "2026-11-05T00:00:00Z",
        path: "",
        entries: [],
      };
    }
    if (method === "agent_conversation.steps") return { steps: [] };
    if (
      method === "agent_conversation.watch" ||
      method === "agent_conversation.unwatch"
    )
      return { ok: true };
    return null;
  },
};
Object.assign(bridge, {
  call: async () => null,
  connection: () => client,
  onControl: () => () => {},
  onStatus: () => () => {},
});

const leaf = (id: string) =>
  ({
    id,
    kind: "agent",
    nativeId: `w1:${id}`,
    connectionId: "local",
    // The client's runtime generation: Needs you reads only that runtime.
    generation: 7,
    label: `${id}-claude`,
    agentName: id,
    hostLabel: "Example host",
    spaceLabel: "example",
    tabLabel: `${id} tab`,
    status: "blocked",
    stale: false,
    actionable: true,
    lastActivityAt: 1,
    terminalId: `terminal-${id}`,
    pane: { pane_id: `w1:${id}` },
    stateLabels: {},
  }) as unknown as WorldLeafObject;
const leaves = [leaf("rigel"), leaf("rigel-trust")];
const world = {
  leaves,
  nodeById: new Map(leaves.map((item) => [item.id, item])),
} as unknown as Pick<WorldObject, "leaves" | "nodeById">;
// A stable snapshot: the store is read with useSyncExternalStore.
const noAsks: never[] = [];
const asksStore = {
  get: () => noAsks,
  subscribe: () => () => {},
  start: () => {},
  stop: () => {},
  answer: async () => null,
  dismiss: async () => null,
} as unknown as WorldAsksStore;
const deskStore = new WorldDeskStore({
  call: async () => null,
  onControl: () => () => {},
  onStatus: () => () => {},
});
const pane = (id: string): Pane => ({
  pane_id: id,
  terminal_id: "terminal",
  workspace_id: "Example",
  tab_id: "tab",
  focused: true,
  agent: "claude",
  agent_status: "blocked",
  revision: 1,
});

document.body.style.cssText =
  "margin:0;background:var(--bg);color:var(--text);font:14px system-ui";
const host = document.body.appendChild(document.createElement("main"));
host.style.cssText =
  "display:grid;gap:12px;padding:12px;box-sizing:border-box;max-width:760px;margin:0 auto";
const root = createRoot(host);
const opened: string[] = [];
const answers: string[] = [];
const trusts: string[] = [];
const frame = () =>
  new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
const view = (which: string | null) =>
  which === "chat-trust" ? (
    <div style={{ height: "calc(100vh - 24px)", display: "flex" }}>
      <AgentChat
        pane={pane("w1:rigel-trust")}
        active
        onClose={() => {}}
        onOpenTerminal={() => {}}
      />
    </div>
  ) : which === "chat-asked" ? (
    <div style={{ height: "calc(100vh - 24px)", display: "flex" }}>
      <AgentChat
        pane={pane("w1:rigel")}
        active
        onClose={() => {}}
        onOpenTerminal={() => {}}
      />
    </div>
  ) : which === "needs-you" ? (
    <aside className="needs-you-tab" style={{ position: "static" }}>
      <NeedsYouList
        world={world}
        request={{ sequence: 0 }}
        now={60_000}
        onChat={() => {}}
        onOpenTerminal={() => {}}
        asksStore={asksStore}
        deskStore={deskStore}
      />
    </aside>
  ) : (
    <>
      {[asked, screen, trustPrompt].map((prompt) => (
        <div key={prompt.fingerprint} data-fixture={prompt.fingerprint}>
          <ChatAfterBlocks
            running={null}
            clock={0}
            answered={null}
            prompt={prompt}
            agent="Claude"
            answering={false}
            notice=""
            onAnswer={(key) => answers.push(key)}
            onOpenTerminal={() => opened.push(prompt.fingerprint)}
            onTrust={(choice) => trusts.push(choice)}
          />
        </div>
      ))}
    </>
  );

const buttonIn = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes(text),
  );
const textOf = (selector: string) =>
  document.querySelector(selector)?.textContent ?? "";

let stage = "start";
async function run() {
  if (scene) {
    // A capture scene: render and stay, for screenshots. Ready once its card
    // is drawn with fonts loaded; layout shifts and long tasks are recorded.
    const shifts: number[] = [];
    const long: number[] = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        if (entry.entryType === "layout-shift")
          shifts.push((entry as unknown as { value: number }).value);
        else long.push(entry.duration);
    }).observe({ entryTypes: ["layout-shift", "longtask"] });
    await act(async () => root.render(view(scene)));
    const until = performance.now() + 5000;
    const cards = scene === "needs-you" ? 2 : 1;
    while (
      document.querySelectorAll(".agent-chat-ask").length < cards &&
      performance.now() < until
    )
      await act(async () => frame());
    await document.fonts.ready;
    await frame();
    document.body.dataset.shifts = String(
      shifts.reduce((sum, value) => sum + value, 0),
    );
    document.body.dataset.longTasks = JSON.stringify(long);
    document.body.dataset.ready = String(
      document.querySelectorAll(".agent-chat-ask").length >= cards,
    );
    return;
  }
  check(
    window.innerWidth === Number(parameters.get("width")),
    "the page viewport equals the requested test width",
  );
  stage = "cards";
  await act(async () => root.render(view(null)));
  const askCard = document.querySelector('[data-fixture="asked-fixture"]')!;
  const card = askCard.textContent ?? "";
  for (const item of QUESTIONS.questions) {
    check(card.includes(item.question), `shows question: ${item.question}`);
    check(card.includes(item.header!), `shows header: ${item.header}`);
    for (const option of item.options)
      check(
        card.includes(option.label) && card.includes(option.description!),
        `shows option and description: ${option.label}`,
      );
  }
  check(
    askCard.querySelector('[aria-label="Pick any"]') &&
      askCard.querySelector('[aria-label="Pick one"]'),
    "multi-select and single-select are told apart",
  );
  check(card.includes("☐"), "multi-select options show checkboxes");
  check(
    askCard
      .querySelector('li[aria-current="step"]')
      ?.textContent?.includes("Which checks"),
    "the question on screen is marked",
  );
  const fields = askCard.querySelectorAll<HTMLInputElement>(
    ".agent-chat-asked-more input",
  );
  check(
    fields.length === 2 && [...fields].every((field) => field.disabled),
    "each question shows its disabled free-text field",
  );
  check(
    askCard.querySelectorAll(".agent-chat-asked-more button").length === 1 &&
      buttonIn(askCard, "Chat about this")?.disabled,
    "Chat about this shows, disabled, only for the single-select question",
  );
  check(
    card.includes("cannot pick several options"),
    "the reason is shown with the card",
  );
  check(
    !askCard.querySelector(".agent-chat-ask-options"),
    "no answer buttons without a verified screen",
  );
  await act(async () =>
    askCard
      .querySelector<HTMLElement>(".agent-chat-ask")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true })),
  );
  check(answers.length === 0, "digits answer nothing without keys");
  await act(async () => buttonIn(askCard, "Answer in the Terminal")!.click());
  check(opened.includes("asked-fixture"), "Answer in the Terminal opens it");

  const pre = document.querySelector<HTMLElement>(
    '[data-fixture="screen-fixture"] .agent-chat-ask-screen',
  );
  check(
    pre?.textContent?.split("\n").length === screen.screen!.length &&
      pre.textContent.includes("target-1.example.com") &&
      pre.textContent.includes("q to quit"),
    "an unknown prompt shows its whole block",
  );
  const atBottom = () =>
    pre &&
    pre.scrollHeight > pre.clientHeight &&
    Math.abs(pre.scrollHeight - pre.clientHeight - pre.scrollTop) <= 1;
  check(
    screen.screen!.length === 40 && atBottom(),
    "the last row of a 40-row prompt is visible on mount",
  );
  check(
    pre &&
      getComputedStyle(pre).whiteSpace === "pre" &&
      getComputedStyle(pre).overflowWrap === "normal",
    "terminal whitespace rules apply",
  );
  // An in-place card update follows the new last row too.
  if (pre) pre.scrollTop = 0;
  const original = screen;
  screen = {
    ...screen,
    screen: [...screen.screen!.slice(1), " updated final prompt row"],
  };
  await act(async () => root.render(view(null)));
  const updatedPre = document.querySelector<HTMLElement>(
    ".agent-chat-ask-screen",
  );
  check(
    updatedPre === pre &&
      updatedPre &&
      Math.abs(
        updatedPre.scrollHeight -
          updatedPre.clientHeight -
          updatedPre.scrollTop,
      ) <= 1,
    "the last row stays visible after update in the same block",
  );
  screen = original;
  await act(async () => root.render(view(null)));
  check(
    textOf('[data-fixture="screen-fixture"]').includes("does not recognise"),
    "an unknown prompt says why",
  );

  const trustCard = document.querySelector<HTMLElement>(
    '[data-fixture="trust-fixture"] .agent-chat-trust',
  )!;
  const choices = [
    ...trustCard.querySelectorAll<HTMLButtonElement>(
      ".agent-chat-ask-options button",
    ),
  ];
  check(
    choices.map((button) => button.textContent).join("|") ===
      "No, exitSelected in the Terminal|Yes, I trust this folder",
    "trust choices keep Claude's order and mark its cursor",
  );
  check(
    !trustCard.querySelector(".is-primary") &&
      !trustCard.contains(document.activeElement),
    "no trust choice is preselected or focused",
  );
  check(
    trustCard.textContent?.includes("/work/example"),
    "the folder is shown",
  );
  await act(async () => choices[1]!.click());
  check(
    trusts.join() === "confirm" && answers.length === 0,
    "a click is the trust choice, not an answer key",
  );

  // Full Chat for a pane with no session: the trust card and its RPC.
  historyFailure = true;
  await act(async () =>
    root.render(
      <AgentChat
        pane={pane("w1:history-failure")}
        active
        onClose={() => {}}
        onOpenTerminal={() => {}}
      />,
    ),
  );
  const errorDeadline = performance.now() + 5000;
  while (
    (!document.querySelector(".agent-chat .agent-chat-ask") ||
      !textOf(".agent-chat-error").includes("Messages could not")) &&
    performance.now() < errorDeadline
  )
    await act(async () => frame());
  check(
    textOf(".agent-chat-error").includes(
      "Messages could not be read. Use Refresh to try again.",
    ) && document.querySelector(".agent-chat .agent-chat-ask"),
    "a history error stays visible beside a question card",
  );
  const errorNote = document.querySelector<HTMLElement>(".agent-chat-error")!;
  const errorCard = document.querySelector<HTMLElement>(
    ".agent-chat .agent-chat-ask",
  )!;
  check(
    errorNote &&
      errorCard &&
      errorNote.getBoundingClientRect().bottom <=
        errorCard.getBoundingClientRect().top,
    "the history error flows above the card without overlap",
  );
  historyFailure = false;
  stage = "chat-trust";
  await act(async () => root.render(view("chat-trust")));
  await frame();
  const chatTrust = () =>
    document.querySelector<HTMLElement>(".agent-chat .agent-chat-trust");
  check(chatTrust(), "Chat shows the trust card before a session");
  check(
    !document.querySelector(".agent-chat-empty"),
    "the card replaces the empty-conversation text",
  );
  await act(async () => buttonIn(chatTrust()!, "Yes, I trust")!.click());
  await frame();
  check(
    trustRequests.length === 1 &&
      trustRequests[0]!.pane_id === "w1:rigel-trust" &&
      trustRequests[0]!.choice === "confirm" &&
      trustRequests[0]!.prompt_fingerprint === "trust-fixture",
    "Chat sends the choice with the shown question's fingerprint",
  );
  check(
    chatTrust()?.textContent?.includes("Nothing was sent"),
    "a refusal is shown on the card",
  );
  trustReply = {
    status: "sent",
    choice: "cancel",
    label: "No, exit",
    acknowledged: true,
  };
  trustPrompt = { ...trustPrompt, fingerprint: "trust-fixture-2" };
  await act(async () => root.render(view(null)));
  await act(async () => root.render(view("chat-trust")));
  await frame();
  await act(async () => buttonIn(chatTrust()!, "No, exit")!.click());
  await frame();
  check(
    trustRequests[trustRequests.length - 1]?.choice === "cancel" &&
      !chatTrust()?.querySelector(".agent-chat-ask-notice"),
    "an acknowledged choice leaves no notice",
  );

  // Needs you shows the same question text and the same trust card.
  stage = "needs-you";
  await act(async () => root.render(view("needs-you")));
  // Each item reads its conversation; wait for both cards, bounded.
  const until = performance.now() + 5000;
  while (
    document.querySelectorAll(".needs-you-tab .agent-chat-ask").length < 2 &&
    performance.now() < until
  )
    await act(async () => frame());
  const needs = document.querySelector(".needs-you-tab")?.textContent ?? "";
  check(
    needs.includes("Which checks should run before the release?") &&
      needs.includes("Browser suites"),
    "Needs you shows Claude's recorded question and options",
  );
  check(
    document.querySelector(".needs-you-tab .agent-chat-trust"),
    "Needs you shows the trust card",
  );
  check(
    document.documentElement.scrollWidth <= window.innerWidth,
    "the cards fit the viewport",
  );
}

run()
  .catch((error) => failures.push(`${stage}: ${String(error)}`))
  .finally(() => {
    if (!scene)
      void fetch("/result", {
        method: "POST",
        body: JSON.stringify(failures),
      });
  });
