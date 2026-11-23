import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  watch,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

export type Kit = {
  version: 1;
  name: string;
  root: string;
  token: string;
  session: string;
  binaries: { tui: string; core: string };
  versions: Record<string, string>;
  port?: number;
};

const repository = resolve(import.meta.dir, "..");
const helper = join(import.meta.dir, "runtime-isolated-processes.py");
export const kitBase = () => `/tmp/world-kit-${process.getuid!()}`;

/** Lock the stable private directory inode: no stale lock file/PID to recover. */
export async function controlOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (process.platform !== "linux")
    throw new Error("isolation requires Linux /proc and pidfds");
  mkdirSync(kitBase(), { recursive: true, mode: 0o700 });
  privateDirectory(kitBase());
  const child = Bun.spawn(["python3", helper, "lock", kitBase()], {
    env: { PATH: "/usr/bin:/bin" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = child.stdout.getReader();
  const ready = await reader.read();
  reader.releaseLock();
  if (ready.done || new TextDecoder().decode(ready.value).trim() !== "locked") {
    const error = await new Response(child.stderr).text();
    await child.exited;
    throw new Error(error || "could not acquire kit control lock");
  }
  try {
    return await operation();
  } finally {
    child.stdin.end();
    await child.exited;
  }
}
export function kitRoot(name: string) {
  if (!/^[a-z][a-z0-9-]{0,19}$/.test(name) || name === "default")
    throw new Error(
      "name must be 1..20 lowercase letters/digits/hyphens, not default",
    );
  return join(kitBase(), name);
}

function privateDirectory(path: string) {
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.uid !== process.getuid!() ||
    stat.mode & 0o077 ||
    realpathSync(path) !== path
  )
    throw new Error(
      `isolation refused: directory must be private and real: ${path}`,
    );
}

export function paths(kit: Kit) {
  return {
    // Named sessions override HERDR_SOCKET_PATH in Herdr 0.9.5. Derive the
    // authoritative named-session endpoints under our private XDG config.
    tui: join(
      kit.root,
      "config",
      "herdr",
      "sessions",
      kit.session,
      "herdr.sock",
    ),
    render: join(
      kit.root,
      "config",
      "herdr",
      "sessions",
      kit.session,
      "herdr-client.sock",
    ),
    core: join(kit.root, "state", "herdr-core", kit.session),
    world: join(kit.root, "world"),
  };
}

/** An allowlist, not a copy-and-delete: no owner runtime, credentials or startup. */
export function kitEnv(
  kit: Kit,
  inherited = process.env,
): Record<string, string> {
  const p = paths(kit);
  return {
    PATH: inherited.PATH ?? "/usr/bin:/bin",
    LANG: "C.UTF-8",
    TERM: "xterm-256color",
    SHELL: "/bin/sh",
    HOME: join(kit.root, "home"),
    XDG_CONFIG_HOME: join(kit.root, "config"),
    XDG_STATE_HOME: join(kit.root, "state"),
    XDG_DATA_HOME: join(kit.root, "data"),
    XDG_CACHE_HOME: join(kit.root, "cache"),
    XDG_RUNTIME_DIR: join(kit.root, "run"),
    TMPDIR: join(kit.root, "tmp"),
    WORLD_RUNTIME_KIT: kit.token,
    CLAUDE_CONFIG_DIR: join(kit.root, "claude"),
    CODEX_HOME: join(kit.root, "codex"),
    HERDR_SESSION: kit.session,
    HERDR_BIN_PATH: kit.binaries.tui,
    HERDR_CONFIG_PATH: join(kit.root, "config", "tui.toml"),
    HERDR_SOCKET_PATH: p.tui,
    HERDR_CLIENT_SOCKET_PATH: p.render,
    HC_SESSION: kit.session,
    HERDR_WORLD_DATA_DIR: p.world,
    HERDR_WORLD_INSTANCE_REGISTRY_DIR: join(kit.root, "registry"),
    // Owner git, source integrations and credential helpers must remain absent.
    GIT_CONFIG_GLOBAL: join(kit.root, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

export function saveKit(kit: Kit) {
  const path = join(kit.root, "kit.json");
  writeFileSync(`${path}.new`, `${JSON.stringify(kit, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(`${path}.new`, path);
}

export function readKit(name: string): Kit | null {
  const root = kitRoot(name);
  if (!existsSync(root)) return null;
  privateDirectory(kitBase());
  privateDirectory(root);
  const kit = JSON.parse(readFileSync(join(root, "kit.json"), "utf8")) as Kit;
  if (
    kit.version !== 1 ||
    kit.name !== name ||
    kit.root !== root ||
    !/^[a-f0-9]{32}$/.test(kit.token) ||
    kit.session !== `kit-${name}-${kit.token.slice(0, 8)}`
  )
    throw new Error(
      "isolation refused: invalid run manifest; no processes touched",
    );
  return kit;
}

/** No child can start before kit.json is published. Recover that initial gap. */
export function removeUninitializedKit(name: string) {
  const root = kitRoot(name);
  if (!existsSync(root) || existsSync(join(root, "kit.json"))) return false;
  privateDirectory(kitBase());
  privateDirectory(root);
  if (
    readdirSync(root).some(
      (entry) =>
        entry !== "kit.json.new" || !lstatSync(join(root, entry)).isFile(),
    )
  )
    throw new Error(
      "isolation refused: missing manifest in nonempty run folder",
    );
  rmSync(root, { recursive: true });
  return true;
}

export async function run(kit: Kit, command: string[]): Promise<string> {
  const child = Bun.spawn(command, {
    env: kitEnv(kit),
    cwd: join(kit.root, "scratch"),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20_000,
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw new Error(`${command[0]} failed (${code}): ${err || out}`);
  return out.trim();
}

export async function processHelper(
  action: "probe" | "inspect" | "stop",
  token = "probe",
) {
  const proc = Bun.spawn(["python3", helper, action, token], {
    env: { PATH: "/usr/bin:/bin" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`process ownership check failed: ${err}`);
  return out.trim();
}

/** Filesystem event wait: no sleep/retry or runtime auto-start probes. */
export function fileEvent<T>(
  root: string,
  check: () => T | undefined,
  timeout = 20_000,
): Promise<T> {
  return new Promise((resolveResult, reject) => {
    const finish = (error?: Error, value?: T) => {
      clearTimeout(timer);
      watcher.close();
      if (error) reject(error);
      else resolveResult(value!);
    };
    const inspect = () => {
      try {
        const value = check();
        if (value !== undefined) finish(undefined, value);
      } catch (error) {
        finish(error as Error);
      }
    };
    const watcher = watch(root, { recursive: true }, inspect);
    watcher.on("error", (error) => finish(error));
    const timer = setTimeout(
      () => finish(new Error("runtime readiness timed out; inspect logs")),
      timeout,
    );
    inspect();
  });
}

function launch(kit: Kit, label: string, command: string[]) {
  const fd = openSync(join(kit.root, `${label}.log`), "a", 0o600);
  try {
    const child = spawn(command[0], command.slice(1), {
      detached: true,
      stdio: ["ignore", fd, fd],
      env: { ...kitEnv(kit), WORLD_RUNTIME_ROLE: label },
      cwd: join(kit.root, "scratch"),
    });
    child.on("error", (error) =>
      writeFileSync(join(kit.root, `${label}.error`), error.message),
    );
    child.unref();
  } finally {
    closeSync(fd);
  }
}

export function isolationEndpoints(kit: Kit) {
  const p = paths(kit);
  privateDirectory(p.core);
  const lock = join(p.core, "core.lock");
  const stat = lstatSync(lock);
  if (!stat.isFile() || stat.uid !== process.getuid!() || stat.size > 4096)
    throw new Error(
      "isolation refused: core.lock is not an owned regular file",
    );
  const coreSocket = readFileSync(lock, "utf8").trim();
  if (
    !coreSocket.startsWith(`${kit.root}/run/`) ||
    resolve(coreSocket) !== coreSocket
  )
    throw new Error("isolation refused: core socket escaped run folder");
  privateDirectory(resolve(coreSocket, ".."));
  for (const socket of [p.tui, p.render, coreSocket]) {
    const stat = lstatSync(socket);
    if (
      !stat.isSocket() ||
      stat.uid !== process.getuid!() ||
      realpathSync(socket) !== socket
    )
      throw new Error("isolation refused: endpoint is not a real owned socket");
  }
  return coreSocket;
}

export async function assertIsolation(kit: Kit, sockets = true) {
  privateDirectory(kitBase());
  privateDirectory(kit.root);
  for (const directory of ["home", "config", "state", "run", "world"])
    privateDirectory(join(kit.root, directory));
  const expected = kitEnv(kit);
  const coreSocket = sockets ? isolationEndpoints(kit) : "";
  const processes = JSON.parse(
    await processHelper("inspect", kit.token),
  ) as Array<{ pid: number; env: string[] }>;
  for (const proc of processes) {
    for (const entry of proc.env) {
      const key = entry.slice(0, entry.indexOf("="));
      // Runtime-injected pane/terminal identifiers belong to the scratch runtime.
      if (
        /^(HERDR_(ENV|PANE_ID|TAB_ID|WORKSPACE_ID)|HC_(RUNTIME|SCOPE|TERMINAL_ID|CORE_ID|PARENT_TERMINAL_ID))$/.test(
          key,
        )
      ) {
        const value = entry.slice(key.length + 1);
        if (
          !/^[a-zA-Z0-9:_-]+$/.test(value) ||
          (["HERDR_ENV", "HC_RUNTIME"].includes(key) && value !== "1")
        )
          throw new Error(`isolation refused: invalid runtime context ${key}`);
      } else if (key === "HC_TERMINAL_SOCKET") {
        if (!sockets || entry !== `HC_TERMINAL_SOCKET=${coreSocket}`)
          throw new Error(
            "isolation refused: terminal socket escaped core endpoint",
          );
      } else if (/^(HERDR_|HC_)/.test(key)) {
        if (entry !== `${key}=${expected[key]}`)
          throw new Error(
            `isolation refused: unexpected runtime variable ${key} in pid ${proc.pid}`,
          );
      }
    }
    for (const key of [
      "HOME",
      "XDG_STATE_HOME",
      "XDG_RUNTIME_DIR",
      "WORLD_RUNTIME_KIT",
    ])
      if (!proc.env.includes(`${key}=${expected[key]}`))
        throw new Error(`isolation refused: ${key} escaped in pid ${proc.pid}`);
  }
  if (!sockets) return { processes: processes.length };
  for (const role of ["tui", "core", ...(kit.port ? ["world"] : [])])
    if (
      !processes.some((entry) =>
        entry.env.includes(`WORLD_RUNTIME_ROLE=${role}`),
      )
    )
      throw new Error(`isolated ${role} is not running; use stop to clean up`);
  if (processes.length < 2)
    throw new Error("isolated runtimes are not running");
  if (kit.port) {
    const response = await fetch(`http://127.0.0.1:${kit.port}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok)
      throw new Error("isolated World is unhealthy; use stop to clean up");
  }
  return { processes: processes.length, core_socket: coreSocket };
}

export async function startKit(name: string): Promise<Kit> {
  if (process.platform !== "linux")
    throw new Error("isolation requires Linux /proc and pidfds");
  await processHelper("probe");
  const [low, high] = readFileSync(
    "/proc/sys/net/ipv4/ip_local_port_range",
    "utf8",
  )
    .trim()
    .split(/\s+/)
    .map(Number);
  if (!low || !high || [8787, 8788].some((port) => low <= port && port <= high))
    throw new Error(
      "isolation refused: ephemeral port range overlaps reserved World ports",
    );
  const root = kitRoot(name);
  mkdirSync(kitBase(), { recursive: true, mode: 0o700 });
  privateDirectory(kitBase());
  // Atomic mkdir forbids reuse, including state left by a crashed start.
  mkdirSync(root, { mode: 0o700 });
  const token = randomBytes(16).toString("hex");
  const kit: Kit = {
    version: 1,
    name,
    root,
    token,
    session: `kit-${name}-${token.slice(0, 8)}`,
    binaries: {
      tui: Bun.which("herdr") ?? "",
      core: Bun.which("herdr-core") ?? "",
    },
    versions: { bun: Bun.version, world: "unknown" },
  };
  // Durable before spawning anything: stop works even after SIGKILL of start.
  saveKit(kit);
  try {
    if (Buffer.byteLength(paths(kit).render) >= 104)
      throw new Error(
        "name makes Unix socket path too long; choose a shorter name",
      );
    if (!kit.binaries.tui || !kit.binaries.core)
      throw new Error("install herdr and herdr-core on PATH first");
    for (const dir of [
      "home",
      "config",
      "state",
      "run",
      "world",
      "scratch",
      "data",
      "cache",
      "tmp",
      "claude",
      "codex",
      "registry",
    ])
      mkdirSync(join(root, dir), { mode: 0o700 });
    writeFileSync(
      join(root, "config", "tui.toml"),
      'onboarding = false\n[terminal]\ndefault_shell = "/bin/sh"\nshell_mode = "non_login"\n[update]\nversion_check = false\nmanifest_check = false\n',
    );
    mkdirSync(join(root, "config", "herdr-core"));
    writeFileSync(
      join(root, "config", "herdr-core", "config.toml"),
      'shell = ["/bin/sh"]\nnotes = false\n',
    );
    // Never fall through to the account's OS credential store.
    writeFileSync(
      join(root, "codex", "config.toml"),
      'cli_auth_credentials_store = "file"\ncheck_for_update_on_startup = false\n',
    );
    const p = paths(kit);
    mkdirSync(p.core, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(p.core, "core.json"),
      JSON.stringify({ id: token.slice(0, 16), name: "example-runtime-kit" }),
    );
    kit.versions.tui = await run(kit, [kit.binaries.tui, "--version"]);
    kit.versions.core = await run(kit, [kit.binaries.core, "--version"]);
    for (const harness of ["claude", "codex"]) {
      const binary = Bun.which(harness);
      if (binary) kit.versions[harness] = await run(kit, [binary, "--version"]);
    }
    kit.versions.world = await run(kit, [
      "git",
      "-C",
      repository,
      "rev-parse",
      "HEAD",
    ]);
    saveKit(kit);
    launch(kit, "tui", [kit.binaries.tui, "--session", kit.session, "server"]);
    launch(kit, "core", [kit.binaries.core, "serve"]);
    await fileEvent(root, () => {
      for (const label of ["tui", "core"])
        if (existsSync(join(root, `${label}.error`)))
          throw new Error(readFileSync(join(root, `${label}.error`), "utf8"));
      if (
        existsSync(p.tui) &&
        existsSync(p.render) &&
        existsSync(join(p.core, "core.lock"))
      ) {
        const socket = readFileSync(join(p.core, "core.lock"), "utf8").trim();
        if (socket && !socket.startsWith(`${root}/run/`))
          throw new Error("core endpoint escaped run folder");
        if (socket && existsSync(socket)) return true;
      }
    });
    await assertIsolation(kit);
    writeFileSync(
      join(p.world, "connections.json"),
      JSON.stringify({
        version: 3,
        default_connection_id: "startup-default",
        profiles: [
          {
            id: "startup-default",
            label: "Kit TUI",
            type: "local",
            control_socket_path: p.tui,
            client_socket_path: p.render,
            auto_connect: true,
          },
          {
            id: "kit-core",
            label: "Kit core",
            type: "local",
            runtime: "herdr-core",
            core_session: kit.session,
            core_state_dir: p.core,
            auto_connect: true,
          },
        ],
      }),
      { mode: 0o600 },
    );
    launch(kit, "world", [
      process.execPath,
      join(repository, "server/src/index.ts"),
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--socket-path",
      p.tui,
      "--client-socket-path",
      p.render,
      "--public-dir",
      join(repository, "server/public"),
    ]);
    kit.port = await fileEvent(root, () => {
      const log = readFileSync(join(root, "world.log"), "utf8");
      const match = log.match(
        /INFO bridge listening[^\r\n]*url=http:\/\/[^\s]+:(\d+)/,
      );
      return match ? Number(match[1]) : undefined;
    });
    if ([8787, 8788].includes(kit.port))
      throw new Error("reserved port selected");
    await assertIsolation(kit);
    saveKit(kit);
    return kit;
  } catch (error) {
    // Logs remain on stderr before cleanup so a failure is actionable.
    for (const label of ["tui", "core", "world"]) {
      const log = join(root, `${label}.log`);
      if (existsSync(log))
        console.error(readFileSync(log, "utf8").slice(-3000));
    }
    await stopKit(kit);
    throw error;
  }
}

export async function stopKit(kit: Kit) {
  const current = readKit(kit.name);
  if (!current || current.token !== kit.token)
    throw new Error("run identity changed; refusing cleanup");
  const receipt = await processHelper("stop", kit.token);
  rmSync(kit.root, { recursive: true });
  return JSON.parse(receipt) as { removed_processes: number };
}
