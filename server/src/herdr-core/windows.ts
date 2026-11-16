import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { win32 } from "node:path";
import {
  sshBridgeCommandArgv,
  sshReadCommandArgv,
} from "../bridge/ssh-command";
import type { SshTunnelConfig } from "../bridge/ssh-tunnel";
import { powershellCommand } from "../bridge/ssh-windows";
import type { CoreConnectionProfile } from "../connections/profiles";
import { createSshProfileRuntimeConfig } from "../connections/ssh-profile-runtime";
import { runProcessWithCodeTimeout } from "../utils/process-utils";
import { CoreUnavailableError } from "./client";
import { CoreEndpointRefusedError, CORE_LOCK_FILE } from "./endpoint";
import type { CoreTransport } from "./runtime";
import type { CoreByteStream } from "./stream";

/**
 * herdr-core on a Windows SSH host. Core there listens on a named pipe, which
 * OpenSSH cannot forward, and its only stdio client (`hc connect`) starts a
 * core when none runs. World instead runs two fixed Windows PowerShell
 * scripts whose only inputs are a validated session, state directory and
 * pipe name:
 *
 * - the probe reads `core.lock` (as the Unix path's `cat` does), checks the
 *   named pipe and prints its name;
 * - the relay opens exactly that existing pipe and copies bytes between it
 *   and SSH's stdio, untouched (framed protocol, win32-input-mode keys).
 *
 * Neither runs a program, so neither can start a core.
 */

/** The probe's one line of output: the pipe name, after this marker. */
export const WINDOWS_PIPE_MARKER = "herdr-core-pipe:";
/** Pipe names World relays; core's default is `herdr-core-<user>-<session>.sock`. */
export const WINDOWS_PIPE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const SESSION = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/;
/** cmd.exe, a common OpenSSH DefaultShell, refuses longer command lines. */
export const WINDOWS_COMMAND_LIMIT = 8191;

/** The scripts' exit codes (3–5 match the Unix lock command's). */
export const WindowsCoreExit = {
  noLock: 3,
  badLock: 4,
  notRunning: 5,
  accessDenied: 6,
  untrusted: 7,
} as const;

// Windows PowerShell 5.1 syntax only (it ships with every supported Windows).
// Never name a variable `input`: the host would then read stdin as objects.
const PRELUDE = [
  "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'",
  // The pipe must be this user's, SYSTEM's or Administrators', and grant
  // no one else: the Windows form of the Unix 0700 socket directory check.
  // Anyone may create a pipe name while core is stopped.
  `function T($p){$a=$p.GetAccessControl();$k=@([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544');$s=[Security.Principal.SecurityIdentifier];if($a.GetOwner($s).Value -notin $k){exit ${WindowsCoreExit.untrusted}};foreach($r in $a.GetAccessRules($true,$true,$s)){if($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -notin $k){exit ${WindowsCoreExit.untrusted}}}}`,
  // An existing pipe only, opened at identification level as core's own
  // client does: whoever serves the name cannot act as this user.
  `function C($n){$p=New-Object IO.Pipes.NamedPipeClientStream('.',$n,[IO.Pipes.PipeDirection]::InOut,[IO.Pipes.PipeOptions]::Asynchronous,[Security.Principal.TokenImpersonationLevel]::Identification);try{$p.Connect(5000)}catch [TimeoutException]{exit ${WindowsCoreExit.notRunning}}catch [UnauthorizedAccessException]{exit ${WindowsCoreExit.accessDenied}};T $p;$p}`,
];

function stateDirExpression(session: string, stateDir: string): string {
  if (!SESSION.test(session))
    throw new CoreEndpointRefusedError("invalid core session");
  // Base64, never quoted: PowerShell also ends a '…' string at curly quotes.
  if (stateDir)
    return `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(stateDir, "utf8").toString("base64")}'))`;
  // Core's rule: XDG_STATE_HOME when set, else %LOCALAPPDATA%.
  return `$h=$env:XDG_STATE_HOME;if(!$h){$h=$env:LOCALAPPDATA};if(!$h){$h=[IO.Path]::Combine($env:USERPROFILE,'AppData','Local')};[IO.Path]::Combine($h,'herdr-core','${session}')`;
}

