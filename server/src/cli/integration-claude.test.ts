import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { runCli } from "./index";
import { createTestCli, type TestCli } from "./test-context";
import { shQuote } from "../utils/process-utils";
import { claudeTapCommand } from "../usage/claude-tap";
import { claudeSettings } from "./claude-settings";

let cli: TestCli;
afterEach(() => cli?.cleanup());
function setup(before?: string) {
  cli = createTestCli({ runtime: { execPath: process.execPath } });
  const config = join(cli.home, ".claude");
  mkdirSync(config);
  const file = join(config, "settings.json");
  if (before !== undefined) writeFileSync(file, before);
  return { file, config };
}
const run = (action: string) =>
  runCli(["integration", action, "claude"], cli.context);

for (const before of [
  undefined,
  '{\r\n  "hooks": {"keep":true}, "model": "test"\r\n}\r\n',
  '{ "statusLine" : { "type":"command", "command":"cat", "padding": 3 }, "hooks":{"keep":true}}\n',
  '{"statusLine":null}',
])
  test(`Claude install/update/uninstall restores exact bytes (${before === undefined ? "missing" : before.slice(0, 30)})`, async () => {
    const { file, config } = setup(before);
    expect(await run("install")).toBe(0);
    const installed = readFileSync(file, "utf8");
    expect(JSON.parse(installed).statusLine.command).toContain(
      "herdr-world-claude-tap",
    );
    if (before?.includes('"padding"'))
      expect(JSON.parse(installed).statusLine.padding).toBe(3);
    expect(await run("install")).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(installed);
    expect(await run("uninstall")).toBe(0);
    expect(existsSync(join(config, "herdr-world"))).toBe(false);
    expect(existsSync(file)).toBe(before !== undefined);
    if (before !== undefined) expect(readFileSync(file, "utf8")).toBe(before);
    expect(await run("uninstall")).toBe(0);
  });

test("uninstall preserves intervening edits but restores the original raw statusLine", async () => {
  const raw = '{ "type": "command", "command": "printf original" }';
  const { file } = setup(`{ "statusLine": ${raw}, "model":"old" }\n`);
  await run("install");
  writeFileSync(file, readFileSync(file, "utf8").replace('"old"', '"new"'));
  expect(await run("uninstall")).toBe(0);
  expect(readFileSync(file, "utf8")).toBe(
    `{ "statusLine": ${raw}, "model":"new" }\n`,
  );
});

test("a changed statusLine is preserved on uninstall and recaptured on reinstall", async () => {
  const { file } = setup(
    '{"statusLine":{"type":"command","command":"echo old"}}',
  );
  await run("install");
  const edited =
    '{ "statusLine" : {"type":"command","command":"echo new"}, "other":1 }\n';
  writeFileSync(file, edited);
  await run("status");
  expect(cli.output.at(-1)).toContain("outdated");
  expect(await run("install")).toBe(0);
  await run("uninstall");
  expect(readFileSync(file, "utf8")).toBe(edited);
  await run("install");
  writeFileSync(file, edited);
  await run("uninstall");
  expect(readFileSync(file, "utf8")).toBe(edited);
});

test("malformed settings refuse install/update/uninstall without changing any installed files", async () => {
  const { file, config } = setup('{"broken":');
  expect(await run("install")).toBe(1);
  expect(existsSync(join(config, "herdr-world"))).toBe(false);
  expect(existsSync(join(config, "skills"))).toBe(false);
  writeFileSync(file, "{}");
  await run("install");
  writeFileSync(file, '{"broken":');
  for (const action of ["install", "uninstall"]) {
    expect(await run(action)).toBe(1);
    expect(readFileSync(file, "utf8")).toBe('{"broken":');
    expect(
      existsSync(join(config, "herdr-world/claude-status-line.json")),
    ).toBe(true);
    expect(existsSync(join(config, "skills/herdr-world/SKILL.md"))).toBe(true);
  }
});

test("deleted settings stay deleted on uninstall", async () => {
  const { file } = setup(
    '{"statusLine":{"type":"command","command":"echo old"}}',
  );
  await run("install");
  rmSync(file);
  expect(await run("uninstall")).toBe(0);
  expect(existsSync(file)).toBe(false);
});

for (const original of [
  "{}",
  '{"model":"old"}',
  '{"statusLine":{"type":"command","command":"echo old"},"model":"old"}',
])
  test("reinstall retains intervening unrelated edits and original absence/value", async () => {
    const { file } = setup(original);
    await run("install");
    const edited = JSON.parse(readFileSync(file, "utf8"));
    edited.model = "new";
    writeFileSync(file, JSON.stringify(edited));
    await run("install");
    await run("uninstall");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      ...JSON.parse(original),
      model: "new",
    });
  });

