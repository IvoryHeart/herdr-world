import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/**
 * A stand-in for an IDE server with VS Code's process shape (#1009): a
 * launcher (`code serve-web`) starts a separate server, and the server
 * starts a terminal shell in a session of its own through a helper that
 * exits at once (as node-pty's spawn helper can), so the shell is
 * re-parented outside the server's process group and tree. The server and
 * the shell ignore SIGTERM, as an interactive shell does, so only
 * escalation ends them. Each records its PID; tests check that none still
 * runs.
 */
export type ProcessTreeStandIn = {
  /** The program to launch. */
  launcher: string;
  /** Resolves once every process has recorded its PID. */
  started(): Promise<{ launcher: number; server: number; shell: number }>;
  /** The recorded PIDs that still run (not exited or a zombie). */
  survivors(): number[];
  /** Forgets the recorded PIDs, so `started()` waits for a new launch. */
  forget(): void;
  /** Ends whatever survived, so a failing test leaves nothing behind. */
  cleanup(): void;
};

function program(path: string, body: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

export function hasSetsid() {
  return Bun.spawnSync(["sh", "-c", "command -v setsid"]).exitCode === 0;
}

/** The parent PID of a process, or 0 when it is gone. */
export function parentOf(pid: number) {
  return Number(
    Bun.spawnSync(["ps", "-o", "ppid=", "-p", String(pid)])
      .stdout.toString()
      .trim() || 0,
  );
}

export function processTreeStandIn(
  top: string,
  options: { launcherExits?: boolean } = {},
): ProcessTreeStandIn {
  const bin = join(top, "stand-in");
  const record = (name: string) => join(top, `${name}.pid`);
  const shell = join(bin, "shell");
  const helper = join(bin, "pty-helper");
  const server = join(bin, "server");
  const launcher = join(bin, "code");
  program(
    shell,
    [
      "trap '' TERM HUP",
      `echo $$ > '${record("shell")}'`,
      "while :; do sleep 1; done",
    ].join("\n"),
  );
  program(
    helper,
    [
      // A session of its own, like a terminal's shell under node-pty; the
      // helper exits, so the shell's parent becomes init or a subreaper.
      `if command -v setsid >/dev/null 2>&1; then setsid '${shell}' & else '${shell}' & fi`,
      "exit 0",
    ].join("\n"),
  );
  program(
    server,
    [
      "trap '' TERM",
      `echo $$ > '${record("server")}'`,
      `'${helper}'`,
      "while :; do sleep 1; done",
    ].join("\n"),
  );
  program(
    launcher,
    [
      `echo $$ > '${record("launcher")}'`,
      // The readiness probe looks for the socket path the IDE was given.
      'while [ $# -gt 0 ]; do case "$1" in --socket|--socket-path) : > "$2" ;; esac; shift; done',
      `'${server}' &`,
      options.launcherExits ? "exit 0" : "wait",
    ].join("\n"),
  );
  const names = ["launcher", "server", "shell"] as const;
  const pids = () =>
    names
      .map((name) =>
        existsSync(record(name))
          ? Number(readFileSync(record(name), "utf8").trim())
          : 0,
      )
      .filter((pid) => pid > 0);
  const survivors = () =>
    pids().filter((pid) => {
      const stat = Bun.spawnSync(["ps", "-o", "stat=", "-p", String(pid)])
        .stdout.toString()
        .trim();
      return stat !== "" && !stat.startsWith("Z");
    });
  return {
    launcher,
    async started() {
      for (
        const iterationDeadline = Date.now() + 5000;
        Date.now() < iterationDeadline;
      ) {
        if (names.every((name) => existsSync(record(name)))) {
          const [l, s, sh] = names.map((name) =>
            Number(readFileSync(record(name), "utf8").trim()),
          );
          if (l && s && sh) return { launcher: l, server: s, shell: sh };
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      throw new Error("the stand-in didn't start");
    },
    survivors,
    forget() {
      for (const name of names) rmSync(record(name), { force: true });
    },
    cleanup() {
      for (const pid of survivors())
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Gone.
        }
    },
  };
}
