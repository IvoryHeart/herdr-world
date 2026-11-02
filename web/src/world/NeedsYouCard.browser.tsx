import { Profiler } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { bridge } from "../api";
import { WorldDeskStore } from "./deskStateStore";
import { NeedsYouMessage } from "./NeedsYouItem";
import { NeedsYouCounter, NeedsYouList } from "./NeedsYouTab";
import type { WorldAsk, WorldAsksStore } from "./worldAsks";
import type { WorldLeafObject, WorldObject } from "./worldObject";
import "../styles/tokens.css";
import "../styles/base.css";
import "./world.css";

// One Needs you card anatomy, in a real browser: a long question clips to
// its first lines with More, expands in place (tap or More), keeps its links,
// and only its own box changes; the name opens the agent's window; every
// kind ends in the same footer row; the phone's compact counter names its
// count. Synthetic data only.

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
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
// Finished work, shown beside the list to compare its footer with the ask's.
const finished = leaf("comet", "done");
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
const answered: string[] = [];
const dismissed: string[] = [];
const asksStore = {
  get: () => asks,
  subscribe: () => () => {},
  start: () => {},
  stop: () => {},
  answer: async (id: string, text: string) => {
    answered.push(`${id}:${text}`);
    return null;
  },
  dismiss: async (id: string) => {
    dismissed.push(id);
    return null;
  },
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

let commits = 0;
const commitLog: string[] = [];
const chats: string[] = [];
const root = document.createElement("div");
root.id = "root";
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
        aria-label="Needs you"
        style={{ top: 48, height: "calc(100% - 48px)" }}
      >
        <Profiler
          id="needs-you"
          onRender={(_id, phase, actual) => {
            commits++;
            commitLog.push(
              `${phase}:${actual.toFixed(1)}@${Math.round(performance.now())}`,
            );
          }}
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
        </Profiler>
      </aside>
      <div
        className="needs-you fixture-done"
        style={{ position: "absolute", top: 48, left: 400, width: 340 }}
      >
        <NeedsYouMessage
          item={{ kind: "done", key: "leaf:comet", leaf: finished }}
          now={60_000}
          focused={false}
          stop="stop-1"
          onChat={() => {}}
          onOpenTerminal={() => {}}
          onAnswer={async () => null}
          onDismiss={async () => null}
          onReviewed={async () => true}
        />
      </div>
    </>,
  ),
);