test("duplicate keys, non-object JSON, symlinks, corrupt backups and orphan wrappers fail safely", async () => {
  const { file, config } = setup();
  for (const text of [
    "[]",
    "null",
    '{"statusLine":null,"statusLine":null}',
    "\ufeff{}",
  ]) {
    writeFileSync(file, text);
    expect(await run("install")).toBe(1);
    expect(readFileSync(file, "utf8")).toBe(text);
  }
  const target = join(cli.home, "untouched.json");
  writeFileSync(target, "{}");
  rmSync(file);
  symlinkSync(target, file);
  expect(await run("install")).toBe(1);
  expect(readFileSync(target, "utf8")).toBe("{}");
  rmSync(file);
  await run("install");
  const installed = readFileSync(file, "utf8");
  const backup = join(config, "herdr-world/claude-status-line.json");
  for (const state of ["bad", '{"version":99}']) {
    writeFileSync(backup, state);
    for (const action of ["install", "uninstall"])
      expect(await run(action)).toBe(1);
    expect(readFileSync(file, "utf8")).toBe(installed);
  }
  rmSync(backup);
  for (const action of ["install", "uninstall"])
    expect(await run(action)).toBe(1);
  expect(readFileSync(file, "utf8")).toBe(installed);
});

test("installed script and per-launch tap chain once, preserve stdin/stdout/stderr/exit and collect limits", async () => {
  const { file, config } = setup();
  const user = join(cli.home, "custom.mjs");
  writeFileSync(
    user,
    `import fs from 'node:fs'; const input=fs.readFileSync(0); fs.appendFileSync('calls','1'); process.stdout.write(input); process.stderr.write('custom error'); process.exitCode=7;`,
  );
  const before = ` { "statusLine": {"type":"command","command":${JSON.stringify(`${shQuote(process.execPath)} ${shQuote(user)}`)}}, "hooks":{"Herdr":"keep"}}\r\n`;
  writeFileSync(file, before);
  await run("install");
  const input = Buffer.from(
    '{"rate_limits":{"five_hour":{"used_percentage":42,"resets_at":1900003600}}}\n\u0000',
  );
  const valid = input.subarray(0, input.length - 1);
  const env = {
    PATH: process.env.PATH!,
    HOME: cli.home,
    XDG_CONFIG_HOME: join(cli.home, "xdg"),
    XDG_CACHE_HOME: join(cli.home, "cache"),
    XDG_DATA_HOME: join(cli.home, "data"),
  };
  const command = JSON.parse(readFileSync(file, "utf8")).statusLine.command;
  for (const [index, cmd] of [
    command,
    claudeTapCommand({ kind: "bun", path: process.execPath }),
  ].entries()) {
    const process = Bun.spawn(["sh", "-c", cmd], {
      cwd: cli.home,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    process.stdin.write(index ? input : valid);
    process.stdin.end();
    const [out, err, code] = await Promise.all([
      new Response(process.stdout).arrayBuffer(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    expect(Buffer.from(out)).toEqual(index ? input : valid);
    expect(err).toBe("custom error");
    expect(code).toBe(7);
  }
  expect(readFileSync(join(cli.home, "calls"), "utf8")).toBe("11");
  expect(
    JSON.parse(
      readFileSync(
        join(cli.home, ".cache/herdr-world/claude-status-line.json"),
        "utf8",
      ),
    ).windows[0].used_percent,
  ).toBe(42);
  expect(
    statSync(join(config, "herdr-world/claude-status-line.json")).mode & 0o777,
  ).toBe(0o600);
  await run("uninstall");
  expect(readFileSync(file, "utf8")).toBe(before);
});

test("missing runtime still runs the previous command with identical bytes", async () => {
  const { file } = setup(
    '{"statusLine":{"type":"command","command":"cat; exit 9"}}',
  );
  cli.context.runtime.execPath = join(cli.home, "missing-runtime");
  await run("install");
  const command = JSON.parse(readFileSync(file, "utf8")).statusLine.command;
  const process = Bun.spawn(["sh", "-c", command], {
    cwd: cli.home,
    env: { PATH: globalThis.process.env.PATH!, HOME: cli.home },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  process.stdin.write("same\ninput\n");
  process.stdin.end();
  expect(await new Response(process.stdout).text()).toBe("same\ninput\n");
  expect(await process.exited).toBe(9);
});

test("settings source edits cover member positions, nesting, escapes and absent values", () => {
  const values = [
    null,
    false,
    42,
    'quotes" braces{} comma,',
    [1, { x: "nested" }],
    { type: "command", command: "cat" },
  ];
  for (const value of values)
    for (const position of [0, 1, 2]) {
      const entries: [string, unknown][] = [
        ["hooks", { nested: ["statusLine", ":", ","] }],
        ["model", "test"],
      ];
      entries.splice(position, 0, ["statusLine", value]);
      const original =
        JSON.stringify(Object.fromEntries(entries), null, 2) + "\r\n";
      const document = claudeSettings(original);
      const installed = claudeSettings(
        document.replace('{"type":"command","command":"world"}'),
      );
      expect(installed.replace(document.raw)).toBe(original);
      expect(JSON.parse(document.replace(undefined))).toEqual({
        hooks: { nested: ["statusLine", ":", ","] },
        model: "test",
      });
    }
  for (const original of ["{}", '{ "model": "test"\r\n}\r\n']) {
    const installed = claudeSettings(claudeSettings(original).replace("null"));
    expect(installed.replace(undefined)).toBe(original);
  }
  expect(claudeSettings('{"status\\u004cine": 1}').raw).toBe("1");
});

test("status detects damaged registration and reinstall repairs it without losing the backup", async () => {
  const before = '{"statusLine":{"type":"command","command":"cat"}}';
  const { file, config } = setup(before);
  await run("install");
  const script = join(config, "herdr-world/herdr-world-claude-tap.sh");
  for (const damage of [
    () => rmSync(script),
    () => writeFileSync(script, "old version"),
  ]) {
    damage();
    await run("status");
    expect(cli.output.at(-1)).toContain("outdated");
    await run("install");
    await run("status");
    expect(cli.output.at(-1)).toContain("current");
  }
  await run("uninstall");
  expect(readFileSync(file, "utf8")).toBe(before);
});

test("reordered registration keys and a shell-sensitive config override preserve the user's command", async () => {
  const { config: defaultConfig } = setup();
  const config = join(cli.home, "Claude user's config");
  mkdirSync(config);
  cli.context.runtime.env.CLAUDE_CONFIG_DIR = config;
  const file = join(config, "settings.json");
  const before =
    '{"statusLine":{"type":"command","command":"cat","padding":2}}';
  writeFileSync(file, before);
  await run("install");
  const installed = JSON.parse(readFileSync(file, "utf8"));
  const line = installed.statusLine;
  installed.statusLine = {
    command: line.command,
    padding: line.padding,
    type: line.type,
  };
  installed.model = "user edit";
  writeFileSync(file, JSON.stringify(installed));
  await run("status");
  expect(cli.output.at(-1)).toContain("current");
  const child = Bun.spawn(["sh", "-c", line.command], {
    cwd: cli.home,
    env: { PATH: process.env.PATH!, HOME: cli.home, CLAUDE_CONFIG_DIR: config },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  child.stdin.write("custom display\n");
  child.stdin.end();
  expect(await new Response(child.stdout).text()).toBe("custom display\n");
  expect(await child.exited).toBe(0);
  await run("install");
  await run("uninstall");
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
    ...JSON.parse(before),
    model: "user edit",
  });
  expect(existsSync(join(defaultConfig, "settings.json"))).toBe(false);
});

test("edited wrapper presentation restores the prior command and keeps the edits", async () => {
  const { file } = setup(
    '{"statusLine":{"type":"command","command":"cat","padding":2}}',
  );
  await run("install");
  const edited = JSON.parse(readFileSync(file, "utf8"));
  edited.statusLine.padding = 8;
  edited.statusLine.refreshInterval = 15;
  writeFileSync(file, JSON.stringify(edited));
  expect(await run("install")).toBe(0);
  expect(await run("uninstall")).toBe(0);
  expect(JSON.parse(readFileSync(file, "utf8")).statusLine).toEqual({
    type: "command",
    command: "cat",
    padding: 8,
    refreshInterval: 15,
  });
});

test("a user command referencing a modified World wrapper is retained with its recovery files", async () => {
  const { file, config } = setup(
    '{"statusLine":{"type":"command","command":"cat"}}',
  );
  await run("install");
  const edited = JSON.parse(readFileSync(file, "utf8"));
  edited.statusLine.command += " user edit";
  const text = JSON.stringify(edited);
  writeFileSync(file, text);
  expect(await run("uninstall")).toBe(1);
  expect(readFileSync(file, "utf8")).toBe(text);
  expect(
    existsSync(join(config, "herdr-world/herdr-world-claude-tap.sh")),
  ).toBe(true);
  expect(existsSync(join(config, "herdr-world/claude-status-line.json"))).toBe(
    true,
  );
});
