// Installing herdr-core on a host World already knows, after a person
// confirms it in World's UI. It runs World's reviewed copy of core's official
// install steps (scripts/herdr-core-install.sh, shared with the installers):
// on this computer through `sh -s`, on an SSH host through the profile's
// existing OpenSSH destination with the script on stdin. On this computer on
// Windows it runs the PowerShell twin (scripts/herdr-core-install.ps1) the
// same way, with Windows PowerShell 5.1. Nothing downloaded is
// run as a script; an installed core is never replaced or updated. Automatic
// connects never come here: only the confirmed `install` call starts core.
// Root tsc reaches this file from scripts/ and needs the `*.sh` declaration.
// oxlint-disable-next-line triple-slash-reference
/// <reference path="./text-imports.d.ts" />
import windowsInstallScript from "../../../scripts/herdr-core-install.ps1" with {
  type: "text",
};
import installScript from "../../../scripts/herdr-core-install.sh" with {
  type: "text",
};
import { sshCommandArgv } from "../bridge/ssh-command";
import { CORE_FIXTURE_CONNECTION_ID } from "./fixture";
import { windowsPowerShell } from "./windows";

export type CoreInstallHost =
  | { type: "local" }
  | { type: "ssh"; destination: string };

/** What the confirmation step shows, read from the host without changing it. */
export type CoreHostProbe = {
  /** Release target, or null where core has no build (World says so). */
  target: string | null;
  /** The installed herdr-core, if any. */
  core: string | null;
  /** The installed Herdr TUI, if any. */
  herdr: string | null;
  /** Where core goes. */
  dir: string;
  /**
   * How core will start at login (Windows: a Startup folder shortcut), or
   * "none" when the host has no way.
   */
  login: "systemd" | "launchd" | "startup" | "none";
};

export type CoreInstallStatus = {
  host: CoreInstallHost;
  phase: "idle" | "installing" | "done" | "failed";
  /** The version being installed (null: the newest when the step ran). */
  version: string | null;
  /** Progress lines, as the host printed them. */
  lines: string[];
  /** Plain words when it failed. */
  error?: string;
  /** The core session set up: the chosen connection's, else `default`. */
  session: string;
  /** The saved core connection the install was offered under, if any. */
  connection?: string;
  /** The connection World connected after it succeeded. */
  connection_id?: string;
};

export type Run = (
  argv: string[],
  input: string,
  timeoutMs: number,
  onLine: (line: string) => void,
) => Promise<{ code: number; stderr: string }>;

type CoreProfileItem = {
  id: string;
  type: string;
  state: string;
  ssh_destination?: string;
  remote_platform?: string;
  core_session: string;
  core_state_dir: string;
};

/** What create/connect return: the connection after its connect attempt. */
type ConnectedItem = { state?: unknown; error?: { message?: unknown } };

export type CoreInstallDeps = {
  profiles: () => {
    list(): Array<{
      id: string;
      type: string;
      ssh_destination?: string;
      remote_platform?: string;
    }>;
    coreList(): CoreProfileItem[];
    create(value: unknown): Promise<unknown>;
    connect(connectionId: unknown): Promise<unknown>;
  };
  /** The preview fixture: the testing switch's stand-in for a real core. */
  fixture?: { start(): Promise<unknown> };
  run?: Run;
  latestVersion?: () => Promise<string | null>;
  sleep?: (ms: number) => Promise<void>;
  /** This computer's platform: Windows runs the PowerShell steps. */
  platform?: NodeJS.Platform;
};

const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+[0-9A-Za-z.+-]*$/;
/** Core session names, as connection profiles validate them. */
const SESSION = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/;
export const PROBE_TIMEOUT_MS = 30_000;
export const SETUP_TIMEOUT_MS = 15 * 60_000;
const MAX_LINES = 40;
const LATEST_URL = "https://releases.herdr.dev/core/latest.json";

/**
 * The script with one call appended; its stdin is closed for the call. Setup
 * takes a version ('' for the newest) and the core session to start. Windows
 * gets the PowerShell twin, whose functions have the same names.
 */
