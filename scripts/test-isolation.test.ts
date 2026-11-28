import { afterEach, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { ISOLATION, isolatedTestEnv, liveTestArgs } from "./test-isolation";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function scratch() {
  const root = mkdtempSync(join(tmpdir(), "isolation-control-"));
  roots.push(root);
  return root;
}

test("only runner-owned browser credentials cross test isolation", () => {
  const env = isolatedTestEnv(scratch(), {
    ...process.env,
    HERDR_TEST_BROWSER: "http://127.0.0.1:1234/",
    HERDR_TEST_BROWSER_TOKEN: "synthetic-browser-token",
    GH_TOKEN: "synthetic-account-token",
    OTHER_API_KEY: "synthetic-account-key",
    HERDR_SESSION: "owner-session",
  });
  expect(env.HERDR_TEST_BROWSER).toBe("http://127.0.0.1:1234/");
  expect(env.HERDR_TEST_BROWSER_TOKEN).toBe("synthetic-browser-token");
  expect(env.GH_TOKEN).toBeUndefined();
  expect(env.OTHER_API_KEY).toBeUndefined();
  expect(env.HERDR_SESSION).toBeUndefined();
});

async function run(
  source: string,
  env: NodeJS.ProcessEnv = process.env,
  name = "probe.test.ts",
  live = false,
) {
  const root = scratch();
  const file = join(root, name);
  writeFileSync(file, `import { test, expect } from "bun:test";\n${source}`);
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "run-tests.ts"),
      ...(live ? ["--live"] : []),
      file,
      "--parallel=1",
    ],
    {
      cwd: root,
      // A scratch probe outside the repository counts as a possible browser
      // selection, so in CI each nested runner would start Chrome cold inside
      // this test's 5 s budget. These probes never open a browser.
      env: { ...env, HERDR_CHROME_WARM: "1" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, text: out + err };
}

