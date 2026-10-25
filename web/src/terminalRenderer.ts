import { detectShortcutPlatform } from "./shortcutBindings";
import { Terminal, type ITerminalOptions } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { TerminalEndpointPresentation } from "./terminalEndpointPresentation";
import { TerminalHistorySelection } from "./terminalHistorySelection";

/** Own the rendered buffer independently of browser transport clients. */
export function createTerminalRenderer(
  container: HTMLElement,
  options: ITerminalOptions,
  history: {
    scroll(direction: "up" | "down", lines: number): Promise<unknown>;
    changed(message: string): void;
  },
) {
  let disposed = false;
  const term = new Terminal({
    cursorBlink: true,
    showCursorImmediately: true,
    allowProposedApi: true,
    scrollbar: { showScrollbar: false },
    scrollback: 2000,
    ...options,
  });
  const fit = new FitAddon();
  term.loadAddon(new UnicodeGraphemesAddon());
  term.loadAddon(fit);
  term.open(container);
  if (detectShortcutPlatform() === "mac")
    term.element?.classList.add("xterm-apple-row-spacing-fix");
  try {
    fit.fit();
  } catch {
    /* ResizeObserver retries after layout. */
  }
  if (term.textarea)
    term.textarea.readOnly = term.options.disableStdin === true;
  const presentation = new TerminalEndpointPresentation(
    () => term.hasSelection() || historySelection.active,
    (text, parsed, linksChanged) =>
      term.write(text, () => {
        parsed();
        if (!disposed && linksChanged) term.refresh(0, term.rows - 1);
      }),
    () => ({ cols: term.cols, rows: term.rows }),
    {
      accepts: (frame) => historySelection.accepts(frame),
      presented: (frame) => historySelection.presented(frame),
      reset: () => historySelection.reset(),
    },
  );
  const historySelection: TerminalHistorySelection =
    new TerminalHistorySelection(term, {
      frame: () => presentation.displayedFrame,
      ...history,
    });
  return {
    term,
    fit,
    presentation,
    historySelection,
    dispose() {
      disposed = true;
      presentation.dispose();
      term.dispose();
    },
  };
}
