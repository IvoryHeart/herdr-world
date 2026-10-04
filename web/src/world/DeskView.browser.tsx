import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ConnectionClient } from "../api";
import "../styles/tokens.css";
import "../styles/base.css";
import { terminalFocusBlockedByOverlay } from "../terminalFocus";
import { DeskBoard } from "./DeskView";
import type { WorldLeafObject, WorldObject } from "./worldObject";

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

function agent(id: string, fingerprint: string): WorldLeafObject {
  return {
    id,
    kind: "agent",
    status: "done",
    selectedHost: true,
    actionable: true,
    stale: false,
    connectionId: "local",
    generation: 1,
    hostLabel: "local",
    label: id,
    agentName: id,
    spaceLabel: "demo",
    tabLabel: id,
    agentSessionFingerprint: fingerprint.repeat(64),
    pane: {
      pane_id: `w1:${id}`,
      workspace_id: "w1",
      tab_id: `t-${id}`,
      agent: "codex",
    },
  } as unknown as WorldLeafObject;
}

const leaves = [agent("alpha", "a"), agent("beta", "b"), agent("gamma", "c")];
const world = {
  leaves,
  hosts: [{ selectedHost: true, label: "local" }],
} as unknown as WorldObject;
const opened: string[] = [];
const client = {
  connectionId: "local",
  generation: 1,
  serverRuntimeGeneration: 1,
  isCurrent: () => true,
  acceptsServerGeneration: () => true,
  async call(method: string, params?: Record<string, unknown>) {
    if (method === "agent_turn.get") {
      const id = String(params?.pane_id).split(":")[1];
      return {
        agent_session_fingerprint: params?.agent_session_fingerprint,
        turn: {
          turn_id: `${id}-turn`,
          ask: `Request for ${id}`,
          report: `Report from ${id}`,
          report_truncated: false,
          started_at: new Date(Date.now() - 60_000).toISOString(),
          ended_at: new Date().toISOString(),
          duration_ms: 60_000,
          tool_calls: 1,
          commands: 0,
          files: [],
          files_truncated: false,
        },
      };
    }
    if (method === "pane.read") return { text: "" };
    return null;
  },
} as unknown as ConnectionClient;

const card = (id: string) =>
  document.querySelector<HTMLElement>(`[data-desk-card="${id}"]`);
const press = (target: Element, key: string) => {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
};

