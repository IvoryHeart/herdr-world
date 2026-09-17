import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import WorldFloatingTerminalWindow from "./WorldFloatingTerminal";
import type { WorldFloatingTerminal } from "./worldTerminalPresentation";
import "./world.css";

const failures: string[] = [];
window.addEventListener("error", (event) => {
  failures.push(
    event.error instanceof Error ? event.error.message : event.message,
  );
});

const first: WorldFloatingTerminal = {
  nodeId: "agent:local:one",
  connectionId: "local",
  runtimeGeneration: 4,
  paneId: "pane-one",
  terminalId: "terminal-one",
  label: "Builder",
  hostLabel: "Local",
  spaceLabel: "Studio",
};

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
        onClose={() => {}}
        onDock={() => {}}
        onFocus={() => {}}
        onAnchorChange={() => {}}
        onPortalChange={(element) =>
          setPortals((current) => ({
            ...current,
            [first.nodeId]: element,
          }))
        }
      />
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
  setTimeout(() => {
    const result = {
      failures,
      portal: host.querySelector('[data-testid="portal-state"]')?.textContent,
      terminalLabel: host.querySelector(".world-floating-terminal strong")
        ?.textContent,
      windows: host.querySelectorAll(".world-floating-terminal").length,
    };
    void fetch("/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
  }, 80);
}, 80);
