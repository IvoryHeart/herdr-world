import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { bridge } from "../api";
import { AgentMoveForm } from "./AgentMoveControl";
import type { WorldRuntimeConnection } from "./runtimeStore";
import "./appearance.css";
const failures: string[] = [];
const check = (value: unknown, message: string) => {
  if (!value) failures.push(message);
};
window.addEventListener("error", (e) => failures.push(String(e.error)));
window.addEventListener("unhandledrejection", (e) =>
  failures.push(String(e.reason)),
);
const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
async function run() {
  const host = {
    connectionId: "core",
    label: "Example",
    runtime: "herdr-core",
    generation: 2,
    snapshotGeneration: 2,
    state: "ready",
    actionable: true,
    stale: false,
    snapshot: { workspaces: [{ workspace_id: "room", label: "Build" }] },
  } as WorldRuntimeConnection;
  const element = document.createElement("main");
  element.className = "terminal-appearance-editor";
  document.body.append(element);
  const root = createRoot(element);
  let received: Record<string, unknown> | undefined;
  const result = Promise.withResolvers<unknown>();
  Object.assign(bridge, {
    call: async (_method: string, params: Record<string, unknown>) => {
      received = params;
      return result.promise;
    },
  });
  flushSync(() =>
    root.render(
      <AgentMoveForm
        connections={[host, { ...host, connectionId: "stale", stale: true }]}
        source={{
          connection_id: "tui",
          generation: 1,
          workspace_id: "w1",
          tab_id: "w1:t1",
          pane_id: "w1:p1",
          terminal_id: "term-a",
          color_key: "tui:w1:t1",
        }}
      />,
    ),
  );
  const buttons = () => [...element.querySelectorAll("button")];
  flushSync(() =>
    buttons()
      .find((b) => b.textContent === "Move to…")!
      .click(),
  );
  const select = element.querySelector("select")!;
  check(
    select.options.length === 2,
    "only the current other-runtime room is offered",
  );
  flushSync(() => {
    select.value = select.options[1]!.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const move = buttons().find((b) => b.textContent === "Move agent")!;
  flushSync(() => move.click());
  check(
    move.disabled && move.textContent === "Moving…",
    "the in-flight move cannot be repeated",
  );
  check(
    (received?.source as { terminal_id?: string })?.terminal_id === "term-a",
    "the exact source witness is sent",
  );
  check(
    (received?.destination as { generation?: number })?.generation === 2,
    "the captured destination generation is sent",
  );
  check(
    received?.preview_busy === true &&
      !location.search.includes("agentMoveBusy"),
    "testing switch is removed and travels only as a refusal",
  );
  result.resolve({
    status: "refused",
    message: "This agent has background work running.",
  });
  await frame();
  await frame();
  check(
    element
      .querySelector('[role="status"]')
      ?.textContent?.includes("background work"),
    "the refusal gives a plain reason",
  );
  check(!move.disabled, "a refused move remains available after work finishes");
  check(
    document.documentElement.scrollWidth <= innerWidth,
    "controls fit the phone viewport",
  );
}
void run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
