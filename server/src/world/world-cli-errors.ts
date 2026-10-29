export type CliErrorCode = "usage" | "refused" | "not_found" | "unavailable";

export class CliError extends Error {
  constructor(
    readonly code: CliErrorCode,
    message: string,
  ) {
    super(message);
  }
}
