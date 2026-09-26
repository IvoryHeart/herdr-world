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
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

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
  trigger.click();
  await settle();

  const menu = document.querySelector<HTMLElement>('[role="menu"]');
  const items = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ];
  check(!!menu && items.length === 6, "menu must expose six labelled choices");
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

  items[0]?.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    }),
  );
  check(
    document.activeElement === items[1],
    "ArrowDown must move to the next choice",
  );
  items[1]?.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    }),
  );
  check(
    document.activeElement === items[2],
    "keyboard users must reach unavailable reasons",
  );
  items[2]?.click();
  await settle();
  check(
    calls.length === 0 && !!document.querySelector('[role="menu"]'),
    "unavailable choice must leave placement unchanged",
  );

  items[1]?.click();
  await settle();
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

  trigger.click();
  await settle();
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  await settle();
  check(!document.querySelector('[role="menu"]'), "Escape must close the menu");
  check(
    document.activeElement === trigger,
    "Escape must restore trigger focus",
  );

  document.getElementById("root")!.style.cssText =
    "position:fixed;right:8px;bottom:8px";
  trigger.click();
  await settle();
  const floatingMenuBounds = document
    .querySelector<HTMLElement>('[role="menu"]')!
    .getBoundingClientRect();
  check(
    floatingMenuBounds.top >= 8 &&
      floatingMenuBounds.bottom <= window.innerHeight - 8,
    "a menu opened from the mobile floating controls must fit above them",
  );

  await fetch("/result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(failures),
  });
}

void run();
