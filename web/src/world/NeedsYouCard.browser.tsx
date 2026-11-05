import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { bridge } from "../api";
import { WorldDeskStore } from "./deskStateStore";
import { NeedsYouCounter, NeedsYouList } from "./NeedsYouTab";
import type { WorldAsk, WorldAsksStore } from "./worldAsks";
import type { WorldLeafObject, WorldObject } from "./worldObject";
import "../styles/tokens.css";
import "../styles/base.css";
import "./world.css";

// Synthetic questions and a blocked report; the test never reaches a runtime.

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

const leaf = (id: string, status: WorldLeafObject["status"]) =>
  ({
    id,
    kind: "agent",
    nativeId: `w1:${id}`,
    connectionId: "local",
    generation: 1,
    label: `${id}-claude`,
    agentName: id,
    hostLabel: "Example host",
    spaceLabel: "example",
    tabLabel: `${id} tab`,
    status,
    stale: false,
    actionable: true,
    lastActivityAt: 1,
    terminalId: `terminal-${id}`,
    pane: { pane_id: `w1:${id}` },
    stateLabels: {},
  }) as unknown as WorldLeafObject;

const LONG = [
  "PR #42 is ready: [the pull request](https://example.com/pull/42).",
  "",
  "It changes three things:",
  "- the reception card keeps its height while answers save;",
  "- the outbox counts each answer once;",
  "- the summary names the agent that asked.",
  "",
  "Tests: https://example.com/runs/7 passed on every viewport.",
  "",
  "Merge it now, or wait for the second review?",
].join("\n");

const ask = (
  id: string,
  question: string,
  pane: string | null,
  options: string[] = [],
): WorldAsk => ({
  id,
  at: 0,
  actor: pane
    ? {
        label: `claude in w1:${pane}`,
        verified: true,
        connection_id: "local",
        pane_id: `w1:${pane}`,
        terminal_id: `terminal-${pane}`,
        connection_generation: 1,
        name: pane,
      }
    : { label: "claude in w9:elsewhere", verified: false },
  question,
  options,
  owner_only: true,
});

const asker = leaf("atlas", "working");
const blocked = leaf("beacon", "blocked");
const world = {
  leaves: [asker, blocked],
  nodeById: new Map([
    [asker.id, asker],
    [blocked.id, blocked],
  ]),
} as unknown as Pick<WorldObject, "leaves" | "nodeById">;
const asks = [
  ask("q-long", LONG, "atlas", ["Merge", "Wait"]),
  ask("q-short", "Use the staging host?", null, ["Yes", "No"]),
];
const asksStore = {
  get: () => asks,
  subscribe: () => () => {},
  start: () => {},
  stop: () => {},
  answer: async () => null,
  dismiss: async () => null,
} as unknown as WorldAsksStore;

// The blocked agent's latest report, as long as the question.
const client = {
  connectionId: "local",
  generation: 1,
  serverRuntimeGeneration: null,
  isCurrent: () => true,
  call: async (method: string) =>
    method === "agent_conversation.latest"
      ? {
          status: "ok",
          latest: { role: "assistant", text: LONG.replace("PR #42", "PR #43") },
        }
      : null,
};
Object.assign(bridge, {
  call: async () => null,
  connection: () => client,
  onControl: () => () => {},
  onStatus: () => () => {},
});
const deskStore = new WorldDeskStore({
  call: async () => null,
  onControl: () => () => {},
  onStatus: () => () => {},
});

const chats: string[] = [];
const root = document.createElement("div");
document.body.append(root);
flushSync(() =>
  createRoot(root).render(
    <>
      <header className="fixture-bar">
        <NeedsYouCounter world={world} compact />
        <NeedsYouCounter world={{ leaves: [] }} compact />
      </header>
      <aside
        className="needs-you-tab"
        style={{ top: 48, height: "calc(100% - 48px)" }}
      >
        <NeedsYouList
          world={world}
          request={{ sequence: 0 }}
          now={60_000}
          onChat={(id) => chats.push(id)}
          onOpenTerminal={() => {}}
          asksStore={asksStore}
          deskStore={deskStore}
        />
      </aside>
    </>,
  ),
);

async function run() {
  await frame();
  await frame();
  const card = document.querySelector<HTMLElement>(
    '[data-needs-you-item="ask:q-long"]',
  )!;
  const text = card.querySelector<HTMLElement>(".needs-you-text")!;
  const toggle = card.querySelector<HTMLButtonElement>(".needs-you-more-text")!;
  const link = text.querySelector<HTMLAnchorElement>("a")!;
  check(
    toggle?.getAttribute("aria-expanded") === "false",
    "long question starts collapsed with more",
  );
  check(
    !document.querySelector(
      '[data-needs-you-item="ask:q-short"] .needs-you-more-text',
    ),
    "short question needs no more",
  );
  check(
    !!document.querySelector(
      '[data-needs-you-item="leaf:beacon"] .needs-you-more-text',
    ),
    "blocked report uses the same expandable text",
  );
  check(
    link.href === "https://example.com/pull/42" && link.target === "_blank",
    "question link opens separately",
  );
  link.addEventListener("click", (event) => event.preventDefault(), {
    once: true,
  });
  link.click();
  await frame();
  check(!text.classList.contains("is-expanded"), "link click does not expand");
  toggle.click();
  await frame();
  check(
    text.classList.contains("is-expanded") && toggle.textContent === "less",
    "more reveals the question",
  );
  toggle.click();
  await frame();
  check(
    !text.classList.contains("is-expanded") && toggle.textContent === "more",
    "less collapses the question",
  );
  card.querySelector<HTMLButtonElement>(".needs-you-name")!.click();
  check(chats.join() === "atlas", "asker name opens its window");
  card.querySelector<HTMLButtonElement>('[title="Open in Chat"]')!.click();
  check(chats.join() === "atlas,atlas", "Chat icon opens its window");
  // ✕ dismisses a question; a blocked agent has no ✕ (it is still waiting).
  check(
    !!card.querySelector('button[title="Dismiss question"]') &&
      !document.querySelector(
        '[data-needs-you-item="leaf:beacon"] button[title^="Mark reviewed"], [data-needs-you-item="leaf:beacon"] button[title="Dismiss question"]',
      ),
    "only a question offers Dismiss",
  );
  // Quick replies only for the question; "Other…" swaps them for one field.
  check(
    !card.querySelector(".needs-you-field") &&
      !document.querySelector(
        '[data-needs-you-item="leaf:beacon"] .needs-you-replies',
      ),
    "replies only where asked",
  );
  card
    .querySelector<HTMLButtonElement>('[aria-label="Type another answer"]')!
    .click();
  await frame();
  const field = card.querySelector<HTMLInputElement>(".needs-you-field input");
  check(
    !card.querySelector(".needs-you-replies") &&
      document.activeElement === field,
    "Other… opens the answer field with focus",
  );
  check(
    !document.querySelector(
      '[data-needs-you-item="ask:q-short"] button.needs-you-name',
    ),
    "unplaced asker has no window opener",
  );
  const counters = document.querySelectorAll(".fixture-bar .needs-you-counter");
  check(
    counters[0]?.getAttribute("aria-label") === "Needs you, 1" &&
      counters[0].querySelector(".world-hosts-count")?.textContent === "1",
    "phone counter names and badges its count",
  );
  check(
    counters[1]?.getAttribute("aria-label") === "Needs you, 0" &&
      !counters[1].querySelector(".world-hosts-count"),
    "zero counter has no badge",
  );
}

void run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
