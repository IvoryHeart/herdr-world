import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { runCli } from "./index";
import { integrationPaths } from "./integration-paths";
import { createTestCli, type TestCli } from "./test-context";
import { WORLD_SKILL_VERSION } from "./integration";
import { WORLD_SKILL } from "./world-skill";

let cli: TestCli;
afterEach(() => cli?.cleanup());
const paths = {
  pi: ".agents/skills",
  omp: null,
  claude: ".claude/skills",
  codex: ".agents/skills",
  copilot: ".copilot/skills",
  devin: ".config/devin/skills",
  droid: ".factory/skills",
  kimi: ".agents/skills",
  opencode: ".config/opencode/skills",
  kilo: ".kilo/skills",
  hermes: ".hermes/skills",
  qodercli: ".qoder/skills",
  qwen: ".qwen/skills",
  letta: null,
  cursor: ".cursor/skills",
  mastracode: null,
  "antigravity-cli": ".gemini/config/skills",
  grok: ".grok/skills",
};

test("status lists exactly Herdr's harnesses and writes nothing", async () => {
  cli = createTestCli();
  expect(await runCli(["integration", "status"], cli.context)).toBe(0);
  expect(cli.output).toEqual(
    Object.entries(paths).map(
      ([name, path]) =>
        `${name}: ${path ? `not installed (~/${path}/herdr-world/SKILL.md)` : "unsupported (no documented skill folder)"}`,
    ),
  );
  expect(readdirSync(cli.home)).toEqual([]);
});

test("every supported harness round trips without touching Herdr or settings", async () => {
  cli = createTestCli();
  for (const [name, path] of Object.entries(paths)) {
    if (!path) {
      expect(await runCli(["integration", "install", name], cli.context)).toBe(
        1,
      );
      continue;
    }
    const config =
      name === "kilo"
        ? ".config/kilo"
        : name === "pi"
          ? ".pi/agent"
          : name === "codex"
            ? ".codex"
            : name === "kimi"
              ? ".kimi-code"
              : dirname(path);
    mkdirSync(join(cli.home, config), { recursive: true });
    const skills = join(cli.home, path);
    mkdirSync(skills, { recursive: true });
    const settings = join(cli.home, config, "settings.json");
    writeFileSync(settings, '{"hooks":{"Herdr":"keep"},"statusLine":"keep"}');
    expect(await runCli(["integration", "install", name], cli.context)).toBe(0);
    const file = join(skills, "herdr-world/SKILL.md");
    const text = readFileSync(file, "utf8");
    expect(text).toStartWith("---\nname: herdr-world\n");
    expect(text).toContain(
      `HERDR_WORLD_INTEGRATION_ID=${["pi", "codex", "kimi"].includes(name) ? "shared" : name}\n`,
    );
    expect(text).toEndWith(WORLD_SKILL);
    expect(await runCli(["integration", "status", name], cli.context)).toBe(0);
    expect(cli.output.at(-1)).toContain(": current (v1)");
    writeFileSync(
      file,
      text.replace(
        "HERDR_WORLD_INTEGRATION_VERSION=1",
        "HERDR_WORLD_INTEGRATION_VERSION=0",
      ),
    );
    await runCli(["integration", "status", name], cli.context);
    expect(cli.output.at(-1)).toContain(": outdated (v0)");
    expect(await runCli(["integration", "install", name], cli.context)).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(text);
    expect(await runCli(["integration", "uninstall", name], cli.context)).toBe(
      0,
    );
    expect(readdirSync(skills)).toEqual([]);
    expect(readFileSync(settings, "utf8")).toBe(
      '{"hooks":{"Herdr":"keep"},"statusLine":"keep"}',
    );
  }
});

