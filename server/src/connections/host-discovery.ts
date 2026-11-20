import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { sshReadCommandArgv } from "../bridge/ssh-command";
import { powershellCommand } from "../bridge/ssh-windows";
import { resolveHerdrSocketPaths } from "../config/server-config";
import { findHerdrBinary } from "../herdr/bootstrap";
import { runProcessWithCodeTimeout } from "../utils/process-utils";
import {
  defaultCoreStateDir,
  resolveLocalCoreEndpoint,
} from "../herdr-core/endpoint";
import { CoreUnavailableError } from "../herdr-core/client";
import { hostId, runtimeKind, type HostProfile } from "./hosts";
import type { ConnectionProfile } from "./profiles";

export type DiscoveredRuntime = {
  profile: ConnectionProfile;
  version: string | null;
  kind?: string;
};
export type DiscoverHost = (
  host: HostProfile,
  existing: readonly ConnectionProfile[],
) => Promise<DiscoveredRuntime[]>;

export class HostDiscoveryError extends Error {
  constructor(
    readonly found: DiscoveredRuntime[],
    readonly checkedKinds: string[],
  ) {
    super(
      "Some runtime probes failed; check SSH access and rediscover this host.",
    );
  }
}

/** A provider adds presence/version discovery and a default runtime profile. */
export type RuntimeProvider = {
  kind: string;
  label: string;
  localBinary(): string | null;
  localPresent?(): boolean;
  matches?(profile: ConnectionProfile): boolean;
  /** Fixed read-only commands; never constructed from a host's input. */
  posixProbe: string;
  windowsProbe: string;
  profile(host: HostProfile, id: string): ConnectionProfile;
};

function posixProbe(binary: "herdr" | "herdr-core"): string {
  const core = binary === "herdr-core";
  const endpoint = core
    ? `elif [ -f "$lock" ] && [ ! -L "$lock" ]; then sock=$(head -c 4096 -- "$lock"); if [ -S "$sock" ]; then printf 'found\\n'; else printf 'absent\\n'; fi; `
    : "";
  return [
    'lock="${XDG_STATE_HOME:-$HOME/.local/state}/herdr-core/default/core.lock"',
    `bin=$(command -v ${binary} 2>/dev/null)`,
    `if [ -z "$bin" ]; then for p in "$HOME/.local/bin/${binary}" /opt/homebrew/bin/${binary} /usr/local/bin/${binary}; do if [ -x "$p" ]; then bin=$p; break; fi; done; fi`,
    `if [ -n "$bin" ]; then printf 'found\\n'; "$bin" --version 2>/dev/null | head -c 200; ${endpoint}else printf 'absent\\n'; fi`,
  ].join("; ");
}

function windowsProbe(binary: "herdr" | "herdr-core"): string {
  return powershellCommand(
    [
      "$ErrorActionPreference = 'Stop'",
      `$cmd = Get-Command '${binary}.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1`,
      `$bin = if ($cmd) { $cmd.Source } else { $null }`,
      `$candidates = @("$env:LOCALAPPDATA\\Programs\\${binary === "herdr" ? "Herdr\\bin" : "herdr-core"}\\${binary}.exe", "$env:USERPROFILE\\.local\\bin\\${binary}.exe")`,
      "if (-not $bin) { foreach ($p in $candidates) { if (Test-Path -LiteralPath $p -PathType Leaf) { $bin = $p; break } } }",
      `if ($bin) { 'found'; & $bin --version 2>$null | Select-Object -First 1 } else { 'absent' }`,
    ].join("; "),
  );
}

