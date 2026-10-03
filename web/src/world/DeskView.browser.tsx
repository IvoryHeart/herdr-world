import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ConnectionClient } from "../api";
import "../styles/tokens.css";
import "../styles/base.css";
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

  // Enter on a focused control keeps its native meaning.
  const mark = card("alpha")?.querySelectorAll<HTMLButtonElement>("button")[1];
  mark?.focus();
  const event = press(mark!, "Enter");
  await settle();
  check(
    !event.defaultPrevented && opened.length === 1,
    "Enter on a focused button was not taken over by the Desk",
  );
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