/**
 * Reads `<state>\core.lock`. While core serves it holds a mandatory lock on
 * the file's first byte, so that read fails with a lock violation; a pipe
 * path always starts with `\`, so the rest is read from offset 1. A lock that
 * is empty (core is starting) or names a pipe nobody serves is "not running".
 */
export function windowsCoreProbeScript(
  session: string,
  stateDir: string,
): string {
  return [
    ...PRELUDE,
    `$d=$(${stateDirExpression(session, stateDir)})`,
    `$l=[IO.Path]::Combine($d,'${CORE_LOCK_FILE}')`,
    "$i=Get-Item -LiteralPath $l -Force -ErrorAction SilentlyContinue",
    `if(!$i -or $i.PSIsContainer -or $i.Attributes -band 1024){exit ${WindowsCoreExit.noLock}}`,
    "$f=[IO.File]::Open($l,'Open','Read','ReadWrite, Delete');$z=$f.Length",
    `if($z -gt 4096){exit ${WindowsCoreExit.badLock}};if($z -lt 2){exit ${WindowsCoreExit.notRunning}}`,
    "$b=New-Object byte[] $z",
    "try{$k=$f.Read($b,0,$z)}catch [IO.IOException]{$x=$_.Exception;if($x.InnerException){$x=$x.InnerException};if(($x.HResult -band 65535) -ne 33){throw};$f.Position=1;$k=1+$f.Read($b,1,$z-1);$b[0]=92}",
    "$f.Dispose();$s=[Text.Encoding]::UTF8.GetString($b,0,$k)",
    `if($s -notmatch '^\\\\\\\\\\.\\\\pipe\\\\([A-Za-z0-9][A-Za-z0-9._-]{0,199})\\n?$'){exit ${WindowsCoreExit.badLock}}`,
    "$n=$Matches[1];$e=$true",
    // Listing never opens the pipe; where it fails, Connect decides.
    "try{$e=@([IO.Directory]::GetFiles('\\\\.\\pipe\\')) -contains ('\\\\.\\pipe\\'+$n)}catch{}",
    `if(!$e){exit ${WindowsCoreExit.notRunning}}`,
    "$p=C $n;$p.Dispose()",
    `[Console]::Out.Write('${WINDOWS_PIPE_MARKER}'+$n+[char]10)`,
  ].join("\n");
}

/** Opens exactly the probed pipe and copies raw bytes both ways until either ends. */
export function windowsCoreRelayScript(pipe: string): string {
  if (!WINDOWS_PIPE_NAME.test(pipe))
    throw new CoreEndpointRefusedError(
      "the Windows core pipe cannot be relayed",
    );
  return [
    ...PRELUDE,
    // The name is [A-Za-z0-9._-] only, so plain quoting is exact.
    `$p=C '${pipe}'`,
    "$i=[Console]::OpenStandardInput();$o=[Console]::OpenStandardOutput()",
    "[void][Threading.Tasks.Task]::WaitAny([Threading.Tasks.Task[]]@($i.CopyToAsync($p,65536),$p.CopyToAsync($o,65536)))",
    // Duplex pipes cannot half-close: either side ending ends the relay.
    "[Environment]::Exit(0)",
  ].join("\n");
}

/** A script as one Windows command line, refused if cmd.exe could not run it. */
export function windowsCoreCommand(script: string): string {
  const command = powershellCommand(script);
  if (command.length > WINDOWS_COMMAND_LIMIT)
    throw new CoreEndpointRefusedError("the Windows core command is too long");
  return command;
}

