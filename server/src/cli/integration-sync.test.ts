import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "./index";
import { integrationPaths, WORLD_HARNESSES } from "./integration-paths";
import { createTestCli, type TestCli } from "./test-context";

let cli: TestCli;
afterEach(() => cli?.cleanup());
const sync = () => runCli(["integration", "sync"], cli.context);
const skill = (name: "claude" | "codex" | "pi") =>
  integrationPaths(name, cli.context.runtime)!.file;

test("discovers configured supported harnesses, installs and refreshes each, and explains removal", async () => {
  cli = createTestCli();
  for (const name of WORLD_HARNESSES) {
    const paths = integrationPaths(name, cli.context.runtime);
    if (paths) mkdirSync(paths.config, { recursive: true });
  }
  expect(await sync()).toBe(0);
  for (const name of WORLD_HARNESSES) {
    const paths = integrationPaths(name, cli.context.runtime);
    if (!paths) continue;
    expect(readFileSync(paths.file, "utf8")).toContain("VERSION=1");
    expect(cli.output.join("\n")).toContain(`${name}: installed`);
    expect(cli.output.join("\n")).toContain(
      `herdr-world integration uninstall ${name}`,
    );
  }
  for (const name of WORLD_HARNESSES) {
    const paths = integrationPaths(name, cli.context.runtime);
    if (paths)
      writeFileSync(
        paths.file,
        readFileSync(paths.file, "utf8").replace("VERSION=1", "VERSION=0"),
      );
  }
  cli.output.length = 0;
  expect(await sync()).toBe(0);
  for (const name of WORLD_HARNESSES) {
    const paths = integrationPaths(name, cli.context.runtime);
    if (!paths) continue;
    expect(readFileSync(paths.file, "utf8")).toContain("VERSION=1");
    expect(cli.output.join("\n")).toContain(`${name}: updated`);
  }
});

test("no harness creates nothing; opt-out prevents fresh installation and updates", async () => {
  cli = createTestCli();
  expect(await sync()).toBe(0);
  expect(cli.output.join("\n")).toContain(
    "No supported harness configuration folders found",
  );
  expect(existsSync(join(cli.home, ".agents"))).toBe(false);
  mkdirSync(join(cli.home, ".codex"));
  cli.context.runtime.env.HERDR_WORLD_SKIP_INTEGRATIONS = "1";
  expect(await sync()).toBe(0);
  expect(existsSync(skill("codex"))).toBe(false);
  delete cli.context.runtime.env.HERDR_WORLD_SKIP_INTEGRATIONS;
  expect(await sync()).toBe(0);
  const old = readFileSync(skill("codex"), "utf8").replace(
    "VERSION=1",
    "VERSION=0",
  );
  writeFileSync(skill("codex"), old);
  cli.context.runtime.env.HERDR_WORLD_SKIP_INTEGRATIONS = "1";
  expect(await sync()).toBe(0);
  expect(readFileSync(skill("codex"), "utf8")).toBe(old);
  expect(cli.output.join("\n")).toContain("HERDR_WORLD_SKIP_INTEGRATIONS=1");
});

test.each(["linux", "win32"])(
  "%s CLI uninstall persists across syncs for the entire shared group; explicit install reenables it",
  async (platform) => {
    cli = createTestCli({ runtime: { platform } });
    mkdirSync(join(cli.home, ".codex"));
    mkdirSync(join(cli.home, ".pi/agent"), { recursive: true });
    expect(await sync()).toBe(0);
    expect(
      await runCli(["integration", "uninstall", "codex"], cli.context),
    ).toBe(0);
    expect(await sync()).toBe(0);
    expect(await sync()).toBe(0);
    expect(existsSync(skill("pi"))).toBe(false);
    expect(cli.output.join("\n")).toContain(
      "pi: skipped (previously uninstalled",
    );
    expect(await runCli(["integration", "install", "pi"], cli.context)).toBe(0);
    expect(await sync()).toBe(0);
    expect(existsSync(skill("codex"))).toBe(true);
  },
);

test("automatic Claude refresh keeps the original status line and uninstall restores its exact bytes", async () => {
  cli = createTestCli();
  mkdirSync(join(cli.home, ".claude"));
  const settings = join(cli.home, ".claude/settings.json");
  const before =
    '{ "hooks": {"keep":true}, "statusLine":{"type":"command","command":"cat"} }\n';
  writeFileSync(settings, before);
  expect(await sync()).toBe(0);
  const registered = readFileSync(settings, "utf8");
  expect(await sync()).toBe(0);
  expect(readFileSync(settings, "utf8")).toBe(registered);
  expect(
    await runCli(["integration", "uninstall", "claude"], cli.context),
  ).toBe(0);
  expect(await sync()).toBe(0);
  expect(readFileSync(settings, "utf8")).toBe(before);
  expect(existsSync(skill("claude"))).toBe(false);
});

test("conflicting user skills survive; other harnesses still install", async () => {
  cli = createTestCli();
  mkdirSync(join(cli.home, ".claude/skills/herdr-world"), { recursive: true });
  mkdirSync(join(cli.home, ".codex"));
  writeFileSync(skill("claude"), "my own skill\n");
  expect(await sync()).toBe(1);
  expect(readFileSync(skill("claude"), "utf8")).toBe("my own skill\n");
  expect(existsSync(join(cli.home, ".claude/settings.json"))).toBe(false);
  expect(existsSync(skill("codex"))).toBe(true);
  expect(cli.errors.join("\n")).toContain("claude");
  expect(cli.errors.join("\n")).toContain("not managed by World");
});

test("discovery honors config overrides and never invents absent harness configuration", async () => {
  cli = createTestCli();
  cli.context.runtime.env.CLAUDE_CONFIG_DIR = "~/custom-claude";
  mkdirSync(join(cli.home, "custom-claude"));
  cli.context.runtime.env.PI_CODING_AGENT_DIR = join(cli.home, "absent-pi");
  expect(await sync()).toBe(0);
  expect(existsSync(skill("claude"))).toBe(true);
  expect(existsSync(join(cli.home, ".claude"))).toBe(false);
  expect(existsSync(join(cli.home, "absent-pi"))).toBe(false);
});

test("automatic install refuses malformed Claude settings and keeps processing other harnesses", async () => {
  cli = createTestCli();
  mkdirSync(join(cli.home, ".claude"));
  mkdirSync(join(cli.home, ".codex"));
  const settings = join(cli.home, ".claude/settings.json");
  writeFileSync(settings, "{broken");
  expect(await sync()).toBe(1);
  expect(readFileSync(settings, "utf8")).toBe("{broken");
  expect(existsSync(skill("claude"))).toBe(false);
  expect(existsSync(skill("codex"))).toBe(true);
  expect(cli.errors.join("\n")).toContain("claude: World integration failed");
});
