import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { useState } from "react";
import { VisualRouteActions } from "./VisualRouteActionsMenu";
import { buildWorldObject, type WorldObjectNode } from "./worldObject";
import "./world.css";

const world = buildWorldObject(
  [
    {
      connectionId: "alpha.example",
      label: "Alpha",
      source: "saved-profile",
      isDefault: true,
      state: "ready",
      generation: 4,
      snapshotGeneration: 4,
      stale: false,
      actionable: true,
      snapshot: {
        workspaces: [
          {
            workspace_id: "studio",
            number: 1,
            label: "Studio",
            focused: true,
            pane_count: 1,
            tab_count: 1,
            agent_status: "working",
          },
        ],
        tabs: [],
        panes: [
          {
            pane_id: "agent-pane",
            terminal_id: "agent-terminal",
            workspace_id: "studio",
            tab_id: "tab-1",
            focused: true,
            agent: "codex",
            agent_status: "working",
            revision: 1,
          },
        ],
        agents: [],
      },
    },
  ],
  "alpha.example",
);
const agent = world.leaves[0]!;
const space = world.spaces[0]!;

function click(label: string) {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((candidate) => candidate.textContent?.trim() === label);
  if (!button) throw new Error(`Missing ${label}`);
  button.click();
}

async function settle() {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

function Harness({ onResource }: { onResource(action: string): void }) {
  const [selection, setSelection] = useState<WorldObjectNode>(agent);
  const [generation, setGeneration] = useState(4);
  return (
    <>
      <button type="button" onClick={() => setSelection(space)}>
        Select space
      </button>
      <button type="button" onClick={() => setGeneration(5)}>
        Replace generation
      </button>
      <VisualRouteActions
        selection={selection}
        world={world}
        activeConnectionId="alpha.example"
        runtimeGeneration={generation}
        onResource={async (_, action) => {
          onResource(action);
          return true;
        }}
        onGoToSpaces={async () => true}
        onError={(reason) => onResource(reason)}
      />
    </>
  );
}

async function verify() {
  const calls: string[] = [];
  const root = createRoot(document.getElementById("root")!);
  flushSync(() =>
    root.render(<Harness onResource={(action) => calls.push(action)} />),
  );

  const trigger = document.querySelector<HTMLButtonElement>(
    "button[aria-label='Actions']",
  )!;
  const initialVisible = trigger.getBoundingClientRect().width > 0;
  trigger.click();
  await settle();
  const menu = document.querySelector<HTMLElement>("[role='menu']")!;
  const initialMenu = menu.textContent ?? "";
  click("Changes");
  await settle();

  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      altKey: true,
      bubbles: true,
      cancelable: true,
      code: "KeyK",
      ctrlKey: true,
      key: "k",
    }),
  );
  await settle();
  const keyboardOpened = Boolean(document.querySelector("[role='menu']"));
  click("Select space");
  await settle();
  const selectionReason =
    document.querySelector("[role='menu']")?.textContent ?? "";

  trigger.click();
  await settle();
  trigger.click();
  await settle();
  click("Replace generation");
  await settle();
  const generationReason =
    document.querySelector("[role='menu']")?.textContent ?? "";

  await fetch("/result", {
    method: "POST",
    body: JSON.stringify({
      initialMenu,
      initialVisible,
      keyboardOpened,
      calls,
      selectionReason,
      generationReason,
    }),
  });
  root.unmount();
}

void verify();
