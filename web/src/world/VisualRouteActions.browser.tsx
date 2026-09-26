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

function button(label: string) {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (candidate) =>
      candidate.textContent?.trim() === label ||
      candidate.firstChild?.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Missing ${label}`);
  return button;
}

function click(label: string) {
  button(label).click();
}

async function settle() {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

function Harness({ onResource }: { onResource(action: string): void }) {
  const [selection, setSelection] = useState<WorldObjectNode>(agent);
  const [generation, setGeneration] = useState(4);
  const [pinnedOnly, setPinnedOnly] = useState(false);
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
        arrangementControl={{
          activePreset: null,
          disabledReasons: { rows: "The stage is too short." },
          onSelect: (command) => onResource(`arrange:${command}`),
        }}
        watchControl={{
          pinnedOnly,
          status: "1 pinned · 1 admitted",
          onTogglePinnedOnly: () => {
            setPinnedOnly((value) => !value);
            onResource("pinned-only");
          },
          pin: {
            label: "Pin selected pane",
            disabledReason: null,
            onSelect: () => onResource("pin"),
          },
        }}
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
  click("Pinned only");
  click("Pin selected pane");
  const changes = button("Changes");
  changes.focus();
  changes.click();
  await settle();
  const resourceFocusRestored = document.activeElement === trigger;

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
  const unavailableRows =
    button("Rows").getAttribute("aria-disabled") === "true";
  button("Rows").focus();
  const unavailableReasonAccessible =
    document.activeElement === button("Rows") &&
    button("Rows").textContent?.includes("The stage is too short.") === true;
  button("Rows").click();
  click("Columns");
  await settle();

  await fetch("/result", {
    method: "POST",
    body: JSON.stringify({
      initialMenu,
      initialVisible,
      keyboardOpened,
      calls,
      resourceFocusRestored,
      selectionReason,
      generationReason,
      unavailableRows,
      unavailableReasonAccessible,
    }),
  });
  root.unmount();
}

void verify().catch(async (cause) => {
  await fetch("/result", {
    method: "POST",
    body: JSON.stringify({ error: String(cause) }),
  });
});
