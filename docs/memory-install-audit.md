# Memory support against installed harnesses

Audit date: **2026-11-20**, Linux x86-64, Node 24.19.0, Bun 1.4.4 and Python
3.14.6 (Hermes). The inventory is `coreHarnessNames()` in
[`harness.ts`](../server/src/herdr-core/harness.ts): the 18 integration names
plus 12 detection/desktop names, **30 canonical harnesses**. Shells, editors and
aliases are not additional harnesses.

**28 adapters; 17 real-install memory comparisons; 13 unchecked rows.**
Sixteen comparisons checked startup files; Copilot checked its actual instruction
inventory. This does **not** certify every harness or an authenticated model turn.
A successful version command, inspected source, and the existing `?memoryFixture`
are not counted as memory verification. Auth/setup barriers below remain open.

All installs and instruction files used isolated disposable homes and Git projects,
without account credentials or the owner's projects. The production memory
service/Python worker and the Library's actual `libraryWings`, `readerRows` and
`agentLoad` functions read those same files. No World server was started. These
are service/Library-model comparisons, not a claim that the live Library was
opened against all 30 harnesses in a browser.

## Complete registry

“Yes” in **Memory checked** means an installed executable or its shipped loader
was exercised on the files, then compared with World. Evidence identifies prompt
capture, local loader reads, or inventory-only inspection. “No” is deliberate;
fixture coverage does not change it. **Installable here** refers to the complete
runtime through the tried public distribution, not merely Linux support upstream.

| Harness | Adapter | Installable here | Memory checked | Installed version / attempted release | Evidence or remaining barrier |
| --- | --- | --- | --- | --- | --- |
| amp | Yes | Yes | No | 0.0.1795204834-g00d70a | Account login starts before project memory; no credentials used |
| antigravity-cli | Yes | Yes | No | 1.5.13 | Global instruction/rule reads seen; no complete project-load receipt |
| claude | Yes | Yes | Yes | 2.1.330 | `-p`: local instruction/rule reads before auth refusal |
| cline | Yes | Yes | No | 3.0.74 | First-run setup did not reach the memory loader in the bounded CLI attempt |
| codex | Yes | Yes | Yes | 0.171.0 | `debug prompt-input`: rendered input contains user instructions and project override |
| command-code | Yes | Yes | No | 1.92.0 | Refuses without account authentication before loading project memory |
| copilot | Yes | Yes | Yes (inventory) | 1.0.114 | `instruction list --json`: exact personal/project/conditional source inventory; startup context not certified |
| crush | Yes | Yes | Yes | 0.102.0 | Real request to a synthetic provider includes all four project files and MDC context |
| cursor | Yes | Yes | No | 2026.11.19-f005e9d | Authentication required before project loading |
| devin | Yes | Yes | No | 3000.14.30821 (a09cd7f323ee) | Account login required, including with disposable workspace trust accepted |
| droid | Yes | Yes | Yes | 1.16.0 | `exec`: personal and project instruction reads during initialization |
| dsh-tui | Yes | No (complete runtime) | No | TUI launcher 0.20.2; core 0.2.2-rc.5 attempted | Launcher installs; core install fails with unresolved `workspace:*` dependency |
| gemini | Yes | Yes | Yes | 0.70.0 | Shipped global/environment memory discovery and `readGeminiMdFiles` return both instruction contents |
| grok | Yes | Yes | No | 1.0.92 (b06756fd6256) | Single-turn mode refuses before memory loading without sign-in |
| hermes | Yes | Yes | Yes | Source tag v0.23.3; CLI says `vunknown` | Shipped soul/context builders and frozen memory store load four files |
| kilo | Yes | Yes | Yes | 7.8.32 | Real provider input includes native global/project AGENTS; suppresses CLAUDE/CONTEXT alternatives |
| kimi | Yes | Yes | No | 2.7.2 | Current Kimi Code runs; only user/shared instruction reads reached, project loading not verified |
| kiro | Yes | Yes | No | 3.5.0 | Requires Kiro login/API key before project context |
| letta | No | Yes | No | 0.34.67 | MemFS belongs to an agent identity World cannot derive; headless mode also requires authentication |
| maki | Yes | Yes | Yes | 0.7.3 | `prompt`: rendered prompt contains personal AGENTS, project AGENTS and additive local instructions |
| mastracode | Yes | Yes | Yes | 0.50.2 | Real initialization reads chosen personal/project AGENTS, skipping the competing CLAUDE file |
| muse | Yes | Yes | Yes | 1.4.24 (1.4.24-R9131.1) | Trusted workspace, built-in echo provider: real loader selects project AGENTS over three alternatives |
| ollama | No | Yes | No (not applicable) | 0.40.16 | No automatic project Markdown memory; model-owned Modelfile/system configuration is outside this model |
| omp | Yes | Yes | Yes | 19.0.1 | Shipped `loadProjectContextFiles`: native user/project `.omp` context beats standalone project AGENTS |
| opencode | Yes | Yes | Yes | 1.19.6 | Real provider input selects global/project AGENTS; nested CLAUDE fallback remains excluded |
| pi | Yes | Yes | Yes | 0.73.1 | Shipped `loadProjectContextFiles`: AGENTS selected; removing it promotes CLAUDE |
| pig | Yes | Yes | Yes | 0.7.0+1.5.0 | `diagnose` establishes XDG root; actual loader reads that global AGENTS and project override |
| prime-agent | Yes | Yes | Yes | 0.10.5 | `prompt --json`: assembled prompt contains global/project AGENTS, excluding CLAUDE |
| qodercli | Yes | Yes | No | 1.1.94 | Requires login before project instruction discovery |
| qwen | Yes | Yes | Yes | 0.28.0 | Shipped trusted loader and real provider input include personal/project/local instructions and baseline rule |

