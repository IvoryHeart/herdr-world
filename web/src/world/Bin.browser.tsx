import { binTownAgent } from "./town/townBin";
import { WindowControls } from "./windows/WindowControls";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { bridge, type BridgeControlMsg } from "../api";
import {
  BIN_BUS_INTERVAL_MS,
  BIN_BUS_DRIVE_MS,
  type BinEntry,
} from "../../../shared/bin";
import { EMPTY_BIN, type BinState } from "../../../shared/bin";
import { BinTray } from "./bin/BinTray";
import { sharedBinStore, putInBin } from "./bin/binStore";
import { TownCanvas, type TownRoomActions } from "./town/TownCanvas";
import {
  projectWorldOffice,
  TOWN_PRESENTATION_BOUNDS,
} from "./herdrOfficeProjection";
import { buildWorldObject } from "./worldObject";
import { goldenConnections } from "./testing/town-golden/scene";
import { EMPTY_OFFICE_OBSERVABILITY } from "./officeObservability";
import "../styles/tokens.css";
import "../styles/base.css";
import "./world.css";

window.__HERDR_WORLD_RENDERER_DEBUG__ = "counters";
const world = buildWorldObject(goldenConnections(), "host-0");
const leaf = world.leaves.find((leaf) => leaf.kind === "agent")!;
const controls = new Set<(control: BridgeControlMsg) => void>();
let now = 0;
const timers = new Set<{ at: number; run(): void }>();
const committed: BinEntry[][] = [];
const state: BinState = {
  ...EMPTY_BIN,
  epoch: "synthetic",
  bus: {
    cycle: 0,
    driving: false,
    remaining_ms: BIN_BUS_INTERVAL_MS,
    elapsed_ms: 0,
  },
};
let nextId = 1;
const publish = () => {
  state.revision++;
  for (const listener of controls)
    listener({ type: "world_bin_changed", revision: state.revision });
};
const registry = {
  list: () => structuredClone(state),
  add: (
    input: Omit<BinEntry, "id" | "trip" | "duration_ms" | "remaining_ms">,
  ) => {
    if (!state.entries.some((e) => e.terminal_id === input.terminal_id))
      state.entries.push({
        ...input,
        id: `bin-synthetic-${nextId++}`,
        trip: "scheduled",
        duration_ms: 0,
        remaining_ms: 0,
      });
    publish();
    return registry.list();
  },
  restore: (id: string) => {
    state.entries = state.entries.filter(
      (entry) => entry.id !== id || entry.boarded,
    );
    publish();
    return registry.list();
  },
  closeNow: (ids: string[]) => {
    const entries = state.entries.filter((entry) => ids.includes(entry.id));
    state.entries = state.entries.filter((entry) => !ids.includes(entry.id));
    state.closing.push(...entries.map((entry) => entry.id));
    committed.push(entries);
    publish();
    return registry.list();
  },
  settle: (id: string) => {
    state.closing = state.closing.filter((key) => key !== id);
    publish();
  },
};
const schedule = (run: () => void, delay: number) =>
  timers.add({ at: now + delay, run });
