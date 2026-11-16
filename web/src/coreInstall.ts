/**
 * Installing herdr-core from World's UI, after a person confirms it: on this
 * computer, or on an SSH host World already has a connection for. The service
 * runs core's official, checksum-verified steps there, starts core now and at
 * login, then connects World. It never replaces or updates an installed core.
 *
 * Testing switch: open World with `?coreInstall=fake` (or `=error`) and the
 * install is simulated: progress a person can watch, then the preview's
 * fixture core stands in (or a checksum error shows). Nothing is installed.
 * The page drops the parameter at once; the switch lasts until a reload.
 */
import type { ConnectionSummary } from "./api";
import type { CoreConnectionSummary } from "./coreConnections";

export type CoreInstallHost =
  | { type: "local" }
  | { type: "ssh"; destination: string };

export type CoreHostProbe = {
  target: string | null;
  core: string | null;
  herdr: string | null;
  dir: string;
  login: "systemd" | "launchd" | "none";
};

export type CoreInstallStatus = {
  phase: "idle" | "installing" | "done" | "failed";
  version: string | null;
  lines: string[];
  error?: string;
  connection_id?: string;
};

const PARAM = "coreInstall";
let fake: "ok" | "error" | false | undefined;

/** The switch, read once per page load; the parameter is removed. */
export function coreInstallFake(): "ok" | "error" | false {
  if (fake !== undefined) return fake;
  fake = false;
  if (typeof location === "undefined") return fake;
  const url = new URL(location.href);
  if (!url.searchParams.has(PARAM)) return fake;
  fake = url.searchParams.get(PARAM) === "error" ? "error" : "ok";
  url.searchParams.delete(PARAM);
  history.replaceState(history.state, "", url);
  return fake;
}

/** For tests: forget the switch so the next read sees the URL again. */
export function resetCoreInstallFake() {
  fake = undefined;
}

export const hostKey = (host: CoreInstallHost) =>
  host.type === "local" ? "local" : `ssh:${host.destination}`;

export const hostLabel = (host: CoreInstallHost) =>
  host.type === "local" ? "this computer" : host.destination;

/**
 * Hosts that could take herdr-core: this computer and each Unix SSH host in
 * Manage connections, unless a herdr-core connection there is already ready.
 */
export function coreInstallHosts(
  connections: Pick<
    ConnectionSummary,
    "type" | "ssh_destination" | "remote_platform"
  >[],
  cores: Pick<
    CoreConnectionSummary,
    "type" | "ssh_destination" | "remote_platform" | "state"
  >[],
): CoreInstallHost[] {
  const ready = new Set(
    cores
      .filter((core) => core.state === "ready")
      .map((core) =>
        hostKey(
          core.type === "ssh"
            ? { type: "ssh", destination: core.ssh_destination ?? "" }
            : { type: "local" },
        ),
      ),
  );
  const hosts: CoreInstallHost[] = [{ type: "local" }];
  for (const profile of [...connections, ...cores]) {
    if (
      profile.type === "ssh" &&
      profile.ssh_destination &&
      profile.remote_platform !== "windows" &&
      !hosts.some(
        (host) =>
          host.type === "ssh" && host.destination === profile.ssh_destination,
      )
    )
      hosts.push({ type: "ssh", destination: profile.ssh_destination });
  }
  return hosts.filter((host) => !ready.has(hostKey(host)));
}

export function loginText(login: CoreHostProbe["login"]): string {
  return login === "systemd"
    ? "Starts at login (a systemd user unit)"
    : login === "launchd"
      ? "Starts at login (a launchd LaunchAgent)"
      : "Cannot start at login there (no systemd user manager or launchd); it starts now only";
}
