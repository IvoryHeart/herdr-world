import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { useWindowManager } from "./useWindowManager";
import { WindowFrame } from "./WindowFrame";
import { WindowSurface } from "./WindowSurface";
import {
  WorldPanel,
  WorldPanelWindow,
  WorldPanelsContext,
  useWorldPanelRegistry,
} from "./WorldPanel";

const stage = { width: 1000, height: 600 };
let harness: {
  setOpen(value: boolean): void;
  setCount(value: number): void;
  closes: number;
};

function Fixture() {
  const registry = useWorldPanelRegistry();
  const { panels, panelBodyRef } = registry;
  const [open, setOpen] = useState(true);
  const [count, setCount] = useState(1);
  const [closes, setCloses] = useState(0);
  const { state, dispatch } = useWindowManager(
    panels.map(({ id, label }) => ({ id, label })),
    stage,
  );
  harness = { setOpen, setCount, closes };
  return (
    <WorldPanelsContext.Provider value={registry}>
      {open ? (
        <WorldPanel
          name="summary"
          label="Summary"
          onClose={() => {
            setCloses((value) => value + 1);
            setOpen(false);
          }}
        >
          <p className="summary-content">Agents: {count}</p>
        </WorldPanel>
      ) : null}
      <WindowSurface
        state={state}
        dispatch={dispatch}
        stage={stage}
        compact={false}
        onLayer={() => {}}
      >
        {({ entry, geometry, stage, workArea, zIndex, active }) => {
          const panel = panels.find((candidate) => candidate.id === entry.id);
          if (!panel) return null;
          return (
            <WindowFrame
              key={entry.id}
              id={entry.id}
              label={`${panel.label} window`}
              geometry={geometry}
              stage={stage}
              workArea={workArea}
              zIndex={zIndex}
              active={active}
              compact={false}
              onRaise={() => dispatch({ type: "raise", id: entry.id })}
              onPlace={(rect) =>
                dispatch({ type: "place", id: entry.id, rect })
              }
              onSnap={(target) =>
                dispatch({ type: "snap", id: entry.id, target })
              }
              onMaximize={() => dispatch({ type: "maximize", id: entry.id })}
            >
              <WorldPanelWindow
                label={panel.label}
                onBody={panelBodyRef(entry.id)}
                controls={{
                  compact: false,
                  maximized: entry.maximized,
                  onMinimize: () =>
                    dispatch({ type: "minimize", id: entry.id }),
                  onMaximize: () =>
                    dispatch({ type: "maximize", id: entry.id }),
                  onClose: panel.onClose,
                  onSnap: (target) =>
                    dispatch({ type: "snap", id: entry.id, target }),
                  onFloat: () => dispatch({ type: "float", id: entry.id }),
                  back: { label: "Back to Town" },
                }}
              />
            </WindowFrame>
          );
        }}
      </WindowSurface>
    </WorldPanelsContext.Provider>
  );
}

const failures: string[] = [];
const check = (condition: unknown, message: string) => {
  if (!condition) failures.push(message);
};
const settle = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
const panelWindow = () =>
  document.querySelector<HTMLElement>(".world-managed-window");

async function run() {
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<Fixture />));
  await settle();
  await settle();
  check(panelWindow(), "an open panel did not open a window");
  check(
    panelWindow()?.querySelector(".world-panel-title")?.textContent ===
      "Summary",
    "the panel window's bar does not name it",
  );
  check(
    panelWindow()?.querySelector(".world-panel-body .summary-content")
      ?.textContent === "Agents: 1",
    "the panel's content did not render inside its window",
  );
  flushSync(() => harness.setCount(2));
  await settle();
  check(
    panelWindow()?.querySelector(".summary-content")?.textContent ===
      "Agents: 2",
    "the panel's content did not follow its caller's props",
  );
  panelWindow()
    ?.querySelector<HTMLButtonElement>('[aria-label="Close Summary window"]')
    ?.click();
  await settle();
  await settle();
  check(harness.closes === 1, "Back did not ask the caller to close");
  check(!panelWindow(), "closing the panel left its window open");
  flushSync(() => harness.setOpen(true));
  await settle();
  await settle();
  check(
    panelWindow()?.querySelector(".summary-content"),
    "a reopened panel did not open its window again",
  );
  flushSync(() => harness.setOpen(false));
  await settle();
  await settle();
  check(!panelWindow(), "unmounting the panel left its window open");
  root.unmount();
}
void run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
