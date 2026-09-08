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
    // Changing a toolbar filter can activate a terminal without requesting input focus.
    && !options.currentTarget?.closest('[data-terminal-autofocus="false"]')
    && options.currentExternalFocusSequence === options.activationSnapshot.externalFocusSequence
    && options.currentTarget === options.activationSnapshot.target
  );
}
