import { StrictMode, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { worldLocalStorage } from "../browserStorage";
import WorldFloatingTerminalWindow from "./WorldFloatingTerminal";
import { FLOATING_TERMINAL_GEOMETRY_KEY } from "./floatingTerminalPreferences";
import type { WorldInspectorConversation } from "./worldTerminalPresentation";
import "./world.css";

const failures: string[] = [];
window.addEventListener("error", (event) => {
  failures.push(
    event.error instanceof Error ? event.error.message : event.message,
  );
});

const first: WorldInspectorConversation = {
  nodeId: "agent:local:one",
  connectionId: "local",
  runtimeGeneration: 4,
  resourceIdentity: "local:4:terminal-one",
  paneId: "pane-one",
  terminalId: "terminal-one",
  label: "Builder",
  hostLabel: "Local",
  spaceLabel: "Studio",
  workspaceId: "studio",
  context: {
    kind: "agent",
    label: "Builder",
    stateLabel: "Working",
    locationLabel: "Studio · Local",
  },
  availableViews: ["terminal", "files", "changes", "history"],
  view: "terminal",
  dock: "right",
  expanded: false,
  size: 520,
};

worldLocalStorage.setItem(
  FLOATING_TERMINAL_GEOMETRY_KEY,
  JSON.stringify([
    {
      id: JSON.stringify([first.connectionId, first.nodeId]),
      geometry: { left: 24, top: 80, width: 420, height: 300 },
    },
  ]),
);

function Fixture() {
  const [conversation, setConversation] = useState(first);
  const [portals, setPortals] = useState<Record<string, HTMLDivElement | null>>(
    {},
  );
  return (
    <>
      <button
        type="button"
        data-testid="select-another"
        onClick={() =>
          setConversation((current) => ({
            ...current,
            label: current.label === "Builder" ? "Reviewer" : "Builder",
          }))
        }
      >
        Select another agent
      </button>
      <output data-testid="portal-state">
        {portals[first.nodeId] ? "ready" : "missing"}
      </output>
      <WorldFloatingTerminalWindow
        conversation={conversation}
        cascadeIndex={0}
        compactActive
        onFocus={() => {}}
        onRaise={() => {}}
        onAnchorChange={() => {}}
        onPortalChange={(element) =>
          setPortals((current) => ({
            ...current,
            [first.nodeId]: element,
          }))
        }
      />
      {portals[first.nodeId]
        ? createPortal(
            <header
              className="workspace-inspector-head is-window-drag-handle"
              data-testid="move-handle"
            >
              Move Inspector
            </header>,
            portals[first.nodeId]!,
          )
        : null}
    </>
  );
}

const host = document.createElement("main");
document.body.append(host);
const root = createRoot(host);
root.render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);

setTimeout(() => {
  host
    .querySelector<HTMLButtonElement>('[data-testid="select-another"]')
    ?.click();
  setTimeout(async () => {
    const floatingWindow = host.querySelector<HTMLElement>(
      ".world-floating-terminal",
    )!;
    const moveHandle = floatingWindow.querySelector<HTMLElement>(
      '[data-testid="move-handle"]',
    )!;
    const startLeft = floatingWindow.getBoundingClientRect().left;
    moveHandle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        buttons: 1,
        pointerId: 12,
        clientX: startLeft + 40,
        clientY: 80,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        buttons: 1,
        pointerId: 12,
        clientX: startLeft + 190,
        clientY: 80,
      }),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    const firstMoveLeft = floatingWindow.getBoundingClientRect().left;
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        buttons: 1,
        pointerId: 12,
        clientX: startLeft + 340,
        clientY: 80,
      }),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    const secondMoveLeft = floatingWindow.getBoundingClientRect().left;
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 12,
        clientX: startLeft + 340,
        clientY: 80,
      }),
    );
    const result = {
      failures,
      portal: host.querySelector('[data-testid="portal-state"]')?.textContent,
      inspectorLabel: host
        .querySelector(".world-floating-terminal")
        ?.getAttribute("aria-label"),
      windows: host.querySelectorAll(".world-floating-terminal").length,
      stableDrag:
        firstMoveLeft >= startLeft + 140 &&
        secondMoveLeft >= firstMoveLeft + 140,
    };
    void fetch("/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
  }, 80);
}, 80);
