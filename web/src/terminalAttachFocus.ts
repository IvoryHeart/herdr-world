export type TerminalAutoFocusSnapshot = {
  target: Element | null;
  externalFocusSequence: number;
};

export function shouldRestoreTerminalFocus(options: {
  autoFocus: boolean;
  currentTarget: Element | null;
  currentExternalFocusSequence: number;
  activationSnapshot: TerminalAutoFocusSnapshot;
}) {
  return (
    options.autoFocus
    && options.currentExternalFocusSequence === options.activationSnapshot.externalFocusSequence
    && options.currentTarget === options.activationSnapshot.target
  );
}
