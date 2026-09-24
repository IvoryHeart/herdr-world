export type DialogKeyAction = "close" | "confirm" | "contain" | "native";

export function dialogKeyAction(
  key: string,
  focusInsideDialog: boolean,
  focusOnButton = false,
): DialogKeyAction {
  if (key === "Escape") return "close";
  if (!focusInsideDialog) return "contain";
  // Confirm on Enter unless a button is focused; focused buttons keep their
  // native activation so Enter on Cancel never confirms.
  if (key === "Enter" && !focusOnButton) return "confirm";
  return "native";
}
