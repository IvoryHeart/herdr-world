/** Reviewed value-level exceptions only. Never exempt an entire file or line.
 * Additions to this list need the same review as the guard itself. */
// Reuse already-published upstream attribution only in this generated artifact.
// Values come from main's published baseline, never from the current additions.
export const publishedAttributionFile = "DEPENDENCY_LICENSES.md";
export const reservedEmailDomain =
  /^(?:[a-z0-9-]+\.)*(?:example\.(?:com|org|net)|example|invalid|test|localhost)$/i;
export const syntheticHomeUsers = new Set([
  "<user>",
  "<username>",
  "example",
  "test-user",
  "$USER",
  "${USER}",
]);
// This unquoted Python binding holds 'release-walk-synthetic-password'. Keep
// the exception scoped to that binding in its fixture, never quoted passwords.
export const syntheticWorldPasswordBindings = new Map([
  ["scripts/release-walk/world.py", "PASSWORD"],
]);
const placeholderWords = new Set([
  "example",
  "placeholder",
  "redacted",
  "your-token",
  "your-password",
  "your-session-secret",
  "change-me",
  "test-token",
  "test-password",
]);
export function syntheticCredential(value: string): boolean {
  return (
    placeholderWords.has(value.toLowerCase()) ||
    /^<[^<>\s]+>$/.test(value) ||
    /^\$\{[^{}]+\}$/.test(value) ||
    /^\$[A-Z_][A-Z0-9_]*$/.test(value) ||
    /^([a-z0-9])\1{7,}$/i.test(value)
  );
}
