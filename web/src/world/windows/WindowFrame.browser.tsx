import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { WindowFrame } from "./WindowFrame";
import { WindowSurface } from "./WindowSurface";
import { WindowControls } from "./WindowControls";
import { WindowSwitcher } from "./WindowSwitcher";
import { useWindowManager } from "./useWindowManager";
import { snapGeometry, windowGeometry, type Size } from "./windowManager";
import { RESIZE_EDGES, resizeWindow } from "./windowInteraction";

const initialInputs = ["A", "B"].map((id, index) => ({
  id,
  label: id,
  initialGeometry: { left: 40 + index * 400, top: 40, width: 360, height: 260 },
}));
let harness: ReturnType<typeof useWindowManager> & {
  size: Size;
  setSize(size: Size): void;
  setCompact(value: boolean): void;
  setInputs(value: typeof initialInputs): void;
};
let terminalActivations = 0;
function Fixture() {
  const [size, setSize] = useState({ width: 1000, height: 600 });
  const [compact, setCompact] = useState(false);
  const [inputs, setInputs] = useState(initialInputs);
  const manager = useWindowManager(inputs, size);
  harness = { ...manager, size, setSize, setCompact, setInputs };
  const { state, dispatch } = manager;
  return (
    <>
      <WindowSwitcher
        entries={inputs
          .filter((input) => !state.windows[input.id]?.dismissed)
          .map((input) => ({
            ...input,
            active: state.activeId === input.id,
            minimized: state.windows[input.id]?.minimized ?? false,
            onSelect: () => dispatch({ type: "focus", id: input.id }),
          }))}
      />
      <div style={{ position: "relative", ...size }}>
        <WindowSurface
          state={state}
          dispatch={dispatch}
          stage={size}
          compact={compact}
          onLayer={() => {}}
          bounds={size}
        >
          {({ entry, geometry, stage, workArea, zIndex, active }) => (
            <WindowFrame
              key={entry.id}
              id={entry.id}
              label={entry.id}
              geometry={geometry}
              stage={stage}
              workArea={workArea}
              zIndex={zIndex}
              active={active}
              compact={compact}
              restoreGeometry={
                entry.maximized || entry.placement.kind !== "floating"
                  ? entry.floating
                  : undefined
              }
              onRaise={() => dispatch({ type: "raise", id: entry.id })}
              onPlace={(rect) =>
                dispatch({ type: "place", id: entry.id, rect })
              }
              onSnap={(target) =>
                dispatch({ type: "snap", id: entry.id, target })
              }
              onMaximize={() => dispatch({ type: "maximize", id: entry.id })}
              onTerminalActivate={() => terminalActivations++}
            >
              <header className="world-window-header">
                <button data-window-drag-handle className="world-window-title">
                  {entry.id}
                </button>
                <WindowControls
                  label={entry.id}
                  controls={{
                    compact,
                    maximized: entry.maximized,
                    onClose: () => dispatch({ type: "dismiss", id: entry.id }),
                    onMinimize: () =>
                      dispatch({ type: "minimize", id: entry.id }),
                    onMaximize: () =>
                      dispatch({ type: "maximize", id: entry.id }),
                    onSnap: (target) =>
                      dispatch({ type: "snap", id: entry.id, target }),
                    onFloat: () => dispatch({ type: "float", id: entry.id }),
                  }}
                />
              </header>
              <div className="world-window-content pane-layout-single">
                <div className="xterm">
                  <textarea className="xterm-helper-textarea" />
                </div>
              </div>
            </WindowFrame>
          )}
        </WindowSurface>
      </div>
    </>
  );
}

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
const frame = (id = "A") =>
  document.querySelector<HTMLElement>(`[data-window-id="${id}"]`)!;
const geometry = (id = "A") => windowGeometry(harness.state, id, harness.size)!;
const cssGeometry = (element: HTMLElement) => ({
  left: Number.parseFloat(element.style.left),
  top: Number.parseFloat(element.style.top),
  width: Number.parseFloat(element.style.width),
  height: Number.parseFloat(element.style.height),
});
const sameGeometry = (
  a: ReturnType<typeof cssGeometry>,
  b: ReturnType<typeof cssGeometry>,
) =>
  (["left", "top", "width", "height"] as const).every(
    (key) => Math.abs(a[key] - b[key]) < 0.01,
  );
const pointer = (target: EventTarget, type: string, x: number, y: number) =>
  flushSync(() =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 10,
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
      }),
    ),
  );
