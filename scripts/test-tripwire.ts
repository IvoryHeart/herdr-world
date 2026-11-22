import {
  appendFileSync,
  existsSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { inside, ISOLATION, recordTripwire } from "./test-isolation";

const runtime = /^(?:herdr|herdr-core|hc|herdr-world)(?:\.exe)?$/i;
const service = /^(?:systemctl|launchctl)(?:\.exe)?$/i;

function fixtureExecutable(command: string, env: NodeJS.ProcessEnv): boolean {
  const root = process.env[ISOLATION];
  const path = Bun.which(command, { PATH: env.PATH });
  if (!root || !path) return false;
  try {
    // macOS temporary roots can use /var or /tmp aliases for /private/… .
    // Compare filesystem identities on both sides, including the guarded bin.
    const executable = realpathSync(path);
    return (
      inside(executable, realpathSync(root)) &&
      !inside(executable, realpathSync(join(root, "bin")))
    );
  } catch {
    return false;
  }
}

export function guardURL(value: string | URL, call = "network"): void {
  // Bun's `ws+unix://<socket>:<path>` names a socket, not a host.
  const unix = /^(?:wss?|https?)\+unix:\/\/([^:]+)/.exec(String(value));
  if (unix) return guardSocket(unix[1]!);
  const url = new URL(value);
  if (["file:", "data:", "blob:"].includes(url.protocol)) return;
  if (
    !["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname) ||
    ["8787", "8788"].includes(url.port)
  )
    recordTripwire(`${call} ${url.origin}${url.pathname}`);
}

/** Shared by Bun/Node spawn hooks and the shell's guarded executables. */
export function guardCommand(
  argv: readonly string[],
  env = process.env,
  explicitEnv = false,
): void {
  const command = argv[0];
  if (!command) return;
  const name = basename(command)
    .toLowerCase()
    .replace(/\.exe$/, "");
  if (
    (runtime.test(name) || service.test(name)) &&
    !fixtureExecutable(command, env)
  )
    recordTripwire(`runtime command ${name}`);
  if (
    name === "ssh" &&
    !argv.includes("-G") &&
    !fixtureExecutable(command, env)
  )
    recordTripwire(
      "SSH connection (use a fixture, never the host's SSH config)",
    );
  if (["curl", "wget"].includes(name) && !fixtureExecutable(command, env)) {
    const socketAt = argv.indexOf("--unix-socket");
    if (socketAt >= 0) guardSocket(argv[socketAt + 1] || "");
    else
      for (const arg of argv.slice(1))
        if (/^https?:\/\//.test(arg)) guardURL(arg, name);
  }
  if (["sh", "bash", "zsh", "dash", "powershell", "pwsh"].includes(name)) {
    const installer =
      argv.includes("-s") ||
      argv.some((arg) =>
        /(?:herdr[_-]core[_-](?:setup|install)|install-herdr-world\.(?:sh|ps1)|homebrew-herdr-bootstrap\.sh|scriptblock\]::Create)/i.test(
          arg,
        ),
      );
    if (
      installer &&
      !(
        explicitEnv &&
        env.HOME &&
        inside(env.HOME, process.env[ISOLATION]!) &&
        fixtureExecutable("curl", env)
      )
    )
      recordTripwire("herdr-core/World installer (shell input)");
    // Shell snippets are another common way to bypass a spawn fake. File
    // fixtures use their own PATH; inspecting text alone must not ban them.
    const at = argv.findIndex((arg) => /^-(?:c|Command)$/i.test(arg));
    if (at >= 0) {
      const text = argv[at + 1] || "";
      for (const match of text.matchAll(
        /(?:^|[;&|\n]\s*|\bexec\s+)(?:\s*)(herdr-core|herdr-world|herdr|hc|systemctl|launchctl|ssh|curl|wget)(?=\s|$)/g,
      )) {
        const found = match[1]!;
        if (!fixtureExecutable(found, env)) {
          if (["curl", "wget"].includes(found)) {
            for (const url of text.matchAll(/https?:\/\/[^\s'";]+/g))
              guardURL(url[0], found);
          } else recordTripwire(`shell command ${found}`);
        }
      }
    }
  }
}

export function guardSocket(path: string): void {
  const root = process.env[ISOLATION];
  const registry = root && join(root, "fixture-sockets.jsonl");
  const owned =
    registry &&
    existsSync(registry) &&
    readFileSync(registry, "utf8")
      .split("\n")
      .includes(JSON.stringify(resolve(path)));
  if (!root || (!inside(resolve(path), root) && !owned))
    recordTripwire(`runtime socket outside test scratch (${path})`);
}

/** A few production transports require short /tmp sockets. Permit only
 * sockets that a test fixture actually bound, never arbitrary host sockets. */
export function registerFixtureSocket(path: string): void {
  const root = process.env[ISOLATION];
  if (root)
    appendFileSync(
      join(root, "fixture-sockets.jsonl"),
      `${JSON.stringify(resolve(path))}\n`,
    );
}

export function guardConnect(args: unknown[]): void {
  const options = args[0];
  if (Array.isArray(options)) return guardConnect(options);
  if (typeof options === "string" && !/^\d+$/.test(options))
    return guardSocket(options);
  if (options && typeof options === "object") {
    const value = options as {
      path?: string;
      unix?: string;
      hostname?: string;
      host?: string;
      port?: number;
    };
    if (value.path || value.unix) return guardSocket(value.path || value.unix!);
    if (value.port)
      guardURL(
        `http://${value.hostname || value.host || "localhost"}:${value.port}`,
        "connect",
      );
  } else if (typeof options === "number" || typeof options === "string") {
    const host = typeof args[1] === "string" ? args[1] : "localhost";
    guardURL(
      `http://${host.includes(":") ? `[${host}]` : host}:${options}`,
      "connect",
    );
  }
}
