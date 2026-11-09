import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { bridge } from "../api";
import { WorldDeskStore } from "./deskStateStore";
import { NeedsYouCounter, NeedsYouList, NeedsYouTabBadge } from "./NeedsYouTab";
import { worldLocalStorage } from "../browserStorage";
import {
  readOfficePreferences,
  WORLD_OFFICE_PREFERENCES_CHANGED_EVENT,
  writeOfficePreferences,
} from "./officePreferences";
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
const prompted = leaf("deneb", "blocked");
const world = {
  leaves: [asker, blocked, prompted],
  nodeById: new Map([
    [asker.id, asker],
    [blocked.id, blocked],
    [prompted.id, prompted],
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
  call: async (method: string, params: Record<string, unknown>) =>
    method === "agent_conversation.latest"
      ? {
          status: "ok",
          latest: { role: "assistant", text: LONG.replace("PR #42", "PR #43") },
          ...(params.pane_id === "w1:deneb"
            ? {
                pending_prompt: {
                  fingerprint: "synthetic-question",
                  request: ["Synthetic request"],
                  question: LONG.split("\n"),
                  options: [
                    { number: "1", key: "1", label: "Proceed" },
                    {
                      number: "2",
                      key: "2",
                      label: "Add detail",
                      input: "text",
                    },
                  ],
                },
              }
            : {}),
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
      <header className="topbar-start fixture-bar" style={{ marginTop: 12 }}>
        <div className="world-topbar-control-plane">
          <span>Town</span>
          <NeedsYouCounter world={world} compact />
          <NeedsYouCounter world={{ leaves: [] }} compact />
        </div>
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
  const other = [...card.querySelectorAll("button")].find(
    (button) => button.textContent === "Other…",
  )!;
  check(
    !other.getAttribute("aria-label") ||
      other.getAttribute("aria-label")!.includes("Other"),
    "Other visible label remains in its accessible name",
  );
  other.click();
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
  const pending = document.querySelector<HTMLElement>(
    '[data-needs-you-item="leaf:deneb"]',
  )!;
  check(
    !!pending.querySelector(".needs-you-more-text"),
    "long native question uses shared more/less",
  );
  const choices = [
    ...pending.querySelectorAll<HTMLButtonElement>(
      ".agent-chat-ask-options button",
    ),
  ];
  check(
    choices.length === 2 &&
      choices.every((button) => !button.closest(".needs-you-text")),
    "native options stay outside the clipped message",
  );
  choices[1]!.click();
  await frame();
  const nativeInput = pending.querySelector(".agent-chat-ask-text input");
  check(
    !!nativeInput && !nativeInput.closest(".needs-you-text"),
    "native text editor remains outside the clip",
  );
  const counters = document.querySelectorAll(".fixture-bar .needs-you-counter");
  check(
    counters[0]?.getAttribute("aria-label") === "Needs you, 2" &&
      counters[0].querySelector(".world-hosts-count")?.textContent === "2",
    "phone counter names and badges its count",
  );
  check(
    counters[1]?.getAttribute("aria-label") === "Needs you, 0" &&
      !counters[1].querySelector(".world-hosts-count"),
    "zero counter has no badge",
  );
}

/** The tab title and icon follow the counter's number, and Menu's switch. */
async function tabBadge() {
  const icon = document.createElement("link");
  icon.rel = "icon";
  icon.href = "/herdr-world-icon-192.png";
  document.head.append(icon);
  document.title = "Herdr World";
  const plain = document.title;
  const host = document.createElement("div");
  document.body.append(host);
  const badgeRoot = createRoot(host);
  const show = (leaves: WorldLeafObject[]) =>
    flushSync(() => badgeRoot.render(<NeedsYouTabBadge world={{ leaves }} />));
  const badged = () =>
    document.head.querySelector<HTMLLinkElement>("link[data-attention-badge]");
  const setSwitch = (tabBadge: boolean) => {
    writeOfficePreferences(worldLocalStorage, {
      ...readOfficePreferences(worldLocalStorage),
      tabBadge,
    });
    window.dispatchEvent(new Event(WORLD_OFFICE_PREFERENCES_CHANGED_EVENT));
  };
  setSwitch(true);
  show([blocked, prompted, asker]);
  check(
    document.title === `(2) ${plain}`,
    `title shows the counter's 2: ${document.title}`,
  );
  for (let wait = 0; wait < 60 && !badged(); wait++) await frame();
  check(
    !!badged()?.href.startsWith("data:image/png") && !icon.isConnected,
    "tab icon is the drawn badge, in place of the plain icon",
  );
  show([blocked, asker]);
  check(document.title === `(1) ${plain}`, "title drops to 1 without reload");
  flushSync(() => setSwitch(false));
  await frame();
  check(
    document.title === plain && !badged() && icon.isConnected,
    "switch off restores the plain title and icon at once",
  );
  flushSync(() => setSwitch(true));
  check(document.title === `(1) ${plain}`, "switch on shows the count again");
  // Another tab of this browser turns the switch off: only a storage event.
  writeOfficePreferences(worldLocalStorage, {
    ...readOfficePreferences(worldLocalStorage),
    tabBadge: false,
  });
  flushSync(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "herdr-world:foundation-v2:officePreferences:v1",
        storageArea: localStorage,
      }),
    ),
  );
  check(
    document.title === plain,
    `another tab's switch off restores the plain title: ${document.title}`,
  );
  flushSync(() => setSwitch(true));
  show([asker]);
  await frame();
  check(
    document.title === plain && !badged() && icon.isConnected,
    "nothing waiting: plain title and icon",
  );
  show([blocked]);
  badgeRoot.unmount();
  await frame();
  check(
    document.title === plain && !badged() && icon.isConnected,
    "leaving restores the plain title and icon",
  );
}

void run()
  .then(tabBadge)
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
