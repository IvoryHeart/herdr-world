import { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { bridge, type BridgeControlMsg } from "../api";
import { buildWorldObject } from "./worldObject";
import { projectWorldOffice } from "./herdrOfficeProjection";
import type { WorldRuntimeConnection } from "./runtimeStore";
import type { AgentAddress } from "../../../shared/agentMove";
import type { BoardDocument } from "./board/boardDocument";
import { townModelFromProjection } from "./town/townModel";
import { townDragFor, townDropTarget } from "./town/townDrag";
import { townMoveActions, type TownMoveConfirm } from "./town/townMoveActions";
import type { TownMoveFlow } from "./town/townMoveMenu";
import { TownTargets } from "./town/TownAccessibleTargets";
import { townTargets } from "./town/townTargets";
import { layoutTown, townShapeFor } from "./town/townLayout";
import { NO_TRACE } from "./devtools/flag";
import { TerminalAppearanceEditor } from "./TerminalAppearanceEditor";
import { TERMINAL_COLOR_PALETTE } from "./terminalColor";
import { AgentMoveForm } from "./AgentMoveControl";
import { waitForElement } from "./testing/waitForElement";
import "./appearance.css";

const failures: string[] = [];
const check = (v: unknown, message: string) => {
  if (!v) throw new Error(message);
};
const controls = new Set<(c: BridgeControlMsg) => void>();
let moved = Promise.withResolvers<{
  status: string;
  message: string;
  target?: AgentAddress;
}>();
Object.assign(bridge, {
  call: async (method: string, params: Record<string, unknown>) => {
    const reply = await (
      await fetch("/rpc", {
        method: "POST",
        body: JSON.stringify({ method, params }),
      })
    ).json();
    if (reply.error) {
      if (method === "world.agent.move") moved.reject(new Error(reply.error));
      throw new Error(reply.error);
    }
    if (method === "world.agent.move") moved.resolve(reply.result);
    if (method === "world.appearance.patch")
      for (const control of controls)
        control({
          type: "world_board_changed",
          revision: reply.result.document.revision,
        });
    return reply.result;
  },
  onControl: (c: (c: BridgeControlMsg) => void) => {
    controls.add(c);
    return () => controls.delete(c);
  },
  onStatus: () => () => {},
});
window.addEventListener("error", (e) => failures.push(String(e.error)));
window.addEventListener("unhandledrejection", (e) =>
  failures.push(String(e.reason)),
);
type State = {
  connections: WorldRuntimeConnection[];
  board: BoardDocument;
  initial: AgentAddress;
};
const getState = async (): Promise<State> => (await fetch("/state")).json();
let notice = "";
function Scene({ state, source }: { state: State; source: AgentAddress }) {
  const world = buildWorldObject(state.connections);
  const office = projectWorldOffice(world, Date.now());
  const model = townModelFromProjection(office);
  const layout = layoutTown(
    model.input,
    townShapeFor(1400, 900),
    new Map(),
    new Map(),
  ).layout;
  const [moveFlow, setMoveFlow] = useState<TownMoveFlow | null>(null);
  const [movingKey, setMovingKey] = useState<string | null>(null);
  const [moveConfirm, setMoveConfirm] = useState<TownMoveConfirm | null>(null);
  const actions = townMoveActions({
    moveFlow,
    setMoveFlow,
    movingKey,
    setMovingKey,
    moveConfirm,
    setMoveConfirm,
    world,
    office,
    deskPins: {},
    relations: [],
    terminalColors: {},
    agentByKey: new Map(
      office.roster.map(({ agent }) => [agent.key, { agent }]),
    ),
    roomForKey: (key) => office.rooms.find((r) => r.key === key) ?? null,
    toast: (_kind, text) => {
      notice = text;
    },
    trace: NO_TRACE,
  });
  const host = state.connections.find(
    (h) => h.connectionId === source.connection_id,
  )!;
  return (
    <>
      <TownTargets
        targets={townTargets(model, layout)}
        selectedKey={null}
        onSelect={() => {}}
        onActivate={() => {}}
        onActivateRoom={() => {}}
        onFocusTarget={() => {}}
        onMoveTarget={(kind, key) =>
          setMoveFlow(
            kind === "desk"
              ? { step: "room", deskKey: key }
              : { step: "desk", agentKey: key },
          )
        }
      />
      {actions.dialogs}
      <TerminalAppearanceEditor
        key={source.terminal_id}
        connectionId={source.connection_id}
        generation={source.generation}
        tabId={source.tab_id}
        paneId={source.pane_id}
        terminalId={source.terminal_id}
        workspaceIds={host.snapshot!.workspaces.map((w) => w.workspace_id)}
        tabName="Traveller"
        color={{
          palette: TERMINAL_COLOR_PALETTE,
          current: { id: "teal", custom: true },
          onColor() {},
        }}
      />
      <AgentMoveForm
        key={source.terminal_id + "move"}
        source={source}
        connections={state.connections}
      />
    </>
  );
}
const buttons = () => [
  ...document.querySelectorAll<HTMLButtonElement>("button"),
];
async function run() {
  const root = createRoot(
    document.body.appendChild(document.createElement("main")),
  );
  let state = await getState(),
    source = state.initial;
  const destinations = [
    { connection: "core-local", label: "Core one" },
    { connection: "core-local", label: "Core two" },
    { connection: "tui", label: "TUI room" },
  ];
  for (const destination of destinations) {
    const previous = source;
    state = await getState();
    const world = buildWorldObject(state.connections),
      office = projectWorldOffice(world, Date.now());
    const desk = office.deskRoster.find(
      ({ desk }) =>
        desk.tabRef.connectionId === source.connection_id &&
        desk.tabRef.nativeId === source.tab_id,
    )!.desk;
    const room = office.rooms.find(
      (r) =>
        r.workspaceRef.connectionId === destination.connection &&
        r.displayLabel === destination.label,
    )!;
    const model = townModelFromProjection(office);
    const drag = townDragFor({ kind: "desk", key: desk.key }, model, "room");
    check(drag, `${source.connection_id} desk can be picked up`);
    check(
      townDropTarget(drag!, { kind: "room", key: room.key }, model).key ===
        room.key,
      `desk can be dropped in ${destination.label}: ${JSON.stringify({ desk, room, target: townDropTarget(drag!, { kind: "room", key: room.key }, model) })}`,
    );
    flushSync(() => root.render(<Scene state={state} source={source} />));
    // The keyboard menu shares Town's drop action, and can target empty core rooms.
    const target = await waitForElement(
      document.body,
      () => buttons().find((b) => b.dataset.targetKey === desk.key),
      "desk target missing",
    );
    flushSync(() =>
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key: "m", bubbles: true }),
      ),
    );
    const choice = await waitForElement(
      document.body,
      () =>
        buttons().find(
          (b) =>
            b.closest(".town-chooser-list") &&
            b.querySelector("span")?.textContent === destination.label,
        ),
      `missing room choice ${destination.label}`,
    );
    moved = Promise.withResolvers();
    flushSync(() => choice.click());
    const confirmation = buttons().find(
      (b) => b.textContent === "Move and close room",
    );
    if (confirmation) flushSync(() => confirmation.click());
    const result = await moved.promise;
    check(
      result.status === "moved",
      `${source.connection_id} → ${destination.connection}: ${JSON.stringify(result)}; ${notice}`,
    );
    source = result.target!;
    check(
      source.workspace_id === room.workspaceRef.nativeId,
      "native destination room matches",
    );
    state = await getState();
    check(
      state.board.layout.pinned[source.color_key]?.x === 120,
      "Board pin follows",
    );
    check(
      state.board.relations?.spawns.some(
        (s) =>
          s.child.connection_id === source.connection_id &&
          s.child.terminal_id === source.terminal_id,
      ),
      "spawned-by follows",
    );
    if (destination.label === "Core one") {
      flushSync(() => root.render(<Scene state={state} source={source} />));
      flushSync(() =>
        buttons()
          .find((b) => b.getAttribute("aria-label") === "Colour teal")!
          .click(),
      );
      await waitForElement(
        document.body,
        () =>
          [...document.querySelectorAll("[role=status]")].find(
            (e) => e.textContent === "Tab colour saved",
          ),
        "core colour save failed",
      );
      // The same core offers its other room in the Settings control too.
      flushSync(() =>
        buttons()
          .find((b) => b.textContent === "Move to…")!
          .click(),
      );
      check(
        [...document.querySelectorAll("option")].some((o) =>
          o.textContent?.includes("Core two"),
        ),
        "Move to offers another room on core-local",
      );
    } else
      check(
        state.board.layout.colors?.[source.color_key] === "teal",
        "colour follows subsequent moves",
      );
    check(
      !state.connections
        .find((h) => h.connectionId === previous.connection_id)!
        .snapshot!.panes.some((p) => p.terminal_id === previous.terminal_id),
      "old terminal closes after the verified resume",
    );
  }
  root.unmount();
}
void run()
  .catch((e) => failures.push(String(e)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
