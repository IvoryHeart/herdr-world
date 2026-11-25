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
// room chosen; `?scene=bin` puts an agent with sub-agents in the bin;
// `?scene=start` renders the whole World and starts a shell and an agent
// with one click each (#1075). Every call is recorded; the page reaches no
// runtime.

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
/** What World observes (`?scene=start`): before, then after each start. */
const observed: {
  snapshot: unknown;
  started: Map<string, unknown>;
  launched: boolean;
} = {
  snapshot: null,
  started: new Map(),
  launched: false,
};
const controls = new Set<(control: Record<string, unknown>) => void>();
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
    if (method === "world.snapshot") return observed.snapshot;
    if (method === "world.core.launch") {
      // A shell is t9, an agent t10; the service invalidates World's
      // observation before it answers, as world.core.launch does.
      const address =
        params.shell !== true ? "t10" : observed.launched ? "t11" : "t9";
      if (params.shell === true) observed.launched = true;
      if (observed.started.has(address)) {
        observed.snapshot = observed.started.get(address);
        for (const listener of controls)
          listener({
            type: "world_invalidated",
            connection_id: "core-fixture",
            connection_generation: 1,
          });
      }
      return { status: "started", terminal_id: address, placed: false };
    }
    if (method === "world.core.watch")
      return {
        stream: String(params.stream),
        grid: { cols: 80, rows: 24 },
        moved_from: null,
      };
    if (method === "world.core.hold") return { held: true };
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
  onControl: (listener: (control: Record<string, unknown>) => void) => {
    controls.add(listener);
    return () => controls.delete(listener);
  },
  onStatus: () => () => {},
});

/**
 * One click on a room's + and one on Terminal start a core shell and open
 * its window; one more pair starts an agent and opens it (#1075). The page
 * is the whole World, on the server's core read model.
 */
