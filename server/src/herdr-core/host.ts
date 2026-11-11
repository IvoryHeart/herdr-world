import { sshReadCommandArgv } from "../bridge/ssh-command";
import { powershellCommand } from "../bridge/ssh-windows";
import { harnessSpec, resolveExecutable } from "../agent/harness-readiness";
import type { CoreConnectionProfile } from "../connections/profiles";
import { runProcessWithCodeTimeout, shQuote } from "../utils/process-utils";
import { windowsCoreCommand } from "./windows";

/**
 * Where a core runs, locally or over the profile's SSH, and how World runs
 * one fixed script there: POSIX `sh` on Unix, Windows PowerShell 5.1 on
 * Windows (the same route as the named-pipe probe).
 */
export type CoreHost = {
  /** The SSH destination, or absent for this computer. */
  destination?: string;
  /** A Windows host: scripts are PowerShell, executables Windows paths. */
  windows: boolean;
  run(
    script: string,
    timeoutMs: number,
  ): Promise<{ code: number; stdout: string }>;
};

export function coreHostForProfile(
  profile: CoreConnectionProfile,
  run: typeof runProcessWithCodeTimeout = runProcessWithCodeTimeout,
): CoreHost {
  if (profile.type === "ssh" && profile.ssh_destination) {
    const destination = profile.ssh_destination;
    const windows = profile.remote_platform === "windows";
    return {
      destination,
      windows,
      run: (script, timeoutMs) =>
        run(
          sshReadCommandArgv(
            destination,
            windows ? windowsCoreCommand(script) : `sh -c ${shQuote(script)}`,
            [],
            "core-host",
          ),
          timeoutMs,
        ),
    };
  }
  const windows = process.platform === "win32";
  return {
    windows,
    run: (script, timeoutMs) =>
      run(
        windows ? powershellCommand(script).split(" ") : ["sh", "-c", script],
        timeoutMs,
      ),
  };
}

/** The Windows resolver's one line of output: the path, after this marker. */
export const WINDOWS_EXECUTABLE_MARKER = "herdr-core-executable:";
const BINARY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** A local drive path to a program core can start (`.cmd` through cmd). */
const WINDOWS_EXECUTABLE =
  /^[A-Za-z]:\\(?:[^\0-\x1f"*?<>|:/\\]+\\)*[^\0-\x1f"*?<>|:/\\]+\.(?:exe|cmd|bat)$/i;

/**
 * Finds a harness on a Windows host: on the PATH (an application, not a
 * script or alias), else where its native installer (`~\.local\bin`) or npm
 * (`%APPDATA%\npm`) puts it. Its only input is the validated binary name; it
 * runs nothing and prints the path after a marker.
 */
export function windowsExecutableScript(binary: string): string {
  if (!BINARY.test(binary)) throw new Error("invalid harness executable name");
  const name = Buffer.from(binary, "utf8").toString("base64");
  return [
    "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'",
    `$n=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${name}'))`,
    "$p=Get-Command -Name $n -CommandType Application -ErrorAction SilentlyContinue|Where-Object{$_.Path -match '\\.(exe|cmd|bat)$'}|Select-Object -First 1 -ExpandProperty Path",
    "if(!$p){$d=@();if($env:USERPROFILE){$d+=[IO.Path]::Combine($env:USERPROFILE,'.local','bin')};if($env:APPDATA){$d+=[IO.Path]::Combine($env:APPDATA,'npm')};foreach($x in $d){foreach($e in '.exe','.cmd'){$f=[IO.Path]::Combine($x,$n+$e);if(!$p -and (Test-Path -LiteralPath $f -PathType Leaf)){$p=$f}}}}",
    `if($p){[Console]::Out.WriteLine('${WINDOWS_EXECUTABLE_MARKER}'+$p)}`,
    "exit 0",
  ].join("\n");
}

/**
 * The absolute path of a harness's executable on the core's host: found on
 * the PATH, else in its usual install places (on Unix the same probe as the
 * launcher's readiness). Core receives this path, never a bare name, which
 * core would first look up as a template.
 */
export async function resolveCoreExecutable(
  host: CoreHost,
  kind: string,
): Promise<string> {
  const spec = harnessSpec(kind);
  if (host.windows) {
    for (const binary of [spec.binary, ...(spec.aliases ?? [])]) {
      const result = await host.run(windowsExecutableScript(binary), 15_000);
      const path =
        result.stdout
          .replace(/\r\n/g, "\n")
          .split("\n")
          .filter((line) => line.startsWith(WINDOWS_EXECUTABLE_MARKER))
          .pop()
          ?.slice(WINDOWS_EXECUTABLE_MARKER.length) ?? "";
      if (
        result.code === 0 &&
        path.length <= 4096 &&
        WINDOWS_EXECUTABLE.test(path)
      )
        return path;
    }
    throw new Error(`no ${spec.binary} executable was found`);
  }
  const script = [
    ...resolveExecutable(spec),
    'case "$b" in /*) [ -x "$b" ] && [ ! -d "$b" ] && printf "%s\\n" "$b" ;; esac',
    "exit 0",
  ].join("\n");
  const result = await host.run(script, 15_000);
  const path = result.stdout.trim().split("\n").pop() ?? "";
  if (result.code !== 0 || !/^\/[^\0\r\n]*$/.test(path) || path.length > 4096)
    throw new Error(`no ${spec.binary} executable was found`);
  return path;
}
