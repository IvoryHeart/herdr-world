import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CoreConnectionProfile } from "../../connections/profiles";
import {
  WINDOWS_PIPE_MARKER,
  WindowsCoreExit,
  windowsCoreCommand,
  windowsCoreProbeScript,
  windowsCoreRelayScript,
} from "../windows";
import { encodeFrame, FrameKind } from "../wire";
import type { FakeCore } from "./fake-core";

/** The PowerShell script inside `powershell.exe … -EncodedCommand <base64>`. */
export function decodeWindowsCommand(command: string): string {
  const match =
    /^powershell\.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ([A-Za-z0-9+/=]+)$/.exec(
      command,
    );
  if (!match) throw new Error(`not a fixed PowerShell command: ${command}`);
  return Buffer.from(match[1]!, "base64").toString("utf16le");
}

type FakePipe = { socket: string; owner: "user" | "other"; denied: boolean };

/**
 * A Windows host for tests: a `core.lock`, a named-pipe namespace whose pipes
 * are Unix sockets, and SSH that runs only World's two fixed scripts. It
 * answers the probe as the script does on Windows, and runs the relay as
 * `fake-windows-relay.ts`. It records everything World asks it to run.
 */
export class FakeWindowsHost {
  /** `core.lock` content; core leaves it behind when it stops. */
  lock: string | null = null;
  readonly pipes = new Map<string, FakePipe>();
  readonly probes: string[][] = [];
  readonly relays: string[][] = [];
  readonly children: ChildProcessWithoutNullStreams[] = [];

  constructor(
    readonly root: string,
    readonly profile: CoreConnectionProfile,
  ) {
    mkdirSync(join(root, "pipes"), { recursive: true, mode: 0o700 });
  }

  /** Core serving `\\.\pipe\<name>` (it writes the lock as it starts). */
  async serve(core: FakeCore, name: string, owner: FakePipe["owner"] = "user") {
    const socket = await core.listen(
      join(this.root, "unused-state"),
      join(this.root, "pipes"),
      name,
    );
    this.pipes.set(name, { socket, owner, denied: false });
    this.lock = `\\\\.\\pipe\\${name}`;
    return socket;
  }

  /** `kill -9` of core: its pipe goes, its lock stays. */
  kill(core: FakeCore, name: string) {
    core.kill(this.pipes.get(name)?.socket);
    this.pipes.delete(name);
  }

  readonly readRemote = async (
    argv: string[],
  ): Promise<{ code: number; stdout: string; stderr: string }> => {
    this.probes.push(argv);
    const script = decodeWindowsCommand(argv.at(-1)!);
    if (
      script !==
      windowsCoreProbeScript(
        this.profile.core_session,
        this.profile.core_state_dir,
      )
    )
      throw new Error("the host ran something other than the probe");
    return { ...this.probe(), stderr: "" };
  };

  /** What the probe script reports on a Windows host in this state. */
  probe(): { code: number; stdout: string } {
    if (this.lock === null) return { code: WindowsCoreExit.noLock, stdout: "" };
    if (this.lock.length > 4096)
      return { code: WindowsCoreExit.badLock, stdout: "" };
    if (this.lock.length < 2)
      return { code: WindowsCoreExit.notRunning, stdout: "" };
    const match = /^\\\\\.\\pipe\\([A-Za-z0-9][A-Za-z0-9._-]{0,199})\n?$/i.exec(
      this.lock,
    );
    if (!match) return { code: WindowsCoreExit.badLock, stdout: "" };
    const pipe = this.pipes.get(match[1]!);
    if (!pipe) return { code: WindowsCoreExit.notRunning, stdout: "" };
    if (pipe.denied) return { code: WindowsCoreExit.accessDenied, stdout: "" };
    if (pipe.owner !== "user")
      return { code: WindowsCoreExit.untrusted, stdout: "" };
    return { code: 0, stdout: `${WINDOWS_PIPE_MARKER}${match[1]}\r\n` };
  }

  readonly spawnRelay = (argv: string[]): ChildProcessWithoutNullStreams => {
    this.relays.push(argv);
    const script = decodeWindowsCommand(argv.at(-1)!);
    const name = /^\$p=C '([^']+)'$/m.exec(script)?.[1];
    if (!name || script !== windowsCoreRelayScript(name))
      throw new Error("the host ran something other than the relay");
    windowsCoreCommand(script);
    const pipe = this.pipes.get(name);
    const child = spawn(
      process.execPath,
      [join(import.meta.dir, "fake-windows-relay.ts")],
      {
        stdio: "pipe",
        env: {
          PATH: process.env.PATH,
          ...(pipe && pipe.owner === "user" && !pipe.denied
            ? { FAKE_PIPE_SOCKET: pipe.socket }
            : {}),
        },
      },
    );
    this.children.push(child);
    return child;
  };

  /** Relay processes that have not exited. */
  running(): ChildProcessWithoutNullStreams[] {
    return this.children.filter(
      (child) => child.exitCode === null && child.signalCode === null,
    );
  }
}

/** Every byte value, a first paint asking for win32-input-mode, and win32 keys. */
export function transparencyPayloads() {
  const all = new Uint8Array(256 * 64).map((_, i) => i % 256);
  const text = new TextEncoder();
  const paint = encodeFrame(
    3,
    FrameKind.DATA,
    text.encode("\x1b[2J\x1b[Hé✓ PS C:\\> \x1b[?9001h"),
  );
  // win32-input-mode key records: CSI Vk;Sc;Uc;Kd;Cs;Rc _ (a, then Ctrl+C).
  const keys = encodeFrame(
    3,
    FrameKind.DATA,
    text.encode("\x1b[65;30;97;1;0;1_\x1b[65;30;97;0;0;1_\x1b[67;46;3;1;8;1_"),
  );
  const reply = encodeFrame(
    3,
    FrameKind.AUTOMATIC_INPUT,
    text.encode("\x1b[?1;2c"),
  );
  const big = new Uint8Array(1 << 20).map((_, i) => (i * 7919) % 256);
  return {
    toWorld: Buffer.concat([paint, all, big]),
    toCore: Buffer.concat([keys, reply, all, big]),
  };
}
