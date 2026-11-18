import { describe, expect, test } from "bun:test";
import {
  Window,
  type HTMLButtonElement,
  type HTMLInputElement,
  type HTMLTextAreaElement,
} from "happy-dom";

const publicRoot = new URL("../../public/", import.meta.url);
const html = await Bun.file(
  new URL("code-view-prototype.html", publicRoot),
).text();
const script = await Bun.file(
  new URL("code-view-prototype/mock.js", publicRoot),
).text();

function fixture(run: (window: Window) => void) {
  const window = new Window({
    url: "https://world.example/code-view-prototype.html",
    settings: {
      disableCSSFileLoading: true,
      disableJavaScriptFileLoading: true,
    },
  });
  try {
    window.fetch = () => {
      throw new Error("The mock must not fetch");
    };
    Object.defineProperty(window, "WebSocket", {
      value: class {
        constructor() {
          throw new Error("The mock must not connect");
        }
      },
    });
    window.document.write(html);
    window.eval(script);
    run(window);
  } finally {
    window.happyDOM.abort();
    window.close();
  }
}

function click(window: Window, action: string, value?: string) {
  const selector = `[data-action="${action}"]${value ? `[data-value="${value}"]` : ""}`;
  const button = window.document.querySelector<HTMLButtonElement>(selector);
  expect(button, selector).not.toBeNull();
  button!.click();
}

describe("synthetic Code view design walkthrough", () => {
  test("a room opens its project and switching projections preserves the selection", () => {
    fixture((window) => {
      click(window, "open", "orchard");
      expect(
        window.document.querySelector("#project-title")?.textContent,
      ).toContain("Orchard");
      expect(window.document.querySelector("#location")?.textContent).toContain(
        "herdr-core",
      );
      click(window, "view", "Board");
      expect(
        window.document.querySelector("#overview")?.hasAttribute("hidden"),
      ).toBe(false);
      click(window, "view", "Code");
      expect(
        window.document.querySelector("#project-title")?.textContent,
      ).toContain("Orchard");
      click(window, "open", "notes");
      expect(window.document.querySelector("#location")?.textContent).toContain(
        "Herdr TUI",
      );
      expect(
        window.document.querySelector("#terminal-title")?.textContent,
      ).toContain("Finch");
    });
  });

  test("agent updates preserve a dirty buffer and require comparison before saving", () => {
    fixture((window) => {
      click(window, "open", "orchard");
      const editor =
        window.document.querySelector<HTMLTextAreaElement>("#buffer")!;
      editor.value = "my unsaved example";
      editor.dispatchEvent(new window.Event("input", { bubbles: true }));
      click(window, "agent-change");
      expect(editor.value).toBe("my unsaved example");
      click(window, "save");
      expect(editor.value).toBe("my unsaved example");
      expect(window.document.querySelector("#notice")?.textContent).toContain(
        "Compare",
      );
      click(window, "panel", "changes");
      expect(
        window.document.querySelector("#change-content")?.textContent,
      ).toContain("my unsaved example");
      click(window, "panel", "pr");
      expect(
        window.document.querySelector("#change-content")?.textContent,
      ).toContain("PR #42");
      click(window, "review");
      expect(
        window.document.querySelector("#checkout-label")?.textContent,
      ).toContain("Scout");
      expect(editor.value).not.toBe("my unsaved example");
      click(window, "checkout", "room");
      expect(editor.value).toBe("my unsaved example");
    });
  });

  test("checkout buffers stay separate and a lost connection revokes terminal control", () => {
    fixture((window) => {
      click(window, "open", "orchard");
      const editor =
        window.document.querySelector<HTMLTextAreaElement>("#buffer")!;
      editor.value = "room draft";
      editor.dispatchEvent(new window.Event("input", { bubbles: true }));
      click(window, "checkout", "agent");
      expect(editor.value).not.toBe("room draft");
      expect(
        window.document.querySelector("#checkout-label")?.textContent,
      ).toContain("Scout");
      click(window, "checkout", "room");
      expect(editor.value).toBe("room draft");
      click(window, "control");
      expect(
        window.document.querySelector<HTMLInputElement>("#terminal-input")
          ?.disabled,
      ).toBe(false);
      click(window, "offline");
      expect(editor.readOnly).toBe(true);
      expect(
        window.document.querySelector<HTMLInputElement>("#terminal-input")
          ?.disabled,
      ).toBe(true);
      click(window, "offline");
      expect(editor.value).toBe("room draft");
      expect(
        window.document.querySelector<HTMLInputElement>("#terminal-input")
          ?.disabled,
      ).toBe(true);
    });
  });

  test("phone panels and runtime terminal selection are interactive without network effects", () => {
    fixture((window) => {
      click(window, "open", "orchard");
      click(window, "mobile", "agents");
      expect(
        window.document.querySelector("#ide")?.getAttribute("data-mobile"),
      ).toBe("agents");
      click(window, "terminal", "reviewer");
      expect(
        window.document.querySelector("#terminal-title")?.textContent,
      ).toContain("Wren");
      click(window, "control");
      const input =
        window.document.querySelector<HTMLInputElement>("#terminal-input")!;
      input.value = "hello example";
      click(window, "send");
      expect(
        window.document.querySelector("#terminal-output")?.textContent,
      ).toContain("hello example");
      expect(window.localStorage.length).toBe(0);
    });
  });
});
