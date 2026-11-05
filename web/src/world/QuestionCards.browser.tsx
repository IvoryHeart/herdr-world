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

// Synthetic Claude questions and an unknown prompt, shown in Chat and in
// Needs you. Nothing here reaches a runtime: every RPC is local.

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const failures: string[] = [];
const check = (condition: unknown, message: string) => {
  if (!condition) failures.push(message);
};
const scene = new URLSearchParams(location.search).get("scene");

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
const screen: PendingPrompt = {
  question: ["line 7", "line 8"],
  request: [],
  options: [],
  screen: [
    " Pick a deployment target",
    "",
    ...Array.from(
      { length: 9 },
      (_, index) => `   ${index + 1}) target-${index + 1}.example.com`,
    ),
    "",
    " Press a number, or q to quit",
  ],
  unanswerable:
    "Chat does not recognise this prompt, so it shows it as the terminal does and does not answer it.",
  fingerprint: "screen-fixture",
};
const latest = (paneId: string) => ({
  conversation_version: 1,
  pane_id: paneId,
  agent: "claude",
  agent_status: "blocked",
  session_binding: "reported",
  session_fingerprint: "a".repeat(64),
  session_label: "Synthetic session",
  status: "ok",
  unavailable: null,
  latest: null,
  messages: [],
  pending_prompt: asked,
  deliveries: [],
});
const client = {
  connectionId: "local",
  generation: 1,
  serverRuntimeGeneration: 7,
  isCurrent: () => true,
  acceptsServerGeneration: () => true,
  call: async (method: string, params: Record<string, unknown> = {}) => {
    const paneId = String(params.pane_id ?? "");
    if (method === "agent_conversation.latest") return latest(paneId);
    if (method === "agent_history.get")
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
const leaves = [leaf("rigel")];
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
const frame = () =>
  new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
const view = (which: string | null) =>
  which === "chat-asked" ? (
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
      {[asked, screen].map((prompt) => (
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
    const cards = 1;
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
  check(
    textOf('[data-fixture="screen-fixture"]').includes("does not recognise"),
    "an unknown prompt says why",
  );

  // Full Chat with no messages yet: the card stands in for the empty text.
  stage = "chat-asked";
  await act(async () => root.render(view("chat-asked")));
  const shown = performance.now() + 5000;
  while (
    !document.querySelector(".agent-chat .agent-chat-ask") &&
    performance.now() < shown
  )
    await act(async () => frame());
  check(
    document.querySelector(".agent-chat .agent-chat-asked"),
    "Chat shows Claude's recorded questions",
  );
  check(
    !document.querySelector(".agent-chat-empty"),
    "the card replaces the empty-conversation text",
  );

  // Needs you shows the same question text.
  stage = "needs-you";
  await act(async () => root.render(view("needs-you")));
  // The item reads its conversation; wait for its card, bounded.
  const until = performance.now() + 5000;
  while (
    !document.querySelector(".needs-you-tab .agent-chat-ask") &&
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
