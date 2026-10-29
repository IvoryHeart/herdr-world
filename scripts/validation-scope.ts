/** One conservative allowlist shared by CI and the local delivery gate. */
export function isToolingPath(path: string): boolean {
  // No normalization: git paths are canonical; ambiguous inputs fail closed.
  if (
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    path.includes("\\")
  )
    return false;
  return (
    path.startsWith("scripts/agent/") ||
    [
      "docs/agent-development.md",
      "docs/crew-runbook.md",
      "docs/dispatch-runbook.md",
    ].includes(path) ||
    /^changes\/[a-z0-9][a-z0-9-]*\.md$/.test(path)
  );
}

export function isToolingOnlyChange(paths: readonly string[]): boolean {
  return paths.length > 0 && paths.every(isToolingPath);
}
