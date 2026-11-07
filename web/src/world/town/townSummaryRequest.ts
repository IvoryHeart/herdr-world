/**
 * Town's summary, asked for from another view (Board's hub): it opens as
 * Town shows, or at once while Town already does.
 */

let pending = false;
let opener: (() => void) | null = null;

export function requestTownSummary() {
  if (opener) opener();
  else pending = true;
}

/** Town offers its summary while it shows; a waiting request opens it now. */
export function offerTownSummary(open: () => void) {
  opener = open;
  if (pending) {
    pending = false;
    open();
  }
  return () => {
    if (opener === open) opener = null;
  };
}

/** Tests start with nothing asked. */
export function resetTownSummaryRequestForTest() {
  pending = false;
  opener = null;
}