async function startScene() {
  const width = Number(await (await fetch("/viewport-ready")).text());
  check(window.innerWidth === width, `viewport ${window.innerWidth}/${width}`);
  const [before, shell, agent, hidden] = await Promise.all(
    [
      "/snapshot",
      "/snapshot?started=t9",
      "/snapshot?started=t9,t10",
      "/snapshot?started=t9,t10,t11",
    ].map(async (path) => (await fetch(path)).json()),
  );
  observed.snapshot = before;
  observed.started.set("t9", shell);
  observed.started.set("t10", agent);
  observed.started.set("t11", hidden);
  const [
    { __storeTesting, emptyServerSessionState, store },
    { worldRuntimeStore },
    { initializeLayoutPreferences },
    { initializeShortcutPreferences },
    { quietGreetingForTest },
    { default: WorldFoundationApp },
    { writeHostsFilter },
    { requestAgentLaunch, WORLD_AGENT_LAUNCH_EVENT },
  ] = await Promise.all([
    import("../store"),
    import("./runtimeStore"),
    import("../layoutPreferences"),
    import("../shortcutPreferences"),
    import("./townMasterGreeting"),
    import("./WorldFoundationApp"),
    import("./hostsFilter"),
    import("./agentProfiles"),
  ]);
  // The core room a + asks the launcher for, to ask again once hidden.
  let room: Record<string, unknown> | undefined;
  window.addEventListener(WORLD_AGENT_LAUNCH_EVENT, (event) => {
    room ??= (event as CustomEvent<Record<string, unknown>>).detail;
  });
  // The Town Master's greeting would sit over what this presses.
  quietGreetingForTest();
  history.replaceState(null, "", "/");
  initializeLayoutPreferences();
  initializeShortcutPreferences();
  store.init = () => {};
  const id = "core-fixture";
  __storeTesting.replaceState({
    ...store.get(),
    ...emptyServerSessionState(1),
    status: "connected",
    catalogueReady: true,
    activeConnectionId: id,
    defaultConnectionId: id,
    connections: [
      {
        id,
        label: "Fixture core",
        source: "local-profile",
        state: "ready",
        generation: 1,
        is_default: true,
      },
      {
        id: "core-beta",
        label: "Beta core",
        source: "local-profile",
        state: "ready",
        generation: 1,
        is_default: false,
      },
    ],
  });
  await worldRuntimeStore.refresh();
  // Hosts shows the fixture core first; beta is hidden until the last start.
  writeHostsFilter(["core-fixture"]);
  const root = document.createElement("div");
  document.body.append(root);
  createRoot(root).render(<WorldFoundationApp />);
  const until = async (condition: () => unknown, label: string) => {
    for (let attempt = 0; attempt < 300; attempt++) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`timed out: ${label}`);
  };
  // A managed window showing the started terminal's core watch.
  const windowOf = (address: string) =>
    [
      ...document.querySelectorAll<HTMLElement>(
        `[data-window-id] [data-core-watch="${address}"]`,
      ),
    ].find((element) => element.getBoundingClientRect().height > 0);
  const start = async (choose: () => HTMLButtonElement | undefined) => {
    const add = () =>
      document.querySelector<HTMLButtonElement>(
        '.town-new-seat[aria-label^="New agent or terminal in"]:not(:disabled)',
      );
    await until(add, "a core room's + in Town");
    add()!.click();
    await until(choose, "the launcher's choice");
    choose()!.click();
  };
  // One click on +, one on Terminal: the shell starts and its window opens.
  await start(
    () =>
      document.querySelector<HTMLButtonElement>(
        ".agent-launcher-card:not(:disabled)",
      ) ?? undefined,
  );
  await until(() => windowOf("t9"), "the started shell's window opens");
  check(
    calls.filter((c) => c.method === "world.core.launch").length === 1,
    "one click started one shell",
  );
  check(
    calls.some(
      (c) => c.method === "world.core.watch" && c.params.address === "t9",
    ),
    "the shell's window watches the started terminal",
  );
  check(
    !document.querySelector(".agent-launcher"),
    "the launcher closed after the start",
  );
  // The same for an agent: its window opens on the started agent.
  await start(() =>
    [
      ...document.querySelectorAll<HTMLButtonElement>(".agent-launcher-kind"),
    ].find((button) => button.textContent?.trim() === "Claude"),
  );
  await until(() => windowOf("t10"), "the started agent's window opens");
  check(
    calls.filter((c) => c.method === "world.core.launch").length === 2,
    "one click started one agent",
  );
  // Hosts now shows only beta; the launcher still offers the hidden host's room,
  // and a start there opens its window from the unfiltered World.
  const seats = () => document.querySelectorAll(".town-new-seat").length;
  const shown = seats();
  writeHostsFilter(["core-beta"]);
  await until(() => seats() !== shown, "the Hosts filter hides the core");
  check(room?.connectionId === "core-fixture", "the + asked for the core room");
  requestAgentLaunch(room ?? {});
  const card = () =>
    document.querySelector<HTMLButtonElement>(
      ".agent-launcher-card:not(:disabled)",
    ) ?? undefined;
  await until(card, "the launcher on the hidden host's room");
  card()!.click();
  await until(
    () => windowOf("t11"),
    "the shell started on a hidden host opens its window",
  );
  const launches = calls.filter((c) => c.method === "world.core.launch");
  check(
    launches.length === 3 &&
      launches[2]!.params.connection_id === "core-fixture",
    `one click started the hidden host's shell: ${JSON.stringify(launches[launches.length - 1]?.params)}`,
  );
}

/**
 * Cmd+K finds a herdr-core agent and opens its terminal in the view it was
 * opened in, never changing the view (#1356), with real input from the test
 * (Chrome's own mouse and keys, so focus moves as it does for a person): in
 * Town, Board and Desk by Shift+Enter and the row's Open terminal button, in
 * Code by choosing it (Code cannot show it), and in Spaces by choosing it.
 */
