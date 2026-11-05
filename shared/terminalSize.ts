/** A terminal size in character cells. */
export type TerminalCells = { cols: number; rows: number };

/**
 * Below this, a pane's size is a squeeze, not a size to keep: another
 * client's hidden attach at 13×1 leaves 2 rows, and no harness menu fits.
 * World never adopts such a size for a terminal it is not showing.
 */
export const TERMINAL_SIZE_FLOOR: TerminalCells = { cols: 40, rows: 10 };

/** Whether `size` is below the floor in either dimension. */
export const terminalSqueezed = (size: TerminalCells) =>
  size.cols < TERMINAL_SIZE_FLOOR.cols || size.rows < TERMINAL_SIZE_FLOOR.rows;