function localCoreBinary(): string | null {
  const executable =
    process.platform === "win32" ? "herdr-core.exe" : "herdr-core";
  const candidates = [
    join(
      process.env.HC_INSTALL_DIR ||
        (process.platform === "win32"
          ? join(
              process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
              "Programs",
              "herdr-core",
            )
          : join(homedir(), ".local", "bin")),
      executable,
    ),
    ...(process.env.PATH ?? "")
      .split(delimiter)
      .filter(Boolean)
      .map((path) => join(path, executable)),
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

export const RUNTIME_PROVIDERS: readonly RuntimeProvider[] = [
  {
    kind: "herdr-core",
    label: "herdr-core",
    localBinary: localCoreBinary,
    localPresent: () => {
      if (process.platform === "win32") return false;
      try {
        resolveLocalCoreEndpoint(
          defaultCoreStateDir(process.env.HC_SESSION || "default"),
        );
        return true;
      } catch (error) {
        if (error instanceof CoreUnavailableError) return false;
        throw error;
      }
    },
    posixProbe: posixProbe("herdr-core"),
    windowsProbe: windowsProbe("herdr-core"),
    profile: (host, id) => ({
      id,
      label: "herdr-core",
      type: host.type,
      runtime: "herdr-core",
      ...(host.type === "ssh"
        ? {
            ssh_destination: host.ssh_destination,
            ...(host.remote_platform
              ? { remote_platform: host.remote_platform }
              : {}),
          }
        : {}),
      core_session:
        host.type === "local" ? process.env.HC_SESSION || "default" : "default",
      core_state_dir: "",
      auto_connect: host.auto_connect,
    }),
  },
  {
    kind: "herdr",
    label: "Herdr TUI",
    localBinary: () => findHerdrBinary(),
    posixProbe: posixProbe("herdr"),
    windowsProbe: windowsProbe("herdr"),
    profile: (host, id) =>
      host.type === "ssh"
        ? {
            id,
            label: "Herdr TUI",
            type: "ssh",
            ssh_destination: host.ssh_destination!,
            remote_control_socket_path: "",
            remote_client_socket_path: "",
            auto_connect: host.auto_connect,
            ...(host.remote_platform
              ? { remote_platform: host.remote_platform }
              : {}),
          }
        : {
            id,
            label: "Herdr TUI",
            type: "local",
            auto_connect: host.auto_connect,
            control_socket_path: resolveHerdrSocketPaths({}).socketPath,
            client_socket_path: resolveHerdrSocketPaths({}).clientSocketPath,
          },
  },
];

function version(text: string): string | null {
  return (
    text
      .slice(0, 400)
      .match(/\b\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?\b/)?.[0]
      ?.slice(0, 80) ?? null
  );
}

/**
 * All providers are checked, even after one succeeds. This observes presence;
 * transport admission still verifies sockets, protocol and runtime ownership.
 * Any failed probe makes the round incomplete: never infer removal/installation
 * advice from an SSH error, nor retire a healthy sibling using partial evidence.
 */
export function createHostDiscoverer(
  providers: readonly RuntimeProvider[] = RUNTIME_PROVIDERS,
  run: typeof runProcessWithCodeTimeout = runProcessWithCodeTimeout,
): DiscoverHost {
  return async (host, existing) => {
    const results = await Promise.allSettled(
      providers.map(async (provider) => {
        let installed: boolean;
        let runtimeVersion: string | null = null;
        if (host.type === "local") {
          const binary = provider.localBinary();
          installed = Boolean(binary) || Boolean(provider.localPresent?.());
          if (binary) {
            // A broken executable is still installed; connecting reports its error.
            try {
              runtimeVersion = version(
                (await run([binary, "--version"], 5000)).stdout,
              );
            } catch {
              /* no version */
            }
          }
        } else {
          const result = await run(
            sshReadCommandArgv(
              host.ssh_destination!,
              host.remote_platform === "windows"
                ? provider.windowsProbe
                : provider.posixProbe,
              [],
              "runtime-discovery",
            ),
            12_000,
          );
          if (result.code !== 0)
            throw new Error(
              `Runtime discovery failed on SSH host (${result.code}); check SSH access.`,
            );
          const [presence, ...rest] = result.stdout.trim().split(/\r?\n/);
          if (presence !== "found" && presence !== "absent")
            throw new Error("Invalid runtime discovery reply from SSH host");
          installed = presence === "found";
          runtimeVersion = version(rest.join("\n"));
        }
        if (!installed) return [];
        const profiles = existing.filter(
          provider.matches ??
            ((profile) => runtimeKind(profile) === provider.kind),
        );
        const baseId = `${host.id}-${provider.kind}`;
        let newId = baseId;
        let suffix = 2;
        while (existing.some((profile) => profile.id === newId))
          newId = `${baseId}-${suffix++}`;
        return (
          profiles.length ? profiles : [provider.profile(host, newId)]
        ).map((profile) => {
          if (hostId(profile) !== host.id)
            throw new Error("discovered runtime belongs to another host");
          return { profile, version: runtimeVersion, kind: provider.kind };
        });
      }),
    );
    const found = results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    );
    if (results.some((result) => result.status === "rejected"))
      throw new HostDiscoveryError(
        found,
        providers
          .filter((_, index) => results[index]!.status === "fulfilled")
          .map((provider) => provider.kind),
      );
    return found;
  };
}

export const discoverHost = createHostDiscoverer();
