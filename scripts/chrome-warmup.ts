export { warmChrome } from "./testing/browser-session";

/**
 * A fresh CI runner's first Chrome launch builds the user's fontconfig cache
 * and pages Chrome in from a cold disk. Measured on six runners it took
 * 0.9–14.6 s, against about 0.5 s for every later launch, and whichever
 * browser test happened to start Chrome first paid it inside its 35 s startup
 * budget. Pay it once, up front, outside any test's budget.
 */
