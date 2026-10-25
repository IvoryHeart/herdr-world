import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { bridge, type ConnectionClient, type TerminalPush } from "./api";
import { __storeTesting, store } from "./store";
import { TerminalView } from "./components/TerminalView";
import {
  readTerminalInputMode,
  rememberTerminalInputMode,
} from "./terminalInputMode";
import {
  readTerminalComposerDraft,
  terminalComposerDraftKey,
  writeTerminalComposerDraft,
} from "./terminalComposer";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout/app.css";

const frames = new Set<(frame: TerminalPush) => void>();
const sent: { terminal: unknown; data: string }[] = [];
const client: ConnectionClient = {
  connectionId: "keyboard-host",
  generation: 1,
  serverRuntimeGeneration: 1,
  isCurrent: () => true,
  acceptsServerGeneration: (generation) => generation === 1,
  call: async (method, params = {}) => {
    if (method === "terminal.attach") {
      for (const listener of frames)
        listener({
          connection_id: client.connectionId,
          connection_generation: 1,
          terminal_id: String(params.terminal_id),
          width: Number(params.cols),
          height: Number(params.rows),
          full: true,
          mouse_reporting: false,
          bytes: btoa("keyboard ready"),
        });
    }
    if (method === "terminal.input")
      sent.push({
        terminal: params.terminal_id,
        data: atob(String(params.data)),
      });
    return {};
  },
};
const boundary = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
async function input(method: string, params: Record<string, unknown>) {
  const response = await fetch("/input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  if (!response.ok) throw new Error("Trusted keyboard input failed");
  await boundary();
}
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
async function click(element: Element) {
  const rect = element.getBoundingClientRect();
  for (const type of ["mousePressed", "mouseReleased"])
    await input("Input.dispatchMouseEvent", {
      type,
      button: "left",
      clickCount: 1,
      x: rect.x + Math.min(rect.width / 2, 80),
      y: rect.y + Math.min(rect.height / 2, 40),
    });
}
async function run() {
  await input("Emulation.setUserAgentOverride", {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
    platform: "MacIntel",
  });
  bridge.connection = () => client;
  bridge.onTerminal = (listener) => {
    frames.add(listener);
    return () => frames.delete(listener);
  };
  bridge.onTerminalClosed = () => () => {};
  store.init = () => {};
  __storeTesting.replaceState({
    ...store.get(),
    status: "connected",
    activeConnectionId: client.connectionId,
    defaultConnectionId: client.connectionId,
    connectionGeneration: 1,
    serverRuntimeGeneration: 1,
    selectedPaneId: "pane-a",
    panes: [
      {
        pane_id: "pane-a",
        terminal_id: "terminal-a",
        workspace_id: "workspace-a",
        tab_id: "tab-a",
        focused: true,
        agent_status: "idle",
        revision: 1,
      },
    ],
    layout: {
      workspace_id: "workspace-a",
      tab_id: "tab-a",
      zoomed: false,
      area: { x: 0, y: 0, width: 80, height: 24 },
      focused_pane_id: "pane-a",
      splits: [],
      panes: [
        {
          pane_id: "pane-a",
          focused: true,
          rect: { x: 0, y: 0, width: 80, height: 24 },
        },
      ],
    },
  });
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;display:flex";
  document.body.append(host);
  const root = createRoot(host);
  const render = (open: boolean) =>
    flushSync(() =>
      root.render(
        <TerminalView
          paneId="pane-a"
          terminalTheme={{}}
          terminalFontScale={1}
          composerOpen={open}
        />,
      ),
    );
  try {
    if (window.innerWidth < 640) {
      rememberTerminalInputMode("composer");
      render(true);
      await boundary();
      const draftKey = terminalComposerDraftKey(
        client.connectionId,
        1,
        "pane-a",
      );
      writeTerminalComposerDraft(draftKey, "preserved draft\nsecond line");
      await boundary();
      const editor = host.querySelector<HTMLTextAreaElement>(
        ".terminal-composer-input",
      );
      const direct = host.querySelector<HTMLButtonElement>(
        ".terminal-mobile-direct",
      );
      check(editor && direct, "Direct controls missing");
      await click(editor);
      await boundary();
      check(
        host.querySelector(".terminal-composer[data-expanded]"),
        "Long draft did not expand composer",
      );
      check(
        getComputedStyle(direct).display !== "none" &&
          direct.getBoundingClientRect().width > 0,
        "Expanded Message draft hides Direct terminal control",
      );
      await click(direct);
      check(
        document.activeElement?.classList.contains("xterm-helper-textarea"),
        `Direct did not focus terminal: ${document.activeElement?.className}`,
      );
      const start = sent.length;
      await input("Input.insertText", { text: "direct probe" });
      check(
        sent
          .slice(start)
          .map((entry) => entry.data)
          .join("") === "direct probe",
        "Direct typing did not reach terminal",
      );
      check(
        readTerminalComposerDraft(draftKey) === "preserved draft\nsecond line",
        "Direct typing changed Message draft",
      );
      for (const [key, code, virtualKey, modifiers, expected] of [
        ["c", "KeyC", 67, 2, "\x03"],
        ["r", "KeyR", 82, 2, "\x12"],
        ["l", "KeyL", 76, 2, "\x0c"],
        ["ArrowUp", "ArrowUp", 38, 0, "\x1b[A"],
        ["ArrowDown", "ArrowDown", 40, 0, "\x1b[B"],
        ["ArrowLeft", "ArrowLeft", 37, 0, "\x1b[D"],
        ["ArrowRight", "ArrowRight", 39, 0, "\x1b[C"],
        ["Escape", "Escape", 27, 0, "\x1b"],
      ] as const) {
        const before = sent.length;
        for (const type of ["keyDown", "keyUp"])
          await input("Input.dispatchKeyEvent", {
            type,
            key,
            code,
            windowsVirtualKeyCode: virtualKey,
            modifiers,
          });
        check(
          sent
            .slice(before)
            .map((entry) => entry.data)
            .join("") === expected,
          `Direct ${key} did not reach terminal`,
        );
      }
      check(
        readTerminalComposerDraft(draftKey) === "preserved draft\nsecond line",
        "Direct keys changed draft",
      );
      return;
    }
    for (const open of [false, true]) {
      rememberTerminalInputMode("composer");
      render(open);
      await boundary();
      const screen = host.querySelector(".xterm-screen");
      check(screen, "Terminal screen missing");
      const draftKey = terminalComposerDraftKey(
        client.connectionId,
        1,
        "pane-a",
      );
      if (open) writeTerminalComposerDraft(draftKey, "unsent note");
      await click(screen);
      if (open) {
        check(
          readTerminalComposerDraft(draftKey) === "unsent note",
          "Returning to output lost the Message draft",
        );
        check(
          readTerminalInputMode() === "composer",
          "Output click changed the saved input preference",
        );
      }
      for (const [key, code, virtualKey, modifiers, expected] of [
        ["c", "KeyC", 67, 2, "\x03"],
        ["r", "KeyR", 82, 2, "\x12"],
        ["l", "KeyL", 76, 2, "\x0c"],
        ["ArrowUp", "ArrowUp", 38, 0, "\x1b[A"],
        ["ArrowDown", "ArrowDown", 40, 0, "\x1b[B"],
        ["ArrowLeft", "ArrowLeft", 37, 0, "\x1b[D"],
        ["ArrowRight", "ArrowRight", 39, 0, "\x1b[C"],
        ["Escape", "Escape", 27, 0, "\x1b"],
      ] as const) {
        const start = sent.length;
        for (const type of ["keyDown", "keyUp"])
          await input("Input.dispatchKeyEvent", {
            type,
            key,
            code,
            windowsVirtualKeyCode: virtualKey,
            modifiers,
          });
        check(
          sent
            .slice(start)
            .map((entry) => entry.data)
            .join("") === expected,
          `Message ${open ? "open" : "closed"}: ${key} did not reach the terminal`,
        );
        check(
          sent.slice(start).every((entry) => entry.terminal === "terminal-a"),
          "Input changed terminal owner",
        );
      }
    }
  } finally {
    root.unmount();
    host.remove();
  }
}
run()
  .then(() => fetch("/result", { method: "POST", body: "[]" }))
  .catch((error) =>
    fetch("/result", { method: "POST", body: JSON.stringify([String(error)]) }),
  );