## What was compared

Each file carried a distinct synthetic marker. Prompt captures used an ephemeral
loopback provider with a synthetic key; no request or account key went to a paid
provider. The provider stub's response behavior is not part of this acceptance.
Local file reads used a trace filtered to the disposable instruction files;
packaged loaders were invoked directly without replacing their discovery code.
Copilot's inspection reports source inventory, so its observation intentionally
omits `loaded` and does not assert startup timing.

The acceptance checker passed **19 observations across 17 harnesses**: one
root-project observation each, plus nested-cwd OpenCode and Kilo observations.
Every observation compared the complete present managed-file catalog, Library
shelves/reader, and fresh reads. The other 18 also compared the startup file set.
Competing files remain on shelves with shadowed load evidence; “exactly” refers
to the selected startup set, not hiding every unused candidate from browsing.

| Harness | Present managed files | Startup | Skipped / on demand |
| --- | --- | --- | --- |
| Claude | 3 | 3 | 0 |
| Codex | 3 | 2 | 1 override loser |
| Pi | 3 | 2 | 1 fallback |
| oh-my-pi | 3 | 2 | 1 standalone loser |
| Copilot | 4 | Not certified | Source inventory only |
| Droid | 3 | 3 | 0 |
| Maki | 4 | 3 | 1 fallback |
| Prime Agent | 3 | 2 | 1 fallback |
| Muse | 4 | 1 | 3 fallback locations |
| PiG | 4 | 2 | 2 fallback files |
| Qwen | 6 | 5 | 1 generated empty index |
| Gemini | 2 | 2 | 0 |
| Mastra Code | 3 | 2 | 1 fallback |
| OpenCode | 3; nested 4 | 2 | 1; nested 2 fallbacks |
| Kilo | 4; nested 5 | 2 | 2; nested 3 fallbacks |
| Crush | 5 | 5 | 0, including MDC despite Cursor-style conditional metadata |
| Hermes | 4 | 4 | 0 |

These bounded cases do not certify every optional source, import, custom filename,
profile, trust setting, path rule or memory system. They cover documented default
instruction discovery and selected rule/memory paths. Existing Claude/Codex
recall stores and every named-subagent/opaque project memory variant were not
all exercised by an authenticated vendor session. Current Library load evidence
remains candidates for a future load, not a receipt from a running session.

## Install and repeat

