import { installTestClock, type ClockTarget } from "./testClock";

// Imported before the app/React. The bundle plugin directs only admission's
// timer port here: real browser frames still prove rendering and focus, while
// admission deadlines never wait on wall time or change production constants.
export const admissionTimers = {} as ClockTarget;
export const admissionClock = installTestClock(admissionTimers, {
  now: () => 0,
});

const completions = new Map<string, () => void>();

/** Register before triggering creation; the real opener's promise settles it. */
export function nextCreatedOpenerCompletion(id: string) {
  return new Promise<void>((resolve) => completions.set(id, resolve));
}

/** Injected immediately after awaiting the actual controller opener. */
export function createdOpenerCompleted(id: string) {
  const resolve = completions.get(id);
  completions.delete(id);
  resolve?.();
}