/** The scripts' failures in plain words: on a Windows SSH host, or this computer. */
const ENDPOINT_WORDS = {
  ssh: {
    noLock:
      "no herdr-core has run with this state directory on the Windows host",
    badLock:
      "the Windows core.lock does not name a local named pipe World can relay",
    notRunning: "herdr-core is not running on the Windows host",
    accessDenied:
      "this SSH login cannot open the Windows core's pipe. If core was started elevated or over SSH, stop it with 'hc server stop' in an elevated terminal there, then start Herdr normally",
    untrusted: "the Windows core pipe belongs to, or admits, another account",
    noPowerShell: "the Windows host needs Windows PowerShell (powershell.exe)",
    failed: "reading the Windows core.lock failed",
  },
  local: {
    noLock: "no herdr-core has run with this state directory",
    badLock: "core.lock does not name a named pipe World can open",
    notRunning: "herdr-core is not running",
    accessDenied:
      "World cannot open herdr-core's pipe. If core was started elevated, stop it with 'hc server stop' in an elevated terminal, then start it normally",
    untrusted: "herdr-core's pipe belongs to, or admits, another account",
    noPowerShell: "this computer needs Windows PowerShell (powershell.exe)",
    failed: "reading core.lock failed",
  },
} as const;

/** Maps the probe's exit status to World's endpoint errors; returns the pipe name. */
export function windowsCoreEndpointResult(
  result: {
    code: number;
    stdout: string;
    stderr?: string;
  },
  where: keyof typeof ENDPOINT_WORDS = "ssh",
): string {
  const words = ENDPOINT_WORDS[where];
  switch (result.code) {
    case 0:
      break;
    case WindowsCoreExit.noLock:
      throw new CoreUnavailableError(words.noLock);
    case WindowsCoreExit.badLock:
      throw new CoreEndpointRefusedError(words.badLock);
    case WindowsCoreExit.notRunning:
      throw new CoreUnavailableError(words.notRunning);
    case WindowsCoreExit.accessDenied:
      throw new CoreEndpointRefusedError(words.accessDenied);
    case WindowsCoreExit.untrusted:
      throw new CoreEndpointRefusedError(words.untrusted);
    default:
      if (
        /powershell\.exe['":\s]+(?:is not recognized|(?:command )?not found)/i.test(
          result.stderr ?? "",
        )
      )
        throw new CoreEndpointRefusedError(words.noPowerShell);
      throw new CoreUnavailableError(`${words.failed} (${result.code})`);
  }
  const pipe = result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith(WINDOWS_PIPE_MARKER))
    ?.slice(WINDOWS_PIPE_MARKER.length);
  if (!pipe || !WINDOWS_PIPE_NAME.test(pipe))
    throw new CoreEndpointRefusedError(words.badLock);
  return pipe;
}

export type WindowsCoreTransportDependencies = {
  readRemote?: (
    argv: string[],
  ) => Promise<{ code: number; stdout: string; stderr?: string }>;
  spawnRelay?: (argv: string[]) => ChildProcessWithoutNullStreams;
  createConfig?: (profile: CoreConnectionProfile) => SshTunnelConfig;
};

/**
 * A Windows SSH core: the probe on every connect, then a private local socket
 * whose one connection is relayed, through its own SSH process, to exactly
 * the probed pipe. Closing either end ends the other.
 */