export function coreInstallInput(
  action: "probe" | "setup",
  version?: string | null,
  session = "default",
  platform: NodeJS.Platform | "posix" = "posix",
): string {
  if (version && !VERSION.test(version))
    throw new Error("invalid herdr-core version");
  if (!SESSION.test(session)) throw new Error("invalid herdr-core session");
  // Both values are validated above, so single quotes are exact.
  if (platform === "win32")
    return `${windowsInstallScript}\nherdr_core_${action}${
      action === "setup" ? ` '${version ?? ""}' '${session}'` : ""
    }\n`;
  const args =
    action === "setup" && session !== "default"
      ? ` '${version ?? ""}' '${session}'`
      : version
        ? ` '${version}'`
        : "";
  const call = `herdr_core_${action}${args} </dev/null`;
  return `${installScript}\n${call}\n`;
}

export function parseCoreProbe(stdout: string): CoreHostProbe {
  const facts = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) facts.set(line.slice(0, at), line.slice(at + 1).trim());
  }
  if (!facts.has("target") || !facts.has("dir"))
    throw new Error("the host did not describe itself");
  const login = facts.get("login");
  return {
    target:
      facts.get("target") && facts.get("target") !== "unsupported"
        ? facts.get("target")!
        : null,
    core: facts.get("core") || null,
    herdr: facts.get("herdr") || null,
    dir: facts.get("dir")!,
    login:
      login === "systemd" || login === "launchd" || login === "startup"
        ? login
        : "none",
  };
}

/** The last thing the script said went wrong, in its own plain words. */
export function plainError(stderr: string, fallback: string): string {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const said = lines.findLast((line) => line.startsWith("herdr-core: "));
  if (said) return said.slice("herdr-core: ".length);
  if (/command not found|not found/.test(lines.at(-1) ?? ""))
    return "the host has no POSIX shell (sh); herdr-core installs on Linux and macOS hosts";
  if (lines.some((line) => /^ssh: |Permission denied|Host key/.test(line)))
    return `could not reach the host over SSH: ${lines.at(-1)}`;
  return fallback;
}

/**
 * How this computer runs the steps: `sh -s`, or on Windows, System32's
 * Windows PowerShell 5.1 running the script read whole from stdin (a script
 * block from a string, so no execution policy or script file is involved).
 */
export function localInstallArgv(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
): string[] {
  if (platform !== "win32") return ["sh", "-s"];
  return [
    windowsPowerShell(env),
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "& ([scriptblock]::Create([Console]::In.ReadToEnd()))",
  ];
}

export const runProcess: Run = async (argv, input, timeoutMs, onLine) => {
  const child = Bun.spawn(argv, {
    stdin: new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill(), timeoutMs);
  const stderr = new Response(child.stderr).text();
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of child.stdout) {
    pending += decoder.decode(chunk, { stream: true });
    let at: number;
    while ((at = pending.indexOf("\n")) >= 0) {
      onLine(pending.slice(0, at));
      pending = pending.slice(at + 1);
    }
  }
  if (pending) onLine(pending);
  const code = await child.exited;
  clearTimeout(timer);
  return { code, stderr: await stderr };
};

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch(LATEST_URL, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const version = ((await response.json()) as { version?: unknown }).version;
    return typeof version === "string" && VERSION.test(version)
      ? version
      : null;
  } catch {
    return null;
  }
}

const hostKey = (host: CoreInstallHost) =>
  host.type === "local" ? "local" : `ssh:${host.destination}`;

export type CoreInstall = ReturnType<typeof createCoreInstall>;

