import {
  SSH_NONINTERACTIVE_ARGS,
  validateSshDestination,
} from "../bridge/ssh-command";
import { shQuote } from "../utils/process-utils";

/**
 * How World reaches the host an IDE server lives on: its own computer, or
 * an SSH host through the connection's OpenSSH destination (so the owner's
 * OpenSSH config applies). Each script run is one short command; nothing
 * here holds the server's life.
 */
export type IdeHostTarget =
  | { kind: "local" }
  | { kind: "ssh"; destination: string };

export type IdeHostResult = {
  /** Null when it timed out or could not run. */
  code: number | null;
  stdout: string;
  stderr: string;
};

export type IdeHostRun = (
  target: IdeHostTarget,
  script: string,
  options: { stdin?: string; timeoutMs: number },
) => Promise<IdeHostResult>;

/** World's private local socket for an SSH-hosted server: an `ssh -N -L`. */
export type IdeForwardChild = {
  exited: Promise<unknown>;
  kill(): void;
};

export type IdeForward = (
  destination: string,
  remoteSocket: string,
  localSocket: string,
) => IdeForwardChild;

export function hostArgv(target: IdeHostTarget, script: string) {
  return target.kind === "local"
    ? ["sh", "-c", script]
    : [
        "ssh",
        ...SSH_NONINTERACTIVE_ARGS,
        "--",
        validateSshDestination(target.destination),
        `sh -c ${shQuote(script)}`,
      ];
}

export function systemHostRun(environment = process.env): IdeHostRun {
  return async (target, script, { stdin, timeoutMs }) => {
    let child: ReturnType<typeof Bun.spawn>;
    try {
      child = Bun.spawn(hostArgv(target, script), {
        env: environment,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (error) {
      return { code: null, stdout: "", stderr: (error as Error).message };
    }
    const sink = child.stdin as import("bun").FileSink;
    try {
      if (stdin) sink.write(stdin);
      void sink.end();
    } catch {
      // It exited before reading.
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout as ReadableStream).text(),
      new Response(child.stderr as ReadableStream).text(),
    ]);
    clearTimeout(timer);
    return { code: timedOut ? null : code, stdout, stderr };
  };
}

/**
 * One ssh per attached server: its own connection (never one of the
 * destination's multiplexed session slots), one Unix socket forward and no
 * remote command. Only World's user can open the local socket; ssh exits
 * if it cannot bind it. Ending it detaches World; the server keeps running.
 */
export function systemForward(environment = process.env): IdeForward {
  return (destination, remoteSocket, localSocket) => {
    const child = Bun.spawn(
      [
        "ssh",
        ...SSH_NONINTERACTIVE_ARGS,
        "-o",
        "ExitOnForwardFailure=yes",
        "-o",
        "StreamLocalBindUnlink=yes",
        "-o",
        "StreamLocalBindMask=0177",
        "-N",
        "-L",
        `${localSocket}:${remoteSocket}`,
        "--",
        validateSshDestination(destination),
      ],
      { env: environment, stdin: "ignore", stdout: "ignore", stderr: "ignore" },
    );
    return {
      exited: child.exited.catch(() => null),
      kill() {
        try {
          child.kill("SIGTERM");
        } catch {
          // Already gone.
        }
      },
    };
  };
}