test("missing config refuses without creating a harness home; shared status and removal name all consumers", async () => {
  cli = createTestCli();
  expect(await runCli(["integration", "install", "codex"], cli.context)).toBe(
    1,
  );
  expect(readdirSync(cli.home)).toEqual([]);
  mkdirSync(join(cli.home, ".codex"));
  await runCli(["integration", "install", "codex"], cli.context);
  for (const name of ["codex", "pi", "kimi"]) {
    await runCli(["integration", "status", name], cli.context);
    expect(cli.output.at(-1)).toBe(
      `${name}: current (v1) (~/.agents/skills/herdr-world/SKILL.md)`,
    );
  }
  await runCli(["integration", "uninstall", "codex"], cli.context);
  expect(cli.output.join("\n")).toContain("Pi and Kimi");
  expect(existsSync(join(cli.home, ".agents/skills/herdr-world"))).toBe(false);
});

test("harness and XDG variables resolve paths while shared skills remain under HOME", async () => {
  cli = createTestCli();
  const env = cli.context.runtime.env;
  for (const [variable, name] of [
    ["CLAUDE_CONFIG_DIR", "claude"],
    ["HERMES_HOME", "hermes"],
    ["GROK_HOME", "grok"],
    ["COPILOT_HOME", "copilot"],
    ["QODER_CONFIG_DIR", "qodercli"],
    ["QWEN_HOME", "qwen"],
    ["CURSOR_CONFIG_DIR", "cursor"],
    ["ANTIGRAVITY_CLI_CONFIG_DIR", "antigravity-cli"],
    ["OPENCODE_CONFIG_DIR", "opencode"],
    ["GROK_CONFIG_DIR", "grok"],
  ]) {
    env[variable!] = join(cli.home, variable!);
    mkdirSync(env[variable!]!);
    expect(await runCli(["integration", "install", name!], cli.context)).toBe(
      0,
    );
    expect(
      existsSync(join(env[variable!]!, "skills/herdr-world/SKILL.md")),
    ).toBe(true);
  }
  delete env.OPENCODE_CONFIG_DIR;
  env.XDG_CONFIG_HOME = join(cli.home, "xdg");
  for (const name of ["devin", "opencode"]) {
    mkdirSync(join(env.XDG_CONFIG_HOME, name), { recursive: true });
    expect(await runCli(["integration", "install", name], cli.context)).toBe(0);
    expect(
      existsSync(
        join(env.XDG_CONFIG_HOME, name, "skills/herdr-world/SKILL.md"),
      ),
    ).toBe(true);
  }
  for (const [variable, name] of [
    ["CODEX_HOME", "codex"],
    ["PI_CODING_AGENT_DIR", "pi"],
    ["KIMI_CODE_HOME", "kimi"],
  ]) {
    env[variable!] = join(cli.home, variable!);
    mkdirSync(env[variable!]!);
    expect(await runCli(["integration", "install", name!], cli.context)).toBe(
      0,
    );
    expect(
      existsSync(join(cli.home, ".agents/skills/herdr-world/SKILL.md")),
    ).toBe(true);
  }
});

test("malformed, wrong-ID and future markers; preserve unrelated files on removal", async () => {
  cli = createTestCli();
  const folder = join(cli.home, ".claude/skills/herdr-world");
  mkdirSync(folder, { recursive: true });
  const file = join(folder, "SKILL.md");
  for (const marker of [
    "",
    "HERDR_WORLD_INTEGRATION_VERSION=nope",
    "HERDR_WORLD_INTEGRATION_ID=codex\nHERDR_WORLD_INTEGRATION_VERSION=1",
  ]) {
    writeFileSync(file, marker);
    await runCli(["integration", "status", "claude"], cli.context);
    expect(cli.output.at(-1)).toContain(": outdated");
  }
  await runCli(["integration", "install", "claude"], cli.context);
  writeFileSync(
    file,
    readFileSync(file, "utf8").replace("VERSION=1", "VERSION=99"),
  );
  await runCli(["integration", "status", "claude"], cli.context);
  expect(cli.output.at(-1)).toContain("current (v99)");
  writeFileSync(join(folder, "keep.txt"), "user content");
  await runCli(["integration", "uninstall", "claude"], cli.context);
  expect(readdirSync(folder)).toEqual(["keep.txt"]);
});

