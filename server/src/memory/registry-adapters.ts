import { posix as path } from "node:path";
import {
  ancestors,
  configHome,
  context,
  directory,
  file,
  files,
  rules,
  type MemoryAdapter,
} from "./adapter-paths";

/** Ordered alternatives are kept visible; load-evidence marks the losers. */
export const CONTEXT_FILENAMES = [
  "AGENTS.md",
  "AGENTS.MD",
  "CLAUDE.md",
  "CLAUDE.MD",
];
export const MAKI_FILENAMES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".github/copilot-instructions.md",
  "COPILOT.md",
  "CONVENTIONS.md",
  "GEMINI.md",
  "CODING_AGENT.md",
];
export const MUSE_FILENAMES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".agents/AGENTS.md",
  ".claude/CLAUDE.md",
];

// https://ampcode.app/docs/customize/agents-md
const amp: MemoryAdapter = {
  harness: "amp",
  candidates(c) {
    const at = context(c);
    return [
      ...files(
        configHome(c.env),
        ["AGENTS.md", "amp/AGENTS.md"],
        "user",
        "Amp personal instructions; both files accumulate",
      ),
      file(
        "/etc/ampcode/AGENTS.md",
        "user",
        "Amp Linux system instructions; system permissions still apply",
      ),
      ...ancestors(at.path, c.env.home).map((root) =>
        file(
          path.join(root, "AGENTS.md"),
          "project",
          "Amp ancestor instructions; subtree guidance is discovered on access",
        ),
      ),
    ];
  },
};

// https://docs.cline.bot/customization/cline-rules
const cline: MemoryAdapter = {
  harness: "cline",
  candidates(c) {
    const at = context(c);
    return [
      file(
        path.join(c.env.home, ".agents/AGENTS.md"),
        "user",
        "Cline shared personal instructions",
      ),
      ...["Documents/Cline/Rules", "Cline/Rules", ".cline/rules"].map((dir) =>
        rules(
          path.join(c.env.home, dir),
          "user",
          "Cline personal Markdown rules; toggles and paths frontmatter decide use",
        ),
      ),
      file(
        path.join(at.root, "AGENTS.md"),
        "project",
        "Cline project instructions; workspace trust and toggles decide use",
      ),
      ...[".clinerules", ".cline/rules"].map((dir) =>
        rules(
          path.join(at.root, dir),
          "project",
          "Cline workspace Markdown rules; paths frontmatter defers conditional rules",
        ),
      ),
    ];
  },
};

// https://geminicli.com/docs/cli/gemini-md/
const gemini: MemoryAdapter = {
  harness: "gemini",
  candidates(c) {
    const at = context(c);
    return [
      file(
        path.join(c.env.home, ".gemini/GEMINI.md"),
        "user",
        "Gemini CLI personal context",
      ),
      ...ancestors(at.path, at.root).map((root) =>
        file(
          path.join(root, "GEMINI.md"),
          "project",
          "Gemini CLI root-to-cwd context; trust, configured filenames and imports can alter loading",
        ),
      ),
    ];
  },
};

// https://kiro.dev/docs/steering/
const kiro: MemoryAdapter = {
  harness: "kiro",
  candidates(c) {
    const at = context(c);
    return [
      rules(
        path.join(c.env.home, ".kiro/steering"),
        "user",
        "Kiro global steering; inclusion modes and custom-agent resources decide use",
      ),
      file(
        path.join(at.root, "AGENTS.md"),
        "project",
        "Kiro workspace instructions",
      ),
      rules(
        path.join(at.root, ".kiro/steering"),
        "project",
        "Kiro steering; always is the default, fileMatch/auto/manual load on demand",
      ),
    ];
  },
};

// https://maki.sh/docs/context/#instruction-files
// Legacy extensionless alternatives and database-backed memory are outside Markdown v1.
const maki: MemoryAdapter = {
  harness: "maki",
  candidates(c) {
    const at = context(c);
    return [
      file(
        path.join(configHome(c.env), "maki/AGENTS.md"),
        "user",
        "Maki global instructions",
      ),
      ...ancestors(at.path, at.root).flatMap((root) =>
        files(
          root,
          [...MAKI_FILENAMES, "AGENTS.local.md"],
          "project",
          "Maki first matching instruction file per directory, plus AGENTS.local.md; custom instruction lists are not expanded",
        ),
      ),
    ];
  },
};

