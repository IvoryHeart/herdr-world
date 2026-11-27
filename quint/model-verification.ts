import assert from "node:assert/strict";

/** Allocation's exhaustive configurations do not depend on its sampled traces.
 * Observe failures immediately and expose a drain for the runner's failure path.
 */
export function prepareModelVerification(
  name: string,
  command: (label: string, args: string[]) => Promise<string>,
  cancellation: AbortController,
) {
  const verify = async () => {
    const log = await command(`${name}-verification`, [
      "verify",
      `quint/${name}.qnt`,
      "--backend",
      "tlc",
      "--invariant",
      "safety",
      "--verbosity",
      "3",
      ...(name === "space-admission"
        ? ["--init", "allConfigurations", "--step", "hold"]
        : []),
    ]);
    assert.match(
      log,
      /No violation found/,
      "verification did not report success",
    );
  };
  const concurrent =
    name === "space-admission"
      ? verify().then(
          () => ({}),
          (error: unknown) => {
            cancellation.abort(error);
            return { error };
          },
        )
      : undefined;
  return {
    drain: concurrent ?? Promise.resolve({}),
    async finish() {
      if (!concurrent) return verify();
      const result = await concurrent;
      if ("error" in result) throw result.error;
    },
  };
}
