import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "../styles/tokens.css";
import "../styles/base.css";
import {
  WindowArrangementMenu,
  type WindowArrangementCommand,
} from "./WindowArrangementMenu";

const failures: string[] = [];
const calls: WindowArrangementCommand[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
// Commit each synthetic interaction and its effects explicitly. A timer does
// not guarantee React has committed, especially during a cold browser launch.
async function interact(action: () => void) {
  flushSync(action);
  // Selection restores trigger focus in a microtask.
  await Promise.resolve();
}

async function run() {
  const root = createRoot(document.getElementById("root")!);
  flushSync(() =>
    root.render(
      <WindowArrangementMenu
        control={{
          activePreset: "single",
          disabledReasons: {
            columns: "Need another window",
            restore: "No saved positions",
          },
          onSelect: (command) => calls.push(command),
        }}
      />,
    ),
  );
  const trigger = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Arrange windows"]',
  )!;
  trigger.focus();
  await interact(() => trigger.click());

  const menu = document.querySelector<HTMLElement>('[role="menu"]');
  const items = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ];
  check(
    !!menu && items.length === 8,
    "menu must expose eight labelled choices",
  );
  check(
    items[6]?.textContent?.includes("Close all terminal windows") === true,
    "Close all must be a labelled arrangement command",
  );
  check(
    items[7]?.textContent?.includes("Open all terminal windows") === true,
    "Open all must be a labelled arrangement command",
  );
  check(
    document.activeElement === items[0],
    "opening must focus the first enabled choice",
  );
  check(
    items[2]?.getAttribute("aria-disabled") === "true",
    "unavailable choice must be announced",
  );
  check(
    items[2]?.textContent?.includes("Need another window") ?? false,
    "unavailable reason must be visible",
  );

  await interact(() =>
    items[0]?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  check(
    document.activeElement === items[1],
    "ArrowDown must move to the next choice",
  );
  await interact(() =>
    items[1]?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  check(
    document.activeElement === items[2],
    "keyboard users must reach unavailable reasons",
  );
  await interact(() => items[2]?.click());
  check(
    calls.length === 0 && !!document.querySelector('[role="menu"]'),
    "unavailable choice must leave placement unchanged",
  );

  await interact(() => items[1]?.click());
  check(
    calls.join(",") === "cascade",
    "enabled choice must invoke its command once",
  );
  check(
    !document.querySelector('[role="menu"]'),
    "choosing a placement must close the menu",
  );
  check(
    document.activeElement === trigger,
    "choosing a placement must restore trigger focus",
  );

  await interact(() => trigger.click());
  await interact(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  check(!document.querySelector('[role="menu"]'), "Escape must close the menu");
  check(
    document.activeElement === trigger,
    "Escape must restore trigger focus",
  );

  document.getElementById("root")!.style.cssText =
    "position:fixed;right:8px;bottom:8px";
  await interact(() => trigger.click());
  const floatingMenuBounds = document
    .querySelector<HTMLElement>('[role="menu"]')!
    .getBoundingClientRect();
  check(
    floatingMenuBounds.top >= 8 &&
      floatingMenuBounds.bottom <= window.innerHeight - 8,
    "a menu opened from the mobile floating controls must fit above them",
  );

  await interact(() => trigger.click());
  document.documentElement.style.zoom = "1.4";
  document.getElementById("root")!.style.cssText =
    "position:fixed;right:8px;top:52px";
  await interact(() => trigger.click());
  const zoomedMenu = document.querySelector<HTMLElement>('[role="menu"]');
  const zoomedTriggerBounds = trigger.getBoundingClientRect();
  const zoomedMenuBounds = zoomedMenu?.getBoundingClientRect();
  check(
    Boolean(
      zoomedMenuBounds &&
        zoomedMenuBounds.left >= 8 &&
        zoomedMenuBounds.right <= window.innerWidth - 8 &&
        Math.abs(zoomedMenuBounds.right - zoomedTriggerBounds.right) <= 20,
    ),
    `scaled menu was not visible beside its trigger: ${JSON.stringify({ menu: zoomedMenuBounds?.toJSON(), trigger: zoomedTriggerBounds.toJSON(), viewport: window.innerWidth })}`,
  );
  const closeAll = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ].find((item) => item.textContent?.includes("Close all terminal windows"));
  await interact(() => closeAll?.click());
  check(
    calls.join(",") === "cascade,close-all",
    "Close all must dispatch through the shared arrangement control",
  );

  await fetch("/result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(failures),
  });
}

void run();