window.addEventListener("error", (event) => failures.push(event.message));
async function run() {
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<Fixture />));
  await settle();
  const before = geometry();
  frame("B").focus();
  await settle();
  check(
    JSON.stringify(geometry()) === JSON.stringify(before),
    "focus moved an unrelated window",
  );
  for (const edge of RESIZE_EDGES) {
    const rect = { left: 120, top: 120, width: 360, height: 260 };
    flushSync(() => harness.dispatch({ type: "place", id: "A", rect }));
    const handle = frame().querySelector<HTMLElement>(
      `[data-window-resize="${edge}"]`,
    )!;
    const bounds = handle.getBoundingClientRect();
    const dx = edge.includes("w") ? -20 : edge.includes("e") ? 20 : 0;
    const dy = edge.includes("n") ? -20 : edge.includes("s") ? 20 : 0;
    pointer(handle, "pointerdown", bounds.x + 2, bounds.y + 2);
    pointer(window, "pointermove", bounds.x + 2 + dx, bounds.y + 2 + dy);
    pointer(window, "pointerup", bounds.x + 2 + dx, bounds.y + 2 + dy);
    check(
      JSON.stringify(geometry()) ===
        JSON.stringify(resizeWindow(rect, edge, dx, dy, harness.size)),
      `${edge} resize used the wrong anchored edge`,
    );
  }
  check(terminalActivations === 0, "window resizing activated terminal input");
  flushSync(() => harness.dispatch({ type: "float", id: "A" }));
  const handle = frame().querySelector<HTMLElement>(
    "[data-window-drag-handle]",
  )!;
  const bounds = handle.getBoundingClientRect();
  const layer = document
    .querySelector(".world-window-layer")!
    .getBoundingClientRect();
  pointer(handle, "pointerdown", bounds.x + 30, bounds.y + 15);
  pointer(window, "pointermove", layer.left + 2, layer.top + layer.height / 2);
  check(
    Boolean(document.querySelector(".world-window-snap-preview")),
    "drag did not preview snap destination",
  );
  pointer(window, "pointerup", layer.left + 2, layer.top + layer.height / 2);
  check(
    harness.state.windows.A?.placement.kind === "snap",
    "release did not commit snap",
  );
  const snapped = geometry();
  flushSync(() => harness.dispatch({ type: "snap", id: "B", target: "left" }));
  check(
    JSON.stringify(geometry()) === JSON.stringify(snapped),
    "occupied snap displaced its occupant",
  );
  flushSync(() => harness.dispatch({ type: "maximize", id: "A" }));
  const maximized = frame().getBoundingClientRect();
  pointer(
    frame().querySelector("[data-window-drag-handle]")!,
    "pointerdown",
    maximized.x + 100,
    maximized.y + 20,
  );
  pointer(window, "pointermove", maximized.x + 200, maximized.y + 120);
  pointer(window, "pointercancel", maximized.x + 200, maximized.y + 120);
  check(
    harness.state.windows.A?.maximized === true &&
      harness.state.windows.A?.placement.kind === "snap",
    "cancel lost the maximize or snap state",
  );
  frame()
    .querySelector<HTMLButtonElement>('[aria-label="Minimize A"]')!
    .click();
  await settle();
  check(!frame(), "minimized window remained visible");
  document
    .querySelector<HTMLButtonElement>(".world-window-switcher-trigger")!
    .click();
  await settle();
  const restore = [
    ...document.querySelectorAll<HTMLButtonElement>(
      ".world-window-switcher-menu button",
    ),
  ].find((button) => button.textContent === "A")!;
  check(
    Boolean(restore.querySelector('[aria-label="Minimized"]')),
    "minimized window lost its switcher entry",
  );
  restore.click();
  await settle();
  check(
    Boolean(frame()) && harness.state.windows.A?.maximized === true,
    "switcher failed to restore maximize state",
  );
  frame().querySelector<HTMLButtonElement>('[aria-label="Restore A"]')!.click();
  await settle();
  check(
    JSON.stringify(geometry()) === JSON.stringify(snapped),
    "restore forgot the previous snap",
  );
  flushSync(() => harness.dispatch({ type: "arrange", preset: "columns" }));
  const a = geometry().width,
    b = geometry("B").width;
  const divider = document.querySelector<HTMLButtonElement>(
    ".world-window-divider",
  )!;
  flushSync(() =>
    divider.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  check(
    Math.abs(geometry().width - a - 16) < 1 &&
      Math.abs(geometry("B").width - b + 16) < 1,
    "shared divider did not resize both neighbors",
  );
  flushSync(() => harness.setSize({ width: 800, height: 500 }));
  check(
    Boolean(document.querySelector(".world-window-divider")),
    "viewport resize lost shared divider",
  );
  const desktop = JSON.stringify(harness.state.windows);
  flushSync(() => harness.setCompact(true));
  check(
    document.querySelectorAll(".world-managed-window").length === 1 &&
      !document.querySelector("[data-window-resize]"),
    "compact mode exposed desktop frames or handles",
  );
  flushSync(() => harness.setCompact(false));
  check(
    JSON.stringify(harness.state.windows) === desktop,
    "compact projection overwrote desktop placements",
  );
  check(
    terminalActivations === 0,
    "presentation controls activated terminal input",
  );
  flushSync(() => {
    harness.setSize({ width: 1000, height: 600 });
    harness.setInputs(
      Array.from({ length: 8 }, (_, index) => ({
        ...initialInputs[0]!,
        id: String.fromCharCode(65 + index),
        label: String.fromCharCode(65 + index),
      })),
    );
  });
  await settle();
  // A scrolled canvas remains the movement boundary, while every snap and
  // maximize destination occupies the visible viewport before and after release.
  for (const preset of ["columns", "rows"] as const) {
    for (const target of [
      "left",
      "right",
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
      "bottom",
      "maximize",
    ] as const) {
      flushSync(() => harness.dispatch({ type: "arrange", preset }));
      await settle();
      const surface = document.querySelector<HTMLElement>(
        ".world-window-layer",
      )!;
      surface.scrollLeft = surface.scrollWidth;
      surface.scrollTop = surface.scrollHeight;
      await settle();
      check(
        preset === "columns" ? surface.scrollLeft > 0 : surface.scrollTop > 0,
        `${preset}: fixture did not scroll`,
      );
      const visible = surface.getBoundingClientRect();
      const title = frame("H").querySelector<HTMLElement>(
        "[data-window-drag-handle]",
      )!;
      const start = title.getBoundingClientRect();
      pointer(title, "pointerdown", start.x + 30, start.y + 15);
      pointer(
        window,
        "pointermove",
        visible.left + harness.size.width / 2,
        visible.top + harness.size.height / 2,
      );
      check(
        !document.querySelector(".world-window-snap-preview"),
        `${preset}: center of visible work area triggered a snap`,
      );
      const x =
        visible.left +
        (target.includes("left")
          ? 2
          : target.includes("right")
            ? harness.size.width - 2
            : harness.size.width / 2);
      const y =
        visible.top +
        (target.includes("top") || target === "maximize"
          ? 2
          : target.includes("bottom")
            ? harness.size.height - 2
            : harness.size.height / 2);
      pointer(window, "pointermove", x, y);
      await settle();
      const preview = document.querySelector<HTMLElement>(
        ".world-window-snap-preview",
      );
      check(
        Boolean(preview),
        `${preset}/${target}: no snap preview at viewport edge`,
      );
      const expected =
        target === "maximize"
          ? { left: 0, top: 0, ...harness.size }
          : snapGeometry(target, harness.size);
      expected.left += surface.scrollLeft;
      expected.top += surface.scrollTop;
      if (preview)
        check(
          sameGeometry(cssGeometry(preview), expected),
          `${preset}/${target}: preview ${JSON.stringify(cssGeometry(preview))} did not match work area ${JSON.stringify(expected)}`,
        );
      pointer(window, "pointerup", x, y);
      await settle();
      check(
        sameGeometry(cssGeometry(frame("H")), expected),
        `${preset}/${target}: release disagreed with preview`,
      );
      const entry = harness.state.windows.H!;
      check(
        target === "maximize"
          ? entry.maximized
          : entry.placement.kind === "snap" &&
              entry.placement.target === target,
        `${preset}/${target}: release did not commit the target`,
      );
      if (target === "right" || target === "maximize") {
        const handle = frame("H").querySelector<HTMLElement>(
          "[data-window-drag-handle]",
        )!;
        const bounds = handle.getBoundingClientRect();
        const startX = bounds.x + bounds.width / 2,
          startY = bounds.y + 15;
        pointer(handle, "pointerdown", startX, startY);
        pointer(window, "pointermove", startX - 60, startY + 80);
        await settle();
        const moved = cssGeometry(frame("H"));
        check(
          !document.querySelector(".world-window-snap-preview"),
          `${preset}/${target}: detaching did not leave the snap target`,
        );
        pointer(window, "pointerup", startX - 60, startY + 80);
        await settle();
        check(
          sameGeometry(cssGeometry(frame("H")), moved),
          `${preset}/${target}: detaching lost canvas coordinates`,
        );
      }
    }
  }
  root.unmount();
}
void run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
