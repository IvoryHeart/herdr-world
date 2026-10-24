import { removeInstallerFixture } from "./installer-upgrade";

/** Keep native fixture cleanup awaited, bounded and observable to the test. */
export async function withNativePluginFixture<T>(
  root: string,
  body: () => T | Promise<T>,
  cleanup: (root: string) => Promise<void> = removeInstallerFixture,
): Promise<T> {
  let result!: T;
  let bodyFailed = false;
  let bodyError: unknown;
  try {
    result = await body();
  } catch (error) {
    bodyFailed = true;
    bodyError = error;
  }
  try {
    await cleanup(root);
  } catch (cleanupError) {
    if (bodyFailed)
      throw new AggregateError(
        [bodyError, cleanupError],
        "Native plugin fixture body and cleanup both failed",
        { cause: cleanupError },
      );
    throw cleanupError;
  }
  if (bodyFailed) throw bodyError;
  return result;
}
