/** A dispatched operation may have completed; callers must re-observe before retrying. */
export class UncertainRequestError extends Error {
  readonly outcome = "uncertain";

  constructor(
    readonly method: string,
    reason: string,
  ) {
    super(
      `${reason}; ${method} outcome is uncertain. Refresh the exact target before retrying.`,
    );
    this.name = "UncertainRequestError";
  }
}
