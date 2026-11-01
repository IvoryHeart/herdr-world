import { deskMetadataBytes } from "../../../shared/deskState";
import type { SavedTerminalMark } from "./terminal-marks";

/** Exactly the writer/restart representation, independent of live attachment. */
export function terminalMarkStorageBytes(rows: readonly SavedTerminalMark[]) {
  return deskMetadataBytes(
    rows.map((row) => ({
      ...row,
      binding: {
        ...row.binding,
        state: row.binding.state === "ended" ? "ended" : "unresolved",
      },
    })),
  );
}
