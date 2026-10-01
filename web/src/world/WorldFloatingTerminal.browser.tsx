import { StrictMode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { worldLocalStorage } from "../browserStorage";
import WorldFloatingTerminalWindow from "./WorldFloatingTerminal";
import { listenForInspectorWindowRaise } from "./inspectorWindowFocus";
import { FLOATING_TERMINAL_GEOMETRY_KEY } from "./floatingTerminalPreferences";
import type { WorldInspectorConversation } from "./worldTerminalPresentation";
import "./world.css";

const failures: string[] = [];
let raises = 0;
let dockedRaises = 0;
let activations = 0;
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
  const dockedRef = useRef<HTMLDivElement | null>(null);
  const [dockedPortal, setDockedPortal] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const docked = dockedRef.current;
    if (!docked) return;
    return listenForInspectorWindowRaise(docked, () => {
      dockedRaises += 1;
    });
  }, []);
  const [conversation, setConversation] = useState(first);
  const [arrangedGeometry, setArrangedGeometry] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [portals, setPortals] = useState<Record<string, HTMLDivElement | null>>(
    {},
  );
  return (
    <>
      <aside>
        <button type="button" data-testid="profile-control">
          Profile control
        </button>
        <div ref={dockedRef}>
          <div ref={setDockedPortal} />
        </div>
      </aside>
      {dockedPortal
        ? createPortal(
            <button type="button" data-testid="docked-inspector-control">
              Docked Inspector control
            </button>,
            dockedPortal,
          )
        : null}
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
      <button
        type="button"
        data-testid="arrange"
        onClick={() =>
          setArrangedGeometry({ left: 100, top: 100, width: 700, height: 500 })
        }
      >
        Arrange
      </button>
      <button
        type="button"
        data-testid="restore"
        onClick={() => setArrangedGeometry(null)}
      >
        Restore
      </button>
      <output data-testid="portal-state">
        {portals[first.nodeId] ? "ready" : "missing"}
      </output>
      <WorldFloatingTerminalWindow
        conversation={conversation}
        cascadeIndex={0}
        compactActive
        arrangedGeometry={arrangedGeometry}
        onArrangedGeometryChange={setArrangedGeometry}
        onFocus={() => {}}
        onRaise={() => {
          activations += 1;
        }}
        onStack={() => {
          raises += 1;
        }}
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
            <>
              <header
                className="workspace-inspector-head is-window-drag-handle"
                data-testid="move-handle"
              >
                Move Inspector
              </header>
              <button type="button" data-testid="inspector-control">
                Inspector control
              </button>
            </>,
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
    const inspectorControl = floatingWindow.querySelector<HTMLButtonElement>(
      '[data-testid="inspector-control"]',
    )!;
    const dockedControl = host.querySelector<HTMLButtonElement>(
      '[data-testid="docked-inspector-control"]',
    )!;
    dockedControl.focus();
    dockedControl.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 10,
      }),
    );
    const dockedControlRaises = dockedRaises >= 2;
    const profileControl = host.querySelector<HTMLButtonElement>(
      '[data-testid="profile-control"]',
    )!;
    profileControl.focus();
    profileControl.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 9,
      }),
    );
    const profileDoesNotRaiseDocked = dockedRaises === 2;
    inspectorControl.focus();
    inspectorControl.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 11,
      }),
    );
    const portaledControlRaises = raises >= 2;
    const portaledControlDoesNotActivate = activations === 0;
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
    const stableGeometryBeforeArrangement = worldLocalStorage.getItem(
      FLOATING_TERMINAL_GEOMETRY_KEY,
    );
    host.querySelector<HTMLButtonElement>('[data-testid="arrange"]')?.click();
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    const arrangedLeft = floatingWindow.getBoundingClientRect().left;
    moveHandle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        buttons: 1,
        pointerId: 13,
        clientX: arrangedLeft + 40,
        clientY: 120,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        buttons: 1,
        pointerId: 13,
        clientX: arrangedLeft + 140,
        clientY: 120,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 13,
      }),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    const arrangedMoveLeft = floatingWindow.getBoundingClientRect().left;
    const stableGeometryAfterArrangement = worldLocalStorage.getItem(
      FLOATING_TERMINAL_GEOMETRY_KEY,
    );
    host.querySelector<HTMLButtonElement>('[data-testid="restore"]')?.click();
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    const restoredLeft = floatingWindow.getBoundingClientRect().left;
    const focusHost = document.createElement("div");
    const focusButton = document.createElement("button");
    focusHost.append(focusButton);
    document.body.append(focusHost);
    let pointerRaisesAfterRebind = 0;
    let keyboardRevealsAfterRebind = 0;
    const listen = () =>
      listenForInspectorWindowRaise(
        focusHost,
        () => {
          pointerRaisesAfterRebind += 1;
        },
        () => {
          keyboardRevealsAfterRebind += 1;
        },
      );
    let stopFocusListener = listen();
    focusButton.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerId: 31 }),
    );
    stopFocusListener();
    stopFocusListener = listen();
    focusButton.focus();
    const pointerFocusSurvivesListenerRebind =
      pointerRaisesAfterRebind === 2 && keyboardRevealsAfterRebind === 0;
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 31 }));
    focusButton.blur();
    focusButton.focus();
    const keyboardFocusRevealsAfterPointer = keyboardRevealsAfterRebind === 1;
    focusButton.blur();
    focusButton.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerId: 32 }),
    );
    stopFocusListener();
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 32 }));
    stopFocusListener = listen();
    focusButton.focus();
    const pointerEndWithoutListenerRestoresKeyboard =
      keyboardRevealsAfterRebind === 2;
    stopFocusListener();
    focusHost.remove();
    const result = {
      failures,
      portal: host.querySelector('[data-testid="portal-state"]')?.textContent,
      inspectorLabel: host
        .querySelector(".world-floating-terminal")
        ?.getAttribute("aria-label"),
      windows: host.querySelectorAll(".world-floating-terminal").length,
      portaledControlRaises,
      portaledControlDoesNotActivate,
      dockedControlRaises,
      profileDoesNotRaiseDocked,
      pointerFocusSurvivesListenerRebind,
      keyboardFocusRevealsAfterPointer,
      pointerEndWithoutListenerRestoresKeyboard,
      stableDrag:
        firstMoveLeft >= startLeft + 140 &&
        secondMoveLeft >= firstMoveLeft + 140,
      arrangementRestoresGeometry:
        arrangedLeft === 100 &&
        arrangedMoveLeft >= arrangedLeft + 90 &&
        Math.abs(restoredLeft - secondMoveLeft) <= 1 &&
        stableGeometryBeforeArrangement === stableGeometryAfterArrangement,
    };
    void fetch("/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
  }, 80);
}, 80);
