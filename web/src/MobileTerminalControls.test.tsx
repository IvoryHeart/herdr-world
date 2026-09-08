import { CommandDraftContext, createCommandDraftStore } from "./commandDrafts";
/**
 * @vitest-environment jsdom
 */
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isCommandComposerSubmitShortcut,
  TerminalCommandControls,
} from "./TerminalView";

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount();
    }
  });
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("TerminalCommandControls", () => {
  for (const expandingInput of [false, true]) {
    it(`clears and remounts the ${
      expandingInput ? "textarea" : "input"
    } after Send`, async () => {
      const { commandInputRef, container, onSubmitCommand } =
        await renderControls(expandingInput);
      const firstField = commandField(container);

      await setCommandValue(firstField, "first prompt");
      firstField.defaultValue = "first prompt";
      firstField.focus();
      await submitForm(container);

      expect(onSubmitCommand).toHaveBeenLastCalledWith("first prompt");
      expect(firstField.value).toBe("");
      expect(firstField.defaultValue).toBe("");

      const secondField = commandField(container);
      expect(secondField).not.toBe(firstField);
      expect(secondField.value).toBe("");
      expect(secondField.defaultValue).toBe("");
      expect(commandInputRef.current).toBe(secondField);
      expect(document.activeElement).not.toBe(secondField);

      await setCommandValue(secondField, "second prompt");
      expect(secondField.value).toBe("second prompt");
      await submitForm(container);

      expect(onSubmitCommand).toHaveBeenLastCalledWith("second prompt");
      expect(onSubmitCommand).toHaveBeenCalledTimes(2);
    });
  }

  for (const expanding of [false, true]) {
    it(`refocuses mobile Send when enabled, with guard intact (textarea=${expanding})`, async () => {
      vi.spyOn(performance, "now").mockReturnValue(1000);
      const { container } = await renderControls(expanding, { mobileFocusAfterSubmit: true });
      const original = commandField(container);
      original.focus();
      await setCommandValue(original, "dictated command");
      await submitForm(container);
      const replacement = commandField(container);
      expect(replacement).not.toBe(original);
      expect(document.activeElement).toBe(replacement);
      expect(replacement.value).toBe("");
      await setCommandInput(replacement, "late correction", "insertCompositionText", true);
      expect(replacement.value).toBe("");
      expect(document.activeElement).toBe(replacement);
      await setCommandInput(replacement, "next", "insertText");
      expect(replacement.value).toBe("next");
      await clickStage(container);
      expect(commandField(container).value).toBe("");
      expect(document.activeElement).not.toBe(commandField(container));
    });
  }

  for (const expanding of [false, true]) {
    for (const action of ["send", "stage"] as const) {
      it(`guards late composition after ${action} across replacement (textarea=${expanding})`, async () => {
        let now = 1000;
        vi.spyOn(performance, "now").mockImplementation(() => now);
        const { container, onSubmitCommand, onStageCommand, drafts } = await renderControls(expanding);
        const original = commandField(container);
        await setCommandValue(original, "accepted dictation");
        if (action === "send") await submitForm(container);
        else await clickStage(container);
        expect(action === "send" ? onSubmitCommand : onStageCommand)
          .toHaveBeenCalledExactlyOnceWith("accepted dictation");
        const field = commandField(container);
        expect(field).not.toBe(original);
        field.focus();
        await setCommandInput(field, "late correction", "insertCompositionText", true);
        expect(field.value).toBe("");
        expect(drafts.get("bridge-a", "pane-a")).toBe("");
        expect(document.activeElement).toBe(field);
        await setCommandInput(field, "new", "insertText");
        await setCommandInput(field, "new paste", "insertFromPaste");
        now = 1249;
        await setCommandInput(field, "late correction again", "insertFromComposition");
        expect(field.value).toBe("new paste");
        expect(drafts.get("bridge-a", "pane-a")).toBe("new paste");
        expect(commandField(container)).toBe(field);
        now = 1250;
        await setCommandInput(field, "fresh dictation", "insertCompositionText", true);
        expect(field.value).toBe("fresh dictation");
        expect(drafts.get("bridge-a", "pane-a")).toBe("fresh dictation");
      });
    }
  }

  it("does not carry a submitted pane's guard into another pane", async () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const { container, renderPane } = await renderControls(true);
    await setCommandValue(commandField(container), "first pane");
    await submitForm(container);
    await renderPane("bridge-a", "pane-b");
    await setCommandInput(commandField(container), "second pane", "insertCompositionText", true);
    expect(commandField(container).value).toBe("second pane");
  });

  it("clears and remounts after Stage while keeping empty Stage disabled", async () => {
    const { container, onStageCommand } = await renderControls(false);
    const firstField = commandField(container);

    await setCommandValue(firstField, "staged prompt");
    firstField.defaultValue = "staged prompt";
    await clickStage(container);

    expect(onStageCommand).toHaveBeenCalledOnce();
    expect(onStageCommand).toHaveBeenCalledWith("staged prompt");
    expect(firstField.value).toBe("");
    expect(firstField.defaultValue).toBe("");

    const secondField = commandField(container);
    expect(secondField).not.toBe(firstField);
    expect(secondField.value).toBe("");
    expect(secondField.defaultValue).toBe("");
    expect(stageButton(container).disabled).toBe(true);

    await clickStage(container);
    expect(onStageCommand).toHaveBeenCalledOnce();
  });

  for (const mobileControls of [false, true]) {
    it(`focuses the terminal after Stage only on desktop (mobile=${mobileControls})`, async () => {
      const { container, onStageCommand, onTerminalFocus } = await renderControls(true, { mobileControls });
      const terminal = document.createElement("input");
      container.append(terminal);
      onTerminalFocus.mockImplementation(() => terminal.focus());
      const field = commandField(container);
      await setCommandValue(field, "staged prompt");
      field.focus();
      await clickStage(container);
      expect(onStageCommand).toHaveBeenCalledExactlyOnceWith("staged prompt");
      expect(commandField(container).value).toBe("");
      if (mobileControls) {
        expect(onTerminalFocus).not.toHaveBeenCalled();
        expect(document.activeElement).not.toBe(terminal);
      } else {
        expect(onTerminalFocus).toHaveBeenCalledOnce();
        expect(document.activeElement).toBe(terminal);
      }
    });
  }

  it("continues submitting an empty command as Enter", async () => {
    const { container, onSubmitCommand } = await renderControls(false);

    await submitForm(container);

    expect(onSubmitCommand).toHaveBeenCalledWith("");
  });

  it("keeps multiline paste as one editable value until Send", async () => {
    const { container, onSubmitCommand } = await renderControls(true, {
      enterNewline: true,
      mobileControls: false,
    });
    const field = commandField(container);

    await setCommandValue(field, "first line\nsecond line");

    expect(onSubmitCommand).not.toHaveBeenCalled();
    expect(field.value).toBe("first line\nsecond line");
    await submitForm(container);
    expect(onSubmitCommand).toHaveBeenCalledWith("first line\nsecond line");
  });

  it("renders the composer without mobile terminal keys in desktop mode", async () => {
    const { container } = await renderControls(true, { mobileControls: false });

    expect(commandField(container)).toBeInstanceOf(HTMLTextAreaElement);
    expect(container.querySelector<HTMLElement>(".term-key-strip")?.hidden).toBe(true);
    expect(container.querySelector(".term-input-row")).not.toBeNull();
  });

  it("inserts Enter and submits Ctrl+Enter in a Linux desktop composer", async () => {
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue("Linux x86_64");
    const { container, onSubmitCommand } = await renderControls(true, {
      enterNewline: true,
      mobileControls: false,
    });
    const field = commandField(container);
    await setCommandValue(field, "two\nlines");

    const enter = await keyDown(field, { key: "Enter" });
    expect(enter.defaultPrevented).toBe(false);
    expect(onSubmitCommand).not.toHaveBeenCalled();

    const submit = await keyDown(field, { key: "Enter", ctrlKey: true });
    expect(submit.defaultPrevented).toBe(true);
    expect(onSubmitCommand).toHaveBeenCalledWith("two\nlines");
  });

  for (const method of ["button", "ctrl-enter", "cmd-enter"] as const) {
    it(`returns focus to the desktop composer after ${method} submission`, async () => {
      vi.spyOn(window.navigator, "platform", "get").mockReturnValue(
        method === "cmd-enter" ? "MacIntel" : "Linux x86_64",
      );
      const { container, onSubmitCommand } = await renderControls(true, {
        enterNewline: true,
        mobileControls: false,
      });
      const field = commandField(container);
      await setCommandValue(field, "first prompt");
      field.focus();
      if (method === "button") {
        const send = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
        send.focus();
        await act(async () => send.click());
      } else {
        await keyDown(field, {
          key: "Enter",
          ctrlKey: method === "ctrl-enter",
          metaKey: method === "cmd-enter",
        });
      }
      const nextField = commandField(container);
      expect(onSubmitCommand).toHaveBeenCalledExactlyOnceWith("first prompt");
      expect(nextField).not.toBe(field);
      expect(nextField.value).toBe("");
      expect(document.activeElement).toBe(nextField);
      await setCommandValue(nextField, "next prompt");
      expect(nextField.value).toBe("next prompt");
    });
  }

  it("uses Cmd+Enter, not Ctrl+Enter, as the macOS submit shortcut", () => {
    expect(
      isCommandComposerSubmitShortcut(
        { key: "Enter", altKey: false, ctrlKey: false, metaKey: true, shiftKey: false },
        "MacIntel",
      ),
    ).toBe(true);
    expect(
      isCommandComposerSubmitShortcut(
        { key: "Enter", altKey: false, ctrlKey: true, metaKey: false, shiftKey: false },
        "MacIntel",
      ),
    ).toBe(false);
  });

  it("keeps the existing mobile multiline modifier behavior", async () => {
    const { container, onSubmitCommand } = await renderControls(true, {
      enterNewline: true,
      mobileControls: true,
    });
    const event = await keyDown(commandField(container), { key: "Enter", ctrlKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(onSubmitCommand).not.toHaveBeenCalled();
  });
  for (const mobileControls of [false, true]) {
    it(`retains separate ${mobileControls ? "mobile" : "desktop"} drafts through pane switches, hiding and disconnects`, async () => {
      const { container, renderPane } = await renderControls(true, { mobileControls });
      await setCommandValue(commandField(container), "first pane\nunsent prompt");
      await renderPane("bridge-a", "pane-b");
      expect(commandField(container).value).toBe("");
      await setCommandValue(commandField(container), "second pane");
      await renderPane("bridge-b", "pane-a");
      expect(commandField(container).value).toBe("");
      await setCommandValue(commandField(container), "other host");
      await renderPane("bridge-a", "pane-a", false);
      await renderPane("bridge-a", "pane-a", true, true);
      expect(commandField(container).value).toBe("first pane\nunsent prompt");
      await renderPane();
      expect(commandField(container).value).toBe("first pane\nunsent prompt");
      await renderPane("bridge-a", "pane-b");
      expect(commandField(container).value).toBe("second pane");
      await renderPane("bridge-b", "pane-a");
      expect(commandField(container).value).toBe("other host");
    });
  }

  for (const action of ["send", "stage"] as const) {
    it(`clears only the submitted pane's retained draft after ${action}`, async () => {
      const { container, renderPane } = await renderControls(true, { mobileControls: false });
      await setCommandValue(commandField(container), "first draft");
      await renderPane("bridge-a", "pane-b");
      await setCommandValue(commandField(container), "second draft");
      if (action === "send") await submitForm(container);
      else await clickStage(container);
      await renderPane();
      expect(commandField(container).value).toBe("first draft");
      await renderPane("bridge-a", "pane-b");
      expect(commandField(container).value).toBe("");
      await setCommandValue(commandField(container), "new draft after submit");
      expect(commandField(container).value).toBe("new draft after submit");
    });
  }

  it("removes closed-pane drafts after a confirmed snapshot, preserving other panes and bridges", async () => {
    const { container, drafts, renderPane } = await renderControls(true);
    await setCommandValue(commandField(container), "closed pane");
    await renderPane("bridge-a", "pane-b");
    await setCommandValue(commandField(container), "live pane");
    await renderPane("bridge-b", "pane-a");
    await setCommandValue(commandField(container), "other bridge");
    await act(async () => drafts.retainPanes("bridge-a", ["pane-b"]));
    expect(commandField(container).value).toBe("other bridge");
    await renderPane();
    expect(commandField(container).value).toBe("");
    await renderPane("bridge-a", "pane-b");
    expect(commandField(container).value).toBe("live pane");
    await act(async () => drafts.retainPanes("bridge-a", []));
    expect(commandField(container).value).toBe("");
  });

  it("composes Ctrl+Shift+Up and sends it without changing the command draft", async () => {
    const { container, onInput, onSubmitCommand } = await renderControls(false);
    await setCommandValue(commandField(container), "keep this draft");
    await openComposer(container);
    await clickButton(container, "Add Ctrl modifier");
    await clickButton(container, "Add Shift modifier");
    await clickButton(container, "Use Up key");

    expect(composerPanel(container).textContent).toContain("Ctrl + Shift + ↑");
    await clickButton(composerPanel(container), "Send Ctrl + Shift + ↑");

    expect(onInput).toHaveBeenCalledExactlyOnceWith("\x1B[1;6A");
    expect(container.querySelector(".term-key-composer")).toBeNull();
    expect(commandField(container).value).toBe("keep this draft");
    expect(onSubmitCommand).not.toHaveBeenCalled();
  });

  for (const selection of ["empty", "special", "printable"]) {
    it(`closes Compose and discards the ${selection} chord without sending`, async () => {
      const { container, onInput } = await renderControls(false);
      await setCommandValue(commandField(container), "keep this draft");
      await openComposer(container);
      if (selection === "special") {
        await clickButton(container, "Add Ctrl modifier");
        await clickButton(container, "Use Up key");
      } else if (selection === "printable") {
        await clickButton(container, "Add Alt modifier");
        await setCommandValue(printableKeyField(container), "p");
      }
      await clickButton(container, "Close terminal key composer");

      expect(container.querySelector(".term-key-composer")).toBeNull();
      expect(onInput).not.toHaveBeenCalled();
      expect(commandField(container).value).toBe("keep this draft");
      await openComposer(container);
      expect(printableKeyField(container).value).toBe("");
      expect(composerPanel(container).textContent).toContain("Choose a key");
      expect(composerPanel(container).querySelectorAll('[data-active="true"]')).toHaveLength(0);
    });
  }

  it("keeps fixed icon actions above the command field and preserves quick keys", async () => {
    const { container, onInput, onUpload, onTerminalFocus, onStageCommand } =
      await renderControls(false);
    const actions = container.querySelector('[aria-label="Terminal actions"]');
    if (!(actions instanceof HTMLElement)) {
      throw new Error("Missing fixed terminal actions");
    }
    expect(
      [...actions.querySelectorAll("button")].map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Upload file",
      "Stage command in terminal",
      "Show more keys",
      "Focus terminal keyboard",
    ]);
    expect(actions.textContent?.trim()).toBe("");
    expect(container.querySelector("form")?.querySelectorAll("button")).toHaveLength(1);
    const shortcuts = container.querySelector('[aria-label="Terminal quick keys"]');
    if (!(shortcuts instanceof HTMLElement)) {
      throw new Error("Missing scrollable quick keys");
    }
    const keys = [...shortcuts.querySelectorAll("button")];
    expect(keys.map((key) => key.textContent)).toEqual(["Esc", "C-c", "C-d", "1", "2", "3"]);
    for (const key of keys) {
      await act(async () => key.click());
    }
    expect(onInput.mock.calls).toEqual([["\x1B"], ["\x03"], ["\x04"], ["1"], ["2"], ["3"]]);
    await clickButton(actions, "Upload file");
    await clickButton(actions, "Focus terminal keyboard");
    expect(onUpload).toHaveBeenCalledOnce();
    expect(onTerminalFocus).toHaveBeenCalledOnce();
    await setCommandValue(commandField(container), "stage me");
    await clickButton(actions, "Stage command in terminal");
    expect(onStageCommand).toHaveBeenCalledWith("stage me");
  });

  it("allows closing Compose while disconnected but blocks sending and staging", async () => {
    const { container, onInput, onStageCommand, setDisabled } = await renderControls(false);
    await setCommandValue(commandField(container), "pending command");
    await openComposer(container);
    await clickButton(container, "Use Up key");
    await setDisabled(true);

    expect(composerPanel(container).querySelector<HTMLButtonElement>('[aria-label="Send ↑"]')?.disabled).toBe(true);
    expect(printableKeyField(container).disabled).toBe(true);
    expect(stageButton(container).disabled).toBe(true);
    await clickButton(container, "Send ↑");
    await clickStage(container);
    await clickButton(container, "Close terminal key composer");
    expect(onInput).not.toHaveBeenCalled();
    expect(onStageCommand).not.toHaveBeenCalled();
    expect(container.querySelector(".term-key-composer")).toBeNull();
  });

  it("updates shortcut edge hints as the strip scrolls and resizes", async () => {
    const { container } = await renderControls(false);
    const shortcuts = container.querySelector<HTMLElement>('[aria-label="Terminal quick keys"]');
    if (!shortcuts) {
      throw new Error("Missing scrollable quick keys");
    }
    Object.defineProperties(shortcuts, {
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 300 },
    });
    window.dispatchEvent(new Event("resize"));
    expect(shortcuts.dataset.scrollLeft).toBe("false");
    expect(shortcuts.dataset.scrollRight).toBe("true");
    shortcuts.scrollLeft = 50;
    shortcuts.dispatchEvent(new Event("scroll"));
    expect(shortcuts.dataset.scrollLeft).toBe("true");
    expect(shortcuts.dataset.scrollRight).toBe("true");
    shortcuts.scrollLeft = 200;
    shortcuts.dispatchEvent(new Event("scroll"));
    expect(shortcuts.dataset.scrollRight).toBe("false");
  });

  it("uses one shared key set to select a chord without sending or repeating", async () => {
    const { container, onInput } = await renderControls(false);
    await setCommandValue(commandField(container), "keep draft");
    await clickButton(container, "Show more keys");
    const keyCount = container.querySelectorAll(".term-key-direct-row button, .term-key-more-row button").length;
    await openComposer(container);
    await clickButton(container, "Add Alt modifier");
    vi.useFakeTimers();
    await clickButton(container, "Use Left key");
    await clickButton(container, "Use Home key");
    await act(async () => vi.advanceTimersByTime(1000));
    expect(onInput).not.toHaveBeenCalled();
    expect(container.querySelectorAll(".term-key-direct-row button, .term-key-more-row button")).toHaveLength(keyCount);
    expect(container.querySelectorAll('[aria-label="Use Home key"]')).toHaveLength(1);
    expect(container.querySelector('[aria-label="Use Home key"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(composerPanel(container).textContent).toContain("Composing shortcut");
    await clickButton(container, "Send Alt + Home");
    await clickButton(container, "Send Left");
    expect(onInput.mock.calls).toEqual([["\x1B[1;3H"], ["\x1B[D"]]);
    expect(commandField(container).value).toBe("keep draft");
  });

  it("selects quick keys in Compose mode and cancels without sending", async () => {
    const { container, onInput } = await renderControls(false);
    await openComposer(container);
    for (const key of ["Esc", "C-c", "C-d", "1", "2", "3"]) {
      await clickButton(container, `Use ${key} key`);
    }
    expect(onInput).not.toHaveBeenCalled();
    await clickButton(container, "Cancel shortcut");
    expect(container.querySelector(".term-key-composer")).toBeNull();
    await openComposer(container);
    expect(composerPanel(container).textContent).toContain("Choose a key");
    await clickButton(container, "Use C-c key");
    await clickButton(container, "Send Ctrl + c");
    expect(onInput).toHaveBeenCalledExactlyOnceWith("\x03");
  });

  it("keeps the navigation pad open across direct keys and Compose sends", async () => {
    const { container, onInput } = await renderControls(false);
    await clickButton(container, "Show more keys");
    for (const name of ["Home", "End", "Delete", "Page Up", "Page Down"]) {
      await clickButton(container, `Send ${name}`);
    }
    await openComposer(container);
    await clickButton(container, "Add Shift modifier");
    await clickButton(container, "Use Tab key");
    await clickButton(container, "Send Shift + Tab");
    await clickButton(container, "Send Home");

    expect(onInput.mock.calls).toEqual([
      ["\x1B[H"],
      ["\x1B[F"],
      ["\x1B[3~"],
      ["\x1B[5~"],
      ["\x1B[6~"],
      ["\x1B[Z"],
      ["\x1B[H"],
    ]);
    await clickButton(container, "Hide more keys");
    expect(container.querySelector('[aria-label="Send Home"]')).toBeNull();
  });

  it("keeps Compose inside More keys and cancels the chord when collapsed", async () => {
    const { container, onInput } = await renderControls(false);
    expect(container.querySelector('[aria-label="Compose terminal key"]')).toBeNull();
    expect(container.querySelector(".term-key-direct-row")).toBeNull();
    await openComposer(container);
    await clickButton(container, "Add Alt modifier");
    await clickButton(container, "Use Up key");
    await clickButton(container, "Hide more keys");
    expect(onInput).not.toHaveBeenCalled();
    expect(container.querySelector(".term-key-composer")).toBeNull();
    expect(container.querySelector(".term-key-more-row")).toBeNull();
    expect(container.querySelector(".term-key-direct-row")).toBeNull();
    await clickButton(container, "Show more keys");
    expect(container.querySelectorAll(".term-key-direct-row button")).toHaveLength(6);
    await clickButton(container, "Send Up");
    expect(onInput).toHaveBeenCalledExactlyOnceWith("\x1B[A");
    await openComposer(container);
    expect(composerPanel(container).textContent).toContain("Choose a key");
    expect(composerPanel(container).querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
  });

  it("places Tab beside Backspace only in the expanded keyboard", async () => {
    const { container, onInput } = await renderControls(false);
    expect(container.querySelector('[aria-label="Send Tab"]')).toBeNull();
    await clickButton(container, "Show more keys");
    const row = container.querySelector(".term-key-direct-row")!;
    expect([...row.querySelectorAll("button")].map((button) => button.textContent))
      .toEqual(["Tab", "Bksp", "←", "↑", "↓", "→"]);
    await clickButton(container, "Send Tab");
    expect(onInput).toHaveBeenCalledExactlyOnceWith("\t");
    await openComposer(container);
    await clickButton(container, "Add Shift modifier");
    await clickButton(container, "Use Tab key");
    expect(container.querySelectorAll('[aria-label="Use Tab key"]')).toHaveLength(1);
    await clickButton(container, "Send Shift + Tab");
    expect(onInput.mock.calls).toEqual([["\t"], ["\x1B[Z"]]);
  });

  it("captures a printable key for Alt chords", async () => {
    const { container, onInput } = await renderControls(false);
    await openComposer(container);
    await clickButton(container, "Add Alt modifier");
    await setCommandValue(printableKeyField(container), "p");

    expect(composerPanel(container).textContent).toContain("Alt + p");
    await clickButton(container, "Send Alt + p");
    expect(onInput).toHaveBeenCalledExactlyOnceWith("\x1Bp");
  });
});

async function renderControls(
  expandingInput: boolean,
  options: { enterNewline?: boolean; mobileControls?: boolean; mobileFocusAfterSubmit?: boolean } = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const commandInputRef = createRef<HTMLInputElement | HTMLTextAreaElement>();
  const onSubmitCommand = vi.fn();
  const onStageCommand = vi.fn();
  const onTerminalFocus = vi.fn();
  const onInput = vi.fn();
  const onUpload = vi.fn();

  const drafts = createCommandDraftStore();
  const renderPane = async (bridgeId = "bridge-a", paneId = "pane-a", visible = true, disabled = false) => {
    await act(async () => {
      root.render(
        <CommandDraftContext.Provider value={drafts}>
          {visible ? <TerminalCommandControls
            key={JSON.stringify([bridgeId, paneId])}
            bridgeId={bridgeId}
            paneId={paneId}
            commandInputRef={commandInputRef}
            disabled={disabled}
            uploadDisabled={disabled}
            expandingInput={expandingInput}
            enterNewline={options.enterNewline ?? false}
            mobileControls={options.mobileControls ?? true}
            mobileFocusAfterSubmit={options.mobileFocusAfterSubmit}
            controlsScalePercent={100}
            onControlsHeightChange={vi.fn()}
            onInput={onInput}
            onTerminalFocus={onTerminalFocus}
            onUpload={onUpload}
            onStageCommand={onStageCommand}
            onSubmitCommand={onSubmitCommand}
          /> : null}
        </CommandDraftContext.Provider>,
      );
    });
  };
  await renderPane();
  const setDisabled = async (disabled: boolean) => {
    await renderPane("bridge-a", "pane-a", true, disabled);
  };

  return {
    drafts,
    renderPane,
    setDisabled,
    commandInputRef,
    container,
    onInput,
    onStageCommand,
    onSubmitCommand,
    onTerminalFocus,
    onUpload,
  };
}

async function keyDown(
  field: HTMLInputElement | HTMLTextAreaElement,
  init: KeyboardEventInit,
) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  await act(async () => {
    field.dispatchEvent(event);
  });
  return event;
}

function commandField(container: HTMLElement) {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    ".term-native-input",
  );
  if (!field) {
    throw new Error("missing mobile command field");
  }
  return field;
}

