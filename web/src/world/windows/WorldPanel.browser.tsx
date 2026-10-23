import { useCallback, useRef, useState } from "react";
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
  useWorldPanelFocus,
  type WorldPanelEntry,
} from "./WorldPanel";
import type { WindowCommand, WindowManagerState } from "./windowManager";

const stage = { width: 1000, height: 600 };
let harness: {
  setOpen(value: boolean): void;
  setCount(value: number): void;
  closes: number;
  launch(): void;
  focus(id: string): void;
  setLate(names: string[]): void;
  dispatch(command: WindowCommand): void;
  state: WindowManagerState;
  delivered: string[];
  register(entry: WorldPanelEntry): () => void;
  setDelivering(value: boolean): void;
  panels: readonly WorldPanelEntry[];
};

function FocusConsumer({
  registry,
  state,
  dispatch,
}: {
  registry: ReturnType<typeof useWorldPanelRegistry>;
  state: WindowManagerState;
  dispatch(command: WindowCommand): void;
}) {
  useWorldPanelFocus(registry, state, dispatch);
  return null;
}

function Fixture() {
  const registry = useWorldPanelRegistry();
  const { panels, panelBodyRef } = registry;
  const [open, setOpen] = useState(true);
  const [count, setCount] = useState(1);
  const [closes, setCloses] = useState(0);
  const [focusKey, setFocusKey] = useState(0);
  const [late, setLate] = useState<string[]>([]);
  const delivered = useRef<string[]>([]);
  const [delivering, setDelivering] = useState(true);
  const { state, dispatch } = useWindowManager(
    panels.map(({ id, label }) => ({ id, label })),
    stage,
  );
  const deliver = useCallback(
    (command: WindowCommand) => {
      if (command.type === "focus") delivered.current.push(command.id);
      dispatch(command);
    },
    [dispatch],
  );
  harness = {
    setOpen,
    setCount,
    closes,
    launch: () => {
      setOpen(true);
      setFocusKey((key) => key + 1);
    },
    focus: registry.focus,
    setLate,
    dispatch,
    state,
    delivered: delivered.current,
    register: registry.register,
    setDelivering,
    panels,
  };
  return (
    <WorldPanelsContext.Provider value={registry}>
      {delivering ? (
        <FocusConsumer registry={registry} state={state} dispatch={deliver} />
      ) : null}
      {open ? (
        <WorldPanel
          name="summary"
          label="Summary"
          focusKey={focusKey}
          onClose={() => {
            setCloses((value) => value + 1);
            setOpen(false);
          }}
        >
          <p className="summary-content">Agents: {count}</p>
        </WorldPanel>
      ) : null}
      {late.map((name) => (
        <WorldPanel
          key={name}
          name={name}
          label={name}
          onClose={() =>
            setLate((current) => current.filter((entry) => entry !== name))
          }
        >
          <p>{name}</p>
        </WorldPanel>
      ))}
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
  flushSync(() => harness.dispatch({ type: "minimize", id: "panel:summary" }));
  await settle();
  check(
    harness.state.windows["panel:summary"]?.minimized,
    "the setup did not minimize Summary",
  );
  flushSync(() => harness.launch());
  await settle();
  await settle();
  check(
    !harness.state.windows["panel:summary"]?.minimized &&
      harness.state.activeId === "panel:summary",
    "launching an open Summary did not restore it",
  );
  flushSync(() => harness.setLate(["cover"]));
  await settle();
  await settle();
  check(
    harness.state.activeId === "panel:cover",
    "the setup did not cover Summary",
  );
  flushSync(() => harness.launch());
  await settle();
  await settle();
  check(
    harness.state.activeId === "panel:summary" &&
      harness.state.stack[harness.state.stack.length - 1] === "panel:summary",
    "launching Summary did not raise it above the covering window",
  );
  flushSync(() => {
    harness.setOpen(false);
    harness.setLate([]);
  });
  await settle();
  await settle();
  const before = harness.delivered.length;
  flushSync(() => {
    harness.focus("panel:late-a");
    harness.focus("panel:late-b");
  });
  flushSync(() => harness.setLate(["late-a"]));
  await settle();
  await settle();
  check(
    harness.delivered.length === before,
    "a superseded request focused late A",
  );
  flushSync(() => harness.setLate(["late-a", "late-b"]));
  await settle();
  await settle();
  check(
    harness.delivered.slice(before).join() === "panel:late-b" &&
      harness.state.activeId === "panel:late-b",
    "the newest pre-registration request did not focus B once",
  );
  flushSync(() => harness.setLate(["late-a"]));
  await settle();
  await settle();
  flushSync(() => harness.setLate(["late-a", "late-b"]));
  await settle();
  await settle();
  check(
    harness.delivered.length === before + 1,
    "registration replayed a consumed focus request",
  );
  flushSync(() => harness.setDelivering(false));
  await settle();
  flushSync(() => harness.setDelivering(true));
  await settle();
  await settle();
  check(
    harness.delivered.length === before + 1,
    "remount replayed a consumed focus request",
  );
  flushSync(() => {
    harness.focus("panel:late-b");
    harness.setLate(["late-a"]);
  });
  await settle();
  await settle();
  flushSync(() => harness.setLate(["late-a", "late-b"]));
  await settle();
  await settle();
  check(
    harness.delivered.length === before + 1,
    "a stale request survived unregister/re-register",
  );
  let removeOld = () => {},
    removeNew = () => {};
  flushSync(() => {
    removeOld = harness.register({
      id: "panel:replace",
      label: "Old",
      onClose: () => {},
    });
  });
  flushSync(() => {
    removeNew = harness.register({
      id: "panel:replace",
      label: "New",
      onClose: () => {},
    });
    removeOld();
  });
  await settle();
  check(
    harness.panels.find((panel) => panel.id === "panel:replace")?.label ===
      "New",
    "an obsolete cleanup removed the replacement registration",
  );
  flushSync(() => harness.focus("panel:replace"));
  await settle();
  await settle();
  check(
    harness.delivered[harness.delivered.length - 1] === "panel:replace" &&
      harness.state.activeId === "panel:replace",
    "the current replacement registration could not receive focus",
  );
  flushSync(() => removeNew());
  flushSync(() => {
    harness.setLate([]);
    harness.setOpen(true);
  });
  await settle();
  await settle();
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
