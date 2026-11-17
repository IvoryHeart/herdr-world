import { fileURLToPath } from "node:url";
// Applied to source subprocesses as well as tests. No bun:test dependency.
import { realpathSync } from "node:fs";
import * as childProcess from "node:child_process";
import { Server, Socket } from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { ISOLATION, LIVE, TRIPWIRE } from "./test-isolation";
import {
  guardCommand,
  guardConnect,
  guardURL,
  registerFixtureSocket,
} from "./test-tripwire";
if (
  process.env[ISOLATION] &&
  process.env[LIVE] !== "1" &&
  !globalThis[Symbol.for("herdr.test.guarded") as never]
) {
  Object.assign(globalThis, { [Symbol.for("herdr.test.guarded")]: true });
  type Options = {
    env?: NodeJS.ProcessEnv;
    cmd?: string[];
    cwd?: string;
    stdin?: unknown;
  };
  const { spawn, spawnSync, connect } = Bun;
  const prepare = (
    command: unknown,
    options?: Options,
  ): [string[], Options] => {
    const opts = (Array.isArray(command) ? options : command) as
      | Options
      | undefined;
    const argv = (Array.isArray(command) ? command : opts?.cmd) as string[];
    const env = opts?.env
      ? {
          [ISOLATION]: process.env[ISOLATION],
          [TRIPWIRE]: process.env[TRIPWIRE],
          ...opts.env,
        }
      : process.env;
    guardCommand(argv, env, !!opts?.env);
    // Source children need the same guard; compiled binaries retain the
    // isolated environment and guarded PATH. Build tools must not embed it.
    let actualBun = false;
    try {
      actualBun =
        realpathSync(Bun.which(argv[0]!, { PATH: env.PATH }) || argv[0]!) ===
        realpathSync(process.execPath);
    } catch {}
    const childArgv =
      actualBun &&
      !["build", "test", "run"].some((arg) => argv.includes(arg)) &&
      !argv.some((arg) => arg.includes("run-tests.ts"))
        ? [
            argv[0]!,
            "--preload",
            fileURLToPath(
              new URL("./test-process-preload.ts", import.meta.url),
            ),
            ...argv.slice(1),
          ]
        : argv;
    return [childArgv, { ...opts, env }];
  };
  Object.assign(Bun, {
    spawn: ((command: unknown, options?: Options) => {
      const [argv, opts] = prepare(command, options);
      return spawn(argv, opts as never);
    }) as typeof Bun.spawn,
    spawnSync: ((command: unknown, options?: Options) => {
      const [argv, opts] = prepare(command, options);
      return spawnSync(argv, opts as never);
    }) as typeof Bun.spawnSync,
    connect: ((options: unknown) => {
      guardConnect([options]);
      return connect(options as never);
    }) as typeof Bun.connect,
  });

  // Node APIs are also used by fixtures; update named builtin ESM imports.
  const node = import.meta.require("node:child_process") as typeof childProcess;
  for (const name of [
    "spawn",
    "spawnSync",
    "execFile",
    "execFileSync",
    "exec",
    "execSync",
  ] as const) {
    const original = node[name] as (...args: unknown[]) => unknown;
    Object.assign(node, {
      [name]: (...args: unknown[]) => {
        const file = args[0] as string;
        const argv = Array.isArray(args[1]) ? [file, ...args[1]] : [file];
        const opts = args.find(
          (arg, index) =>
            index > 0 && arg && typeof arg === "object" && !Array.isArray(arg),
        ) as Options | undefined;
        guardCommand(
          name.startsWith("exec") && !name.startsWith("execFile")
            ? ["sh", "-c", file]
            : argv,
          opts?.env ?? process.env,
          !!opts?.env,
        );
        return original(...args);
      },
    });
  }
  syncBuiltinESMExports();
  const socketConnect = Socket.prototype.connect;
  Socket.prototype.connect = function (this: Socket, ...args: unknown[]) {
    guardConnect(args);
    return socketConnect.apply(this, args as never);
  } as typeof socketConnect;
  const listen = Server.prototype.listen;
  Server.prototype.listen = function (this: Server, ...args: unknown[]) {
    const first = args[0];
    const path =
      typeof first === "string" ? first : (first as { path?: string })?.path;
    if (path) this.once("listening", () => registerFixtureSocket(path));
    return listen.apply(this, args as never);
  } as typeof listen;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      guardURL(input instanceof Request ? input.url : String(input), "fetch");
      // A redirect must not turn a fixture URL into a real download/login.
      return originalFetch(input, { ...init, redirect: "error" });
    }) as typeof fetch,
    originalFetch,
  );
  const OriginalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = class extends OriginalWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      guardURL(url, "WebSocket");
      super(url, protocols);
    }
  } as typeof WebSocket;
}
