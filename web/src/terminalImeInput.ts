/**
 * Browser IME helpers for the terminal's hidden textarea.
 *
 * Composition preedit stays in the textarea. Only a completed composition or
 * ordinary, non-composition input is allowed to reach the PTY.
 */

export type TerminalImeState =
  | {
      phase: "idle";
      preedit: "";
      pendingCommit: string | null;
    }
  | {
      phase: "composing";
      baseline: string;
      preedit: string;
      pendingCommit: null;
    };

export type TerminalImeEvent =
  | { type: "compositionstart"; data: string; textareaValue: string }
  | { type: "compositionupdate"; data: string; textareaValue: string }
  | { type: "compositionend"; data: string; textareaValue: string }
  | {
      type: "input";
      data: string | null;
      inputType: string;
      isComposing: boolean;
      textareaValue: string;
    }
  | { type: "settle" }
  | { type: "reset" };

export type TerminalImeTransition = {
  state: TerminalImeState;
  output: string | null;
  suppressInput: boolean;
  clearTextarea: boolean;
};

export type ImeTextareaAnchor = {
  left: number;
  top: number;
  width: number;
  height: number;
  fontSizePx: number;
};

export function idleTerminalImeState(): TerminalImeState {
  return { phase: "idle", preedit: "", pendingCommit: null };
}

/**
 * Reduce browser composition/input events into terminal output.
 *
 * Browsers disagree about whether their final input event occurs before or
 * after compositionend. A completed composition is emitted at compositionend;
 * pendingCommit suppresses a matching trailing input without swallowing the
 * next unrelated keystroke. Call settle in a microtask after compositionend so
 * that suppression cannot leak into a later user action.
 */
export function reduceTerminalImeState(
  state: TerminalImeState,
  event: TerminalImeEvent,
): TerminalImeTransition {
  switch (event.type) {
    case "compositionstart":
      return transition({
        phase: "composing",
        baseline: event.textareaValue,
        preedit: event.data,
        pendingCommit: null,
      });

    case "compositionupdate":
      if (state.phase !== "composing") {
        return transition(state);
      }
      return transition({ ...state, preedit: event.data });

    case "compositionend": {
      if (state.phase !== "composing") {
        return transition(state, { suppressInput: true });
      }
      const output = normalizeTerminalText(event.data);
      return transition(
        {
          phase: "idle",
          preedit: "",
          // An empty string is intentional: it lets a later insertText supply
          // a commit when compositionend did not expose data, without treating
          // the textarea's possibly canceled preedit as committed text.
          pendingCommit: output ?? "",
        },
        {
          output,
          suppressInput: true,
          clearTextarea: true,
        },
      );
    }

    case "input": {
      if (state.phase === "composing") {
        const preedit = inputPreedit(state.baseline, event);
        return transition({ ...state, preedit }, { suppressInput: true });
      }

      if (event.isComposing || isImeCompositionInputType(event.inputType)) {
        return transition(
          { ...state, pendingCommit: null },
          { suppressInput: true, clearTextarea: true },
        );
      }

      if (state.pendingCommit !== null) {
        const candidate = inputCandidate(event.data, event.textareaValue);
        if (candidate === state.pendingCommit) {
          return transition(
            { ...state, pendingCommit: null },
            { suppressInput: true, clearTextarea: true },
          );
        }
        return transition({ ...state, pendingCommit: null });
      }

      return transition(state);
    }

    case "settle":
      return state.phase === "idle"
        ? transition({ ...state, pendingCommit: null })
        : transition(state);

    case "reset":
      return transition(idleTerminalImeState(), {
        suppressInput: state.phase === "composing",
        clearTextarea: state.phase === "composing",
      });
  }
}

/**
 * Return true when beforeinput belongs to composition and must be left in the
 * textarea instead of being sent directly to the PTY.
 */
export function shouldDeferBeforeInputToIme(
  state: TerminalImeState,
  event: Pick<InputEvent, "data" | "inputType" | "isComposing">,
): boolean {
  if (state.phase === "composing" || event.isComposing || isImeCompositionInputType(event.inputType)) {
    return true;
  }
  if (state.pendingCommit === null) {
    return false;
  }
  return normalizeTerminalText(event.data) === state.pendingCommit;
}

