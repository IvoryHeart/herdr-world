export type CliErrorCode = "usage" | "refused" | "not_found" | "unavailable";

export class CliError extends Error {
  constructor(
    readonly code: CliErrorCode,
    message: string,
    readonly result?: unknown,
  ) {
    super(message);
  }
}
