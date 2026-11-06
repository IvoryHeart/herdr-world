import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { BoardDocumentStore } from "../board/boardDocument";
import BoardView from "../BoardView";
import { DeskBoard } from "../DeskView";
import { WorldDeskStore } from "../deskStateStore";
import { TownCanvas, type TownRoomActions } from "../town/TownCanvas";
import { buildWorldObject } from "../worldObject";
import {
  projectWorldOffice,
  TOWN_PRESENTATION_BOUNDS,
} from "../herdrOfficeProjection";
import { EMPTY_OFFICE_OBSERVABILITY } from "../officeObservability";
import { goldenConnections } from "./town-golden/scene";
import "../../styles/tokens.css";
import "../../styles/base.css";
import "../world.css";

const world = buildWorldObject(goldenConnections(), "host-0");
const empty = buildWorldObject([], null);
const noAction = () => {};
const unavailable = async () => "returned" as const;
const roomActions: TownRoomActions = {
  showCreateSeat: () => true,
  canCreateSeat: () => true,
  createSeatReason: () => null,
  onNewAgent: noAction,
  showCreateRoom: () => true,
  canCreateRoom: () => true,
  createRoomReason: () => null,
  onCreateRoom: noAction,
  canRenameRoom: () => true,
  onRenameRoom: noAction,
  canCloseRoom: () => true,
  onCloseRoom: noAction,
  onChoosePanes: noAction,
  onMoveDesk: noAction,
  onMoveAgent: noAction,
  placeColor: () => null,
  onDropDesk: unavailable,
  onReorderDesk: unavailable,
  onDropAgent: unavailable,
  onGroupDesk: unavailable,
  onUngroupDesk: unavailable,
};
const board = new BoardDocumentStore({
  call: async () => ({
    version: 1,
    revision: 1,
    layout: { anchors: {}, offsets: {}, pinned: {}, folded: [] },
    notes: [],
    strings: [],
  }),
  onControl: () => noAction,
  onStatus: () => noAction,
});
const desk = new WorldDeskStore({
  call: async () => ({ revision: 1, records: [] }),
  onControl: () => noAction,
  onStatus: () => noAction,
});
const client = {
  connectionId: "host-0",
  generation: 1,
  isCurrent: () => true,
  call: async () => ({}),
  onControl: () => noAction,
  onStatus: () => noAction,
};
const host = document.getElementById("root")!;
const root = createRoot(host);
function mount(view: string, blank = false) {
  const shown = blank ? empty : world;
  flushSync(() =>
    root.render(
      view === "town" ? (
        <TownCanvas
          projection={projectWorldOffice(
            shown,
            Date.now(),
            null,
            TOWN_PRESENTATION_BOUNDS,
          )}
          selectedKey={null}
          completionSeenKeys={new Set()}
          conversationTargets={[]}
          onSelect={noAction}
          onActivateAgent={noAction}
          onActivateRoom={noAction}
          roomActions={roomActions}
          selectedRoomKey={null}
          observability={EMPTY_OFFICE_OBSERVABILITY}
        />
      ) : view === "board" ? (
        <BoardView
          world={shown}
          selectedId={null}
          onSelect={noAction}
          onOpen={async () => {}}
          store={board}
        />
      ) : (
        <DeskBoard
          world={shown}
          client={client as never}
          onOpen={async () => {}}
          deskStore={desk}
        />
      ),
    ),
  );
}
function retainHiddenTown() {
  const element = document.createElement("div");
  element.style.cssText = "display:none;position:fixed;inset:0";
  document.body.append(element);
  flushSync(() =>
    createRoot(element).render(
      <TownCanvas
        projection={projectWorldOffice(
          world,
          Date.now(),
          null,
          TOWN_PRESENTATION_BOUNDS,
        )}
        selectedKey={null}
        completionSeenKeys={new Set()}
        conversationTargets={[]}
        onSelect={noAction}
        onActivateAgent={noAction}
        onActivateRoom={noAction}
        roomActions={roomActions}
        selectedRoomKey={null}
        observability={EMPTY_OFFICE_OBSERVABILITY}
      />,
    ),
  );
}
const fixture = {
  retainHiddenTown,
  removeAssets() {
    host
      .querySelectorAll('img[src$="never-image"]')
      .forEach((image) => image.remove());
    mount("town");
  },
  mount,
  asset(name: string) {
    const image = new Image();
    image.src = `/${name}`;
    host.querySelector(".town-shell,.board,.desk")!.append(image);
  },
  font() {
    const face = new FontFace("Capture slow font", 'url("/held-font")');
    document.fonts.add(face);
    void face.load();
  },
};
Object.assign(window, { captureFixture: fixture });
mount("town");
void fetch("/mounted");
