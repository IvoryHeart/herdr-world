/** The Rust backend can download/extract ZIPs through adm-zip. Verification
 * must use the in-process TypeScript evaluator and our owned TLC checker.
 * Refuse omitted defaults as well as explicit backend changes before spawn.
 */
export function assertQuintBackend(args: readonly string[]) {
  const expected =
    args[0] === "run" || args[0] === "test"
      ? "typescript"
      : args[0] === "verify"
        ? "tlc"
        : null;
  if (!expected) return;
  if (
    args.filter((arg) => arg === "--backend").length !== 1 ||
    args.some((arg) => arg.startsWith("--backend=")) ||
    args[args.indexOf("--backend") + 1] !== expected
  )
    throw new Error(
      `Verification ${args[0]} requires explicit --backend ${expected}; automatic evaluator installation is refused`,
    );
}
