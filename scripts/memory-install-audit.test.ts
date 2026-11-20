import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditMemoryInstall } from "./memory-install-audit";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function observation(
  harness: string,
  files: Record<string, string>,
  loaded: string[],
) {
  const root = await mkdtemp(join(tmpdir(), "world-memory-install-check-"));
  roots.push(root);
  const home = join(root, "home"),
    project = join(root, "project");
  await mkdir(home);
  await mkdir(join(project, ".git"), { recursive: true });
  const absolute = (name: string) =>
    name.startsWith("~/") ? join(home, name.slice(2)) : join(project, name);
  for (const [name, text] of Object.entries(files)) {
    const path = absolute(name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, text);
  }
  return {
    harness,
    version: "test-contract",
    home,
    project,
    files: Object.keys(files).map(absolute),
    loaded: loaded.map(absolute),
  };
}

// Filesystem/Library regressions derived from the separate real-install audit.
// These tests do not install or impersonate any vendor harness.
test.each(["pi", "prime-agent", "maki", "muse", "kilo", "mastracode"])(
  "%s lists alternatives while Library startup matches the first existing file",
  async (harness) => {
    const result = await auditMemoryInstall(
      await observation(
        harness,
        {
          "AGENTS.md": "Preferred\n",
          "CLAUDE.md": "Fallback\n",
        },
        ["AGENTS.md"],
      ),
    );
    expect(result).toMatchObject({ files: 2, startup: 1, skipped: 1 });
  },
);

test("Pi's empty primary still suppresses the fallback", async () => {
  expect(
    await auditMemoryInstall(
      await observation(
        "pi",
        {
          "AGENTS.md": "",
          "CLAUDE.md": "Fallback\n",
        },
        [],
      ),
    ),
  ).toMatchObject({ files: 2, startup: 0, skipped: 2 });
});

test("Qwen's generated empty memory index stays on its shelf and off the startup list", async () => {
  expect(
    await auditMemoryInstall(
      await observation(
        "qwen",
        {
          "~/.qwen/memories/MEMORY.md": "",
        },
        [],
      ),
    ),
  ).toMatchObject({ files: 1, startup: 0, skipped: 1 });
});

test("native OMP context wins over standalone instructions at the same depth", async () => {
  expect(
    await auditMemoryInstall(
      await observation(
        "omp",
        {
          "AGENTS.md": "Standalone\n",
          ".omp/AGENTS.md": "Native\n",
        },
        [".omp/AGENTS.md"],
      ),
    ),
  ).toMatchObject({ startup: 1, skipped: 1 });
});

test("PiG's installed default uses its XDG agent directory and an override", async () => {
  expect(
    await auditMemoryInstall(
      await observation(
        "pig",
        {
          "~/.config/pig/agent/AGENTS.md": "Personal\n",
          "AGENTS.md": "Base\n",
          "AGENTS.override.md": "Override\n",
        },
        ["~/.config/pig/agent/AGENTS.md", "AGENTS.override.md"],
      ),
    ),
  ).toMatchObject({ startup: 2, skipped: 1 });
});

test("Command Code's hidden location is a fallback, including for an empty primary", async () => {
  expect(
    await auditMemoryInstall(
      await observation(
        "command-code",
        {
          "AGENTS.md": "",
          ".commandcode/AGENTS.md": "Hidden fallback\n",
        },
        [],
      ),
    ),
  ).toMatchObject({ startup: 0, skipped: 2 });
});

test.each([
  ["cline", ".cline/rules", "paths: [src/**]"],
  ["kiro", ".kiro/steering", "inclusion: manual"],
])(
  "%s separates baseline and conditional rules in the Library",
  async (harness, folder, header) => {
    expect(
      await auditMemoryInstall(
        await observation(
          harness,
          {
            [`${folder}/baseline.md`]: "Baseline\n",
            [`${folder}/conditional.md`]: `---\n${header}\n---\nConditional\n`,
          },
          [`${folder}/baseline.md`],
        ),
      ),
    ).toMatchObject({ startup: 1, on_demand: 1 });
  },
);

test("Crush's default context directory exposes MDC without losing Markdown", async () => {
  expect(
    await auditMemoryInstall(
      await observation(
        "crush",
        {
          "CRUSH.md": "Project context\n",
          ".cursor/rules/audit.mdc": "Rule\n",
        },
        ["CRUSH.md", ".cursor/rules/audit.mdc"],
      ),
    ),
  ).toMatchObject({ files: 2, startup: 2 });
});

test("the acceptance checker rejects a vendor/Library mismatch", async () => {
  await expect(
    auditMemoryInstall(await observation("pi", { "AGENTS.md": "Rules\n" }, [])),
  ).rejects.toThrow("Library startup versus vendor loader");
});

test.each(["opencode", "kilo"])(
  "%s searches a filename across the ancestor chain before falling back",
  async (harness) => {
    const o = await observation(
      harness,
      { "AGENTS.md": "Root\n", "src/CLAUDE.md": "Nested fallback\n" },
      ["AGENTS.md"],
    );
    expect(
      await auditMemoryInstall({ ...o, cwd: join(o.project, "src") }),
    ).toMatchObject({ files: 2, startup: 1, skipped: 1 });
  },
);
