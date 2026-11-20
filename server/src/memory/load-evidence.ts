import { posix as path } from "node:path";
import type { MemoryEntry, MemorySource } from "../../../shared/memory";
import {
  CONTEXT_FILENAMES,
  MAKI_FILENAMES,
  MUSE_FILENAMES,
} from "./registry-adapters";

const alternatives: Record<string, string[]> = {
  pi: CONTEXT_FILENAMES,
  "prime-agent": CONTEXT_FILENAMES,
  pig: ["AGENTS.override.md", ...CONTEXT_FILENAMES],
  maki: MAKI_FILENAMES,
  muse: MUSE_FILENAMES,
  "command-code": ["AGENTS.md", ".commandcode/AGENTS.md"],
  kilo: ["AGENTS.md", "CLAUDE.md", "CONTEXT.md"],
};

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
      if (entry.size === 0) mode = "empty";
      const names =
        harness === "mastracode"
          ? (source.scope === "user"
              ? [
                  ".claude",
                  ".mastracode",
                  ".config/claude",
                  ".config/mastracode",
                ]
              : ["", ".claude", ".mastracode"]
            ).flatMap((dir) =>
              ["AGENTS.md", "CLAUDE.md"].map((name) =>
                dir ? `${dir}/${name}` : name,
              ),
            )
          : alternatives[harness];
      const name = names
        ?.filter((name) => source.path.endsWith(`/${name}`))
        .sort((a, b) => b.length - a.length)[0];
      if (name && source.kind === "instructions") {
        const root = source.path.slice(0, -name.length);
        const preferred = names!.slice(0, names!.indexOf(name)).find((name) => {
          const candidate = sources.find(
            (s) => s.path === root + name && s.harnesses.includes(harness),
          );
          // These harnesses select by existence, including an empty primary.
          return (
            candidate &&
            entries.some(
              (e) => e.source_id === candidate.id && e.state === "available",
            )
          );
        });
        if (preferred) {
          mode = "shadowed";
          reason = `${preferred} takes precedence in this directory`;
        }
      }
      if (
        harness === "pi" &&
        source.scope === "user" &&
        path.basename(source.path) === "SYSTEM.md" &&
        sources.some(
          (s) =>
            s.harnesses.includes("pi") &&
            s.scope === "project" &&
            s.path.endsWith("/.pi/SYSTEM.md") &&
            present.has(s.path),
        )
      ) {
        mode = "shadowed";
        reason = "Project .pi/SYSTEM.md replaces the global system prompt";
      }
      if (
        harness === "omp" &&
        source.scope === "project" &&
        path.basename(source.path) === "AGENTS.md" &&
        !source.path.endsWith("/.omp/AGENTS.md") &&
        present.has(path.join(path.dirname(source.path), ".omp/AGENTS.md"))
      ) {
        mode = "shadowed";
        reason =
          "Native .omp/AGENTS.md takes precedence at this directory depth";
      }
      if (
        (harness === "opencode" || harness === "kilo") &&
        source.scope === "project" &&
        source.kind === "instructions"
      ) {
        // These loaders search the whole ancestor chain for one filename before
        // trying the next filename, rather than choosing a fallback per directory.
        const order =
          harness === "kilo" ? alternatives.kilo! : ["AGENTS.md", "CLAUDE.md"];
        const earlier = order.slice(
          0,
          order.indexOf(path.basename(source.path)),
        );
        const preferred = sources.find(
          (candidate) =>
            candidate.scope === "project" &&
            candidate.harnesses.includes(harness) &&
            earlier.includes(path.basename(candidate.path)) &&
            source.agent_ids.every((id) => candidate.agent_ids.includes(id)) &&
            entries.some(
              (e) => e.source_id === candidate.id && e.state === "available",
            ),
        );
        if (preferred) {
          mode = "shadowed";
          reason = `${path.basename(preferred.path)} takes precedence across the instruction chain`;
        }
      }
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
        (harness === "opencode" || harness === "kilo") &&
        path.basename(source.path) === "CLAUDE.md"
      ) {
        const primary = sources.find(
          (candidate) =>
            candidate.harnesses.includes(harness) &&
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
          reason = `${harness === "opencode" ? "OpenCode" : "Kilo"} AGENTS.md takes precedence over its CLAUDE.md fallback`;
        }
      }
      entry.harness_loads[harness] = { mode, ...(reason ? { reason } : {}) };
    }
  }
}
