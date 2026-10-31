import { checkDeskRevealHook } from "./testing/deskRevealHookAcceptance";
import { checkDeskOtherHosts } from "./testing/deskOtherHostsAcceptance";
import { bridge } from "../api";
import { sharedAsksStore, type WorldAsk } from "./worldAsks";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ConnectionClient } from "../api";
import "../styles/tokens.css";
import "../styles/base.css";
import { terminalFocusBlockedByOverlay } from "../terminalFocus";
import { runSharedDeskWatchChecks } from "./testing/deskWatchBrowser";
import { handoffId } from "./handoffs";
import { DeskBoard } from "./DeskView";
import { WorldDeskStore } from "./deskStateStore";
import { deskKey, type DeskRecord } from "../../../shared/deskState";
import type { BridgeControlMsg } from "../api";
import { InspectorChat } from "../components/InspectorChat";
import { ResourceConnectionClientContext } from "../useConnectionClient";
import type { WorldLeafObject, WorldObject } from "./worldObject";

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

function agent(id: string, fingerprint: string): WorldLeafObject {
  return {
    id,
    terminalId: id,
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
const alphaReceiptReads: Array<() => Promise<unknown>> = [];
const receiptReadCounts = new Map<string, number>();
function receiptReply(
  id: string,
  fingerprint: unknown,
  turnId = `${id}-turn`,
  report = `Report from ${id}`,
) {
  return {
    agent_session_fingerprint: fingerprint,
    turn: {
      turn_id: turnId,
      ask: `Request for ${id}`,
      report,
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
const client = {
  connectionId: "local",
  generation: 1,
  serverRuntimeGeneration: 1,
  isCurrent: () => true,
  acceptsServerGeneration: () => true,
  async call(method: string, params?: Record<string, unknown>) {
    if (method === "agent_conversation.latest")
      return {
        conversation_version: 1,
        pane_id: params?.pane_id,
        agent: "codex",
        agent_status: "done",
        session_binding: "reported",
        session_fingerprint: String(params?.pane_id).repeat(8),
        status: "ok",
        unavailable: null,
        latest: null,
      };
    if (method === "agent_history.get")
      return {
        history_version: 2,
        mode: "snapshot",
        cursor: { epoch: "desk-chat", revision: 1 },
        window_limit: 200,
        agent: "codex",
        pane_id: params?.pane_id,
        workspace_id: "w1",
        tab_id: "fixture",
        updated_at: "2026-10-22T09:00:00Z",
        path: "",
        entries: [],
      };
    if (method === "agent_conversation.steps") return { steps: [] };
    if (method === "agent_turn.get") {
      const id = String(params?.pane_id).split(":")[1]!;
      receiptReadCounts.set(id, (receiptReadCounts.get(id) ?? 0) + 1);
      const queued = id === "alpha" ? alphaReceiptReads.shift() : undefined;
      if (queued) return queued();
      return receiptReply(id, params?.agent_session_fingerprint);
    }
    if (method === "pane.read") return { text: "" };
    return null;
  },
} as unknown as ConnectionClient;

const askLedger = { revision: 0, asks: [] as WorldAsk[] };
const originalCall = bridge.call.bind(bridge);
bridge.call = (async (method: string, params?: Record<string, unknown>) =>
  method === "world.asks.get"
    ? structuredClone(askLedger)
    : originalCall(method, params)) as typeof bridge.call;

let revision = 0;
const deskRecords = new Map<string, DeskRecord>(
  leaves.map((leaf) => {
    const record: DeskRecord = {
      connection_id: leaf.connectionId,
      connection_generation: leaf.generation,
      terminal_id: leaf.terminalId,
      agent_session_fingerprint: leaf.agentSessionFingerprint ?? null,
      reviewed_stop: null,
      stopped_at: 1,
      opened_at: null,
      observed_stop_id: `observed-${leaf.id}`,
    };
    return [deskKey(record), record];
  }),
);
const deskControls = new Set<(control: BridgeControlMsg) => void>();
let reviewReply: Promise<void> | undefined;
const metadataOpens: string[] = [];
const deskService = {
  async call(method: string, params?: Record<string, unknown>) {
    if (method === "world.desk.open") {
      metadataOpens.push(String(params?.terminal_id));
      if (params?.terminal_id === "asker")
        throw new Error("Agent metadata requires an agent pane");
    }
    if (method !== "world.desk.get") {
      const identity = params as unknown as DeskRecord;
      const key = deskKey(identity);
      const record = deskRecords.get(key) ?? {
        ...identity,
        reviewed_stop: null,
        stopped_at: null,
        opened_at: null,
      };
      if (method === "world.desk.review")
        record.reviewed_stop = params?.reviewed
          ? String(params?.stop_id)
          : null;
      else if (method === "world.desk.open") record.opened_at = Date.now();
      deskRecords.set(key, record);
      revision++;
      for (const callback of deskControls)
        callback({ type: "world_desk_changed", revision });
    }
    if (method === "world.desk.review") await reviewReply;
    return {
      revision,
      records: [...deskRecords.values()].map((record) => ({ ...record })),
    };
  },
  onControl: (callback: (control: BridgeControlMsg) => void) => {
    deskControls.add(callback);
    return () => {
      deskControls.delete(callback);
    };
  },
  onStatus: () => () => {},
};
const deskStore = new WorldDeskStore(deskService);

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
        deskStore={deskStore}
        world={world}
        client={client}
        onOpen={async (id) => {
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

  // Admit the external-store render before mark() resumes, as a revision
  // notification can publish before the mutation reply's continuation.
  const stopFlush = deskStore.subscribe(() => flushSync(() => {}));
  // Tab to beta's button, then E: the agent that has focus is marked.
  const betaOpen =
    card("beta")?.querySelector<HTMLButtonElement>("button.is-primary");
  betaOpen?.focus();
  await settle();
  press(betaOpen!, "e");
  await settle(200);
  check(!card("beta"), "E marked the focused card (beta) reviewed");
  check(
    card("gamma")?.contains(document.activeElement) === true,
    "E moves DOM focus to the next card, gamma, after the async shared mark",
  );
  check(!!card("alpha") && !!card("gamma"), "E left the other cards alone");

  // Recency can expire while the retained stop and review mark stay the same.
  const betaRecord = [...deskRecords.values()].find(
    (entry) => entry.terminal_id === "beta",
  )!;
  const betaReadsBeforeExpiry = receiptReadCounts.get("beta");
  betaRecord.stopped_at = null;
  revision++;
  for (const callback of deskControls)
    callback({ type: "world_desk_changed", revision });
  await settle(150);
  check(
    !card("beta"),
    "expiring only the display time does not return the same stop to To review",
  );

  check(
    receiptReadCounts.get("beta") === betaReadsBeforeExpiry,
    "display expiry does not refetch an unchanged stable stop",
  );

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
  const betaMark = [
    ...card("beta")!.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent?.startsWith("Mark reviewed"))!;
  betaMark.focus();
  await settle();
  betaMark.click();
  await settle(200);
  check(
    card("gamma")?.contains(document.activeElement) === true,
    "Mark reviewed moves DOM focus to the next card after publication removes its focused button",
  );
  stopFlush();

  // A slow save must not reclaim focus after the user leaves the Desk.
  const heldReply = Promise.withResolvers<void>();
  reviewReply = heldReply.promise;
  const alphaMark = [
    ...card("alpha")!.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent?.startsWith("Mark reviewed"))!;
  alphaMark.focus();
  alphaMark.click();
  await settle(100);
  const elsewhere = document.createElement("button");
  elsewhere.textContent = "Outside Desk";
  document.body.append(elsewhere);
  elsewhere.focus();
  reviewReply = undefined;
  heldReply.resolve();
  await settle(150);
  check(
    document.activeElement === elsewhere,
    "a late review save preserves newer focus outside the Desk",
  );
  await deskStore.mutate(
    "world.desk.review",
    {
      connection_id: "local",
      connection_generation: 1,
      terminal_id: "alpha",
      agent_session_fingerprint: "a".repeat(64),
    },
    {
      stop_id: JSON.parse(
        handoffId(leaves[0]!, undefined, "observed-alpha"),
      )[1],
      reviewed: false,
    },
  );
  elsewhere.remove();
  await settle(100);

  // A second browser sees the same service, without sharing browser storage.
  const secondBrowser = new WorldDeskStore(deskService);
  secondBrowser.start();
  await secondBrowser.refresh();
  const alphaIdentity = {
    connection_id: "local",
    connection_generation: 1,
    terminal_id: "alpha",
    agent_session_fingerprint: "a".repeat(64),
  };
  await secondBrowser.mutate("world.desk.review", alphaIdentity, {
    stop_id: JSON.parse(handoffId(leaves[0]!, undefined, "observed-alpha"))[1],
    reviewed: true,
  });
  await settle(150);
  check(
    !card("alpha"),
    "a mark from another browser removes the same stop from To review",
  );
  const oldStopRead = Promise.withResolvers<unknown>();
  const latestStopRead = Promise.withResolvers<unknown>();
  alphaReceiptReads.push(
    () => oldStopRead.promise,
    () => latestStopRead.promise,
  );
  const alphaReadsBeforeStop = receiptReadCounts.get("alpha") ?? 0;
  const alphaRecord = deskRecords.get(deskKey(alphaIdentity))!;
  alphaRecord.observed_stop_id = "observed-alpha-later";
  alphaRecord.stopped_at = Date.now();
  revision++;
  for (const callback of deskControls)
    callback({ type: "world_desk_changed", revision });
  await settle(150);
  check(
    !!card("alpha"),
    "native progress returns a new completed stop to review without a working browser frame",
  );
  const alphaMarkButton = () =>
    [
      ...(card("alpha")?.querySelectorAll<HTMLButtonElement>("button") ?? []),
    ].find((button) => button.textContent?.startsWith("Mark reviewed"));
  check(
    (receiptReadCounts.get("alpha") ?? 0) > alphaReadsBeforeStop,
    "shared stop identity triggers a new receipt read with unchanged native status/activity",
  );
  check(
    alphaMarkButton()?.disabled === true,
    "a new stop is not markable while its receipt is pending",
  );
  const precedingMark = alphaRecord.reviewed_stop;
  card("alpha")?.focus();
  press(card("alpha")!, "e");
  await settle();
  check(
    alphaRecord.reviewed_stop === precedingMark,
    "E cannot mark a new stop against its preceding report",
  );

  // Supersede an in-flight read without changing status, activity or session.
  alphaRecord.observed_stop_id = "observed-alpha-newest";
  revision++;
  for (const callback of deskControls)
    callback({ type: "world_desk_changed", revision });
  await settle(150);
  oldStopRead.resolve(
    receiptReply(
      "alpha",
      "a".repeat(64),
      "superseded-turn",
      "Superseded report must not publish",
    ),
  );
  await settle(150);
  check(
    alphaMarkButton()?.disabled === true,
    "a late read from an older stop cannot settle the newest stop",
  );
  check(
    !card("alpha")?.textContent?.includes("Superseded report must not publish"),
    "a superseded stop response is fenced before publication",
  );
  latestStopRead.reject(new Error("synthetic receipt refresh failure"));
  await settle(150);
  check(
    alphaMarkButton()?.disabled === true,
    "one failed refresh cannot make the preceding report current",
  );

  alphaReceiptReads.push(async () => {
    throw new Error("synthetic repeated receipt failure");
  });
  document.dispatchEvent(new Event("visibilitychange"));
  await settle(200);
  check(
    alphaMarkButton()?.disabled === false,
    "an unreadable stop can settle without a report after retry",
  );
  check(
    !card("alpha")?.textContent?.includes("Report from alpha"),
    "repeated failures discard the preceding stop report instead of validating it",
  );

  alphaReceiptReads.push(async () =>
    receiptReply("alpha", "a".repeat(64), "newest-turn", "Newest stop report"),
  );
  document.dispatchEvent(new Event("visibilitychange"));
  await settle(200);
  check(
    card("alpha")?.textContent?.includes("Newest stop report") === true,
    "a successful refresh publishes the newest stop report",
  );
  check(
    alphaMarkButton()?.disabled === false,
    "a current stop report enables Mark reviewed",
  );
  await secondBrowser.mutate("world.desk.review", alphaIdentity, {
    stop_id: JSON.parse(handoffId(leaves[0]!, undefined, "observed-alpha"))[1],
    reviewed: false,
  });
  await settle(150);
  check(
    !!card("alpha"),
    "Undo from another browser restores the stop immediately",
  );
  secondBrowser.stop();
  check(
    !Object.keys(localStorage).some((key) =>
      /handoffs|desk\.opened/u.test(key),
    ),
    "Desk metadata never writes browser storage",
  );

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
  const renderReading = (reading: string) =>
    root.render(
      <>
        <DeskBoard
          deskStore={deskStore}
          world={world}
          client={client}
          onOpen={async (id) => {
            opened.push(id);
          }}
          reading={reading}
          onPreview={async (id) => {
            previewed.push(id);
            renderReading(id);
          }}
          onCloseReading={() => {
            closed += 1;
          }}
        />
        <ResourceConnectionClientContext.Provider value={client}>
          <InspectorChat
            pane={{
              ...leaves.find((leaf) => leaf.id === reading)!.pane!,
              terminal_id: `terminal-${reading}`,
            }}
            workSessionFingerprint={reading}
            focusIntent={null}
            active
            onClose={() => {}}
          />
        </ResourceConnectionClientContext.Provider>
      </>,
    );
  flushSync(() => renderReading("alpha"));
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
    document.querySelector(".agent-chat textarea") !== null,
    "The Desk preview regression mounts the real Inspector Chat input",
  );
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
  check(
    document.activeElement === card("gamma"),
    "Previewing a real Chat composer must keep keyboard focus on the Desk card",
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
        deskStore={deskStore}
        world={filtered}
        client={resolve}
        onOpen={async (id) => {
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
        deskStore={deskStore}
        world={{ ...filtered, leaves: [remote], hosts: [filtered.hosts[1]] }}
        client={resolve}
        onOpen={async (id) => {
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

  // Start an independent service-state scenario; clearing browser storage
  // deliberately no longer clears shared review marks.
  deskRecords.clear();
  revision++;
  for (const callback of deskControls)
    callback({ type: "world_desk_changed", revision });
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
        deskStore={deskStore}
        key="slow-host"
        world={{ ...filtered, leaves: [remote, leaves[0]] }}
        client={independent}
        onOpen={async () => {}}
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
        deskStore={deskStore}
        key="slow-host"
        world={{
          ...filtered,
          leaves: [{ ...remote, status: "blocked" }, leaves[0]],
        }}
        client={independent}
        onOpen={async () => {}}
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
  const asker = {
    ...agent("asker", "e"),
    kind: "terminal",
    status: "idle",
    agentSessionFingerprint: undefined,
    pane: { ...agent("asker", "e").pane, agent: "" },
  } as WorldLeafObject;
  askLedger.asks = [
    {
      id: "q-desk",
      at: Date.now(),
      question: "Which design should I use?",
      options: [],
      owner_only: true,
      actor: {
        label: "Example asker",
        verified: true,
        connection_id: "local",
        connection_generation: 1,
        pane_id: asker.pane.pane_id,
        terminal_id: asker.terminalId,
        agent_session_fingerprint: asker.agentSessionFingerprint,
      },
    },
  ];
  askLedger.revision++;
  await sharedAsksStore().refresh();
  flushSync(() =>
    root.render(
      <DeskBoard
        key="asks"
        deskStore={deskStore}
        world={{ ...world, leaves: [asker] }}
        client={client}
        onOpen={async (id) => {
          opened.push(id);
        }}
      />,
    ),
  );
  await settle(300);
  check(
    Boolean(
      document.querySelector('.desk-lane.is-needs [data-world-ask="q-desk"]'),
    ),
    "a non-blocked ask shows ? in Desk Needs you",
  );
  check(
    card("asker")?.textContent?.includes("Which design should I use?") === true,
    "Desk shows the owner's actual question",
  );
  card("asker")?.querySelector<HTMLButtonElement>("button.is-primary")?.click();
  await settle(100);
  check(
    opened[opened.length - 1] === "asker",
    "one action opens the asking agent",
  );
  check(
    !metadataOpens.includes("asker"),
    "opening an asking shell does not dispatch unsupported agent metadata",
  );
  check(
    !document.querySelector(".desk-error"),
    "an asking shell opens without an agent-metadata error",
  );
  askLedger.asks[0]!.withdrawn = { at: Date.now() };
  askLedger.revision++;
  await sharedAsksStore().refresh();
  await settle(100);
  check(
    !document.querySelector('[data-world-ask="q-desk"]'),
    "withdrawal clears Desk's question mark",
  );
  await checkDeskOtherHosts(check);
  await checkDeskRevealHook(check);
  flushSync(() => root.unmount());
  await runSharedDeskWatchChecks(check);
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