export function windowsSshCoreTransport(
  profile: CoreConnectionProfile,
  dependencies: WindowsCoreTransportDependencies = {},
): CoreTransport<string> {
  const destination = profile.ssh_destination;
  if (
    profile.type !== "ssh" ||
    profile.remote_platform !== "windows" ||
    !destination
  )
    throw new Error("a Windows core connection needs an SSH destination");
  const probe = windowsCoreCommand(
    windowsCoreProbeScript(profile.core_session, profile.core_state_dir),
  );
  const config = (
    dependencies.createConfig ??
    ((value: CoreConnectionProfile) =>
      createSshProfileRuntimeConfig({
        id: value.id,
        label: value.label,
        type: "ssh",
        ssh_destination: destination,
        remote_control_socket_path: "",
        remote_client_socket_path: "",
        auto_connect: value.auto_connect,
      }))
  )(profile);
  const readRemote =
    dependencies.readRemote ??
    ((argv: string[]) => runProcessWithCodeTimeout(argv, 20_000));
  const spawnRelay =
    dependencies.spawnRelay ??
    ((argv: string[]) =>
      spawn(argv[0]!, argv.slice(1), {
        stdio: "pipe",
        env: { ...process.env, LC_ALL: "C" },
      }));
  let relay: WindowsRelay | null = null;
  let closed = false;
  return {
    open: async (signal) => {
      if (closed || relay)
        throw new Error("the Windows core transport is used");
      const result = await readRemote(
        sshReadCommandArgv(destination, probe, [], "core.lock"),
      );
      signal.throwIfAborted();
      const pipe = windowsCoreEndpointResult(result);
      const opened = await listenRelay(
        config.socketPath,
        sshBridgeCommandArgv(
          destination,
          windowsCoreCommand(windowsCoreRelayScript(pipe)),
        ),
        spawnRelay,
      );
      if (closed || signal.aborted) {
        await opened.stop();
        signal.throwIfAborted();
        throw new Error("the Windows core transport is closed");
      }
      relay = opened;
      return config.socketPath;
    },
    close: async () => {
      closed = true;
      await relay?.stop();
      if (config.ownedRuntimeDirectory)
        rmSync(config.ownedRuntimeDirectory, { recursive: true, force: true });
    },
  };
}

type WindowsRelay = { stop(): Promise<void> };

/** One local connection, one SSH relay process; nothing else is accepted. */
async function listenRelay(
  path: string,
  argv: string[],
  spawnRelay: (argv: string[]) => ChildProcessWithoutNullStreams,
): Promise<WindowsRelay> {
  let child: ChildProcessWithoutNullStreams | null = null;
  let exited: Promise<void> = Promise.resolve();
  let peer: Socket | null = null;
  let stopping = false;
  rmSync(path, { force: true });
  const server: Server = createServer({ allowHalfOpen: true }, (socket) => {
    server.close();
    if (stopping || child) {
      socket.destroy();
      return;
    }
    peer = socket;
    const relay = spawnRelay(argv);
    child = relay;
    exited = new Promise<void>((resolve) => {
      relay.once("error", () => socket.destroy());
      relay.once("close", (code) => {
        if (code === 0) socket.end();
        else socket.destroy();
        resolve();
      });
    });
    // Drained so a chatty error stream can never stall the relay.
    relay.stderr.resume();
    relay.stdin.on("error", () => socket.destroy());
    relay.stdout.on("error", () => socket.destroy());
    socket.on("error", () => socket.destroy());
    socket.once("close", () => relay.kill());
    socket.pipe(relay.stdin);
    relay.stdout.pipe(socket, { end: false });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  return {
    stop: async () => {
      stopping = true;
      // close() alone would wait for the relayed connection to end.
      server.close();
      (peer as Socket | null)?.destroy();
      const running = child as ChildProcessWithoutNullStreams | null;
      if (running && running.exitCode === null && running.signalCode === null) {
        running.kill();
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          exited,
          new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              running.kill("SIGKILL");
              resolve();
            }, 1500);
          }),
        ]);
        clearTimeout(timer);
        await exited;
      }
      rmSync(path, { force: true });
    },
  };
}

/**
 * Windows PowerShell 5.1 from System32, never a `powershell.exe` found first
 * on PATH.
 */
export function windowsPowerShell(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.SystemRoot
    ? win32.join(
        env.SystemRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      )
    : "powershell.exe";
}

/** One fixed script for this computer's Windows PowerShell. */
export function windowsPowerShellArgv(
  script: string,
  env: Record<string, string | undefined> = process.env,
): string[] {
  return [
    windowsPowerShell(env),
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ];
}

