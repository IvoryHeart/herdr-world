import { expect, mock, test } from "bun:test";
import { useLayoutEffect } from "react";
import { applyAppearance } from "../../../shared/appearance";
import { tabCardKey } from "../../../shared/terminalColor";
import { TERMINAL_COLOR_PALETTE } from "./terminalColor";

if (process.env.HERDR_APPEARANCE_EDITOR_DOM_TEST !== "1") {
  test("appearance editor drafts in an isolated DOM runtime", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, HERDR_APPEARANCE_EDITOR_DOM_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  }, 15_000);
} else {
  test("typing in the commit that brings a new shared name and status keeps the typed drafts, and a refused rename keeps its draft", async () => {
    const { Window } = await import("happy-dom");
    const browser = new Window({ url: "http://localhost" });
    for (const [key, value] of Object.entries({
      window: browser,
      document: browser.document,
      navigator: browser.navigator,
      HTMLElement: browser.HTMLElement,
      HTMLInputElement: browser.HTMLInputElement,
      Element: browser.Element,
      Node: browser.Node,
      Event: browser.Event,
    }))
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });
    const tab = {
      connection_id: "alpha",
      connection_generation: 3,
      kind: "tab" as const,
      native_id: "tab-1",
      color_key: tabCardKey("alpha", "tab-1", new Set(["space-1"])),
      witness: ["terminal-1"],
    };
    const shared: { document: unknown } = { document: null };
    mock.module("./appearance", () => ({
      useAppearanceDocument: () => shared.document,
      saveAppearance: async () => null,
      renameAppearanceTab: async () => {
        throw new Error("Synthetic native rename refused");
      },
    }));
    const { TerminalAppearanceEditor } = await import(
      "./TerminalAppearanceEditor"
    );
    const { createRoot } = await import("react-dom/client");
    const field = (label: string) =>
      document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    // Type as a user does: the native value, then an input event.
    const type = (label: string, text: string) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(field(label), text);
      field(label).dispatchEvent(new Event("input", { bubbles: true }));
    };
    // Keystrokes inside the commit that carries the new shared values: the
    // ordering in which a value synchronized after commit overwrote them.
    function TypeDuringCommit({ when }: { when: boolean }) {
      useLayoutEffect(() => {
        if (!when) return;
        type("Tab name", "Typed name");
        type("Tab status message", "Typed status");
      }, [when]);
      return null;
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = (tabName: string, typing: boolean) =>
      root.render(
        <>
          <TerminalAppearanceEditor
            connectionId="alpha"
            generation={3}
            tabId="tab-1"
            paneId="pane-1"
            terminalId="terminal-1"
            workspaceIds={["space-1"]}
            tabName={tabName}
            color={{
              palette: TERMINAL_COLOR_PALETTE,
              current: { id: "blue", custom: false },
              onColor: () => {},
            }}
          />
          <TypeDuringCommit when={typing} />
        </>,
      );
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
    render("Native name", false);
    await settle();
    expect(field("Tab name").value).toBe("Native name");

    const document_ = { layout: {}, appearance: {} };
    applyAppearance(document_ as never, tab, { status: "Shared status" });
    shared.document = document_;
    render("Shared native name", true);
    await settle();
    expect(field("Tab name").value).toBe("Typed name");
    expect(field("Tab status message").value).toBe("Typed status");

    const save = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Save name",
    )!;
    save.click();
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Synthetic native rename refused",
    );
    expect(field("Tab name").value).toBe("Typed name");
    root.unmount();
  });
}
