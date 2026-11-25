import { createRoot } from "react-dom/client";
import { bridge } from "../api";
import type { BoardDocument } from "./board/boardDocument";
import "../styles/tokens.css";
import "../styles/base.css";
import "./world.css";

// The whole World on a synthetic copy of one real machine's topology (#1198):
// two Herdr TUI connections on one socket (a startup default and a saved
// profile), a herdr-core and an unreachable SSH remote, from the server's
// read model. `?townBuildings=machine|runtime` picks the layout. The page
// only renders and records; the runner drives it with real pointer input
// (TownOwnerTopology.browser.test.ts). Nothing reaches a runtime.

const failures: string[] = [];
window.addEventListener("error", (event) => failures.push(String(event.error)));
const consoleError = console.error;
console.error = (...args: unknown[]) => {
  failures.push(args.map(String).join(" ").slice(0, 400));
  consoleError(...args);
};

const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
// The runner releases the catalog after Terminal first appears. Its paint
// recentres the dialog; the click must use the resulting geometry.
const catalogReady = Promise.withResolvers<void>();
const controls = new Set<(control: Record<string, unknown>) => void>();
const observed: { snapshot: unknown; started: unknown } = {
  snapshot: null,
  started: null,
};

/** The one room moved by hand: a saved spot in its building (Board layout). */
const boardDocument: BoardDocument = {
  version: 1,
  revision: 1,
  layout: {
    anchors: {},
    offsets: {},
    pinned: {},
    folded: [],
    colors: {},
    room_pins: { "tui-default:w03": { x: 2, y: 9 } },
  },
  notes: [],
  strings: [],
  relations: { spawns: [], groups: [] },
};

Object.assign(bridge, {
  call: async (method: string, params: Record<string, unknown> = {}) => {
    calls.push({ method, params });
    if (method === "world.snapshot") return observed.snapshot;
    if (method === "world.board.get") return structuredClone(boardDocument);
    if (method === "world.core.catalog") {
      await catalogReady.promise;
      return {
        kinds: ["claude", "codex"],
        readiness: [
          { kind: "claude", installed: true, logged_in: true },
          { kind: "codex", installed: true, logged_in: true },
        ],
        skills: [],
      };
    }
    if (method === "world.core.launch") {
      // The service invalidates World's observation before it answers.
      observed.snapshot = observed.started;
      for (const listener of controls)
        listener({
          type: "world_invalidated",
          connection_id: "core-local",
          connection_generation: 1,
        });
      return { status: "started", terminal_id: "t9", placed: false };
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
  connection: (connectionId: string, generation?: number) => ({
    connectionId,
    // Both TUI views hold their current generation; the remote never does.
    isCurrent: () => connectionId.startsWith("tui-") && generation === 1,
    call: async (method: string, params: Record<string, unknown> = {}) => {
      calls.push({
        method: `${connectionId}@${generation}:${method}`,
        params,
      });
      // Herdr's workspace order, for a room move's ordering (the runner's
      // rooms w01..w18); herdr-core has none and is never asked.
      if (connectionId.startsWith("tui-") && method === "workspace.list")
        return {
          workspaces: Array.from({ length: 18 }, (_, index) => ({
            workspace_id: `w${String(index + 1).padStart(2, "0")}`,
            number: index + 1,
          })),
        };
      return null;
    },
  }),
  onControl: (listener: (control: Record<string, unknown>) => void) => {
    controls.add(listener);
    return () => controls.delete(listener);
  },
  onStatus: () => () => {},
});

declare global {
  interface Window {
    __ownerTopology?: {
      failures: string[];
      calls: typeof calls;
      releaseCatalog(): void;
    };
    __pointerTarget?: EventTarget | null;
  }
}
window.__ownerTopology = {
  failures,
  calls,
  releaseCatalog: catalogReady.resolve,
};
// Where the runner's last real pointer move landed, by the browser's own
// hit test (headless Chrome leaves `:hover` behind after camera moves).
addEventListener(
  "pointermove",
  (event) => {
    window.__pointerTarget = event.target;
  },
  true,
);
// Town's renderer counters (level, flights), for the runner's waits.
window.__HERDR_WORLD_RENDERER_DEBUG__ = "counters";

/** Both TUI connections name this socket: one Herdr endpoint, two views. */
const socket = {
  type: "local" as const,
  control_socket_path: "/run/herdr-fixture/herdr.sock",
  client_socket_path: "/run/herdr-fixture/herdr-client.sock",
};

async function run() {
  const mode = new URLSearchParams(location.search).get("townBuildings");
  const [before, started] = await Promise.all(
    ["/snapshot", "/snapshot?started=t9"].map(async (path) =>
      (await fetch(path)).json(),
    ),
  );
  observed.snapshot = before;
  observed.started = started;
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
  // The Town Master's greeting would sit over what the runner presses.
  quietGreetingForTest();
  history.replaceState(null, "", `/?townBuildings=${mode}`);
  initializeLayoutPreferences();
  initializeShortcutPreferences();
  store.init = () => {};
  const tui = (id: string, is_default: boolean, source: string) => ({
    id,
    label: "herdr-world-linux",
    source,
    state: "ready" as const,
    generation: 1,
    is_default,
    read_only: false,
    ...socket,
  });
  __storeTesting.replaceState({
    ...store.get(),
    ...emptyServerSessionState(1),
    status: "connected",
    catalogueReady: true,
    activeConnectionId: "tui-default",
    defaultConnectionId: "tui-default",
    connections: [
      tui("tui-default", true, "startup-default"),
      tui("tui-profile", false, "local-profile"),
      {
        id: "remote",
        label: "dev.example.test",
        source: "ssh-profile",
        state: "error",
        generation: 1,
        is_default: false,
        error: { message: "ssh: connect to host dev.example.test: timed out" },
        type: "ssh",
        ssh_destination: "dev.example.test",
        remote_control_socket_path: "/run/herdr-fixture/herdr.sock",
        remote_client_socket_path: "/run/herdr-fixture/herdr-client.sock",
      },
    ],
    coreConnections: [
      {
        id: "core-local",
        label: "herdr-core",
        type: "local",
        runtime: "herdr-core",
        state: "ready",
        generation: 1,
        core_session: "fixture",
        core_state_dir: "",
        auto_connect: true,
        read_only: false,
      },
    ],
  });
  await worldRuntimeStore.refresh();
  const root = document.createElement("div");
  document.body.append(root);
  createRoot(root).render(<WorldFoundationApp />);
  for (let attempt = 0; attempt < 400; attempt++) {
    const renderer = window.__HERDR_TOWN_RENDERER__;
    if (
      renderer?.ready &&
      !renderer.flying &&
      document.querySelectorAll(".town-room-plaque").length > 0
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  failures.push("Town never drew the owner topology");
}

void run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
