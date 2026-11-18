import { describe, expect, test } from "bun:test";
import { Window, type HTMLButtonElement } from "happy-dom";

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

describe("real IDE integration design walkthrough", () => {
  test("room, agent and checkout identity survive projection changes and PR review", () => {
    fixture((window) => {
      const content = (id: string) =>
        window.document.querySelector(id)?.textContent;
      click(window, "open", "orchard");
      expect(content("#provider-label")).toContain("Microsoft");
      expect(content("#location")).toContain("demo-local");
      expect(window.document.querySelector("textarea")).toBeNull();
      click(window, "checkout", "agent");
      click(window, "terminal", "Wren");
      expect(content("#terminal-title")).toContain("Wren");
      expect(content("#checkout-label")).toContain("Scout");
      click(window, "view", "Board");
      click(window, "view", "Code");
      expect(content("#project-title")).toBe("Orchard");
      expect(content("#checkout-label")).toContain("Scout");
      click(window, "agent-change");
      expect(content("#code-content")).toContain("Hello");
      click(window, "panel", "pr");
      expect(content("#change-content")).toContain("PR #42");
      click(window, "review");
      expect(content("#notice")).toContain("exact checkout");
      expect(window.localStorage.length).toBe(0);
    });
  });

  test("IDE discovery and enablement are per host, with explicit provider choice", () => {
    fixture((window) => {
      const hidden = (id: string) =>
        window.document.querySelector(id)?.hasAttribute("hidden");
      click(window, "open", "orchard");
      click(window, "integrations");
      expect(
        window.document.querySelector("#picker-host")?.textContent,
      ).toContain("demo-local");
      expect(
        window.document.querySelector("#provider-list")?.textContent,
      ).toContain("Open VSX");
      click(window, "enable", "openvscode");
      click(window, "provider", "openvscode");
      expect(
        window.document.querySelector("#provider-label")?.textContent,
      ).toBe("OpenVSCode Server");
      expect(hidden("#picker")).toBe(true);
      click(window, "open", "notes");
      expect(hidden("#workbench")).toBe(true);
      expect(
        window.document.querySelector("#unavailable-title")?.textContent,
      ).toContain("not installed");
      click(window, "integrations");
      expect(
        window.document.querySelector("#picker-host")?.textContent,
      ).toContain("demo-ssh");
      click(window, "installed", "microsoft");
      click(window, "close-picker");
      expect(
        window.document.querySelector("#unavailable-title")?.textContent,
      ).toContain("disabled");
      click(window, "integrations");
      click(window, "enable", "microsoft");
      click(window, "provider", "microsoft");
      expect(hidden("#workbench")).toBe(false);
      click(window, "open", "orchard");
      expect(
        window.document.querySelector("#provider-label")?.textContent,
      ).toBe("OpenVSCode Server");
    });
  });

  test("embedding failures never substitute a provider, and desktop handoff keeps SSH context", () => {
    fixture((window) => {
      click(window, "open", "notes");
      click(window, "blocked");
      expect(
        window.document.querySelector("#unavailable-detail")?.textContent,
      ).toContain("Microsoft CDN");
      expect(
        window.document.querySelector("#provider-label")?.textContent,
      ).toContain("Microsoft");
      click(window, "checkout", "agent");
      click(window, "desktop");
      click(window, "desktop-target", "JetBrains Gateway");
      expect(
        window.document.querySelector("#handoff-project")?.textContent,
      ).toContain("finch/notes");
      expect(
        window.document.querySelector("#handoff-detail")?.textContent,
      ).toContain("SSH/Gateway");
      expect(
        window.document.querySelector("#handoff-detail")?.textContent,
      ).toContain("No app launched");
      expect(window.location.href).toBe(
        "https://world.example/code-view-prototype.html",
      );
      click(window, "close-handoff");
      click(window, "offline");
      click(window, "desktop");
      expect(
        window.document.querySelector("#handoff-detail")?.textContent,
      ).toContain("unavailable");
      const targets = window.document.querySelectorAll<HTMLButtonElement>(
        ".handoff-options button",
      );
      expect([...targets].every((target) => target.disabled)).toBe(true);
    });
  });

  test("Herdr attach requires shared-resize acknowledgement and reconnect does not reattach", () => {
    fixture((window) => {
      click(window, "open", "notes");
      click(window, "integrations");
      click(window, "enable", "coder");
      click(window, "provider", "coder");
      click(window, "attach");
      expect(window.document.querySelector("#attach")?.textContent).toContain(
        "Confirm shared resize",
      );
      expect(
        window.document.querySelector("#terminal-title")?.textContent,
      ).not.toContain("Attached");
      expect(
        window.document.querySelector("#resize-warning")?.textContent,
      ).toContain("every viewer");
      click(window, "attach");
      expect(
        window.document.querySelector("#terminal-title")?.textContent,
      ).toContain("Attached");
      expect(
        window.document.querySelector("#terminal-output")?.textContent,
      ).toContain("No replacement process");
      click(window, "offline");
      click(window, "offline");
      expect(
        window.document.querySelector("#terminal-title")?.textContent,
      ).not.toContain("Attached");
      expect(window.document.querySelector("#notice")?.textContent).toContain(
        "no input replay",
      );
      click(window, "attach");
      click(window, "attach");
      click(window, "view", "Town");
      click(window, "view", "Code");
      expect(
        window.document.querySelector("#terminal-title")?.textContent,
      ).not.toContain("Attached");
    });
  });

  test("phones retain native panels and core profiles do not inherit TUI resize confirmation", () => {
    fixture((window) => {
      click(window, "open", "orchard");
      click(window, "mobile", "files");
      expect(
        window.document
          .querySelector("#native-content")
          ?.hasAttribute("hidden"),
      ).toBe(false);
      click(window, "mobile", "agents");
      click(window, "terminal", "Wren");
      expect(
        window.document.querySelector("#agent-context")?.textContent,
      ).toContain("Native World terminal");
      click(window, "attach");
      expect(
        window.document.querySelector("#terminal-title")?.textContent,
      ).toContain("Attached");
      expect(
        window.document.querySelector("#terminal-output")?.textContent,
      ).toContain("Core screen-watch");
      click(window, "mobile", "changes");
      expect(
        window.document.querySelector("#ide")?.getAttribute("data-mobile"),
      ).toBe("changes");
      click(window, "reset");
      expect(
        window.document.querySelector("#overview")?.hasAttribute("hidden"),
      ).toBe(false);
    });
  });

  test("integration dialogs contain keyboard focus and Escape restores the trigger", () => {
    fixture((window) => {
      const trigger = window.document.querySelector<HTMLButtonElement>(
        '[data-action="integrations"]',
      )!;
      trigger.focus();
      trigger.click();
      const buttons = [
        ...window.document.querySelectorAll<HTMLButtonElement>(
          "#picker button:not(:disabled)",
        ),
      ];
      const first = buttons[0]!,
        last = buttons[buttons.length - 1]!;
      expect(window.document.activeElement).toBe(first);
      last.focus();
      window.document.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Tab" }),
      );
      expect(window.document.activeElement).toBe(first);
      window.document.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape" }),
      );
      expect(window.document.activeElement).toBe(trigger);
      expect(
        window.document.querySelector("#picker")?.hasAttribute("hidden"),
      ).toBe(true);
      click(window, "open", "orchard");
      const desktop = window.document.querySelector<HTMLButtonElement>(
        '[data-action="desktop"]',
      )!;
      desktop.focus();
      desktop.click();
      click(window, "desktop-target", "Cursor");
      window.document.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape" }),
      );
      expect(window.document.activeElement).toBe(desktop);
    });
  });
});
