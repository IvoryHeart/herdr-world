import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { SpacesTabWindow } from "./SpacesTabWindow";
import "../styles/tokens.css";
import "../styles/base.css";

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
let geometry = { left: 40, top: 50, width: 500, height: 320 };
let focusCount = 0;
let raiseCount = 0;
let closeCount = 0;
let portal: HTMLDivElement | null = null;
const root = createRoot(document.getElementById("root")!);

flushSync(() =>
  root.render(
    <SpacesTabWindow
      tabId="tab-one"
      label="Builder"
      active
      geometry={geometry}
      stage={{ width: 1100, height: 700 }}
      zIndex={3}
      onRaise={() => raiseCount++}
      onFocus={() => focusCount++}
      onClose={() => closeCount++}
      onGeometryChange={(next) => {
        geometry = next;
      }}
      onPortalChange={(element) => {
        portal = element;
      }}
    />,
  ),
);

const content = document.createElement("button");
content.textContent = "Terminal content";
document
  .querySelector<HTMLDivElement>(".spaces-tab-window-portal")
  ?.append(content);
content.dispatchEvent(
  new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }),
);
check(
  focusCount === 0,
  "terminal content must not trigger duplicate tab focus",
);
check(raiseCount === 1, "terminal content must raise its window");

const move = document.querySelector<HTMLButtonElement>(
  'button[aria-label="Move Builder window"]',
)!;
move.dispatchEvent(
  new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "ArrowRight",
  }),
);
check(geometry.left === 60, "keyboard move must update horizontal geometry");
check(focusCount === 1, "window chrome must raise the tab once");

const resize = document.querySelector<HTMLButtonElement>(
  'button[aria-label="Resize Builder window"]',
)!;
resize.dispatchEvent(
  new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "ArrowDown",
  }),
);
check(geometry.height === 340, "keyboard resize must update height");
document
  .querySelector<HTMLButtonElement>('button[aria-label="Close Builder tab"]')
  ?.click();
check(closeCount === 1, "close control must close exactly once");
check(portal !== null, "window must expose a terminal portal");

void fetch("/result", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(failures),
});
