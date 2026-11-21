import { posix as path } from "node:path";
import type { MemoryEntry, MemorySource } from "../../../shared/memory";

/** Default precedence only. Runtime controls and custom settings remain unproven. */
export function memoryLoadEvidence(
  entries: MemoryEntry[],
  sources: MemorySource[],
) {
  const present = new Map(
    entries
      .filter((entry) => entry.state === "available" && entry.size > 0)
      .map((entry) => {
        const source = sources.find((source) => source.id === entry.source_id)!;
        return [
          source.shape === "file"
            ? source.path
            : path.join(source.path, entry.path),
          entry,
        ];
      }),
  );
  for (const entry of entries) {
    const source = sources.find((source) => source.id === entry.source_id)!;
    const ruleLoads = entry.harness_loads;
    entry.harness_loads = {};
    for (const harness of source.harnesses) {
      let mode: NonNullable<
        MemoryEntry["harness_loads"][typeof harness]
      >["mode"] = ruleLoads?.[harness]?.mode ?? entry.load;
      let reason: string | undefined;
      if (source.kind === "instructions" && entry.size === 0) mode = "empty";
      if (
        harness === "codex" &&
        source.kind === "instructions" &&
        path.basename(source.path) === "AGENTS.md" &&
        present.has(path.join(path.dirname(source.path), "AGENTS.override.md"))
      ) {
        mode = "shadowed";
        reason = "Nonempty AGENTS.override.md takes precedence";
      }
      if (
        harness === "claude" &&
        source.kind === "instructions" &&
        path.basename(source.path) === "AGENTS.md"
      ) {
        const competing = sources.some((candidate) => {
          const parent = path
            .dirname(candidate.path)
            .replace(/\/\.claude$/, "");
          return (
            candidate.harnesses.includes("claude") &&
            candidate.kind === "instructions" &&
            /(?:^|\/)CLAUDE(?:\.local)?\.md$/.test(candidate.path) &&
            present.has(candidate.path) &&
            (path.dirname(source.path) === parent ||
              source.path.startsWith(`${parent}/`))
          );
        });
        if (competing) {
          mode = "shadowed";
          reason =
            "Claude instructions take precedence over the AGENTS.md fallback";
        }
      }
      if (
        harness === "opencode" &&
        path.basename(source.path) === "CLAUDE.md"
      ) {
        const primary = sources.find(
          (candidate) =>
            candidate.harnesses.includes("opencode") &&
            candidate.scope === source.scope &&
            path.basename(candidate.path) === "AGENTS.md" &&
            (source.scope === "user" ||
              path.dirname(candidate.path) === path.dirname(source.path)),
        );
        if (
          primary &&
          entries.some(
            (entry) =>
              entry.source_id === primary.id && entry.state === "available",
          )
        ) {
          mode = "shadowed";
          reason =
            "OpenCode AGENTS.md takes precedence over its CLAUDE.md fallback";
        }
      }
      entry.harness_loads[harness] = { mode, ...(reason ? { reason } : {}) };
    }
  }
}