// https://github.com/MichaelKinsy/PiG/blob/v0.7.0/internal/codingagent/context_files.go
const pig: MemoryAdapter = {
  harness: "pig",
  candidates(c) {
    const at = context(c);
    const names = ["AGENTS.override.md", ...CONTEXT_FILENAMES];
    return [
      ...files(
        path.join(configHome(c.env), "pig/agent"),
        names,
        "user",
        "PiG global context; override then first existing AGENTS/CLAUDE variant; pig diagnose reports the active root",
      ),
      ...ancestors(at.path).flatMap((root) =>
        files(
          root,
          names,
          "project",
          "PiG ancestor context; project trust decides use, one file per directory",
        ),
      ),
    ];
  },
};

// https://github.com/charmbracelet/crush/blob/v0.102.0/internal/config/config.go
const crush: MemoryAdapter = {
  harness: "crush",
  candidates(c) {
    const at = context(c);
    return [
      ...files(
        at.root,
        [
          ".github/copilot-instructions.md",
          "CLAUDE.md",
          "CLAUDE.local.md",
          "GEMINI.md",
          "gemini.md",
          "crush.md",
          "crush.local.md",
          "Crush.md",
          "Crush.local.md",
          "CRUSH.md",
          "CRUSH.local.md",
          "AGENTS.md",
          "agents.md",
          "Agents.md",
        ],
        "project",
        "Crush default context files accumulate; custom context_paths are not expanded",
      ),
      directory(
        path.join(at.root, ".cursor/rules"),
        "project",
        "rules",
        "Crush Cursor-compatible context directory; configured context paths decide use",
      ),
    ];
  },
};

// https://commandcode.ai/docs/memory
const commandCode: MemoryAdapter = {
  harness: "command-code",
  candidates(c) {
    const at = context(c);
    return [
      file(
        path.join(c.env.home, ".commandcode/AGENTS.md"),
        "user",
        "Command Code personal memory",
      ),
      ...ancestors(at.path, at.root).flatMap((root) =>
        files(
          root,
          ["AGENTS.md", ".commandcode/AGENTS.md"],
          "project",
          "Command Code first existing location; subdirectory files load on access, imports are not expanded",
        ).map((source) => ({
          ...source,
          load:
            root === at.root
              ? ("startup-candidate" as const)
              : ("on-demand" as const),
        })),
      ),
    ];
  },
};

// https://github.com/PrimeIntellect-ai/prime-agent/blob/v0.10.5/crates/pa-core/src/resources/mod.rs
const prime: MemoryAdapter = {
  harness: "prime-agent",
  candidates(c) {
    const at = context(c);
    return [
      ...files(
        path.join(c.env.home, ".prime/agent"),
        CONTEXT_FILENAMES,
        "user",
        "Prime Agent global context; first existing filename wins",
      ),
      ...ancestors(at.path).flatMap((root) =>
        files(
          root,
          CONTEXT_FILENAMES,
          "project",
          "Prime Agent ancestor context; first existing filename per directory wins",
        ),
      ),
    ];
  },
};

// https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/agent-instructions/README.md
const deepseek: MemoryAdapter = {
  harness: "dsh-tui",
  candidates(c) {
    const at = context(c);
    return [
      ...files(
        c.env.home,
        [".dsh/AGENTS.md", ".agents/AGENTS.md"],
        "user",
        "DeepSeek Harness global instruction chain; custom process homes are not inferred",
      ),
      ...ancestors(at.path, at.root).flatMap((root) =>
        files(
          root,
          ["AGENTS.md", "CLAUDE.md", "AGENTS.local.md", "CLAUDE.local.md"],
          "project",
          "DeepSeek Harness default instruction chain; duplicate content and per-chain budgets can omit files",
        ),
      ),
    ];
  },
};

// https://dev.meta.ai/docs/muse-code/configuration
const muse: MemoryAdapter = {
  harness: "muse",
  candidates(c) {
    const at = context(c);
    return ancestors(at.path, at.root).flatMap((root) =>
      files(
        root,
        MUSE_FILENAMES,
        "project",
        "Muse Code first existing instruction location per directory; workspace trust decides use",
      ),
    );
  },
};

export const REGISTRY_MEMORY_ADAPTERS: readonly MemoryAdapter[] = [
  amp,
  cline,
  gemini,
  kiro,
  maki,
  pig,
  crush,
  commandCode,
  prime,
  deepseek,
  muse,
];
