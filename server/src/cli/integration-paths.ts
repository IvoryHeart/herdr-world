import { join } from "node:path";
import type { CliRuntime } from "./command";
import { WORLD_HARNESSES } from "./harness-names";

export { WORLD_HARNESSES };
export type WorldHarness = (typeof WORLD_HARNESSES)[number];
export const SHARED_HARNESSES: readonly WorldHarness[] = [
  "codex",
  "pi",
  "kimi",
];

/** Config roots follow Herdr's src/integration/env.rs; skills follow each harness. */
export function integrationPaths(harness: WorldHarness, runtime: CliRuntime) {
  const env = runtime.env;
  const home = env.HOME || runtime.homeDir;
  const expand = (value: string) =>
    value.startsWith("~")
      ? join(home, value.slice(1).replace(/^[/\\]/, ""))
      : value;
  const setting = (key: string, fallback: string) =>
    env[key] ? expand(env[key]!) : fallback;
  const xdg = setting("XDG_CONFIG_HOME", join(home, ".config"));
  const roots: Partial<Record<WorldHarness, string>> = {
    claude: setting("CLAUDE_CONFIG_DIR", join(home, ".claude")),
    codex: setting("CODEX_HOME", join(home, ".codex")),
    pi: setting("PI_CODING_AGENT_DIR", join(home, ".pi/agent")),
    kimi: setting("KIMI_CODE_HOME", join(home, ".kimi-code")),
    copilot: setting("COPILOT_HOME", join(home, ".copilot")),
    devin: join(
      env.XDG_CONFIG_HOME
        ? xdg
        : runtime.platform === "win32" && env.APPDATA
          ? env.APPDATA
          : xdg,
      "devin",
    ),
    droid: join(home, ".factory"),
    opencode: setting("OPENCODE_CONFIG_DIR", join(xdg, "opencode")),
    kilo: join(xdg, "kilo"),
    hermes: setting(
      "HERMES_HOME",
      runtime.platform === "win32" &&
        !(env.HOME && env.HOME !== env.USERPROFILE) &&
        env.LOCALAPPDATA
        ? join(env.LOCALAPPDATA, "hermes")
        : join(home, ".hermes"),
    ),
    qodercli: setting("QODER_CONFIG_DIR", join(home, ".qoder")),
    qwen: setting("QWEN_HOME", join(home, ".qwen")),
    cursor: setting("CURSOR_CONFIG_DIR", join(home, ".cursor")),
    "antigravity-cli": setting(
      "ANTIGRAVITY_CLI_CONFIG_DIR",
      join(home, ".gemini/config"),
    ),
    grok: setting("GROK_CONFIG_DIR", setting("GROK_HOME", join(home, ".grok"))),
  };
  const config = roots[harness];
  if (!config) return null;
  const shared = SHARED_HARNESSES.includes(harness);
  const skills = shared
    ? join(home, ".agents/skills")
    : harness === "kilo"
      ? join(home, ".kilo/skills")
      : join(config, "skills");
  return {
    config,
    skills,
    folder: join(skills, "herdr-world"),
    file: join(skills, "herdr-world/SKILL.md"),
    id: shared ? "shared" : harness,
  };
}