export function isImeComposingKeyEvent(
  event: Pick<KeyboardEvent, "isComposing" | "keyCode">,
): boolean {
  return event.isComposing || event.keyCode === 229;
}

export function isImeCompositionInputType(inputType: string): boolean {
  return (
    inputType === "insertCompositionText" ||
    inputType === "deleteCompositionText" ||
    inputType === "insertFromComposition" ||
    inputType === "deleteByComposition"
  );
}

export function beforeInputOutput(event: Pick<InputEvent, "inputType" | "data">): string | null {
  switch (event.inputType) {
    case "insertText":
    case "insertReplacementText":
      return normalizeTerminalText(event.data);
    case "insertLineBreak":
    case "insertParagraph":
      return "\r";
    case "deleteContentBackward":
      return "\x7F";
    case "deleteContentForward":
      return "\x1B[3~";
    default:
      return null;
  }
}

export function textareaDelta(previousValue: string, nextValue: string): string {
  if (nextValue.startsWith(previousValue)) {
    return nextValue.slice(previousValue.length).replace(/\n/g, "\r");
  }

  const previousChars = Array.from(previousValue);
  const nextChars = Array.from(nextValue);
  let commonPrefixLength = 0;
  while (
    commonPrefixLength < previousChars.length &&
    commonPrefixLength < nextChars.length &&
    previousChars[commonPrefixLength] === nextChars[commonPrefixLength]
  ) {
    commonPrefixLength += 1;
  }

  const deletes = "\x7F".repeat(previousChars.length - commonPrefixLength);
  const inserts = nextChars.slice(commonPrefixLength).join("").replace(/\n/g, "\r");
  return `${deletes}${inserts}`;
}

export function keyboardEventOutput(
  event: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "metaKey" | "key">,
): string | null {
  if (event.ctrlKey || event.altKey || event.metaKey) {
    return null;
  }
  if (event.key.length === 1) {
    return event.key;
  }
  switch (event.key) {
    case "Enter":
      return "\r";
    case "Backspace":
      return "\x7F";
    case "Delete":
      return "\x1B[3~";
    default:
      return null;
  }
}

/** Position the hidden textarea over the visible terminal cursor cell. */
export function imeTextareaAnchor(options: {
  terminalLeft: number;
  terminalTop: number;
  terminalWidth: number;
  terminalHeight: number;
  browserWidth: number;
  browserHeight: number;
  cellWidth: number;
  cellHeight: number;
  cursorCol: number;
  cursorRow: number;
  fontSizePx: number;
}): ImeTextareaAnchor {
  const cellWidth = Math.max(1, options.cellWidth);
  const cellHeight = Math.max(1, options.cellHeight);
  const maxCol = Math.max(0, Math.floor(options.terminalWidth / cellWidth) - 1);
  const maxRow = Math.max(0, Math.floor(options.terminalHeight / cellHeight) - 1);
  const col = clampInteger(options.cursorCol, 0, maxCol);
  const row = clampInteger(options.cursorRow, 0, maxRow);
  const maxLeft = Math.max(1, options.browserWidth - cellWidth - 1);
  const maxTop = Math.max(1, options.browserHeight - cellHeight - 1);
  return {
    left: clampNumber(options.terminalLeft + col * cellWidth, 1, maxLeft),
    top: clampNumber(options.terminalTop + row * cellHeight, 1, maxTop),
    width: cellWidth,
    height: cellHeight,
    fontSizePx: Math.max(1, options.fontSizePx),
  };
}

function transition(
  state: TerminalImeState,
  overrides: Partial<Omit<TerminalImeTransition, "state">> = {},
): TerminalImeTransition {
  return {
    state,
    output: null,
    suppressInput: false,
    clearTextarea: false,
    ...overrides,
  };
}

function inputPreedit(
  baseline: string,
  event: Extract<TerminalImeEvent, { type: "input" }>,
) {
  if (typeof event.data === "string") {
    return event.data;
  }
  if (event.textareaValue.startsWith(baseline)) {
    return event.textareaValue.slice(baseline.length);
  }
  return event.textareaValue;
}

function inputCandidate(data: string | null, textareaValue: string) {
  return normalizeTerminalText(data) ?? normalizeTerminalText(textareaValue) ?? "";
}

function normalizeTerminalText(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  return value.replace(/\n/g, "\r");
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