export function createCoreInstall(deps: CoreInstallDeps) {
  const run = deps.run ?? runProcess;
  const latestVersion = deps.latestVersion ?? fetchLatestVersion;
  const sleep =
    deps.sleep ??
    ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const jobs = new Map<string, CoreInstallStatus>();

  /** Only this computer, or an SSH (non-Windows) host World has a profile for. */
  function hostOf(value: unknown): CoreInstallHost {
    const host = value as Partial<{ type: string; destination: string }>;
    if (host?.type === "local") return { type: "local" };
    if (host?.type === "ssh" && typeof host.destination === "string") {
      const profiles = deps.profiles();
      const known = [...profiles.list(), ...profiles.coreList()].some(
        (profile) =>
          profile.type === "ssh" &&
          profile.ssh_destination === host.destination &&
          profile.remote_platform !== "windows",
      );
      if (!known)
        throw new Error(
          "install herdr-core only on this computer or an SSH host in Manage connections",
        );
      return { type: "ssh", destination: host.destination };
    }
    throw new Error("choose this computer or an SSH host");
  }

  const platform = deps.platform ?? process.platform;
  const argv = (host: CoreInstallHost) =>
    host.type === "local"
      ? localInstallArgv(platform)
      : sshCommandArgv(host.destination, "sh -s", [], "core-install");
  /** The script for a host: SSH hosts here are Unix; this computer may not be. */
  const input = (
    host: CoreInstallHost,
    action: "probe" | "setup",
    version?: string | null,
    session?: string,
  ) =>
    coreInstallInput(
      action,
      version,
      session,
      host.type === "local" ? platform : "posix",
    );

  async function probe(value: unknown, fake = false, connection?: unknown) {
    const host = hostOf(value);
    // Offered under a saved connection: refuse one World cannot set up now.
    chosenConnection(host, connection);
    if (fake)
      return {
        host,
        probe: {
          target: "linux-x86_64",
          core: null,
          herdr: null,
          dir: "~/.local/bin",
          login: "systemd",
        } satisfies CoreHostProbe,
        version: "0.1.22",
      };
    let stdout = "";
    const [result, version] = await Promise.all([
      run(argv(host), input(host, "probe"), PROBE_TIMEOUT_MS, (line) => {
        stdout += `${line}\n`;
      }),
      latestVersion(),
    ]);
    if (result.code !== 0)
      throw new Error(
        plainError(result.stderr, "could not check the host for herdr-core"),
      );
    return { host, probe: parseCoreProbe(stdout), version };
  }

  const sameHost = (profile: CoreProfileItem, host: CoreInstallHost) =>
    host.type === "local"
      ? profile.type === "local"
      : profile.type === "ssh" && profile.ssh_destination === host.destination;

  /**
   * The saved core connection an install was offered under. Its session is
   * the one set up; a custom state directory is refused, because World starts
   * core only where its session keeps state by default.
   */
  function chosenConnection(
    host: CoreInstallHost,
    value: unknown,
  ): CoreProfileItem | null {
    if (value === undefined || value === null) return null;
    const profile = deps
      .profiles()
      .coreList()
      .find((item) => item.id === value);
    if (!profile || !sameHost(profile, host))
      throw new Error("that herdr-core connection is not on this host");
    if (!SESSION.test(profile.core_session))
      throw new Error("invalid herdr-core session");
    if (profile.core_state_dir)
      throw new Error(
        `this connection reads herdr-core from ${profile.core_state_dir}; World only starts core in its session's usual place, so start that core there yourself, then Connect`,
      );
    return profile;
  }

  /** Throws unless World's connection is ready, in its own plain words. */
  function requireReady(item: unknown) {
    const connected = item as ConnectedItem | null;
    if (connected?.state === "ready") return;
    const why =
      typeof connected?.error?.message === "string"
        ? connected.error.message
        : `the connection is ${String(connected?.state ?? "not connected")}`;
    throw new Error(
      `herdr-core is installed and started, but World could not connect to it: ${why}`,
    );
  }

  /**
   * Connects World to the core just set up: the chosen connection, else this
   * host's connection to the same (default) endpoint, else a new one. Only a
   * ready connection counts as success.
   */
  async function connectInstalled(job: CoreInstallStatus): Promise<string> {
    const profiles = deps.profiles();
    const host = job.host;
    const existing = profiles
      .coreList()
      .find((profile) =>
        job.connection
          ? profile.id === job.connection
          : sameHost(profile, host) &&
            profile.core_session === job.session &&
            !profile.core_state_dir,
      );
    if (job.connection && !existing)
      throw new Error("the herdr-core connection was removed meanwhile");
    if (existing) {
      if (existing.state !== "ready")
        requireReady(await profiles.connect(existing.id));
      return existing.id;
    }
    const taken = new Set([
      ...profiles.list().map((profile) => profile.id),
      ...profiles.coreList().map((profile) => profile.id),
    ]);
    const base =
      host.type === "local"
        ? "core-local"
        : `core-${host.destination.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")}`.slice(
            0,
            100,
          );
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    requireReady(
      await profiles.create({
        id,
        label:
          host.type === "local"
            ? "herdr-core on this computer"
            : `herdr-core on ${host.destination}`,
        type: host.type,
        runtime: "herdr-core",
        ...(host.type === "ssh" ? { ssh_destination: host.destination } : {}),
        core_session: job.session,
        core_state_dir: "",
        auto_connect: true,
      }),
    );
    return id;
  }

  async function perform(job: CoreInstallStatus, fake: false | "ok" | "error") {
    const say = (line: string) => {
      job.lines.push(line);
      if (job.lines.length > MAX_LINES) job.lines.shift();
    };
    try {
      if (fake) {
        // The testing switch: progress a person can watch, then the preview
        // fixture core stands in for the installed one. Nothing is installed,
        // and every line and the failure say "Simulated:" so a person never
        // mistakes them for a real host's result (#931).
        const simulate = (line: string) => say(`Simulated: ${line}`);
        for (const line of [
          "Reading the herdr-core release list...",
          `Downloading herdr-core ${job.version} for linux-x86_64...`,
          ...(fake === "error" ? [] : ["Checksum verified. Unpacking..."]),
        ]) {
          simulate(line);
          await sleep(700);
        }
        if (fake === "error")
          throw new Error(
            "Simulated: the download is damaged (checksum mismatch). This is the test switch; nothing was downloaded.",
          );
        simulate(
          `Installed herdr-core ${job.version} into ~/.local/bin/herdr-core.`,
        );
        simulate("herdr-core will start at login (systemd user unit).");
        simulate("Starting the preview's fixture core instead...");
        if (!deps.fixture) throw new Error("the preview core is not available");
        await deps.fixture.start();
        simulate("the fixture core is running.");
        job.connection_id = CORE_FIXTURE_CONNECTION_ID;
      } else {
        const result = await run(
          argv(job.host),
          input(job.host, "setup", job.version, job.session),
          SETUP_TIMEOUT_MS,
          say,
        );
        if (result.code !== 0)
          throw new Error(
            plainError(result.stderr, "herdr-core could not be installed"),
          );
        say("Connecting World...");
        job.connection_id = await connectInstalled(job);
      }
      job.phase = "done";
    } catch (error) {
      job.phase = "failed";
      job.error = (error as Error).message;
    }
  }

  return {
    probe,
    /**
     * Starts the confirmed install or setup; one at a time per host. Offered
     * under a saved core connection, it sets up that connection's session
     * and connects exactly that connection.
     */
    install(
      value: unknown,
      version: unknown,
      fake?: unknown,
      connection?: unknown,
    ) {
      const host = hostOf(value);
      const chosen = chosenConnection(host, connection);
      const key = hostKey(host);
      if (jobs.get(key)?.phase === "installing")
        throw new Error("herdr-core is already being installed there");
      if (
        version !== null &&
        version !== undefined &&
        (typeof version !== "string" || !VERSION.test(version))
      )
        throw new Error("invalid herdr-core version");
      const job: CoreInstallStatus = {
        host,
        phase: "installing",
        version: (version as string | null | undefined) ?? null,
        lines: [],
        session: chosen?.core_session ?? "default",
        ...(chosen ? { connection: chosen.id } : {}),
      };
      jobs.set(key, job);
      void perform(job, fake === "ok" || fake === "error" ? fake : false);
      return { ...job, lines: [...job.lines] };
    },
    status(value: unknown): CoreInstallStatus {
      const host = hostOf(value);
      const job = jobs.get(hostKey(host));
      return job
        ? { ...job, lines: [...job.lines] }
        : { host, phase: "idle", version: null, lines: [], session: "default" };
    },
  };
}
