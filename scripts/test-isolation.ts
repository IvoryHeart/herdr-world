import { fileURLToPath } from "node:url";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  copyFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";

export const ISOLATION = "HERDR_WORLD_TEST_ISOLATION";
export const LIVE = "HERDR_WORLD_TEST_LIVE";
export const TRIPWIRE = "HERDR_WORLD_TEST_TRIPWIRE";
const runnerVariables = new Set([
  "HERDR_WORLD_CHECK_LOCK",
  "HERDR_WORLD_TEST_ASSETS",
  "HERDR_WORLD_TEST_LABEL",
  "HERDR_CHROME_WARM",
  "HERDR_TEST_BROWSER",
  "HERDR_TEST_BROWSER_TOKEN",
  "HERDR_TEST_BROWSER_RENDERING",
  // The CI diagnostics adapter needs these through nested test runners.
  "HERDR_DIAGNOSTIC_CHROME",
  "HERDR_BROWSER_DIAGNOSTICS_DIR",
  "HERDR_BROWSER_DIAGNOSTICS_MODE",
]);
const forbiddenBinaries = /^(?:herdr|herdr-core|hc|herdr-world)(?:\.exe)?$/i;
const services = /^(?:systemctl|launchctl)(?:\.exe)?$/i;

/** Construct this before starting Bun: Bun caches os.homedir() at startup. */
export function isolatedTestEnv(
  directory: string,
  inherited: NodeJS.ProcessEnv,
  live = false,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (/^(?:HERDR_|HC_)/.test(key) && !runnerVariables.has(key)) continue;
    // Credentials, harness records, proxies and shell/git startup must not
    // redirect a fixture into the developer's account or configuration.
    if (
      /^(?:SSH_|GIT_|CURL_HOME$|WGETRC$|GH_CONFIG_DIR$|GLAB_CONFIG_DIR$|BASH_ENV$|ENV$|ZDOTDIR$|BUN_OPTIONS$|NODE_OPTIONS$|.*_PROXY$|.*_TOKEN$|.*_API_KEY$)/i.test(
        key,
      ) &&
      key !== "HERDR_TEST_BROWSER_TOKEN"
    )
      continue;
    if (
      /^(?:CODEX_HOME|CLAUDE_CONFIG_DIR|GEMINI_HOME|GROK_HOME|ANTIGRAVITY_HOME|ANTIGRAVITY_CONVERSATIONS_DIR|PI_CODING_AGENT_DIR|OPENCODE_CONFIG(?:_DIR|_CONTENT)?|HERMES_HOME|COPILOT_HOME|QWEN_HOME)$/.test(
        key,
      )
    )
      continue;
    env[key] = value;
  }
  for (const [key, subdir] of Object.entries({
    HOME: "home",
    USERPROFILE: "home",
    APPDATA: "home/AppData/Roaming",
    LOCALAPPDATA: "home/AppData/Local",
    XDG_CONFIG_HOME: "config",
    XDG_CACHE_HOME: "cache",
    XDG_DATA_HOME: "data",
    XDG_STATE_HOME: "state",
    XDG_RUNTIME_DIR: "run",
    HERDR_WORLD_DATA_DIR: "herdr-world-data",
  })) {
    env[key] = join(directory, subdir);
    mkdirSync(env[key]!, { recursive: true, mode: 0o700 });
  }
  env.TMPDIR = env.TMP = env.TEMP = directory;
  env[ISOLATION] = directory;
  env[TRIPWIRE] = join(directory, "tripwire.log");
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = join(directory, "gitconfig");
  env.GIT_TERMINAL_PROMPT = "0";
  env.BUN_INSTALL_CACHE_DIR = join(directory, "bun-cache");
  env.PATH = isolatedPath(directory, inherited, live);
  if (live) {
    env[LIVE] = "1";
    // The user systemd bus lives here; live resource controls must reach the
    // explicitly selected manager while all persistent state stays in scratch.
    if (inherited.XDG_RUNTIME_DIR)
      env.XDG_RUNTIME_DIR = inherited.XDG_RUNTIME_DIR;
    // Only explicit resource live controls may select a real systemd manager.
    if (["user", "system"].includes(inherited.HERDR_RESOURCE_MANAGER ?? ""))
      env.HERDR_RESOURCE_MANAGER = inherited.HERDR_RESOURCE_MANAGER;
    for (const [key, value] of Object.entries(inherited))
      if (
        /^(?:HERDR_CORE_BIN|HERDR_WORLD_LIVE_|HERDR_WORLD_PWSH|HERDR_LIVE_|HC_)/.test(
          key,
        )
      )
        env[key] = value;
    // Live fixtures still get scratch homes, but may explicitly find their
    // supplied runtime. Ordinary suites can never inherit this search path.
    env.PATH += delimiter + (inherited.PATH ?? "");
  }
  return env;
}

