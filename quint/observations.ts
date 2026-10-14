import assert from "node:assert/strict";

export class ObservationMismatch extends assert.AssertionError {
  constructor(
    readonly observation: string,
    actual: unknown,
    expected: unknown,
    context?: string,
  ) {
    super({
      actual,
      expected,
      operator: "deepStrictEqual",
      message: `${observation}${context ? ` (${context})` : ""}`,
    });
  }
}

export function observe(
  observation: string,
  actual: unknown,
  expected: unknown,
  context?: string,
) {
  try {
    assert.deepEqual(actual, expected);
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    throw new ObservationMismatch(observation, actual, expected, context);
  }
}

export async function expectObservationMismatch(
  replay: () => unknown | Promise<unknown>,
  allowed: readonly string[],
) {
  try {
    await replay();
  } catch (error) {
    if (!isObservationMismatch(error, allowed)) throw error;
    return error;
  }
  assert.fail("negative control produced no expected observation mismatch");
}

export function isObservationMismatch(
  error: unknown,
  allowed: readonly string[],
): error is ObservationMismatch {
  return (
    error instanceof ObservationMismatch && allowed.includes(error.observation)
  );
}
