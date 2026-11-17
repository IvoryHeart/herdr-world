// Native refusal, transport uncertainty and negotiated capability errors.
export class CoreRpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly kind: string | null,
  ) {
    super(message);
    this.name = "CoreRpcError";
  }
}

export class CoreUnavailableError extends Error {
  readonly retryable = true;
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CoreUnavailableError";
  }
}

/**
 * A write whose reply never came (timeout or a closed connection after it
 * was sent): core may or may not have done it. Shown as uncertain and never
 * retried automatically.
 */
export class CoreWriteUncertainError extends Error {
  readonly outcome = "uncertain";
  constructor(method: string, options?: ErrorOptions) {
    super(`herdr-core may have done ${method}; its reply never came`, options);
    this.name = "CoreWriteUncertainError";
  }
}

/** The connected core does not offer an operation World needs. */
export class CoreUnsupportedError extends Error {
  readonly retryable = false;
  constructor(version: string, method: string) {
    super(`herdr-core ${version} does not offer ${method}`);
    this.name = "CoreUnsupportedError";
  }
}

export class CoreIncompatibleError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "CoreIncompatibleError";
  }
}