async function run() {
  localStorage.clear();
  const root = createRoot(document.getElementById("root")!);
  flushSync(() =>
    root.render(
      <DeskBoard
        world={world}
        client={client}
        onOpenTerminal={async (id) => {
          opened.push(id);
        }}
      />,
    ),
  );
  await settle(500);
  check(
    !!card("alpha") && !!card("beta") && !!card("gamma"),
    "all finished agents are in To review",
  );

  // Tab to beta's button, then E: the agent that has focus is marked.
  const betaOpen =
    card("beta")?.querySelector<HTMLButtonElement>("button.is-primary");
  betaOpen?.focus();
  await settle();
  press(betaOpen!, "e");
  await settle(200);
  check(!card("beta"), "E marked the focused card (beta) reviewed");
  check(!!card("alpha") && !!card("gamma"), "E left the other cards alone");

  // Marking offers Undo, and the stop stays reachable under Reviewed.
  const undo = [
    ...document.querySelectorAll<HTMLButtonElement>(".desk-toast button"),
  ].find((button) => button.textContent === "Undo");
  check(!!undo, "marking shows an Undo toast");
  const tab = (label: string) =>
    [
      ...document.querySelectorAll<HTMLButtonElement>(".desk-modes button"),
    ].find((button) => button.textContent?.startsWith(label));
  tab("Reviewed")?.click();
  await settle(150);
  check(!!card("beta"), "Reviewed lists the stop that was marked");
  tab("Now")?.click();
  await settle(150);
  undo?.click();
  await settle(150);
  check(!!card("beta"), "Undo returns the stop to To review");
  const betaAgain =
    card("beta")?.querySelector<HTMLButtonElement>("button.is-primary");
  betaAgain?.focus();
  await settle();
  press(betaAgain!, "e");
  await settle(200);

  // Search narrows the Desk to matching agents.
  const search = document.querySelector<HTMLInputElement>(".desk-search input");
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setValue?.call(search, "gamma");
  search?.dispatchEvent(new Event("input", { bubbles: true }));
  await settle(150);
  const visible = () =>
    [...document.querySelectorAll<HTMLElement>("[data-desk-card]")]
      .map((element) => element.dataset.deskCard)
      .join(",");
  check(
    !card("alpha") && !!card("gamma"),
    `search narrows To review to gamma (visible: ${visible()}, query: ${search?.value})`,
  );
  setValue?.call(search, "");
  search?.dispatchEvent(new Event("input", { bubbles: true }));
  await settle(150);

  // Agents lists every agent, including reviewed ones.
  tab("Agents")?.click();
  await settle(150);
  check(
    document.querySelectorAll(".desk-row").length === 3,
    "Agents lists every agent",
  );
  tab("Now")?.click();
  await settle(150);

  // J moves DOM focus with the highlight, so Enter opens that agent.
  card("alpha")?.focus();
  await settle();
  press(card("alpha")!, "j");
  await settle();
  check(
    document.activeElement === card("gamma"),
    "J moved DOM focus to the next card",
  );
  press(document.activeElement!, "Enter");
  await settle();
  check(
    opened.join(",") === "gamma",
    `Enter opened the focused agent (opened: ${opened.join(",")})`,
  );

  // With the reading pane open, J previews the next agent and Esc closes it.
  const previewed: string[] = [];
  let closed = 0;
  flushSync(() =>
    root.render(
      <DeskBoard
        world={world}
        client={client}
        onOpenTerminal={async (id) => {
          opened.push(id);
        }}
        reading="alpha"
        onPreview={async (id) => {
          previewed.push(id);
        }}
        onCloseReading={() => {
          closed += 1;
        }}
      />,
    ),
  );
  await settle(200);
  check(
    !!document.querySelector(".desk.has-reading") &&
      card("alpha")?.classList.contains("is-reading") === true,
    "the card being read is marked in the queue",
  );
  card("alpha")?.focus();
  await settle();
  // A streaming terminal in the reading pane must not take focus from here.
  check(
    terminalFocusBlockedByOverlay(document.activeElement, document),
    "terminal autofocus is blocked while focus is in the Desk queue",
  );
  press(card("alpha")!, "j");
  await settle(300);
  check(
    previewed.join(",") === "gamma",
    `J previewed the next agent (previewed: ${previewed.join(",")})`,
  );
  // Rapid moves preview only where the operator stops.
  previewed.length = 0;
  press(document.activeElement!, "k");
  press(document.activeElement!, "j");
  press(document.activeElement!, "k");
  await settle(300);
  check(
    previewed.join(",") === "alpha",
    `rapid moves previewed once, at the final agent (previewed: ${previewed.join(",")})`,
  );
  // The active card is highlighted and follows J.
  check(
    document.querySelector(".desk-card.is-focused") === card("alpha"),
    "the active card is highlighted",
  );
  // Esc right after a move cancels the pending preview.
  previewed.length = 0;
  press(document.activeElement!, "j");
  press(document.activeElement!, "Escape");
  await settle(300);
  check(closed === 1, "Esc closed the reading pane");
  check(
    previewed.length === 0,
    `Esc cancelled the pending preview (previewed: ${previewed.join(",")})`,
  );
  // Clicking Mark reviewed removes its card (and the focused button); focus
  // must stay inside the guarded Desk without relying on a blur event.
  const markTarget = [
    ...document.querySelectorAll<HTMLElement>("[data-desk-card]"),
  ].find((element) => element.querySelector("button:not(.is-primary)"));
  const markButton = markTarget?.querySelector<HTMLButtonElement>(
    "button:not(.is-primary)",
  );
  check(Boolean(markButton), "a review card offers Mark reviewed");
  markButton?.focus();
  markButton?.click();
  await settle(200);
  check(
    Boolean(document.activeElement?.closest(".desk")) &&
      terminalFocusBlockedByOverlay(document.activeElement, document),
    `focus stayed in the Desk after clicking Mark reviewed (active: ${document.activeElement?.tagName})`,
  );
  const undoButton = [
    ...document.querySelectorAll<HTMLButtonElement>(".desk-toast button"),
  ].find((button) => button.textContent === "Undo");
  undoButton?.focus();
  undoButton?.click();
  await settle(200);
  check(
    Boolean(document.activeElement?.closest(".desk")),
    `focus stayed in the Desk after clicking Undo (active: ${document.activeElement?.tagName})`,
  );

  // Marking with E keeps focus inside the guarded Desk.
  const reviewCard = card("gamma") ?? card("alpha");
  reviewCard?.focus();
  await settle();
  press(reviewCard!, "e");
  await settle(200);
  check(
    Boolean(document.activeElement?.closest(".desk")) &&
      terminalFocusBlockedByOverlay(document.activeElement, document),
    `focus stayed in the Desk after marking (active: ${document.activeElement?.tagName})`,
  );

  // Enter on a focused control keeps its native meaning.
  const mark = card("alpha")?.querySelectorAll<HTMLButtonElement>("button")[1];
  mark?.focus();
  const event = press(mark!, "Enter");
  await settle();
  check(
    !event.defaultPrevented && opened.length === 1,
    "Enter on a focused button was not taken over by the Desk",
  );

  // Equal native pane IDs on two filtered hosts retain independent reads and marks.
  const remote = {
    ...agent("remote-alpha", "d"),
    selectedHost: false,
    connectionId: "remote",
    generation: 7,
    hostLabel: "Remote",
    pane: { ...leaves[0].pane },
  } as WorldLeafObject;
  const reads: string[] = [];
  const remoteClient = {
    ...client,
    connectionId: "remote",
    generation: 10,
    serverRuntimeGeneration: 7,
    async call(method: string, params?: Record<string, unknown>) {
      reads.push(`${method}:${params?.pane_id}`);
      const result = await client.call(method, params);
      if (method === "agent_turn.get")
        return {
          ...(result as object),
          turn: {
            ...(result as { turn: object }).turn,
            report: "Remote closing report",
          },
        };
      return { text: "Remote live screen" };
    },
  } as ConnectionClient;
  const resolve = (leaf: WorldLeafObject) =>
    leaf.connectionId === "remote" ? remoteClient : client;
  const filtered = {
    leaves: [leaves[0], remote, { ...remote, id: "stale", stale: true }],
    hosts: [
      { connectionId: "local", label: "Local" },
      { connectionId: "remote", label: "Remote" },
    ],
  } as unknown as WorldObject;
  flushSync(() =>
    root.render(
      <DeskBoard
        world={filtered}
        client={resolve}
        onOpenTerminal={async (id) => {
          opened.push(id);
        }}
      />,
    ),
  );
  await settle(500);
  check(
    Boolean(card("alpha")) && Boolean(card("remote-alpha")) && !card("stale"),
    "aggregate Desk triages both filtered hosts and excludes stale agents",
  );
  check(
    card("remote-alpha")?.textContent?.includes("Remote closing report") ===
      true,
    "a colliding remote pane publishes only its owner's receipt",
  );
  check(
    reads.includes("agent_turn.get:w1:alpha") &&
      reads.includes("pane.read:w1:alpha"),
    "receipt and screen reads use the non-focused host client",
  );
  card("alpha")?.focus();
  press(card("alpha")!, "e");
  await settle(200);
  check(
    !card("alpha") && Boolean(card("remote-alpha")),
    "reviewing one host's stop does not review a colliding pane on another host",
  );
  flushSync(() =>
    root.render(
      <DeskBoard
        world={{ ...filtered, leaves: [remote], hosts: [filtered.hosts[1]] }}
        client={resolve}
        onOpenTerminal={async (id) => {
          opened.push(id);
        }}
      />,
    ),
  );
  await settle(200);
  check(
    Boolean(card("remote-alpha")),
    "host filtering retains the remote Desk card",
  );

  localStorage.clear();
  let releaseSlow!: () => void;
  const slowRead = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  const slowCalls: string[] = [];
  const slowClient = {
    ...remoteClient,
    async call(method: string, params?: Record<string, unknown>) {
      slowCalls.push(method);
      await slowRead;
      return remoteClient.call(method, params);
    },
  } as ConnectionClient;
  const healthyCalls: string[] = [];
  const healthyClient = {
    ...client,
    async call(method: string, params?: Record<string, unknown>) {
      healthyCalls.push(method);
      return client.call(method, params);
    },
  } as ConnectionClient;
  const independent = (leaf: WorldLeafObject) =>
    leaf.connectionId === "remote" ? slowClient : healthyClient;
  flushSync(() =>
    root.render(
      <DeskBoard
        key="slow-host"
        world={{ ...filtered, leaves: [remote, leaves[0]] }}
        client={independent}
        onOpenTerminal={async () => {}}
      />,
    ),
  );
  await settle(500);
  check(
    card("alpha")?.textContent?.includes("Report from alpha") === true,
    "a slow host does not delay another host's receipt or review controls",
  );
  const healthyReview = [
    ...(card("alpha")?.querySelectorAll<HTMLButtonElement>("button") ?? []),
  ].find((button) => button.textContent?.startsWith("Mark reviewed"));
  check(
    Boolean(healthyReview) && !healthyReview!.disabled,
    "the healthy host's review control becomes ready while the slow read is pending",
  );
  check(
    healthyCalls.includes("pane.read"),
    "the healthy host's screen is read while another host is pending",
  );
  flushSync(() =>
    root.render(
      <DeskBoard
        key="slow-host"
        world={{
          ...filtered,
          leaves: [{ ...remote, status: "blocked" }, leaves[0]],
        }}
        client={independent}
        onOpenTerminal={async () => {}}
      />,
    ),
  );
  await settle(200);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  document.dispatchEvent(new Event("visibilitychange"));
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  document.dispatchEvent(new Event("visibilitychange"));
  await settle(200);
  check(
    slowCalls.filter((method) => method === "agent_turn.get").length === 1 &&
      slowCalls.filter((method) => method === "pane.read").length === 1,
    "status and visibility changes do not overlap reads on a pending host",
  );
  await settle(4400);
  check(
    healthyCalls.filter((method) => method === "pane.read").length >= 2,
    "healthy screen polling continues independently of the slow host",
  );
  releaseSlow();
  await settle(200);
}

run()
  .catch((error: unknown) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(failures),
    }),
  );