The npm distributions were installed at the exact versions above with
`npm install --prefix <disposable-install> <package>@<version>`. They are:
`@anthropic-ai/claude-code`, `@openai/codex`, `@mariozechner/pi-coding-agent`,
`@oh-my-pi/pi-coding-agent`, `@github/copilot`, `devin`, `@factory/cli`,
`@moonshot-ai/kimi-code`, `opencode-ai`, `@kilocode/cli`, `@qoder-ai/qodercli`,
`@qwen-code/qwen-code`, `@letta-ai/letta-code`, `mastracode`, `cline`,
`@google/gemini-cli`, `command-code`, `@pi-in-go/pig`, `@ampcode/cli`,
`@charmland/crush` and `@deepseek-harness-tui/dsh-tui`.

Native installs used the maker's [Cursor installer](https://cursor.com/install),
[Kiro installer](https://cli.kiro.dev/install),
[Antigravity installer](https://antigravity.google/cli/install.sh),
[Muse installer](https://dev.meta.ai/install.sh),
[Grok installer](https://x.ai/cli/install.sh),
[Maki v0.7.3 release](https://github.com/tontinton/maki/releases/tag/v0.7.3),
[Prime Agent v0.10.5 release](https://github.com/PrimeIntellect-ai/prime-agent/releases/tag/v0.10.5)
and [Ollama v0.40.16 release](https://github.com/ollama/ollama/releases/tag/v0.40.16).
Only Ollama's CLI binary was extracted; no Ollama daemon was started.

Hermes used the maker's [v0.23.3 source](https://github.com/NousResearch/hermes-agent/tree/v0.23.3)
and **`uv sync --frozen --no-dev --python 3.14`**, honoring its shipped dependency
overrides. A plain `uv pip install` does not honor that project lock/override policy
and fails on incompatible Pillow pins; that failed route is not the installability
verdict. The source archive lacks Git release metadata, so its CLI prints
`vunknown`; the exact source tag above identifies this check. The legacy Python
`kimi-cli` was also inspected, but the table uses its maker's current replacement,
Kimi Code. DeepSeek core install was tried both alone and with its instruction
plugin; neither dependency resolution completed.

For each repeat, create a fresh disposable home and Git project, prepare the
maker's files listed in [the adapter table](memory-api.md#discovery-and-load-evidence),
and obtain the installed loader's inventory or rendered input. Derive expectations
from that vendor result before checking World. Record one observation per case:

```json
[{
  "harness": "pi",
  "version": "0.73.1",
  "home": "/tmp/world-memory-audit/home",
  "project": "/tmp/world-memory-audit/project",
  "files": ["/tmp/world-memory-audit/project/AGENTS.md", "/tmp/world-memory-audit/project/CLAUDE.md"],
  "loaded": ["/tmp/world-memory-audit/project/AGENTS.md"]
}]
```

Use optional `cwd` for an agent below the project root. Omit `loaded` only when the
vendor reports inventory without startup evidence. Then run:

```sh
bun scripts/memory-install-audit.ts observations.json
```

The command reads existing files through the production service, checks the actual
Library model, and reports only harness/version/counts. It installs nothing,
starts no server, and does not fabricate vendor evidence. Temporary install trees,
capture payloads, traces and machine paths are not committed. The focused tests
are deterministic regressions derived from this audit, not substitutes for it.

## Exclusions and decisions

- [Letta MemFS](https://docs.letta.com/concepts/memfs) is agent-owned, with a
  `$MEMORY_DIR` selected by Letta. A workspace path does not identify its owner.
  The installed code describes AGENTS/CLAUDE files as project resources to read,
  rather than a documented default startup instruction chain. World does not
  guess an agent directory or inspect another process's environment.
- [Ollama Modelfile](https://docs.ollama.com/modelfile) configures a model's system
  prompt and message history. It does not establish a project Markdown memory
  directory; model artifacts and integration-supplied context remain excluded.
- New adapters cite maker docs/source in
  [`registry-adapters.ts`](../server/src/memory/registry-adapters.ts). Unmanaged
  extensionless legacy rules, arbitrary profiles/imports and external memory
  integrations remain outside the existing Markdown contract. No authentication,
  ownership, connection generation, mutation or retry boundary was relaxed.
