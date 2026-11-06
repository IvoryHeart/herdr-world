/** A terminal size in character cells. */
export type TerminalCells = { cols: number; rows: number };

/**
 * Below this, a tab's area (or, with no layout, a terminal) is a squeeze, not
 * a size to keep: another client's hidden attach leaves 12–24 columns by
 * 1–3 rows. Split panes and narrow viewers are legitimately smaller than a
 * tab (a shown 30×8 stays), so the floor is tested on the tab, not the pane.
 * World never adopts a squeezed size for a terminal it is not showing.
 */
export const TERMINAL_SIZE_FLOOR: TerminalCells = { cols: 30, rows: 5 };

/** Whether `size` is below the floor in either dimension. */
export const terminalSqueezed = (size: TerminalCells) =>
  size.cols < TERMINAL_SIZE_FLOOR.cols || size.rows < TERMINAL_SIZE_FLOOR.rows;

/** The size World gives a squeezed terminal it has no better size for. */
export const TERMINAL_DEFAULT_SIZE: TerminalCells = { cols: 100, rows: 30 };
