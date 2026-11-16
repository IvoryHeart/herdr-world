// Installing herdr-core on a host World already knows, after a person
// confirms it in World's UI. It runs World's reviewed copy of core's official
// install steps (scripts/herdr-core-install.sh, shared with the installers):
// on this computer through `sh -s`, on an SSH host through the profile's
// existing OpenSSH destination with the script on stdin. Nothing downloaded is
// run as a script; an installed core is never replaced or updated. Automatic
// connects never come here: only the confirmed `install` call starts core.
// Root tsc reaches this file from scripts/ and needs the `*.sh` declaration.
// oxlint-disable-next-line triple-slash-reference
/// <reference path="./text-imports.d.ts" />
import installScript from "../../../scripts/herdr-core-install.sh" with {
  type: "text",
};
import { sshCommandArgv } from "../bridge/ssh-command";
import { CORE_FIXTURE_CONNECTION_ID } from "./fixture";

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
  /** How core will start at login, or "none" when the host has no way. */
  login: "systemd" | "launchd" | "none";
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
  /** The connection World connected after it succeeded. */
  connection_id?: string;
};

type Run = (
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
};

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
};

const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+[0-9A-Za-z.+-]*$/;
const PROBE_TIMEOUT_MS = 30_000;
const SETUP_TIMEOUT_MS = 15 * 60_000;
const MAX_LINES = 40;
const LATEST_URL = "https://releases.herdr.dev/core/latest.json";

/** The script with one call appended; its stdin is closed for the call. */
export function coreInstallInput(
  action: "probe" | "setup",
  version?: string | null,
): string {
  if (version && !VERSION.test(version))
    throw new Error("invalid herdr-core version");
  const call = `herdr_core_${action}${version ? ` '${version}'` : ""} </dev/null`;
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
    login: login === "systemd" || login === "launchd" ? login : "none",
  };
}

/** The last thing the script said went wrong, in its own plain words. */
function plainError(stderr: string, fallback: string): string {
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

const runProcess: Run = async (argv, input, timeoutMs, onLine) => {
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

export type LocalCoreSetup = {
  /** The herdr-core World found or installed, if any. */
  core: string | null;
  installed: boolean;
  error?: string;
};

/**
 * `herdr-world herdr upgrade --install` with no Herdr on this computer: an
 * installed herdr-core is enough and is left alone; otherwise core is
 * installed and started (now and at login), the same steps as the installers.
 */
export async function setupMissingLocalCore(
  log: (line: string) => void,
  run: Run = runProcess,
): Promise<LocalCoreSetup> {
  let stdout = "";
  const probed = await run(
    ["sh", "-s"],
    coreInstallInput("probe"),
    PROBE_TIMEOUT_MS,
    (line) => {
      stdout += `${line}\n`;
    },
  );
  if (probed.code !== 0)
    return {
      core: null,
      installed: false,
      error: plainError(probed.stderr, "could not check for herdr-core"),
    };
  const probe = parseCoreProbe(stdout);
  if (probe.core) return { core: probe.core, installed: false };
  if (!probe.target)
    return {
      core: null,
      installed: false,
      error: "herdr-core has no build for this computer",
    };
  const result = await run(
    ["sh", "-s"],
    coreInstallInput("setup"),
    SETUP_TIMEOUT_MS,
    log,
  );
  if (result.code !== 0)
    return {
      core: null,
      installed: false,
      error: plainError(result.stderr, "herdr-core could not be installed"),
    };
  return { core: `${probe.dir}/herdr-core`, installed: true };
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

  const argv = (host: CoreInstallHost) =>
    host.type === "local"
      ? ["sh", "-s"]
      : sshCommandArgv(host.destination, "sh -s", [], "core-install");

  async function probe(value: unknown, fake = false) {
    const host = hostOf(value);
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
        version: "0.1.21",
      };
    let stdout = "";
    const [result, version] = await Promise.all([
      run(argv(host), coreInstallInput("probe"), PROBE_TIMEOUT_MS, (line) => {
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

  /** The core connection for this host: an existing one connects, else one is added. */
  async function connectInstalled(host: CoreInstallHost): Promise<string> {
    const profiles = deps.profiles();
    const existing = profiles
      .coreList()
      .find((profile) =>
        host.type === "local"
          ? profile.type === "local"
          : profile.type === "ssh" &&
            profile.ssh_destination === host.destination,
      );
    if (existing) {
      if (existing.state !== "connected") await profiles.connect(existing.id);
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
    await profiles.create({
      id,
      label:
        host.type === "local"
          ? "herdr-core on this computer"
          : `herdr-core on ${host.destination}`,
      type: host.type,
      runtime: "herdr-core",
      ...(host.type === "ssh" ? { ssh_destination: host.destination } : {}),
      core_session: "default",
      core_state_dir: "",
      auto_connect: true,
    });
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
        // fixture core stands in for the installed one. Nothing is installed.
        for (const line of [
          "Reading the herdr-core release list...",
          `Downloading herdr-core ${job.version} for linux-x86_64...`,
          ...(fake === "error" ? [] : ["Checksum verified. Unpacking..."]),
        ]) {
          say(line);
          await sleep(700);
        }
        if (fake === "error")
          throw new Error(
            "the download is damaged (checksum mismatch); try again",
          );
        say(
          `Installed herdr-core ${job.version} into ~/.local/bin/herdr-core.`,
        );
        say("herdr-core will start at login (systemd user unit).");
        say("Starting herdr-core...");
        if (!deps.fixture) throw new Error("the preview core is not available");
        await deps.fixture.start();
        say("herdr-core is running.");
        job.connection_id = CORE_FIXTURE_CONNECTION_ID;
      } else {
        const result = await run(
          argv(job.host),
          coreInstallInput("setup", job.version),
          SETUP_TIMEOUT_MS,
          say,
        );
        if (result.code !== 0)
          throw new Error(
            plainError(result.stderr, "herdr-core could not be installed"),
          );
        say("Connecting World...");
        job.connection_id = await connectInstalled(job.host);
      }
      job.phase = "done";
    } catch (error) {
      job.phase = "failed";
      job.error = (error as Error).message;
    }
  }

  return {
    probe,
    /** Starts the confirmed install or setup; one at a time per host. */
    install(value: unknown, version: unknown, fake?: unknown) {
      const host = hostOf(value);
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
        : { host, phase: "idle", version: null, lines: [] };
    },
  };
}
