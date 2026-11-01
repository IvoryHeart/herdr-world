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

export const usage = (message: string): never => {
  throw new CliError("usage", message);
};
export const refused = (message: string): never => {
  throw new CliError("refused", message);
};
export const notFound = (message: string): never => {
  throw new CliError("not_found", message);
};
