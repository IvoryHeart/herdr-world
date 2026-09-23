import type { TerminalHistoryViewport } from "./terminalHistorySelection";

export interface TerminalPresentationFrame {
  text: string;
  size?: { cols: number; rows: number };
  history?: TerminalHistoryViewport;
  linkFrame?: string;
}

/** xterm's native selection escape: Shift on non-Mac, Option on Mac. */
export function terminalMouseUsesSelection(
  mouseReporting: boolean | undefined,
  event: { shiftKey: boolean; altKey: boolean },
  applePlatform: boolean,
): boolean {
  return (
    mouseReporting !== true || (applePlatform ? event.altKey : event.shiftKey)
  );
}

/**
 * Endpoint frames are self-contained repaints, not an incremental PTY stream.
 * Retain just the newest while selecting so copied text stays the visible text.
 * Legacy chunks use a separate ordered buffer and never replace one another.
 */
export class TerminalEndpointPresentation {
  mouseReporting: boolean | undefined;
  selectionDrag = false;
  private appliedMouseReporting: boolean | undefined;
  private pendingFrame: TerminalPresentationFrame | null = null;
  displayedFrame: TerminalPresentationFrame | null = null;
  private writing = false;
  private changingLinks = false;
  private incremental = "";
  private disposed = false;
  private generation = 0;
  private deferredSelection: (() => void) | null = null;

  constructor(
    private hasSelection: () => boolean,
    private write: (
      text: string,
      parsed: () => void,
      linksChanged: boolean,
    ) => void,
    private viewportSize?: () => { cols: number; rows: number },
    private selectionHistory?: {
      accepts: (frame: TerminalPresentationFrame) => boolean;
      presented: (frame: TerminalPresentationFrame) => void;
      reset: () => void;
    },
  ) {}

  get selectionPending(): boolean {
    return this.deferredSelection !== null;
  }

  get writePending(): boolean {
    return this.writing;
  }

  get linkWritePending(): boolean {
    return this.writing && this.changingLinks;
  }

  /** Legacy chunks are ordered, never coalesced as endpoint repaints. */
  updateIncremental(text: string, overflow: () => void): void {
    if (this.disposed || !text) return;
    // ponytail: 1 MiB UTF-16 payload budget; release selection instead of dropping output.
    if (
      (this.selectionDrag || this.hasSelection()) &&
      (this.incremental.length + text.length) * 2 > 1024 * 1024
    )
      overflow();
    this.incremental += text;
    this.flush();
  }

  /** Reserve selection immediately; replay native initiation only after parsing. */
  beginSelection(replay: () => void): boolean {
    if (this.disposed) return false;
    this.selectionDrag = true;
    if (!this.writing) return true;
    this.deferredSelection = replay;
    return false;
  }

  cancelSelection(): void {
    this.deferredSelection = null;
    this.selectionDrag = false;
    this.flush();
  }

  update(
    text: string,
    mouseReporting: boolean,
    size?: { cols: number; rows: number },
    history?: TerminalHistoryViewport,
    linkFrame?: string,
  ): void {
    if (this.disposed) return;
    this.mouseReporting = mouseReporting;
    this.pendingFrame = { text, size, history, linkFrame };
    this.flush();
  }

  flush(): void {
    if (
      this.disposed ||
      this.writing ||
      ((this.selectionDrag || this.hasSelection()) &&
        !(
          this.pendingFrame && this.selectionHistory?.accepts(this.pendingFrame)
        ))
    )
      return;
    const frame = this.incremental ? null : this.pendingFrame;
    if (frame) this.pendingFrame = null;
    const viewport = this.viewportSize?.();
    // A resize can overtake a frame on the wire or while selection holds it.
    // The bridge clips subsequent frames to the new viewer size.
    if (
      frame?.size &&
      viewport &&
      (frame.size.cols > viewport.cols || frame.size.rows > viewport.rows)
    )
      return;
    let prefix = "";
    if (
      this.mouseReporting !== undefined &&
      this.appliedMouseReporting !== this.mouseReporting
    ) {
      // Activation clears xterm selection, so apply only after selection ends.
      // Drag tracking suffices for pane applications; no hover reports that
      // could clear a retained browser selection after the escape is released.
      prefix = this.mouseReporting
        ? "\x1b[?1006h\x1b[?1002h"
        : "\x1b[?1002l\x1b[?1006l";
      this.appliedMouseReporting = this.mouseReporting;
    }
    const incremental = this.incremental;
    this.incremental = "";
    let text = frame?.text ?? "";
    let linksChanged = true;
    const displayed = this.displayedFrame;
    if (frame && displayed && !prefix && !incremental) {
      if (text === displayed.text) {
        // Metadata may advance without changing the physical xterm buffer.
        this.displayedFrame = frame;
        this.selectionHistory?.presented(frame);
        return;
      }
      if (frame.linkFrame && frame.linkFrame === displayed.linkFrame) {
        // frameToAnsi ends its cell grid with DECAWM, then only cursor controls.
        // Updating just that suffix preserves OSC8 IDs and the pressed link.
        const cursor = text.lastIndexOf("\x1b[?7h");
        if (
          cursor >= 0 &&
          text.slice(0, cursor) === displayed.text.slice(0, cursor)
        ) {
          text = text.slice(cursor);
          linksChanged = false;
        }
      }
    }
    if (prefix || frame !== null || incremental) {
      this.writing = true;
      this.changingLinks = linksChanged;
      const generation = this.generation;
      this.write(
        prefix + text + incremental,
        () => {
          // reset() cannot cancel the physical xterm write. Its completion must
          // still release the gate for current intent, never restore old state.
          if (frame && !this.disposed && generation === this.generation) {
            this.displayedFrame = frame;
            this.selectionHistory?.presented(frame);
          }
          this.writing = false;
          if (this.disposed) return;
          const replay = this.deferredSelection;
          this.deferredSelection = null;
          if (replay) replay();
          this.flush();
        },
        linksChanged,
      );
    }
  }

  reset(discardIncremental = false): void {
    // Invalidate presentation/replay, not the outstanding parser operation.
    this.generation++;
    this.deferredSelection = null;
    this.mouseReporting = undefined;
    this.appliedMouseReporting = undefined;
    this.pendingFrame = null;
    if (discardIncremental) this.incremental = "";
    this.displayedFrame = null;
    this.selectionHistory?.reset();
    this.selectionDrag = false;
  }

  dispose(): void {
    this.reset(true);
    this.disposed = true;
  }
}
