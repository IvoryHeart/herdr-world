// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { shouldRestoreTerminalFocus } from "./terminalAttachFocus";

afterEach(() => {
  document.body.replaceChildren();
});

describe("terminal attach focus guard", () => {
  it("does not refocus the terminal after an external control wins focus during attach", () => {
    const terminal = document.createElement("div");
    terminal.tabIndex = 0;
    const control = document.createElement("button");
    document.body.append(terminal, control);
    terminal.focus();
    const activationSnapshot = {
      target: document.activeElement,
      externalFocusSequence: 0,
    };

    control.focus();

    expect(
      shouldRestoreTerminalFocus({
        autoFocus: true,
        currentTarget: control,
        currentExternalFocusSequence: 1,
        activationSnapshot,
      }),
    ).toBe(false);
  });

  it("does not renew autofocus eligibility when a later attach attempt starts", () => {
    const opener = document.createElement("button");
    const officeStage = document.createElement("div");
    officeStage.tabIndex = 0;
    document.body.append(opener, officeStage);
    opener.focus();
    const activationSnapshot = {
      target: document.activeElement,
      externalFocusSequence: 2,
    };

    officeStage.focus();

    // A socket retry may begin after this focus change, but the terminal
    // activation still owns the original snapshot.
    expect(
      shouldRestoreTerminalFocus({
        autoFocus: true,
        currentTarget: officeStage,
        currentExternalFocusSequence: 3,
        activationSnapshot,
      }),
    ).toBe(false);
  });

  it("restores focus only when the activation-time focus state is unchanged", () => {
    const terminal = document.createElement("div");
    const activationSnapshot = {
      target: terminal,
      externalFocusSequence: 4,
    };

    expect(
      shouldRestoreTerminalFocus({
        autoFocus: true,
        currentTarget: terminal,
        currentExternalFocusSequence: 4,
        activationSnapshot,
      }),
    ).toBe(true);
    expect(
      shouldRestoreTerminalFocus({
        autoFocus: false,
        currentTarget: terminal,
        currentExternalFocusSequence: 4,
        activationSnapshot,
      }),
    ).toBe(false);
    expect(
      shouldRestoreTerminalFocus({
        autoFocus: true,
        currentTarget: terminal,
        currentExternalFocusSequence: 5,
        activationSnapshot,
      }),
    ).toBe(false);
  });
});