// This cold-start control launches nested Bun processes and builds an isolated
// tool directory. Loaded CI runners can exceed Bun's default five seconds
// before the probe starts; keep a bounded startup budget for this test only.
test("the wrapper sets HOME before Bun caches homedir and removes host state/tools", async () => {
  const root = scratch();
  const bin = join(root, "user-bin");
  mkdirSync(bin);
  for (const name of [
    "herdr",
    "hc",
    "herdr-core",
    "herdr-world",
    "user-only-tool",
  ])
    writeFileSync(join(bin, name), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
  const result = await run(
    `
import { homedir } from "node:os";
test("isolated startup", () => {
  expect(homedir()).toBe(process.env.HOME);
  expect(process.env.HOME).not.toBe(${JSON.stringify(root)});
  for (const key of ["HERDR_BIN_PATH", "HERDR_SESSION", "HC_SESSION", "HERDR_WORLD_DATA_DIR"]) expect(process.env[key]).not.toBe("host-value");
  for (const name of ["herdr", "hc", "herdr-core", "herdr-world", "user-only-tool"]) expect(Bun.which(name)).toBeNull();
  for (const name of ["bun", "git"]) expect(Bun.which(name)).not.toBeNull();
  console.log("HOME=" + process.env.HOME);
  expect(Bun.spawnSync(["bun", "-e", 'console.log(require("node:os").homedir())']).stdout.toString().trim()).toBe(process.env.HOME);
});`,
    {
      ...process.env,
      HOME: root,
      PATH: `${bin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
      HERDR_BIN_PATH: "host-value",
      HERDR_SESSION: "host-value",
      HC_SESSION: "host-value",
      HERDR_WORLD_DATA_DIR: "host-value",
    },
  );
  expect(result.text).toContain("HOME=");
  expect(result.code).toBe(0);
  expect(homedir()).toBe(process.env.HOME!);
}, 30_000);

test.each([
  ['Bun.spawnSync(["herdr", "--version"])', "runtime command herdr"],
  ['Bun.spawn(["/example/herdr-core", "serve"])', "runtime command herdr-core"],
  ['Bun.spawnSync({cmd:["hc", "server", "start"]})', "runtime command hc"],
  [
    'Bun.spawnSync(["systemctl", "--user", "start", "herdr"])',
    "runtime command systemctl",
  ],
  ['Bun.spawnSync(["launchctl", "list"])', "runtime command launchctl"],
  [
    'Bun.spawn(["sh", "-s"], {stdin:new Blob(["herdr_core_setup"])})',
    "herdr-core/World installer",
  ],
  [
    'Bun.spawnSync(["sh", "scripts/install-herdr-world.sh"])',
    "herdr-core/World installer",
  ],
  [
    'require("node:child_process").execFileSync("herdr", ["--version"])',
    "runtime command herdr",
  ],
  [
    'require("node:child_process").execSync("hc server start")',
    "shell command hc",
  ],
  [
    'await fetch("https://releases.herdr.dev/core/latest.json")',
    "fetch https://releases.herdr.dev/core/latest.json",
  ],
  [
    'await fetch("https://github.com/example/example/releases/latest/download/app")',
    "fetch https://github.com/example/example/releases",
  ],
  [
    'await fetch("https://login.example.com/token")',
    "fetch https://login.example.com",
  ],
  ['await fetch("http://localhost:8787/")', "fetch http://localhost:8787"],
  [
    'Bun.connect({hostname:"login.example.com",port:443,socket:{}})',
    "connect http://login.example.com",
  ],
  [
    'new WebSocket("wss://login.example.com/ws")',
    "WebSocket wss://login.example.com",
  ],
  [
    'require("node:net").createConnection({host:"login.example.com",port:443})',
    "connect http://login.example.com",
  ],
  [
    'require("node:net").createConnection("/example/herdr.sock")',
    "runtime socket outside test scratch",
  ],
  [
    'new WebSocket("ws+unix:///example/ide.sock:/ide/x")',
    "runtime socket outside test scratch",
  ],
  ['Bun.spawnSync(["ssh", "example.invalid", "true"])', "SSH connection"],
])(
  "a caught forbidden operation still fails the run: %s",
  async (operation, message) => {
    const result = await run(
      `test("caught escape", async () => {try { ${operation}; } catch {} });`,
    );
    expect(result.code).not.toBe(0);
    expect(result.text).toContain(`[test-tripwire] refused ${message}`);
  },
);

test.skipIf(process.platform === "win32")(
  "shell and source grandchildren inherit tripwires",
  async () => {
    for (const operation of [
      'Bun.spawnSync(["sh", "-c", "command systemctl --user start herdr"])',
      'Bun.spawnSync(["bun", "-e", \'fetch("https://releases.herdr.dev/core/latest.json").catch(()=>{})\'])',
      'Bun.spawnSync(["sh", "-c", "command curl https://github.com/example/example/releases/latest/download/app"])',
      'Bun.spawnSync(["bun", "-e", \'Bun.spawnSync(["hc","server","start"])\'], {env:{PATH:process.env.PATH}})',
    ]) {
      const result = await run(`test("grandchild", () => { ${operation}; });`);
      expect(result.code).not.toBe(0);
      expect(result.text).toContain("[test-tripwire] refused");
    }
  },
);

test("fakes in scratch and local fixture HTTP still work", async () => {
  const result = await run(`
import {writeFileSync} from "node:fs";
import {join} from "node:path";
test("fake runtime", async () => {
  if (process.platform !== "win32") {
    const fake = join(process.env.HOME!, "herdr");
    writeFileSync(fake, "#!/bin/sh\\necho synthetic\\n", {mode:0o755});
    expect(Bun.spawnSync([fake]).stdout.toString().trim()).toBe("synthetic");
  }
  const server = Bun.serve({hostname:"127.0.0.1",port:0,fetch:(request)=>new URL(request.url).pathname === "/redirect" ? new Response(null, {status:302,headers:{location:"/"}}) : new Response("fixture")});
  try {
    expect(await (await fetch(server.url)).text()).toBe("fixture");
    expect((await fetch(new URL("/redirect",server.url), {redirect:"manual"})).status).toBe(302);
  } finally {server.stop(true);}
});`);
  expect(result.code).toBe(0);
});

test.skipIf(process.platform === "win32")(
  "runtime fixtures work when the scratch root has a filesystem alias",
  async () => {
    const root = scratch();
    const physical = join(root, "physical");
    const alias = join(root, "alias");
    mkdirSync(physical);
    symlinkSync(physical, alias);
    const result = await run(
      `
import {writeFileSync, realpathSync} from "node:fs";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
test("aliased fixture", () => {
  expect(realpathSync(process.env.HOME!)).not.toBe(process.env.HOME);
  const fake = join(process.env.HOME!, "herdr-world");
  writeFileSync(fake, "#!/bin/sh\\necho synthetic\\n", {mode:0o755});
  const env = {...process.env, PATH:""};
  expect(Bun.spawnSync([fake], {env}).stdout.toString().trim()).toBe("synthetic");
  expect(spawnSync(fake, [], {env, encoding:"utf8"}).stdout.trim()).toBe("synthetic");
});`,
      { ...process.env, TMPDIR: alias, TMP: alias, TEMP: alias },
    );
    expect(result.text).toContain("1 pass");
    expect(result.code).toBe(0);
  },
);

for (const target of ["host", "guarded-bin"])
  test.skipIf(process.platform === "win32")(
    `an aliased runtime fixture symlink cannot authorize a ${target} executable`,
    async () => {
      const root = scratch();
      const physical = join(root, "physical");
      const alias = join(root, "alias");
      mkdirSync(physical);
      symlinkSync(physical, alias);
      const result = await run(
        `
import {symlinkSync} from "node:fs";
import {join} from "node:path";
test("external executable", () => {
  const fake = join(process.env.HOME!, "herdr-world");
  symlinkSync(${target === "host" ? '"/bin/sh"' : 'join(process.env.HERDR_WORLD_TEST_ISOLATION!, "bin", "launchctl")'}, fake);
  try {Bun.spawnSync([fake, "-c", "echo escaped"]);} catch {}
});`,
        { ...process.env, TMPDIR: alias, TMP: alias, TEMP: alias },
      );
      expect(result.code).not.toBe(0);
      expect(result.text).toContain(
        "[test-tripwire] refused runtime command herdr-world",
      );
    },
  );

test("#926: omitted detection fake reaches the real core installer tripwire", async () => {
  const result = await run(`
import {runHerdrCommand} from ${JSON.stringify(fileURLToPath(new URL("../server/src/herdr/cli.ts", import.meta.url)))};
import {join} from "node:path";
test("partial CLI injection", async () => {
  await runHerdrCommand(["herdr","upgrade","--install"], "0.0.0", {
    loadConfig: () => ({socketPath:join(process.env.HOME!,"absent.sock")}) as never,
    upgrade: async () => {throw new Error("should never reach TUI upgrade");},
    log: () => {}, error: () => {},
  });
});`);
  expect(result.code).not.toBe(0);
  expect(result.text).toContain(
    "[test-tripwire] refused herdr-core/World installer",
  );
});

test("named Node builtin imports also hit the process tripwire", async () => {
  const result = await run(`import {spawnSync} from "node:child_process";
test("named builtin", () => {try {spawnSync("herdr",["--version"]);} catch {}});`);
  expect(result.code).not.toBe(0);
  expect(result.text).toContain(
    "[test-tripwire] refused runtime command herdr",
  );
});

test("only an explicit named live selection opts out; parent markers cannot", () => {
  expect(() => liveTestArgs(["--live"])).toThrow("explicitly named");
  expect(() =>
    liveTestArgs(["--live", "server/src/herdr/cli.test.ts"]),
  ).toThrow("explicitly named");
  expect(
    liveTestArgs(["--live", "server/src/herdr-core/core.live.test.ts"]),
  ).toEqual({ live: true, args: ["server/src/herdr-core/core.live.test.ts"] });
  const env = isolatedTestEnv(scratch(), {
    ...process.env,
    HERDR_WORLD_TEST_LIVE: "1",
    HERDR_WORLD_TEST_ISOLATION: "/example/old",
    HERDR_CORE_BIN: "/example/core",
    SSH_AUTH_SOCK: "/example/agent",
    CODEX_HOME: "/example/codex",
    PI_CODING_AGENT_DIR: "/example/pi",
    ANTIGRAVITY_CONVERSATIONS_DIR: "/example/conversations",
    OPENCODE_CONFIG_DIR: "/example/opencode",
    XDG_RUNTIME_DIR: "/example/host-runtime",
  });
  expect(env.HERDR_WORLD_TEST_LIVE).toBeUndefined();
  expect(env.HERDR_CORE_BIN).toBeUndefined();
  expect(env.SSH_AUTH_SOCK).toBeUndefined();
  expect(env.CODEX_HOME).toBeUndefined();
  expect(env.PI_CODING_AGENT_DIR).toBeUndefined();
  expect(env.ANTIGRAVITY_CONVERSATIONS_DIR).toBeUndefined();
  expect(env.OPENCODE_CONFIG_DIR).toBeUndefined();
  expect(env.XDG_RUNTIME_DIR).not.toBe("/example/host-runtime");
  expect(env[ISOLATION]).not.toBe("/example/old");
});

test("explicit live selection retains scratch HOME and its supplied binary", async () => {
  const result = await run(
    `import {homedir} from "node:os"; test("live opt-out", () => {
    expect(process.env.HERDR_WORLD_TEST_LIVE).toBe("1");
    expect(process.env.HERDR_CORE_BIN).toBe("/example/disposable/core");
    expect(homedir()).toBe(process.env.HOME);
    expect(process.env.HOME).toContain("hwt-");
  });`,
    { ...process.env, HERDR_CORE_BIN: "/example/disposable/core" },
    "probe.live.test.ts",
    true,
  );
  expect(result.code).toBe(0);
});

test.skipIf(process.platform === "win32")(
  "explicit live shell tools bypass guards and retain the supplied user-manager socket directory",
  async () => {
    const runtime = scratch();
    const result = await run(
      `
import {realpathSync} from "node:fs";
test("live shell controls", async () => {
  if (process.platform === "linux" && Bun.which("systemctl")) {
    const result = Bun.spawnSync(["sh", "-c", "command systemctl --version"]);
    expect(result.stderr.toString()).not.toContain("[test-tripwire]");
    expect(result.exitCode).toBe(0);
  }
  // Following a local redirect also proves the shell download wrapper is gone.
  // No real download or user-manager operation is needed for this control.
  const server = Bun.serve({hostname:"127.0.0.1",port:0,fetch:(request)=>new URL(request.url).pathname === "/redirect" ? new Response(null, {status:302,headers:{location:"/"}}) : new Response("fixture")});
  try {
    expect(realpathSync(Bun.which("curl")!)).not.toStartWith(process.env.HERDR_WORLD_TEST_ISOLATION!);
    const child = Bun.spawn(["sh", "-c", 'command curl -fsSL "$1"', "fixture", new URL("/redirect",server.url).href], {stdout:"pipe",stderr:"pipe"});
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code, err).toBe(0);
    expect(out).toBe("fixture");
  } finally {server.stop(true);}
  expect(process.env.XDG_RUNTIME_DIR).toBe(${JSON.stringify(runtime)});
});`,
      { ...process.env, XDG_RUNTIME_DIR: runtime },
      "shell.live.test.ts",
      true,
    );
    expect(result.text).toContain("1 pass");
    expect(result.code).toBe(0);
  },
);

test.each(["lifecycle", "stderr"])(
  "browser diagnostics runner variables reach its adapter (%s)",
  async (mode) => {
    const root = scratch();
    const fakeChrome = join(root, "fake-chrome");
    const directory = join(root, "diagnostics");
    const adapter = fileURLToPath(
      new URL("./browser-diagnostics.ts", import.meta.url),
    );
    writeFileSync(
      fakeChrome,
      '#!/usr/bin/env bun\nconsole.error("synthetic chrome");\n',
      { mode: 0o755 },
    );
    const result = await run(
      `
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
test("diagnostics adapter launches", async () => {
  expect(process.env.HERDR_DIAGNOSTIC_CHROME).toBe(${JSON.stringify(fakeChrome)});
  expect(process.env.HERDR_BROWSER_DIAGNOSTICS_DIR).toBe(${JSON.stringify(directory)});
  expect(process.env.HERDR_BROWSER_DIAGNOSTICS_MODE).toBe(${JSON.stringify(mode)});
  expect(process.env.HERDR_SESSION).toBeUndefined();
  expect(process.env.HERDR_RESOURCE_MANAGER).toBeUndefined();
  const child = Bun.spawn([process.execPath, process.env.CHROME_BIN!, "--fixture-argument"], {stdout:"pipe", stderr:"pipe"});
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(stderr).toContain("synthetic chrome");
  expect(code).toBe(0);
  const files = readdirSync(${JSON.stringify(directory)});
  expect(files).toHaveLength(1);
  const events = readFileSync(join(${JSON.stringify(directory)}, files[0]!), "utf8").trim().split("\\n").map(line=>JSON.parse(line));
  expect(events[0].data).toEqual({args:["--fixture-argument"], mode:${JSON.stringify(mode)}});
  expect(events.at(-1).data.code).toBe(0);
});`,
      {
        ...process.env,
        CI: "false",
        CHROME_BIN: adapter,
        HERDR_DIAGNOSTIC_CHROME: fakeChrome,
        HERDR_BROWSER_DIAGNOSTICS_DIR: directory,
        HERDR_BROWSER_DIAGNOSTICS_MODE: mode,
        HERDR_SESSION: "host-value",
        HERDR_RESOURCE_MANAGER: "system",
      },
    );
    expect(result.text).toContain("1 pass");
    expect(result.code).toBe(0);
  },
);