async function readLocalProbe(
  argv: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  let child: ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">>;
  try {
    child = Bun.spawn(argv, {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20_000,
    });
  } catch {
    return { code: -1, stdout: "", stderr: "powershell.exe: not found" };
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

export type WindowsLocalCoreTransportDependencies = {
  readLocal?: (
    argv: string[],
  ) => Promise<{ code: number; stdout: string; stderr?: string }>;
  spawnRelay?: (argv: string[]) => ChildProcessWithoutNullStreams;
  env?: Record<string, string | undefined>;
};

/**
 * A core on this Windows computer. Core serves a named pipe here, so World
 * runs the Windows SSH path's two fixed scripts locally instead of over SSH:
 * the probe on every connect (core.lock under the session's state directory,
 * `%LOCALAPPDATA%\herdr-core\<session>` by default), then the relay, whose
 * stdio is the connection. The pipe stays opened by the relay, at
 * identification level after the owner check, so the same existing-only
 * rules hold: neither script runs a program, so neither can start a core.
 */
export function windowsLocalCoreTransport(
  profile: CoreConnectionProfile,
  dependencies: WindowsLocalCoreTransportDependencies = {},
): CoreTransport {
  if (profile.type !== "local")
    throw new Error("a local Windows core connection is on this computer");
  const env = dependencies.env ?? process.env;
  const probe = windowsPowerShellArgv(
    windowsCoreProbeScript(profile.core_session, profile.core_state_dir),
    env,
  );
  const readLocal = dependencies.readLocal ?? readLocalProbe;
  const spawnRelay =
    dependencies.spawnRelay ??
    ((argv: string[]) =>
      spawn(argv[0]!, argv.slice(1), { stdio: "pipe", windowsHide: true }));
  let relay: ChildProcessWithoutNullStreams | null = null;
  let closed = false;
  return {
    open: async (signal) => {
      if (closed || relay)
        throw new Error("the Windows core transport is used");
      const pipe = windowsCoreEndpointResult(await readLocal(probe), "local");
      signal.throwIfAborted();
      if (closed) throw new Error("the Windows core transport is closed");
      relay = spawnRelay(
        windowsPowerShellArgv(windowsCoreRelayScript(pipe), env),
      );
      return relayStream(relay, signal);
    },
    close: async () => {
      closed = true;
      if (relay) await stopChild(relay);
    },
  };
}

/** The relay's stdio as World's byte stream; its exit status says why it ended. */
function relayStream(
  child: ChildProcessWithoutNullStreams,
  signal: AbortSignal,
): CoreByteStream {
  const dataListeners: Array<(bytes: Uint8Array) => void> = [];
  const closeListeners: Array<(error?: Error) => void> = [];
  const early: Uint8Array[] = [];
  let closed: { error?: Error } | null = null;
  const finish = (error?: Error) => {
    if (closed) return;
    closed = { error };
    signal.removeEventListener("abort", stop);
    for (const listener of closeListeners) listener(error);
  };
  const stop = () => {
    child.kill();
    finish();
  };
  signal.addEventListener("abort", stop, { once: true });
  child.stdout.on("data", (chunk: Buffer) => {
    const bytes = new Uint8Array(chunk);
    if (dataListeners.length === 0) early.push(bytes);
    for (const listener of dataListeners) listener(bytes);
  });
  // Drained so a chatty error stream can never stall the relay.
  child.stderr.resume();
  child.stdin.on("error", (error) => finish(error));
  child.once("error", (error) => finish(error));
  child.once("close", (code, exitSignal) => {
    if (code === 0) return finish();
    if (code === null)
      return finish(
        new CoreUnavailableError(`the core relay ended (${exitSignal})`),
      );
    try {
      windowsCoreEndpointResult({ code, stdout: "" }, "local");
      finish(new CoreUnavailableError(`the core relay ended (${code})`));
    } catch (error) {
      finish(error as Error);
    }
  });
  return {
    write(bytes) {
      if (!closed) child.stdin.write(bytes);
    },
    close: stop,
    onData(listener) {
      dataListeners.push(listener);
      for (const bytes of early.splice(0)) listener(bytes);
    },
    onClose(listener) {
      if (closed) listener(closed.error);
      else closeListeners.push(listener);
    },
  };
}

async function stopChild(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("close", resolve));
  child.kill();
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    exited,
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 1500);
    }),
  ]);
  clearTimeout(timer);
}