async function setCommandValue(
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    const prototype =
      field instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submitForm(container: HTMLElement) {
  const form = container.querySelector("form");
  if (!form) {
    throw new Error("missing mobile command form");
  }
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function stageButton(container: HTMLElement) {
  const button = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Stage command in terminal"]',
  );
  if (!button) {
    throw new Error("missing Stage button");
  }
  return button;
}

async function clickStage(container: HTMLElement) {
  await act(async () => {
    stageButton(container).click();
  });
}

async function openComposer(container: HTMLElement) {
  if (container.querySelector('[aria-label="Show more keys"]')) {
    await clickButton(container, "Show more keys");
  }
  await clickButton(container, "Compose terminal key");
}

function composerPanel(container: HTMLElement) {
  const panel = container.querySelector<HTMLElement>(".term-key-composer");
  if (!panel) {
    throw new Error("Missing terminal key composer");
  }
  return panel;
}

function printableKeyField(container: HTMLElement) {
  const field = container.querySelector<HTMLInputElement>('input[aria-label="Printable key"]');
  if (!field) {
    throw new Error("Missing printable key field");
  }
  return field;
}

async function clickButton(container: HTMLElement, ariaLabel: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${ariaLabel}"]`);
  if (!button) {
    throw new Error(`Missing button: ${ariaLabel}`);
  }
  await act(async () => button.click());
}

async function setCommandInput(
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  inputType: string,
  isComposing = false,
) {
  await act(async () => {
    const prototype = field instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType, isComposing }));
  });
}