async function run() {
  await settle(300);
  const card = (key: string) =>
    document.querySelector<HTMLElement>(`[data-needs-you-item="${key}"]`)!;
  const longCard = card("ask:q-long");
  const shortCard = card("ask:q-short");
  const agentCard = card("leaf:beacon");
  check(Boolean(longCard && shortCard && agentCard), "all three cards render");
  const text = longCard.querySelector<HTMLElement>(".needs-you-text")!;
  const more = () =>
    longCard.querySelector<HTMLButtonElement>(".needs-you-more-text");

  // Collapsed: the first lines, clipped, with More.
  check(
    text.scrollHeight > text.clientHeight + 1,
    "a long question is clipped while collapsed",
  );
  check(
    getComputedStyle(text).webkitLineClamp === "3",
    "a collapsed question shows its first three lines",
  );
  check(
    more()?.textContent === "More" &&
      more()?.getAttribute("aria-expanded") === "false" &&
      more()?.getAttribute("aria-controls") === text.id,
    "a clipped question offers More, controlling its text",
  );
  check(
    !shortCard.querySelector(".needs-you-more-text"),
    "a question that fits offers no More",
  );
  check(
    Boolean(agentCard.querySelector(".needs-you-more-text")),
    "a blocked agent's long report has the same More",
  );
  // Links render as links, opening outside World.
  const links = [...text.querySelectorAll<HTMLAnchorElement>("a")];
  check(
    links.some((link) => link.href === "https://example.com/pull/42") &&
      links.some((link) => link.href === "https://example.com/runs/7") &&
      links.every((link) => link.target === "_blank"),
    `the question's links render: ${links.map((link) => link.href).join(", ")}`,
  );

  // A link in the clipped text opens; it does not expand the card.
  const link = links[0]!;
  const block = (event: Event) => event.preventDefault();
  document.addEventListener("click", block, { capture: false });
  link.click();
  await frame();
  document.removeEventListener("click", block);
  check(
    !text.classList.contains("is-expanded"),
    "a link in the clipped text does not expand it",
  );

  // Expand with More: one commit, nothing above moves, the markdown is not
  // re-rendered, and only cards below follow.
  const list = document.querySelector<HTMLElement>(".needs-you")!;
  const above = list.querySelector<HTMLElement>(".needs-you-count")!;
  const aboveTop = above.getBoundingClientRect().top;
  const cardTop = longCard.getBoundingClientRect().top;
  const scrollTop = list.scrollTop;
  let markdownMutations = 0;
  const watch = new MutationObserver(
    (records) => (markdownMutations += records.length),
  );
  watch.observe(text.querySelector(".needs-you-markdown")!, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });
  const shifts: { value: number; sources: string[] }[] = [];
  const shiftObserver =
    "PerformanceObserver" in window &&
    PerformanceObserver.supportedEntryTypes?.includes("layout-shift")
      ? new PerformanceObserver((entries) => {
          for (const entry of entries.getEntries() as unknown as {
            value: number;
            sources?: { node?: Node; previousRect: DOMRectReadOnly }[];
          }[])
            shifts.push({
              value: entry.value,
              sources: (entry.sources ?? []).map((source) => {
                const node = source.node;
                const element =
                  node instanceof Element ? node : node?.parentElement;
                const item = element?.closest("[data-needs-you-item]");
                return `${item?.getAttribute("data-needs-you-item") ?? element?.className ?? "?"}@${Math.round(source.previousRect.top)}`;
              }),
            });
        })
      : null;
  shiftObserver?.observe({ type: "layout-shift", buffered: false });
  const frames: number[] = [];
  let last = performance.now();
  let sampling = true;
  const sample = (at: number) => {
    frames.push(at - last);
    last = at;
    if (sampling) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  await frame();
  const idleBefore = commits;
  await frame();
  await frame();
  const idleCommits = commits - idleBefore;
  const before = commits;
  const logStart = commitLog.length;
  more()!.click();
  await frame();
  await frame();
  const expandCommits = commits - before;
  sampling = false;
  await settle(50);
  shiftObserver?.disconnect();
  watch.disconnect();
  check(
    text.classList.contains("is-expanded") &&
      text.scrollHeight <= text.clientHeight + 1,
    "More shows the whole question",
  );
  check(
    more()?.textContent === "Less" &&
      more()?.getAttribute("aria-expanded") === "true",
    "an expanded question offers Less",
  );
  check(
    Math.abs(above.getBoundingClientRect().top - aboveTop) < 0.5 &&
      Math.abs(longCard.getBoundingClientRect().top - cardTop) < 0.5 &&
      list.scrollTop === scrollTop,
    "expanding moves nothing above the card and keeps the scroll",
  );
  check(
    expandCommits <= 1,
    `expanding commits once, not ${expandCommits} times`,
  );
  check(
    markdownMutations === 0,
    `expanding re-rendered the question's markdown (${markdownMutations} mutations)`,
  );
  const cardBottom = longCard.getBoundingClientRect().bottom;
  const movedAbove = shifts.flatMap((shift) =>
    shift.sources.filter((source) => Number(source.split("@").pop()) < cardTop),
  );
  check(
    movedAbove.length === 0,
    `layout shifted above the expanding card: ${movedAbove.join(", ")}`,
  );
  const metrics = {
    expandCommits,
    idleCommits,
    expandLog: commitLog.slice(logStart),
    layoutShift: shifts.reduce((sum, shift) => sum + shift.value, 0),
    shiftedSources: shifts.flatMap((shift) => shift.sources),
    longestFrameMs: Math.round(Math.max(0, ...frames.slice(1))),
    frames: frames.length,
    cardGrewPx: Math.round(cardBottom - cardTop),
  };
  console.info(`needs-you-card metrics ${JSON.stringify(metrics)}`);

  // Less clips it again; tapping the clipped text expands it too.
  more()!.click();
  await frame();
  check(
    !text.classList.contains("is-expanded") && more()?.textContent === "More",
    "Less clips the question again",
  );
  text
    .querySelector("li")!
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await frame();
  check(
    text.classList.contains("is-expanded"),
    "tapping the clipped text expands it in place",
  );
  // Expanded text stays put when tapped (Less collapses it).
  text.click();
  await frame();
  check(
    text.classList.contains("is-expanded"),
    "tapping expanded text leaves it expanded",
  );

  // Keyboard: More is a real button in the tab order.
  const toggle = more()!;
  toggle.focus();
  check(
    document.activeElement === toggle && toggle.tabIndex === 0,
    "More/Less is reachable by keyboard",
  );

  // The name opens the agent's window; an unplaced asker is plain text.
  const name = longCard.querySelector<HTMLButtonElement>(
    "button.needs-you-name",
  );
  name?.click();
  check(
    chats.join() === "atlas",
    `the asker's name opens its window (opened ${chats.join() || "nothing"})`,
  );
  check(
    name?.getAttribute("aria-label") === "Open atlas's window",
    "the name says it opens the agent's window",
  );
  check(
    !shortCard.querySelector("button.needs-you-name") &&
      shortCard.querySelector("b.needs-you-name")?.textContent ===
        "claude in w9:elsewhere",
    "an asker World could not place is named without a button",
  );
  agentCard.querySelector<HTMLButtonElement>("button.needs-you-name")?.click();
  check(
    chats.join() === "atlas,beacon",
    "a blocked agent's name opens its window the same way",
  );

  // One anatomy: quick replies, then the field with Answer inline at its
  // height, then one footer row with the kind's action at the start and
  // Chat at the end, aligned like finished work's Mark reviewed/Follow up….
  const doneCard = card("leaf:comet");
  const rect = (element: Element | null | undefined) =>
    element?.getBoundingClientRect() ?? null;
  const content = (element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      left:
        box.left +
        parseFloat(style.borderLeftWidth) +
        parseFloat(style.paddingLeft),
      right:
        box.right -
        parseFloat(style.borderRightWidth) -
        parseFloat(style.paddingRight),
    };
  };
  const footer = (item: HTMLElement) => {
    const row = item.querySelector<HTMLElement>(".needs-you-footer");
    const buttons = [...(row?.querySelectorAll("button") ?? [])];
    return {
      row,
      buttons: buttons.map((button) => button.getBoundingClientRect()),
      labels: buttons.map((button) => button.textContent),
    };
  };
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  const layouts = [
    ["ask", longCard, ["Dismiss", "Chat about this"]],
    ["blocked", agentCard, ["Chat about this"]],
    ["done", doneCard, ["Mark reviewed", "Follow up…"]],
  ] as const;
  const footerHeights: number[] = [];
  for (const [kind, item, labels] of layouts) {
    const { row, buttons, labels: shown } = footer(item);
    const box = content(item);
    check(
      Boolean(row) &&
        row === item.querySelector(".needs-you-footer:last-of-type") &&
        JSON.stringify(shown) === JSON.stringify(labels),
      `the ${kind} card ends in one footer row: ${JSON.stringify(shown)}`,
    );
    const last = buttons[buttons.length - 1];
    check(
      Boolean(last) && near(last!.right, box.right),
      `the ${kind} card's Chat ends at the card's right edge (${last?.right} vs ${box.right})`,
    );
    if (buttons.length === 2)
      check(
        near(buttons[0]!.left, box.left) &&
          near(buttons[0]!.top, buttons[1]!.top),
        `the ${kind} card's action starts the footer row on Chat's line`,
      );
    footerHeights.push(...buttons.map((button) => Math.round(button.height)));
    // Nothing else in the card sits below the footer but a notice.
    const below = [...item.querySelectorAll("button, input")].filter(
      (control) => rect(control)!.top > rect(row)!.bottom,
    );
    check(below.length === 0, `no ${kind} control sits below the footer`);
  }
  check(
    new Set(footerHeights).size === 1,
    `every footer button has one height (${footerHeights.join()})`,
  );
  const reply = longCard.querySelector<HTMLElement>(".needs-you-reply")!;
  const field = rect(reply.querySelector("input"))!;
  const answer = rect(reply.querySelector("button"))!;
  check(
    near(field.top, answer.top) &&
      near(field.height, answer.height) &&
      near(field.height, footerHeights[0]!),
    `Answer sits inline at the field's height (${field.height}, ${answer.height})`,
  );
  check(
    near(field.left, content(longCard).left) &&
      near(answer.right, content(longCard).right),
    "the answer row spans the card",
  );
  const options = [
    ...longCard.querySelectorAll<HTMLButtonElement>(
      ".needs-you-answer > .needs-you-options button",
    ),
  ].map((button) => button.getBoundingClientRect());
  check(
    options.length === 2 &&
      options.every(
        (option) =>
          near(option.top, options[0]!.top) &&
          near(option.height, footerHeights[0]!),
      ),
    "quick replies are one row of equal-height buttons",
  );

  // Answer and Dismiss stay on the card and act as before.
  [...longCard.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent === "Merge")!
    .click();
  await settle();
  check(answered.join() === "q-long:Merge", "an option answers in place");
  shortCard
    .querySelector<HTMLButtonElement>('button[aria-label^="Dismiss"]')!
    .click();
  await settle();
  check(dismissed.join() === "q-short", "Dismiss closes the question");

  // The phone's compact counter: an icon with the count as a badge (the
  // shared asks store is empty here; the blocked agent counts).
  const [counted, empty] = document.querySelectorAll<HTMLButtonElement>(
    ".fixture-bar .needs-you-counter",
  );
  check(
    counted?.getAttribute("aria-label") === "Needs you, 1" &&
      counted.querySelector(".needs-you-badge")?.textContent === "1",
    `the compact counter names and badges its count (${counted?.getAttribute("aria-label")})`,
  );
  check(
    empty?.getAttribute("aria-label") === "Needs you, 0" &&
      !empty.querySelector(".needs-you-badge"),
    "a zero counter shows the icon without a badge",
  );
  const box = counted!.getBoundingClientRect();
  check(
    Math.round(box.width) === 36 && Math.round(box.height) === 36,
    `the compact counter is the bar's 36px icon size (${box.width}×${box.height})`,
  );
  await fetch("/result", {
    method: "POST",
    body: JSON.stringify({ failures, metrics }),
  });
}

void run().catch(async (error) => {
  failures.push(
    `fixture threw: ${error instanceof Error ? error.stack : error}`,
  );
  await fetch("/result", {
    method: "POST",
    body: JSON.stringify({ failures, metrics: null }),
  });
});