const arrive = () => {
  state.bus = {
    cycle: state.bus!.cycle + 1,
    driving: true,
    remaining_ms: BIN_BUS_DRIVE_MS,
    elapsed_ms: 0,
  };
  for (const entry of state.entries) entry.boarded = true;
  publish();
  schedule(() => {
    registry.closeNow(
      state.entries.filter((entry) => entry.boarded).map((entry) => entry.id),
    );
    state.bus = {
      cycle: state.bus!.cycle,
      driving: false,
      remaining_ms: BIN_BUS_INTERVAL_MS - BIN_BUS_DRIVE_MS,
      elapsed_ms: 0,
    };
    publish();
    schedule(arrive, BIN_BUS_INTERVAL_MS - BIN_BUS_DRIVE_MS);
  }, BIN_BUS_DRIVE_MS);
};
schedule(arrive, BIN_BUS_INTERVAL_MS);
bridge.onControl = (listener) => {
  controls.add(listener);
  return () => {
    controls.delete(listener);
  };
};
bridge.onStatus = (listener) => {
  listener("connected");
  return () => {};
};
const nativeCall = bridge.call.bind(bridge);
bridge.call = async (method, params = {}) => {
  if (method === "world.bin.add") return registry.add(params as never);
  if (method === "world.bin.restore")
    return registry.restore(String(params.id));
  if (method === "world.bin.close_now")
    return registry.closeNow(params.ids as string[]);
  if (method === "world.bin.list") return registry.list();
  return nativeCall(method, params);
};
const noAction = () => {};
const unavailable = async () => "returned" as const;
const roomActions: TownRoomActions = {
  showCreateSeat: () => false,
  canCreateSeat: () => false,
  createSeatReason: () => null,
  onNewAgent: noAction,
  showCreateRoom: () => false,
  canCreateRoom: () => false,
  createRoomReason: () => null,
  onCreateRoom: noAction,
  canRenameRoom: () => false,
  onRenameRoom: noAction,
  canCloseRoom: () => false,
  onCloseRoom: noAction,
  onChoosePanes: noAction,
  onMoveDesk: noAction,
  onMoveAgent: noAction,
  placeColor: () => null,
  onDropDesk: unavailable,
  onReorderDesk: unavailable,
  onDropAgent: unavailable,
  onBinAgent: (key) => binTownAgent(world, projection, key),
  onGroupDesk: unavailable,
  onUngroupDesk: unavailable,
};
const projection = projectWorldOffice(world, 1, null, TOWN_PRESENTATION_BOUNDS);
function App() {
  const [selected, setSelected] = useState(leaf.id);
  return (
    <main style={{ position: "fixed", inset: 0 }}>
      <TownCanvas
        projection={projection}
        selectedKey={
          projection.roster.find((item) => item.agent.nodeId === leaf.id)!.agent
            .key
        }
        completionSeenKeys={new Set()}
        conversationTargets={[]}
        onSelect={(key) =>
          setSelected(
            projection.roster.find((item) => item.agent.key === key)?.agent
              .nodeId ?? leaf.id,
          )
        }
        onActivateAgent={noAction}
        onActivateRoom={noAction}
        roomActions={roomActions}
        selectedRoomKey={null}
        observability={EMPTY_OFFICE_OBSERVABILITY}
      />
      <BinTray world={world} selectedId={selected} view="town" />
      <div style={{ position: "fixed", top: 0, right: 0 }}>
        <WindowControls
          label="synthetic agent"
          controls={{
            compact: innerWidth < 640,
            maximized: false,
            onMinimize: noAction,
            onMaximize: noAction,
            onClose: noAction,
            onSnap: noAction,
            onFloat: noAction,
            bin: {
              onBin: () => {
                void putInBin(leaf, world, "town");
              },
            },
          }}
        />
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
const wait = (find: () => Element | null | undefined) =>
  new Promise<Element>((resolve, reject) => {
    const present = find();
    if (present) return resolve(present);
    const observer = new MutationObserver(() => {
      const value = find();
      if (value) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(value);
      }
    });
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error("bin fixture did not update"));
    }, 15000);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  });
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === text,
  );
const closeTray = () =>
  document
    .querySelector<HTMLButtonElement>('[aria-label="Close bin"]')!
    .click();
