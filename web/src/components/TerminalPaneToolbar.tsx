import type {
  RefObject,
  PointerEventHandler,
  Dispatch,
  SetStateAction,
} from "react";
import {
  Columns2,
  Rows2,
  Minimize2,
  Maximize2,
  MessagesSquare,
  X,
} from "lucide-react";
import type { ConnectionClient } from "../api";
import type { Pane } from "../types";
import type { State, useOperationalStore } from "../store";
import { shortcutTitle } from "../shortcutPreferences";
import { setPaneView } from "../paneView";
import { PaneMoveMenu } from "./PaneMoveMenu";
export function TerminalPaneToolbar({
  s,
  pane,
  store,
  connectionClient,
  paneZoomed,
  canClosePane,
  preventPaneActionFocus,
  paneToolbarRef,
  chatAvailable,
  chatShown,
  setClosePaneRequested,
}: {
  s: Pick<
    State,
    "status" | "endpointAvailability" | "activeConnectionId" | "layout"
  >;
  pane: Pane;
  store: ReturnType<typeof useOperationalStore>;
  connectionClient: ConnectionClient;
  paneZoomed: boolean;
  canClosePane: boolean;
  preventPaneActionFocus: PointerEventHandler<HTMLButtonElement>;
  paneToolbarRef: RefObject<HTMLDivElement | null>;
  chatAvailable: boolean;
  chatShown: boolean;
  setClosePaneRequested: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <div
      className={`terminal-pane-toolbar${chatShown ? " is-over-chat" : ""}`}
      aria-label="Pane actions"
      ref={(element) => {
        paneToolbarRef.current = element;
        element?.toggleAttribute(
          "inert",
          s.status !== "connected" || !connectionClient.isCurrent(),
        );
      }}
    >
      {chatAvailable && !chatShown ? (
        <button
          type="button"
          className="terminal-pane-action"
          title={shortcutTitle("Show as a chat", "pane.chat")}
          aria-label="Show as a chat"
          onPointerDown={preventPaneActionFocus}
          onClick={() =>
            setPaneView(s.activeConnectionId, pane!.pane_id, "chat")
          }
        >
          <MessagesSquare size={14} />
        </button>
      ) : null}
      {s.endpointAvailability[pane.terminal_id] &&
      store.terminalScrollReason(pane.terminal_id) ? (
        <span
          className="muted"
          role="status"
          title={store.terminalScrollReason(pane.terminal_id) ?? undefined}
        >
          History unavailable: pane.scroll not advertised
        </span>
      ) : null}
      {!paneZoomed ? (
        <>
          <button
            type="button"
            className="terminal-pane-action"
            title="Split pane right"
            aria-label="Split pane right"
            onPointerDown={preventPaneActionFocus}
            onClick={() => store.splitPane(pane.pane_id, "right")}
          >
            <Columns2 size={14} />
          </button>
          <button
            type="button"
            className="terminal-pane-action"
            title="Split pane down"
            aria-label="Split pane down"
            onPointerDown={preventPaneActionFocus}
            onClick={() => store.splitPane(pane.pane_id, "down")}
          >
            <Rows2 size={14} />
          </button>
          <PaneMoveMenu
            paneId={pane.pane_id}
            layout={s.layout}
            onPointerDown={preventPaneActionFocus}
          />
        </>
      ) : null}
      {canClosePane || paneZoomed ? (
        <button
          type="button"
          className="terminal-pane-action"
          title={paneZoomed ? "Restore pane" : "Maximize pane"}
          aria-label={paneZoomed ? "Restore pane" : "Maximize pane"}
          onPointerDown={preventPaneActionFocus}
          onClick={() => store.zoomPane(pane.pane_id)}
        >
          {paneZoomed ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      ) : null}
      {canClosePane ? (
        <button
          type="button"
          className="terminal-pane-action is-danger"
          title="Close pane"
          aria-label="Close pane"
          onPointerDown={preventPaneActionFocus}
          onClick={() => setClosePaneRequested(true)}
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}
