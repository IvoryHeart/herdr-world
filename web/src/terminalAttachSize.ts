import type { ConnectionClient } from "./api";
import { terminalPaneSize, type TerminalSize } from "./terminalResize";
import type { PaneLayout } from "./types";

type Ref<T> = { readonly current: T };
/** One pane.layout read, valid only for the client and pane that made it. */
type LayoutRead = {
  terminalId: string;
  paneId: string;
  client: ConnectionClient;
  layout: PaneLayout | null;
  done: boolean;
};

/**
 * The size a TerminalView attaches at. Herdr resizes a pane to every attach,
 * for every viewer, so a terminal that is not displayed (World's parked
 * creation endpoint, or a window showing Chat) has no size of its own to
 * send: its xterm was never fitted. It attaches at the size the pane has now,
 * from the store's layout of its tab or else from one `pane.layout` read;
 * only if that read fails does it use the xterm's size, so the attach (and
 * its endpoint) is never withheld. A shown terminal uses its fitted size.
 */
export class TerminalAttachSize {
  private read: LayoutRead | null = null;
  private waiting = false;

  constructor(
    private readonly view: {
      paneIdRef: Ref<string | undefined>;
      paneTabIdRef: Ref<string | undefined>;
      paneLayoutRef: Ref<PaneLayout | null>;
      currentClientRef: Ref<ConnectionClient>;
      desiredTerminalRef: Ref<string | null>;
      /** Runs the attach again once a read settles. */
      retry: (update: (value: number) => number) => void;
    },
  ) {}

  /**
   * The size to attach `terminalId` at, with the layout for its surface and
   * relay; null while its pane's layout is read.
   */
  resolve(
    terminalId: string,
    fitted: TerminalSize | null,
    xterm: TerminalSize,
  ):
    | (TerminalSize & {
        layout: PaneLayout | null;
        relayLayout: PaneLayout | null;
      })
    | null {
    const { view } = this;
    const paneId = view.paneIdRef.current;
    const stored = view.paneLayoutRef.current;
    let layout = stored?.tab_id === view.paneTabIdRef.current ? stored : null;
    let size = fitted ?? terminalPaneSize(layout, paneId);
    const client = view.currentClientRef.current;
    // A read made through a replaced client (a transport reconnect) is not
    // this attach's: its failure is no fallback, and the new client reads.
    const read =
      this.read?.terminalId === terminalId &&
      this.read.paneId === paneId &&
      this.read.client === client
        ? this.read
        : null;
    if (!size && read?.done) {
      layout = read.layout;
      size = terminalPaneSize(layout, paneId) ?? {
        cols: xterm.cols,
        rows: xterm.rows,
      };
    }
    this.waiting = !size;
    if (size) {
      this.read = null;
      return { ...size, layout, relayLayout: fitted ? stored : layout };
    }
    if (read || !paneId) return null;
    const pending: LayoutRead = {
      terminalId,
      paneId,
      client,
      layout: null,
      done: false,
    };
    this.read = pending;
    client
      .call("pane.layout", { pane_id: paneId })
      .then(
        (result) => {
          pending.layout =
            (result as { layout?: PaneLayout } | null)?.layout ?? null;
        },
        () => {},
      )
      .finally(() => {
        pending.done = true;
        if (this.read !== pending) return;
        // Only the attach still waiting on it may use a read; any other
        // settles into nothing, so a later attach reads afresh.
        if (
          view.desiredTerminalRef.current === terminalId &&
          client.isCurrent()
        )
          view.retry((value) => value + 1);
        else this.read = null;
      });
    return null;
  }

  /** Whether an attach waits for a size; showing the terminal ends that. */
  shown() {
    const waiting = this.waiting;
    this.waiting = false;
    return waiting;
  }
}
