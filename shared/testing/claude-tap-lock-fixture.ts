/** Synthetic histories checked against the actual tap's filesystem regression. */
export const claudeTapLockFixture = {
  live: {
    commits: [20, 22, 23],
    explanation:
      "A pauses before publication. B skips its optional reading; A publishes 22, then B's next update publishes 23.",
  },
  dead: {
    commits: [20, 23, 23],
    explanation:
      "A exits before publication. B confirms its death and publishes 23; A cannot resume. B's next update retains 23.",
  },
};
