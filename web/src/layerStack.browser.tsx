import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { StrictMode, useState } from "react";
import { bridge, type ConnectionClient } from "./api";
import { __storeTesting, store } from "./store";
import {
  initializeLayoutPreferences,
  updateLayoutPreferences,
} from "./layoutPreferences";
import { rememberTerminalInputMode } from "./terminalInputMode";
import { openLayerCount } from "./layerStack";
import { TerminalView } from "./components/TerminalView";
import { ThemedSelect } from "./components/ThemedSelect";
import { WindowArrangementMenu } from "./components/WindowArrangementMenu";
import { ColorSwatchButton } from "./components/ColorSwatch";
import { InterestButton } from "./components/InterestButton";
import type { Interest } from "../../shared/interest";
import { WindowControls } from "./world/windows/WindowControls";
import { TERMINAL_COLOR_PALETTE } from "./world/terminalColor";
import type { Pane } from "./types";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout/app.css";
import "./styles/vendor.css";

// A terminal window as World shows it: a header with the terminal's colour,
// its menu (with the colour picker nested inside) and a themed dropdown over a
// live xterm. Input comes from Chrome (CDP) through /input, so touches,
// presses and keys take the browser's real paths, xterm's included.
const params = new URLSearchParams(location.search);
const phone = params.get("touch") === "1";
const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(`${location.search}: ${message}`);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 120));
const input = async (method: string, body: Record<string, unknown>) => {
  const response = await fetch("/input", {
    method: "POST",
    body: JSON.stringify({ method, params: body }),
  });
  if (!response.ok) throw new Error(`CDP ${method} failed`);
};

const client: ConnectionClient = {
  connectionId: "layers-test",
  generation: 1,
  serverRuntimeGeneration: 1,
  isCurrent: () => true,
  acceptsServerGeneration: () => true,
  call: async () => ({}),
};
bridge.connection = () => client;
bridge.onTerminal = () => () => {};
bridge.onTerminalClosed = () => () => {};
const pane: Pane = {
  pane_id: "layers-pane",
  terminal_id: "layers-terminal",
  workspace_id: "workspace",
  tab_id: "tab",
  focused: true,
  agent_status: "idle",
  revision: 1,
};
__storeTesting.replaceState({
  ...store.get(),
  status: "connected",
  activeConnectionId: client.connectionId,
  connectionGeneration: 1,
  serverRuntimeGeneration: 1,
  connections: [
    {
      id: client.connectionId,
      label: "Synthetic terminal",
      source: "test",
      is_default: true,
      state: "ready",
      generation: 1,
    },
  ],
  panes: [pane],
  selectedPaneId: pane.pane_id,
  layout: {
    workspace_id: pane.workspace_id,
    tab_id: pane.tab_id,
    zoomed: false,
    splits: [],
    area: { x: 0, y: 0, width: 80, height: 24 },
    focused_pane_id: pane.pane_id,
    panes: [
      {
        pane_id: pane.pane_id,
        focused: true,
        rect: { x: 0, y: 0, width: 80, height: 24 },
      },
    ],
  },
});
initializeLayoutPreferences();
updateLayoutPreferences({ mode: phone ? "mobile" : "desktop" });
rememberTerminalInputMode("direct");

const chosen: (string | null)[] = [];
const interests: Interest[] = [];
function TerminalWindow() {
  const [color, setColor] = useState({ id: "blue", custom: false });
  const [interest, setInterest] = useState<Interest>("watching");
  const [sort, setSort] = useState("attention");
  const onColor = (id: string | null) => {
    chosen.push(id);
    setColor({ id: id ?? "blue", custom: id !== null });
  };
  const choice = { palette: TERMINAL_COLOR_PALETTE, current: color, onColor };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header
        className="world-window-header"
        style={{ display: "flex", alignItems: "center", gap: 4 }}
      >
        <ColorSwatchButton label="Terminal colour" {...choice} />
        <InterestButton
          current={interest}
          onInterest={(next) => {
            interests.push(next);
            setInterest(next);
          }}
        />
        <span style={{ flex: 1 }}>builder</span>
        <ThemedSelect
          aria-label="Sort order"
          value={sort}
          onChange={setSort}
          options={[
            { value: "attention", label: "Attention first" },
            { value: "manual", label: "Manual order" },
          ]}
        />
        <WindowArrangementMenu
          showWindowSwitcher={false}
          control={{
            activePreset: null,
            disabledReasons: {},
            onSelect() {},
          }}
        />
        <WindowControls
          label="builder window"
          controls={{
            maximized: false,
            compact: false,
            onMinimize() {},
            onMaximize() {},
            onClose() {},
            onSnap() {},
            onFloat() {},
            color: choice,
          }}
        />
      </header>
      <div
        className="workspace-terminal-surface"
        style={{ flex: 1, display: "flex", minHeight: 0 }}
      >
        <TerminalView
          terminalTheme={{ background: "#171922", foreground: "#dddddd" }}
          terminalFontScale={100}
        />
      </div>
    </div>
  );
}