const advance = (ms: number) => {
  now += ms;
  for (const timer of [...timers])
    if (timer.at <= now) {
      timers.delete(timer);
      timer.run();
    }
};
let committedBeforeDrag = 0;
Object.assign(window, {
  binDebug: () => ({
    renderer: window.__HERDR_TOWN_RENDERER__,
    level: document.querySelector(".town-world")?.getAttribute("data-level"),
    bin: sharedBinStore().get(),
    registry: registry.list(),
    leaf,
    html: document.body.textContent?.slice(-1200),
  }),
  binDragPrepare: async () => {
    committedBeforeDrag = committed.length;
    await wait(() =>
      window.__HERDR_TOWN_RENDERER__?.ready
        ? document.querySelector("canvas[data-office-canvas]")
        : null,
    );
    const agentKey = projection.roster.find(
      (item) => item.agent.nodeId === leaf.id,
    )!.agent.key;
    const target = [
      ...document.querySelectorAll<HTMLElement>(
        '.world-semantic-target[data-kind="agent"]',
      ),
    ].find((node) => node.dataset.targetKey === agentKey)!;
    target.focus();
    const initial = target.getBoundingClientRect();
    const host = document.querySelector<HTMLElement>(".town-canvas-host")!;
    host.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -2000,
        clientX: initial.left + initial.width / 2,
        clientY: initial.top + initial.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait(() => document.querySelector('.town-world[data-level="desk"]'));
    const current = [
      ...document.querySelectorAll<HTMLElement>(
        '.world-semantic-target[data-kind="agent"]',
      ),
    ].find((node) => node.dataset.targetKey === agentKey)!;
    current.blur();
    current.focus();
    await wait(() =>
      !window.__HERDR_TOWN_RENDERER__!.flying &&
      current.getBoundingClientRect().left >= 0
        ? current
        : null,
    );
    const box = current.getBoundingClientRect();
    const bin = document
      .querySelector<HTMLElement>("[data-agent-bin-drop]")!
      .getBoundingClientRect();
    const from = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const to = { x: bin.left + bin.width / 2, y: bin.top + bin.height / 2 };
    return { from, to };
  },
  binDragCheck: async () => {
    await wait(() => button("Put back"));
    const entry = registry.list().entries[0];
    const valid =
      entry?.connection_id === leaf.connectionId &&
      entry?.connection_generation === leaf.generation &&
      entry?.pane_id === leaf.pane.pane_id &&
      committed.length === committedBeforeDrag;
    button("Put back")!.click();
    await wait(() =>
      !registry.list().entries.length
        ? document.querySelector(".world-bin-tray")
        : null,
    );
    closeTray();
    return valid;
  },
  binPreview: async () => {
    document
      .querySelector<HTMLButtonElement>('[aria-label="Show the whole town"]')
      ?.click();
    await putInBin(leaf, world, "town");
    await wait(() => document.querySelector(".world-bin-tray li"));
  },
  binChecks: async () => {
    const failures: string[] = [];
    const before = committed.length;
    const check = (ok: boolean, label: string) => {
      if (!ok) failures.push(label);
    };
    if (!registry.list().entries.length) await putInBin(leaf, world, "town");
    await wait(() => button("Put back"));
    check(
      document
        .querySelector(".world-bin-tray")!
        .textContent!.includes("Next bus in"),
      "tray shows shared schedule",
    );
    button("Put back")!.click();
    await wait(() =>
      document.querySelector(".world-bin-tray p") &&
      registry.list().entries.length === 0
        ? document.querySelector(".world-bin-tray")
        : null,
    );
    check(committed.length === before, "Put back sent a close");
    closeTray();
    document.querySelector<HTMLButtonElement>(".town-bus-stop")!.click();
    await wait(() => document.querySelector(".world-bin-tray"));
    closeTray();
    document
      .querySelector<HTMLButtonElement>(
        '[aria-label="More actions for synthetic agent"]',
      )!
      .click();
    const menuBin = await wait(() =>
      document
        .querySelector('[role="menuitem"]')
        ?.textContent?.includes("Put in bin")
        ? document.querySelector('[role="menuitem"]')
        : null,
    );
    (menuBin as HTMLButtonElement).click();
    await wait(() =>
      button("Close now") && !button("Close now")!.disabled
        ? button("Close now")
        : null,
    );
    button("Close now")!.click();
    await wait(() =>
      committed.length > before
        ? document.querySelector(".world-bin-tray")
        : null,
    );
    check(
      committed[before]?.[0]?.connection_id === leaf.connectionId &&
        committed[before]?.[0]?.connection_generation === leaf.generation,
      "close lost connection fence",
    );
    registry.settle(committed[before]![0]!.id);
    await putInBin(leaf, world, "board");
    closeTray();
    advance(BIN_BUS_INTERVAL_MS);
    await sharedBinStore().refresh();
    const bus = await wait(() =>
      document.querySelector<HTMLButtonElement>(".town-scheduled-bus"),
    );
    (bus as HTMLButtonElement).click();
    await wait(() =>
      button("Put back")?.disabled ? button("Put back") : null,
    );
    advance(BIN_BUS_DRIVE_MS);
    await sharedBinStore().refresh();
    check(
      committed.length === before + 2,
      "scheduled bus did not commit its riders after leaving",
    );
    check(
      document.documentElement.scrollWidth <= innerWidth,
      "bin tray overflows viewport",
    );
    registry.settle(committed[committed.length - 1]![0]!.id);
    await sharedBinStore().refresh();
    closeTray();
    return failures;
  },
});
void wait(() => document.querySelector("canvas[data-office-canvas]")).then(() =>
  fetch("/ready"),
);
