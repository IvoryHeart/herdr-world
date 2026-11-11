import { sshReadCommandArgv } from "../bridge/ssh-command";
import { harnessSpec, resolveExecutable } from "../agent/harness-readiness";
import type { CoreConnectionProfile } from "../connections/profiles";
import { runProcessWithCodeTimeout, shQuote } from "../utils/process-utils";

/** A POSIX script run where a core runs: locally or over the profile's SSH. */
export type CoreHost = {
  /** The SSH destination, or absent for this computer. */
  destination?: string;
  /** A Windows host: no POSIX shell, so World starts only its shell there. */
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
    return {
      destination,
      windows: profile.remote_platform === "windows",
      run: (script, timeoutMs) =>
        run(
          sshReadCommandArgv(
            destination,
            `sh -c ${shQuote(script)}`,
            [],
            "core-host",
          ),
          timeoutMs,
        ),
    };
  }
  return {
    windows: process.platform === "win32",
    run: (script, timeoutMs) => run(["sh", "-c", script], timeoutMs),
  };
}

/**
 * The absolute path of a harness's executable on the core's host: found on
 * the PATH, else in its usual install places (the same probe as the
 * launcher's readiness). Core receives this path, never a bare name, which
 * core would first look up as a template.
 */
export async function resolveCoreExecutable(
  host: CoreHost,
  kind: string,
): Promise<string> {
  if (host.windows)
    throw new Error(
      "World starts only a plain shell on a Windows herdr-core host for now",
    );
  const script = [
    ...resolveExecutable(harnessSpec(kind)),
    'case "$b" in /*) [ -x "$b" ] && [ ! -d "$b" ] && printf "%s\\n" "$b" ;; esac',
    "exit 0",
  ].join("\n");
  const result = await host.run(script, 15_000);
  const path = result.stdout.trim().split("\n").pop() ?? "";
  if (result.code !== 0 || !/^\/[^\0\r\n]*$/.test(path) || path.length > 4096)
    throw new Error(`no ${harnessSpec(kind).binary} executable was found`);
  return path;
}