const host = document.createElement("div");
host.style.cssText =
  "position:fixed;inset:0;display:flex;flex-direction:column";
document.body.append(host);
// StrictMode runs every layer's effects twice, as development does.
flushSync(() =>
  createRoot(host).render(
    <StrictMode>
      <TerminalWindow />
    </StrictMode>,
  ),
);

const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector);
const textarea = () => $<HTMLTextAreaElement>(".xterm-helper-textarea");
const center = (element: Element) => {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};
async function press(
  element: Element | null,
  label: string,
  at: (element: Element) => { x: number; y: number } = center,
) {
  if (!element) {
    failures.push(`${location.search}: ${label} is missing`);
    return;
  }
  const point = at(element);
  const hit = document.elementFromPoint(point.x, point.y);
  if (!hit || !element.contains(hit))
    failures.push(
      `${location.search}: ${label} is covered by ${hit?.className}`,
    );
  if (phone) {
    await input("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...point, id: 1 }],
    });
    await input("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } else {
    for (const type of ["mousePressed", "mouseReleased"])
      await input("Input.dispatchMouseEvent", {
        type,
        ...point,
        button: "left",
        clickCount: 1,
      });
  }
  await settle();
}
// Lower left, clear of the menus anchored at the top right.
const pressTerminal = () =>
  press($(".xterm-screen"), "terminal", (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + 24, y: rect.bottom - 24 };
  });
