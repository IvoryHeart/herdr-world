import assert from "node:assert/strict";

/** Remove exactly one currency fence, preserving the other startup boundary. */
export function removeRuntimeStartGuard(
  source: string,
  boundary: "transport" | "background",
) {
  const guard = "if (!this.isCurrent(entry, generation, runtime)) {";
  const parts = source.split(guard);
  assert.equal(parts.length, 3, "retired start guards changed");
  assert(parts[0]!.includes("await runtime.startTransport()"));
  assert(parts[1]!.includes("await runtime.startBackground()"));
  return (
    parts[0] +
    (boundary === "transport" ? "if (false) {" : guard) +
    parts[1] +
    (boundary === "background" ? "if (false) {" : guard) +
    parts[2]
  );
}