async function findScene() {
  const width = Number(await (await fetch("/viewport-ready")).text());
  check(window.innerWidth === width, `viewport ${window.innerWidth}/${width}`);
  observed.snapshot = await (await fetch("/snapshot")).json();
  const [
    { __storeTesting, emptyServerSessionState, store },
    { worldRuntimeStore },
    { initializeLayoutPreferences },
    { initializeShortcutPreferences },
    { quietGreetingForTest },
    { default: WorldFoundationApp },
  ] = await Promise.all([
    import("../store"),
    import("./runtimeStore"),
    import("../layoutPreferences"),
    import("../shortcutPreferences"),
    import("./townMasterGreeting"),
    import("./WorldFoundationApp"),
  ]);
  quietGreetingForTest();
  history.replaceState(null, "", "/");
  initializeLayoutPreferences();
  initializeShortcutPreferences();
  store.init = () => {};
  const id = "core-fixture";
  __storeTesting.replaceState({
    ...store.get(),
    ...emptyServerSessionState(1),
    status: "connected",
    catalogueReady: true,
    activeConnectionId: id,
    defaultConnectionId: id,
    connections: [
      {
        id,
        label: "Fixture core",
        source: "local-profile",
        state: "ready",
        generation: 1,
        is_default: true,
      },
    ],
  });
  await worldRuntimeStore.refresh();
  const root = document.createElement("div");
  document.body.append(root);
  createRoot(root).render(<WorldFoundationApp />);
  const until = async (condition: () => unknown, label: string) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`timed out: ${label}`);
  };
  const input = (body: Record<string, unknown>) =>
    fetch("/input", { method: "POST", body: JSON.stringify(body) });
  const clickAt = async (element: Element) => {
    const box = element.getBoundingClientRect();
    await input({
      click: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
    });
  };
  const row = (name: string) =>
    [...document.querySelectorAll<HTMLElement>("[cmdk-item]")].find(
      (item) =>
        item.dataset.value?.includes("world-find-") &&
        item
          .querySelector(".command-item-title")
          ?.textContent?.startsWith(`${name} ·`) === true,
    );
  const spacesShows = (address: string) =>
    document.querySelector(".spaces-core-name") !== null &&
    store.get().notice === null &&
    document.querySelector(`.spaces-core [data-core-watch="${address}"]`) !==
      null;
  const view = () =>
    document.querySelector<HTMLSelectElement>('select[aria-label="World view"]')
      ?.value;
  const setView = async (next: string) => {
    const select = document.querySelector<HTMLSelectElement>(
      'select[aria-label="World view"]',
    )!;
    select.value = next;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => view() === next, `the ${next} view`);
  };
  const find = async (name: string) => {
    await input({ key: "k" });
    await until(
      () => document.querySelector(".command-popover input"),
      "the command box opens",
    );
    await input({ text: name });
    await until(
      () => row(name),
      `the box finds ${name}: ${JSON.stringify([...document.querySelectorAll("[cmdk-item]")].map((item) => item.textContent))} input=${document.querySelector<HTMLInputElement>(".command-popover input")?.value}`,
    );
    await settle();
  };
  await until(
    () => document.querySelector(".town-new-seat"),
    "Town shows the core",
  );
  await settle(10);
  const windowShows = (address: string) =>
    document.querySelector(
      `[data-window-id] [data-core-watch="${address}"]`,
    ) !== null && store.get().notice === null;
  const closeWindows = async () => {
    for (const close of document.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Close Inspector window"]',
    ))
      close.click();
    await until(
      () => !document.querySelector("[data-window-id] [data-core-watch]"),
      "the windows close",
    );
  };
  for (const [where, how, name, address] of [
    ["town", "shift-enter", "builder", "t2"],
    ["town", "button", "reviewer", "t1"],
    ["board", "shift-enter", "reviewer", "t1"],
    ["desk", "button", "builder", "t2"],
    ["code", "enter", "reviewer", "t1"],
    ["spaces", "enter", "builder", "t2"],
  ] as const) {
    store.clearNotice();
    await setView(where);
    await settle(10);
    if (where !== "spaces") await closeWindows();
    await find(name);
    if (how === "button")
      await clickAt(
        row(name)!.querySelector<HTMLElement>(".command-item-secondary")!,
      );
    else await input({ key: how === "enter" ? "Enter" : "Shift+Enter" });
    await settle(20);
    const shown = where === "spaces" ? spacesShows : windowShows;
    check(
      view() === where && shown(address),
      `${where}: ${how} on ${name} did not open its terminal in ${where} (view ${view()}, window ${document.querySelector("[data-window-id] [data-core-watch]")?.getAttribute("data-core-watch") ?? "none"}, Spaces shows ${document.querySelector(".spaces-core-name")?.textContent ?? "no core terminal"}, notice ${JSON.stringify(store.get().notice)})`,
    );
    if (document.querySelector(".command-popover"))
      await input({ key: "Escape" });
    await settle();
  }
}
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
  if (scene === "start") return startScene();
  if (scene === "find") return findScene();
  if (scene === "launcher") {
    let closed = 0;
    flushSync(() =>
      createRoot(root).render(
        <AgentLauncherDialog
          world={world}
          initial={{}}
          onOpen={() => failures.push("nothing opens before a start")}
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
    fetch("/result", {
      method: "POST",
      body: JSON.stringify(failures),
    }),
  );
