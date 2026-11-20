/** Reviewed value-level exceptions only. Never exempt a file, directory or line.
 * Additions to this list need the same review as the guard itself. */
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