async function escape(times = 1) {
  // Several presses before React commits, as a key repeat or a double tap.
  for (let press = 0; press < times; press++)
    for (const type of ["keyDown", "keyUp"])
      await input("Input.dispatchKeyEvent", {
        type,
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
  await settle();
}
async function back() {
  history.back();
  await settle();
}
const menu = () => $('[role="menu"][aria-label="Window actions"]');
const swatches = () => $('.color-swatch-popover [role="group"]');
const select = () => $(".themed-select-content");
const menuTrigger = () =>
  $('button[aria-label="More actions for builder window"]');

async function run() {
  const deadline = performance.now() + 5_000;
  while (!textarea() && performance.now() < deadline) await settle();
  check(Boolean(textarea()), "xterm did not mount");

  // The owner's report: a dropdown over the terminal must close when the
  // terminal is pressed, Radix's popover (closed by the click a touch would
  // make, which the terminal cancels) and the window menu alike.
  await press($('button[aria-label="Sort order"]'), "dropdown trigger");
  check(Boolean(select()), "dropdown did not open");
  await pressTerminal();
  check(!select(), "pressing the terminal left the dropdown open");
  check(openLayerCount() === 0, "a closed dropdown stayed on the stack");

  await press(menuTrigger(), "window menu trigger");
  check(Boolean(menu()), "window menu did not open");
  await pressTerminal();
  check(!menu(), "pressing the terminal left the window menu open");

  // Menus that used to keep their own listeners are on the stack too:
  // Spaces' window arrangement menu closes on a terminal tap and on Escape
  // from the terminal.
  const arrangement = () => $('[role="menu"][aria-label="Arrange windows"]');
  await press($('button[aria-label="Arrange windows"]'), "arrangement menu");
  check(Boolean(arrangement()), "arrangement menu did not open");
  await pressTerminal();
  check(!arrangement(), "pressing the terminal left the arrangement menu open");
  await press($('button[aria-label="Arrange windows"]'), "arrangement menu");
  textarea()?.focus();
  await escape();
  check(
    !arrangement(),
    "Escape from the terminal left the arrangement menu open",
  );

  // Nested layers close top first: Escape, then a press outside.
  await press(menuTrigger(), "window menu trigger");
  await press($(".world-window-color"), "menu colour item");
  check(Boolean(menu() && swatches()), "colour picker did not open in menu");
  check(openLayerCount() === 2, `expected 2 layers, ${openLayerCount()}`);
  await escape();
  check(!swatches(), "Escape left the colour picker open");
  check(Boolean(menu()), "Escape closed the menu below the colour picker");
  await escape();
  check(!menu(), "second Escape left the menu open");

  // The press rule (layerStack.ts): a press outside all layers, here on the
  // terminal, closes every open layer, so one tap returns to the terminal; a
  // press inside a lower layer (the menu) closes only the layers above it.
  // Escape and Back, above, close one layer at a time.
  await press(menuTrigger(), "window menu trigger");
  await press($(".world-window-color"), "menu colour item");
  check(openLayerCount() === 2, `expected 2 layers, ${openLayerCount()}`);
  await pressTerminal();
  check(
    !swatches() && !menu() && openLayerCount() === 0,
    "one press on the terminal left a layer over it",
  );
  await press(menuTrigger(), "window menu trigger");
  await press($(".world-window-color"), "menu colour item");
  // The menu's padding, clear of the picker that may cover its items.
  await press(menu(), "the window menu", (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + 3, y: rect.bottom - 3 };
  });
  check(!swatches(), "a press in the menu left the picker open");
  check(Boolean(menu()), "a press in the menu closed the menu");
  await escape();

  // Two quick Escapes close the two layers, one each.
  await press(menuTrigger(), "window menu trigger");
  await press($(".world-window-color"), "menu colour item");
  await escape(2);
  check(!swatches() && !menu(), "two quick Escapes did not close both layers");

  // A dialog outside the stack, above an open menu, keeps its Escape even
  // when nothing has focus.
  await press(menuTrigger(), "window menu trigger");
  const dialog = document.createElement("div");
  dialog.className = "modal-backdrop";
  let dialogEscapes = 0;
  const onDialogKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") dialogEscapes++;
  };
  window.addEventListener("keydown", onDialogKey);
  document.body.append(dialog);
  (document.activeElement as HTMLElement | null)?.blur();
  await escape();
  check(Boolean(menu()), "Escape for a dialog above closed the menu below");
  check(dialogEscapes === 1, "the dialog above did not receive its Escape");
  dialog.remove();
  window.removeEventListener("keydown", onDialogKey);
  await escape();
  check(!menu(), "Escape after the dialog closed left the menu open");

  // Choosing a colour applies it and closes both layers.
  await press(menuTrigger(), "window menu trigger");
  await press($(".world-window-color"), "menu colour item");
  await press($('.color-swatch-popover [aria-label="Colour green"]'), "green");
  check(
    chosen[chosen.length - 1] === "green",
    `menu chose ${chosen[chosen.length - 1]}`,
  );
  check(!menu() && !swatches(), "choosing a colour left a layer open");
  check(
    $('button[aria-label="Terminal colour: green"]') !== null,
    "the header swatch does not show the chosen colour",
  );

  // The header swatch opens the same picker; Default resets.
  await press($('button[aria-label="Terminal colour: green"]'), "swatch");
  check(Boolean(swatches()), "header swatch did not open the picker");
  await press(
    $(".color-swatch-popover .color-swatches-reset"),
    "Default colour",
  );
  check(chosen[chosen.length - 1] === null, "Default colour did not reset");
  check(!swatches(), "Default colour left the picker open");

  // The agent's interest: a header button opening three choices, one layer.
  const choices = () => $(".interest-popover");
  await press($('button[aria-label="Interest: Watching"]'), "interest");
  check(Boolean(choices()), "the interest button did not open its choices");
  await press($(".interest-popover .interest-choice:nth-child(2)"), "Muted");
  check(
    interests[interests.length - 1] === "muted",
    `interest chose ${interests[interests.length - 1]}`,
  );
  check(!choices(), "choosing an interest left its choices open");
  check(
    $('button[aria-label="Interest: Muted"]') !== null,
    "the header does not show the chosen interest",
  );
  await press($('button[aria-label="Interest: Muted"]'), "interest");
  if (phone) await back();
  else await escape();
  check(!choices(), "Back or Escape left the interest choices open");

  if (phone) {
    // The phone's Back closes the top layer only.
    await press(menuTrigger(), "window menu trigger");
    await press($(".world-window-color"), "menu colour item");
    await back();
    check(!swatches(), "Back left the colour picker open");
    check(Boolean(menu()), "Back closed the menu below the colour picker");
    await back();
    check(!menu(), "second Back left the menu open");
  } else {
    // Focus returns to the terminal that had it, past the menu's trigger.
    await pressTerminal();
    check(document.activeElement === textarea(), "terminal did not focus");
    await press(menuTrigger(), "window menu trigger");
    await press($(".world-window-color"), "menu colour item");
    await escape();
    check(
      menu()?.contains(document.activeElement) === true,
      "closing the colour picker did not return focus to the menu",
    );
    await escape();
    check(
      document.activeElement === textarea(),
      `Escape returned focus to ${document.activeElement?.className}, not the terminal`,
    );
    // A Tab right after the press that opened the dropdown moves focus by
    // keyboard: the dropdown closes.
    await press($('button[aria-label="Sort order"]'), "dropdown trigger");
    check(Boolean(select()), "dropdown did not open before Tab");
    for (const type of ["keyDown", "keyUp"])
      await input("Input.dispatchKeyEvent", {
        type,
        key: "Tab",
        code: "Tab",
        windowsVirtualKeyCode: 9,
      });
    await settle();
    check(!select(), "a quick Tab out left the dropdown open");
    // xterm consumes keys in its textarea; Escape still closes the top layer.
    await press($('button[aria-label="Sort order"]'), "dropdown trigger");
    textarea()?.focus();
    await escape();
    check(!select(), "Escape from the terminal left the dropdown open");
  }
  // The window menu too, on every width.
  await press(menuTrigger(), "window menu trigger");
  textarea()?.focus();
  await escape();
  check(!menu(), "Escape from the terminal left the window menu open");
  check(openLayerCount() === 0, `${openLayerCount()} layers left open`);
}

void run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
