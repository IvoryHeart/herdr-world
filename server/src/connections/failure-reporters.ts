import {
  createRecoveryReporter,
  type Logger,
  type RecoveryReporter,
} from "../utils/logger";

/** One recovery reporter per connection: a failure logs once until it recovers. */
export function connectionFailureReporters(
  logger: Logger,
): (connectionId: string) => RecoveryReporter {
  const reporters = new Map<string, RecoveryReporter>();
  return (connectionId) => {
    let reporter = reporters.get(connectionId);
    if (!reporter) {
      reporter = createRecoveryReporter({
        logger,
        failureMessage: "connection degraded",
        recoveryMessage: "connection recovered",
      });
      reporters.set(connectionId, reporter);
    }
    return reporter;
  };
}