function isolatedPath(
  directory: string,
  inherited: NodeJS.ProcessEnv,
  live: boolean,
): string {
  const bin = join(directory, "bin");
  mkdirSync(bin);
  const system =
    process.platform === "win32"
      ? [
          join(inherited.SystemRoot || "C:\\Windows", "System32"),
          join(
            inherited.SystemRoot || "C:\\Windows",
            "System32/WindowsPowerShell/v1.0",
          ),
          dirname(Bun.which("git") || "C:\\Program Files\\Git\\cmd\\git.exe"),
        ]
      : ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  if (process.platform !== "win32") {
    // Preserve command basenames: uutils dispatches on argv[0]. Never add
    // /usr/local/bin, a Homebrew prefix or a user's ~/.local/bin wholesale.
    for (const dir of system) {
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        if (
          forbiddenBinaries.test(name) ||
          (!live && services.test(name)) ||
          existsSync(join(bin, name))
        )
          continue;
        try {
          symlinkSync(join(dir, name), join(bin, name));
        } catch {}
      }
    }
  }
  const tools = {
    bun: process.execPath,
    node: Bun.which("node"),
    "google-chrome":
      inherited.CHROME_BIN ||
      Bun.which("google-chrome") ||
      Bun.which("chromium"),
  };
  for (const [name, path] of Object.entries(tools)) {
    if (!path) continue;
    if (existsSync(join(bin, name))) unlinkSync(join(bin, name));
    if (process.platform === "win32")
      copyFileSync(path, join(bin, `${name}.exe`));
    else symlinkSync(path, join(bin, name));
  }
  if (process.platform !== "win32" && !live) {
    for (const name of ["systemctl", "launchctl", "ssh", "curl", "wget"]) {
      const original = system.map((dir) => join(dir, name)).find(existsSync);
      const target = join(bin, name);
      if (existsSync(target)) unlinkSync(target);
      // Also covers shell scripts, Bun.$ and grandchildren without a preload.
      const quote = (value: string) =>
        "'" + value.replaceAll("'", "'\\''") + "'";
      const real = original || join(system[0]!, name);
      const guard = fileURLToPath(
        new URL("./test-shell-tripwire.ts", import.meta.url),
      );
      const noRedirect =
        name === "curl"
          ? " --max-redirs 0"
          : name === "wget"
            ? " --max-redirect=0"
            : "";
      writeFileSync(
        target,
        `#!/bin/sh\n${quote(process.execPath)} ${quote(guard)} ${quote(directory)} ${quote(real)} "$@" || exit "$?"\nexec ${quote(real)} "$@"${noRedirect}\n`,
        { mode: 0o755 },
      );
    }
  }
  return [bin, ...(process.platform === "win32" ? system : [])].join(delimiter);
}

export function recordTripwire(call: string): never {
  const message = `[test-tripwire] refused ${call}; inject a fake (live suites require --live)`;
  if (process.env[TRIPWIRE])
    appendFileSync(process.env[TRIPWIRE]!, `${message}\n`);
  throw new Error(message);
}

export function tripwireFailures(env: NodeJS.ProcessEnv): string {
  const path = env[TRIPWIRE];
  return path && existsSync(path) ? readFileSync(path, "utf8") : "";
}

export function liveTestArgs(args: string[]): {
  live: boolean;
  args: string[];
} {
  const live = args.includes("--live");
  const rest = args.filter((arg) => arg !== "--live");
  if (
    live &&
    (!rest.length ||
      rest.some(
        (arg) =>
          !arg.startsWith("--") && !/[.-]live\.test\.[cm]?[jt]sx?$/.test(arg),
      ))
  )
    throw new Error("--live requires explicitly named *.live.test.ts files");
  return { live, args: rest };
}

export function inside(path: string, root: string): boolean {
  const absolute = resolve(path);
  return (
    absolute === resolve(root) ||
    absolute.startsWith(
      resolve(root) + (process.platform === "win32" ? "\\" : "/"),
    )
  );
}
