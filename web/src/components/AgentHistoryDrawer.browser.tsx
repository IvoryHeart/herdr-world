import { createRoot } from "react-dom/client";
import { bridge } from "../api";
import { store } from "../store";
import { copyTextWithFeedback } from "../copyText";
import { AgentHistoryDrawer } from "./AgentHistoryDrawer";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/vendor.css";

const failures: string[] = [];
function check(condition: boolean, message: string) {
  if (!condition) failures.push(message);
}
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 80));
}

async function run() {
  const originalConnection = bridge.connection;
  let toolFetches = 0;
  bridge.connection = () => ({
    connectionId: "test",
    generation: 1,
    serverRuntimeGeneration: null,
    isCurrent: () => true,
    acceptsServerGeneration: () => true,
    call: async (method) =>
      method === "agent_session.get"
        ? { status: "ok", stats: { turns: 1, records: 3 } }
        : method === "agent_history.entry"
          ? (toolFetches++, { text: "Tool output ready" })
          : {
              status: "ok",
              history_version: 2,
              mode: "snapshot",
              window_limit: 200,
              cursor: { epoch: "test", revision: 1 },
              entries: [
                {
                  id: "message-1",
                  role: "assistant",
                  kind: "message",
                  text: "# Example\n\nA message for desktop layout verification.",
                  sent_at: new Date(
                    new Date().getFullYear(),
                    8,
                    20,
                    17,
                    38,
                  ).toISOString(),
                },
                {
                  id: "user-1",
                  role: "user",
                  kind: "message",
                  text: "Searchable 中文 note from the user.",
                  sent_at: new Date(
                    new Date().getFullYear() - 1,
                    0,
                    2,
                    0,
                    5,
                  ).toISOString(),
                },
                {
                  id: "tool-1",
                  role: "tool",
                  kind: "tool_result",
                  tool_name: "read",
                  text: "",
                  text_bytes: 17,
                  sent_at: "2026-01-01T00:01:00Z",
                },
              ],
            },
  });
  const container = document.createElement("div");
  container.style.cssText = "display:flex;height:600px;width:1000px";
  document.body.append(container);
  const root = createRoot(container);
  const render = (wide: boolean, paneId = "p") =>
    root.render(
      <AgentHistoryDrawer
        pane={{
          pane_id: paneId,
          terminal_id: "terminal",
          workspace_id: "Example",
          tab_id: "tab",
          focused: true,
          agent: "pi",
          agent_status: "Idle",
          revision: 1,
        }}
        open
        embedded
        wide={wide}
        onOpenChange={() => {}}
      />,
    );
  const checkHeader = async (context: string) => {
    const header = container.querySelector<HTMLElement>(
      ".agent-history-drawer-head",
    )!;
    const actions = container.querySelector<HTMLElement>(
      ".agent-history-actions",
    )!;
    const details = actions.querySelector<HTMLButtonElement>(
      '[aria-label="Session details"]',
    )!;
    check(
      !container.querySelector(
        '[role="tablist"], [role="tabpanel"], .agent-history-footer',
      ),
      `${context}: history must not reserve tab or footer rows`,
    );
    check(
      !!container.querySelector(".agent-history-title .agent-history-count"),
      `${context}: history count must share the title`,
    );
    check(
      actions.querySelectorAll("button").length === 4,
      `${context}: details, transcript, export and refresh must share the header`,
    );
    for (const button of actions.querySelectorAll("button")) {
      const bounds = button.getBoundingClientRect();
      const headerBounds = header.getBoundingClientRect();
      check(
        !!button.getAttribute("aria-label") &&
          !!button.title &&
          bounds.width >= 28 &&
          bounds.height >= 28 &&
          bounds.right <= headerBounds.right &&
          bounds.bottom <= headerBounds.bottom,
        `${context}: header icons must be labeled, usable and fully visible`,
      );
    }
    check(
      !!actions.querySelector('[aria-label="Open transcript"]') &&
        !!actions.querySelector('[aria-label="Export raw session"]'),
      `${context}: both session actions must remain available`,
    );
    const search = container.querySelector<HTMLElement>(
      ".agent-history-search",
    )!;
    check(
      Math.abs(
        search.getBoundingClientRect().top -
          header.getBoundingClientRect().bottom,
      ) <= 1,
      `${context}: messages must start immediately below the header`,
    );
    check(
      header.scrollWidth <= header.clientWidth,
      `${context}: header must not overflow`,
    );
    const selectedSequence = container.querySelector<HTMLElement>(
      ".agent-history-card.is-selected",
    )?.dataset.sequence;
    details.focus();
    details.click();
    await settle();
    check(
      details.getAttribute("aria-pressed") === "true" &&
        !!container.querySelector(
          '[role="region"][aria-label="Session details"]',
        ) &&
        !container.querySelector('[aria-label="Search history messages"]'),
      `${context}: the info toggle must show session metadata`,
    );
    check(
      container.textContent?.includes("Session ID") === true,
      `${context}: session metadata must remain available`,
    );
    details.click();
    await settle();
    check(
      details.getAttribute("aria-pressed") === "false" &&
        !!container.querySelector(
          '[role="region"][aria-label="History messages"]',
        ) &&
        document.activeElement === details,
      `${context}: the toggle must restore history and retain keyboard focus`,
    );
    check(
      container.querySelector<HTMLElement>(".agent-history-card.is-selected")
        ?.dataset.sequence === selectedSequence,
      `${context}: toggling metadata must preserve the selected message`,
    );
  };
  try {
    render(true);
    for (
      let i = 0;
      i < 100 && !container.querySelector('[aria-label="Open transcript"]');
      i++
    )
      await settle();
    for (const theme of ["dark", "light"]) {
      document.documentElement.dataset.theme = theme;
      for (const width of [1000, 640]) {
        container.style.width = `${width}px`;
        await settle();
        await checkHeader(`${theme} wide ${width}px`);
        check(
          container.scrollWidth <= width,
          `${theme} ${width}: horizontal overflow`,
        );
        const entry = container.querySelector<HTMLButtonElement>(
          ".agent-history-card-open",
        );
        check(!!entry, "History fixture must render a selectable message");
        entry?.focus();
        check(
          document.activeElement === entry,
          "Message open action must remain keyboard-focusable",
        );
        container
          .querySelector<HTMLElement>(".agent-history-card-meta")
          ?.click();
        await settle();
        check(
          container.querySelector(".agent-history-card time")?.textContent ===
            "09-20 17:38" &&
            container.querySelector(".agent-history-card.is-user time")
              ?.textContent === `${new Date().getFullYear() - 1}-01-02 00:05`,
          "Card timestamps must use local 24-hour dates and show other years",
        );
        const reader = container.querySelector<HTMLElement>(
          ".agent-history-wide-detail .agent-message-modal-content",
        );
        check(
          !!reader && getComputedStyle(reader).borderTopWidth === "0px",
          "Reader must not have a nested card border",
        );
        const readerHeader = container.querySelector<HTMLElement>(
          ".agent-history-wide-detail .agent-message-modal-head",
        );
        check(
          !!readerHeader && getComputedStyle(readerHeader).display === "flex",
          `${theme} ${width}: inline message header must keep its flex layout`,
        );
        const title = readerHeader?.firstElementChild;
        const controls = readerHeader?.lastElementChild;
        if (title && controls) {
          const titleRect = title.getBoundingClientRect();
          const controlsRect = controls.getBoundingClientRect();
          check(
            controlsRect.left >= titleRect.right &&
              controlsRect.top < titleRect.bottom &&
              controlsRect.bottom > titleRect.top,
            `${theme} ${width}: inline message actions must stay beside the title`,
          );
        }
      }
    }
    const search = async (text: string) => {
      const input = container.querySelector<HTMLInputElement>(
        '[aria-label="Search history messages"]',
      )!;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await settle();
    };
    await search("  中文  ");
    await checkHeader("Filtered history");
    check(
      container.querySelector<HTMLInputElement>('input[type="search"]')
        ?.value === "  中文  " &&
        container.querySelector(".agent-history-count")?.textContent === "1/3",
      "Details toggle must preserve the search and filtered count",
    );
    check(
      container.querySelectorAll(".agent-history-card").length === 1 &&
        !!container.querySelector(".agent-history-card.is-user"),
      "Search must filter message text including Chinese",
    );
    check(
      !container.querySelector(
        ".agent-history-wide-detail .agent-message-modal-content",
      ),
      "Search must hide a selected detail that no longer matches",
    );
    check(
      !container.querySelector('[role="slider"]'),
      "Minimap must follow the searched list",
    );
    container
      .querySelector<HTMLButtonElement>(".agent-history-filter.is-user")!
      .click();
    await settle();
    check(
      container.querySelectorAll(".agent-history-card").length === 0,
      "Search must respect role toggles",
    );
    await search("unmatched text");
    check(
      container
        .querySelector(".agent-history-state")
        ?.textContent?.includes("No entries match the search") === true,
      "Search must explain empty results",
    );
    container
      .querySelector<HTMLButtonElement>(".agent-history-state button")!
      .click();
    await settle();
    check(
      container.querySelector<HTMLInputElement>('input[type="search"]')
        ?.value === "" &&
        container.querySelectorAll(".agent-history-card").length === 3,
      "Reset filters must clear search and restore entries",
    );
    check(toolFetches === 0, "Search must not download unloaded tool payloads");
    container
      .querySelector<HTMLButtonElement>(".agent-history-filter.is-tool")!
      .click();
    await settle();
    await search("DESKTOP LAYOUT");
    check(
      container.querySelectorAll(".agent-history-card").length === 1 &&
        !!container.querySelector(".agent-history-card.is-assistant"),
      "Search must ignore text case",
    );
    await search("");
    container.querySelector<HTMLElement>(".agent-history-card")!.click();
    await settle();
    check(
      !!container.querySelector(
        ".agent-history-wide-detail .agent-message-modal-content",
      ),
      "Card whitespace must open the detail",
    );

    // Exercise the real copy buttons with the Clipboard API absent (HTTP).
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    const originalExecCommand = document.execCommand;
    const copied: string[] = [];
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      });
      document.execCommand = (command) => {
        if (command !== "copy") return false;
        copied.push((document.activeElement as HTMLTextAreaElement).value);
        return true;
      };
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Close message detail"]',
        )!
        .click();
      await settle();
      container
        .querySelector<HTMLButtonElement>(".agent-history-copy")!
        .click();
      await settle();
      check(
        !container.querySelector(
          ".agent-history-wide-detail .agent-message-modal-content",
        ),
        "Copy must not open the message detail",
      );
      copied.length = 0;
      container.querySelector<HTMLElement>(".agent-history-card-meta")!.click();
      await settle();
      for (const selector of [
        ".agent-history-copy",
        '[aria-label="Copy message"]',
      ]) {
        const button = container.querySelector<HTMLButtonElement>(selector);
        check(!!button, `Missing copy button: ${selector}`);
        button?.click();
      }
      check(
        copied.length === 2 &&
          copied.every((text) => text.startsWith("# Example")),
        "History and message copies must use the HTTP fallback",
      );
      await Promise.resolve();
      check(
        store.get().notice?.kind === "success",
        "Successful copies must provide feedback",
      );
      document.execCommand = () => false;
      await copyTextWithFeedback("unavailable");
      check(
        store.get().notice?.kind === "error",
        "Missing clipboard support must report failure",
      );
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error("Clipboard denied");
          },
        },
      });
      await copyTextWithFeedback("denied");
      check(
        store.get().notice?.detail === "Clipboard denied",
        "Clipboard denial must not be an unhandled rejection",
      );
      for (const olderFails of [true, false]) {
        const olderWrite = Promise.withResolvers<void>();
        let writes = 0;
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: () => {
              if (++writes === 1) return olderWrite.promise;
              return olderFails
                ? Promise.resolve()
                : Promise.reject(new Error("latest copy denied"));
            },
          },
        });
        const olderCopy = copyTextWithFeedback("older");
        await copyTextWithFeedback("latest");
        const latestNotice = store.get().notice;
        check(
          latestNotice?.kind === (olderFails ? "success" : "error"),
          "Latest copy must report its outcome",
        );
        if (olderFails) olderWrite.reject(new Error("older copy denied"));
        else olderWrite.resolve();
        await olderCopy;
        check(
          store.get().notice === latestNotice,
          "Superseded copy must not overwrite the latest feedback",
        );
      }
    } finally {
      document.execCommand = originalExecCommand;
      if (clipboardDescriptor)
        Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
      else Reflect.deleteProperty(navigator, "clipboard");
      store.clearNotice();
    }
    document.documentElement.dataset.layout = "mobile";
    render(false);
    for (const theme of ["dark", "light"]) {
      document.documentElement.dataset.theme = theme;
      for (const width of [380, 320]) {
        container.style.width = `${width}px`;
        await settle();
        await checkHeader(`${theme} compact ${width}px`);
        check(
          container.scrollWidth <= width,
          `${theme} compact ${width}px: horizontal overflow`,
        );
        const drawer = container.querySelector<HTMLElement>(
          ".agent-history-drawer",
        )!;
        const content = container.querySelector<HTMLElement>(
          ".agent-history-content",
        )!;
        check(
          Math.abs(
            drawer.getBoundingClientRect().bottom -
              content.getBoundingClientRect().bottom,
          ) <= 1,
          `${theme} compact ${width}px: history must use the former footer space`,
        );
      }
    }
    container.style.width = "380px";
    container.querySelector<HTMLElement>(".agent-history-card-meta")!.click();
    await settle();
    check(
      !!document.querySelector(".agent-message-modal"),
      "Compact card header must open the modal detail",
    );
    document
      .querySelector<HTMLButtonElement>('[aria-label="Close message"]')!
      .click();
    await settle();
    await search("中文");
    check(
      container.querySelectorAll(".agent-history-card").length === 1,
      "Compact search must filter messages",
    );
    await search("");
    delete document.documentElement.dataset.layout;
    render(true);
    container.style.width = "1000px";
    await settle();
    await checkHeader("Restored wide layout");
    container
      .querySelector<HTMLButtonElement>(".agent-history-filter.is-tool")!
      .click();
    await settle();
    container
      .querySelector<HTMLElement>('[role="slider"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true }),
      );
    await settle();
    check(
      container
        .querySelector(".agent-history-wide-detail")
        ?.textContent?.includes("Tool output ready") === true,
      "Selecting a redacted tool entry must fetch its inline content",
    );
    await search("OUTPUT READY");
    check(
      container.querySelectorAll(".agent-history-card").length === 1 &&
        !!container.querySelector(".agent-history-card.is-tool"),
      "Search must include explicitly loaded tool text",
    );
    container
      .querySelector<HTMLButtonElement>('[aria-label="Session details"]')!
      .click();
    await settle();
    render(true, "replacement-pane");
    await settle();
    check(
      container.querySelector<HTMLInputElement>('input[type="search"]')
        ?.value === "",
      "Search must reset when switching sessions",
    );
    check(
      container
        .querySelector('[aria-label="Session details"]')
        ?.getAttribute("aria-pressed") === "false",
      "Session changes must restore history instead of stale details",
    );
  } finally {
    root.unmount();
    container.remove();
    bridge.connection = originalConnection;
    delete document.documentElement.dataset.layout;
    delete document.documentElement.dataset.theme;
  }
}

run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