test("tilde and empty overrides, XDG precedence and Windows config fallbacks", () => {
  cli = createTestCli();
  const runtime = cli.context.runtime;
  runtime.env.CLAUDE_CONFIG_DIR = "~/custom-claude";
  expect(integrationPaths("claude", runtime)?.config).toBe(
    join(cli.home, "custom-claude"),
  );
  runtime.env.CLAUDE_CONFIG_DIR = "";
  expect(integrationPaths("claude", runtime)?.config).toBe(
    join(cli.home, ".claude"),
  );
  runtime.platform = "win32";
  runtime.env.APPDATA = join(cli.home, "roaming");
  runtime.env.LOCALAPPDATA = join(cli.home, "local");
  expect(integrationPaths("devin", runtime)?.config).toBe(
    join(cli.home, "roaming/devin"),
  );
  expect(integrationPaths("hermes", runtime)?.config).toBe(
    join(cli.home, "local/hermes"),
  );
  runtime.env.XDG_CONFIG_HOME = join(cli.home, "xdg");
  expect(integrationPaths("devin", runtime)?.config).toBe(
    join(cli.home, "xdg/devin"),
  );
});

test("refuses symlinked managed folders and files without changing their targets", async () => {
  cli = createTestCli();
  const skills = join(cli.home, ".claude/skills");
  mkdirSync(skills, { recursive: true });
  const other = join(cli.home, "other");
  mkdirSync(other);
  writeFileSync(join(other, "SKILL.md"), "keep");
  symlinkSync(other, join(skills, "herdr-world"));
  for (const action of ["install", "uninstall"]) {
    expect(await runCli(["integration", action, "claude"], cli.context)).toBe(
      1,
    );
    expect(readFileSync(join(other, "SKILL.md"), "utf8")).toBe("keep");
  }
  unlinkSync(join(skills, "herdr-world"));
  mkdirSync(join(skills, "herdr-world"));
  symlinkSync(join(other, "SKILL.md"), join(skills, "herdr-world/SKILL.md"));
  for (const action of ["install", "uninstall"]) {
    expect(await runCli(["integration", action, "claude"], cli.context)).toBe(
      1,
    );
    expect(readFileSync(join(other, "SKILL.md"), "utf8")).toBe("keep");
  }
});

test.skipIf(process.getuid?.() === 0)(
  "install and uninstall replace an unreadable skill file without reading it",
  async () => {
    cli = createTestCli();
    mkdirSync(join(cli.home, ".claude/skills/herdr-world"), {
      recursive: true,
    });
    const file = join(cli.home, ".claude/skills/herdr-world/SKILL.md");
    writeFileSync(file, "unreadable");
    chmodSync(file, 0o000);
    expect(
      await runCli(["integration", "install", "claude"], cli.context),
    ).toBe(0);
    expect(readFileSync(file, "utf8")).toContain("HERDR_WORLD_INTEGRATION_ID=");
    chmodSync(file, 0o000);
    expect(
      await runCli(["integration", "uninstall", "claude"], cli.context),
    ).toBe(0);
    expect(existsSync(file)).toBe(false);
  },
);

test("strict command usage; unsupported and absent removal write nothing", async () => {
  cli = createTestCli();
  for (const args of [
    [],
    ["install"],
    ["uninstall"],
    ["install", "gemini"],
    ["status", "codex", "extra"],
    ["status", "--unknown"],
    ["enable", "claude"],
  ]) {
    expect(await runCli(["integration", ...args], cli.context)).toBe(2);
  }
  expect(await runCli(["integration", "--help"], cli.context)).toBe(0);
  for (const name of ["omp", "letta", "mastracode"]) {
    expect(await runCli(["integration", "uninstall", name], cli.context)).toBe(
      1,
    );
  }
  expect(
    await runCli(["integration", "uninstall", "claude"], cli.context),
  ).toBe(0);
  expect(readdirSync(cli.home)).toEqual([]);
});

test("skill guide changes require a version bump", () => {
  // Version -> guide digest: append a new version when the guide changes.
  const digests: Record<number, string> = {
    1: "094336333630edbf6ed474d0be6278fe18bf997bd5c2187b3c194925dc0eb43b",
  };
  expect(createHash("sha256").update(WORLD_SKILL).digest("hex")).toBe(
    digests[WORLD_SKILL_VERSION]!,
  );
});
