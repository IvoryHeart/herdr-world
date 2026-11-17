import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { bridge } from "../api";
import { AgentLauncherDialog } from "./AgentLauncherDialog";
import { putInBin } from "./bin/WorldBin";
import { CoreKillConfirmHost } from "./CoreKillConfirm";
import { WorldRuntimeStore } from "./runtimeStore";
import { buildWorldObject, type WorldLeafObject } from "./worldObject";
import "../styles/tokens.css";
import "../styles/base.css";
import "./world.css";

// World's control of a herdr-core host (#869), on core agents as the
// server's read model lists them: `?scene=launcher` opens New agent with no
// room chosen; `?scene=bin` puts an agent with sub-agents in the bin. Every
// call is recorded; the page reaches no runtime.

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const settle = async (frames = 6) => {
  for (let i = 0; i < frames; i++) await frame();
};
window.addEventListener("error", (event) => failures.push(String(event.error)));
const consoleError = console.error;
console.error = (...args: unknown[]) => {
  failures.push(args.map(String).join(" ").slice(0, 400));
  consoleError(...args);
};

const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
/** What world.core.kill_plan answers: the builder and its dying sub-agent. */
const plan = {
  core_id: "c0ffee",
  roots: [
    {
      address: "t2",
      pid: 12,
      occupant: "p2",
      name: "builder",
      remote: false,
      label: "builder",
      room: "web",
    },
  ],
  descendants: [
    {
      address: "t3",
      pid: 13,
      occupant: "p3",
      parent: "t2",
      name: "tests",
      remote: false,
      label: "tests",
      room: "web",
    },
  ],
};
Object.assign(bridge, {
  call: async (method: string, params: Record<string, unknown> = {}) => {
    calls.push({ method, params });
    if (method === "world.core.catalog")
      return {
        kinds: ["claude", "codex"],
        readiness: [
          { kind: "claude", installed: true, logged_in: true },
          { kind: "codex", installed: true, logged_in: true },
        ],
        skills: [],
      };
    if (method === "world.core.kill_plan") return plan;
    if (method === "world.core.launch")
      return { status: "started", terminal_id: "t9", placed: false };
    return null;
  },
  connection: (connectionId: string) => ({
    connectionId,
    isCurrent: () => false,
    call: async (method: string) => {
      calls.push({ method: `${connectionId}:${method}`, params: {} });
      return null;
    },
  }),
  onControl: () => () => {},
  onStatus: () => () => {},
});

async function run() {
  const viewport = document.createElement("meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width, initial-scale=1";
  document.head.append(viewport);
  const snapshot = await (await fetch("/snapshot")).json();
  const store = new WorldRuntimeStore(
    {
      call: async () => snapshot,
      connection: () => ({ isCurrent: () => false }),
      onControl: () => () => {},
      onStatus: () => () => {},
    },
    async () => {},
  );
  await store.refresh();
  const world = buildWorldObject(store.get().connections);
  const root = document.createElement("div");
  document.body.append(root);
  const scene = new URLSearchParams(location.search).get("scene");
  if (scene === "launcher") {
    let closed = 0;
    flushSync(() =>
      createRoot(root).render(
        <AgentLauncherDialog
          world={world}
          initial={{}}
          onOpen={() => failures.push("a core terminal has no World window")}
          onEditProfiles={() => {}}
          onClose={() => {
            closed += 1;
          }}
        />,
      ),
    );
    await settle(10);
    const select = document.querySelector<HTMLSelectElement>(
      ".agent-launcher select",
    );
    const chosen = select?.selectedOptions[0]?.textContent ?? "";
    check(
      chosen.includes("herdr-core"),
      `core first: the launcher picks a core room (${chosen})`,
    );
    check(
      document.body.textContent?.includes(
        "Herdr's apps show the agent and keep it running",
      ) === true,
      "the launcher says the apps keep the agent running",
    );
    check(
      calls.some((c) => c.method === "world.core.catalog") &&
        !calls.some((c) => c.method.endsWith(":launcher.catalog")),
      `the catalog comes from world.core.catalog: ${JSON.stringify(calls)}`,
    );
    const quick = [
      ...document.querySelectorAll<HTMLButtonElement>(".agent-launcher-kind"),
    ].map((b) => b.textContent?.trim());
    check(
      quick.includes("Claude") && quick.includes("Codex"),
      `quick start offers the host's harnesses: ${JSON.stringify(quick)}`,
    );
    // Nothing starts until the person chooses; captures show this state.
    check(
      !calls.some((c) => c.method === "world.core.launch"),
      "nothing starts on open",
    );
    void closed;
    return;
  }
  if (scene === "bin") {
    flushSync(() => createRoot(root).render(<CoreKillConfirmHost />));
    const builder = world.leaves.find(
      (leaf) => leaf.agentName === "builder",
    ) as WorldLeafObject;
    check(builder?.coreControl === true, "the builder is under core control");
    // Confirmed once: the bin gets exactly the confirmed set.
    const held = putInBin(builder, "town", false);
    await settle();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    check(
      dialog?.textContent?.includes("tests (in web)") === true &&
        !dialog.textContent.includes("preview-server"),
      `the confirmation names only the sub-agent that ends: ${dialog?.textContent}`,
    );
    [...(dialog?.querySelectorAll("button") ?? [])]
      .find((b) => b.textContent === "Put in the bin")
      ?.click();
    await held;
    const add = calls.find((c) => c.method === "world.bin.add");
    check(
      JSON.stringify(add?.params.confirmation) ===
        JSON.stringify({
          core_id: "c0ffee",
          terminals: [
            { address: "t2", pid: 12, occupant: "p2" },
            { address: "t3", pid: 13, occupant: "p3" },
          ],
        }) && add?.params.runtime === "herdr-core",
      `the bin carries the confirmation: ${JSON.stringify(add?.params)}`,
    );
    // Open again for the captures.
    void putInBin(builder, "town", false);
    await settle();
    return;
  }
  failures.push(`unknown scene ${scene}`);
}

void run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
