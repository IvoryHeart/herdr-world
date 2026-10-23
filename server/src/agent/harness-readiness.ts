import { sshCommandArgv } from "../bridge/ssh-command";
import { AGENT_KIND } from "../../../shared/agentProfile";
import type { HerdrCall } from "./launch";

/**
 * Is a harness installed on a host, and is it logged in? Each harness answers
 * with its own status command; World reads only the fields below, never
 * credentials, and never forwards the command's output (it can name the
 * account). Logging in runs the harness's own login command in a small
 * Herdr terminal, where the user completes the browser or device flow.
 *
 * The table is data: add a harness here, not logic.
 */
export type HarnessSpec = {
  /** The executable, as Herdr starts it for the kind. */
  binary: string;
  /** Default install locations, for service PATHs that lack them. */
  paths: string[];
  /**
   * Its status command (arguments after the binary) and how to read it:
   * `json` reads `loggedIn` and `authMethod`; `exit` treats exit 0 as in.
   */
  status?: { args: string[]; read: "json" | "exit" };
  /** Its login command (arguments after the binary). */
  login?: string[];
};

export const HARNESS_SPECS: Record<string, HarnessSpec> = {
  claude: {
    binary: "claude",
    paths: ["$HOME/.local/bin/claude", "$HOME/.claude/local/claude"],
    status: { args: ["auth", "status"], read: "json" },
    login: ["auth", "login"],
  },
  codex: {
    binary: "codex",
    paths: [
      "$HOME/.local/bin/codex",
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
    ],
    status: { args: ["login", "status"], read: "exit" },
    // The device flow also works when the host has no browser (SSH).
    login: ["login", "--device-auth"],
  },
  // Pi checks readiness per provider (`pi auth check --provider`), so World
  // reports only whether it is installed.
  pi: { binary: "pi", paths: ["$HOME/.local/bin/pi"] },
};

export const harnessSpec = (kind: string): HarnessSpec =>
  HARNESS_SPECS[kind] ?? { binary: kind, paths: [`$HOME/.local/bin/${kind}`] };

export type HarnessReadiness = {
  kind: string;
  installed: boolean;
  /** null when the harness has no status command World can read. */
  logged_in: boolean | null;
  method?: string;
  can_log_in: boolean;
};

type Run = (
  argv: string[],
  timeoutMs: number,
) => Promise<{ code: number; stdout: string; stderr: string }>;

const WORD = /^[A-Za-z0-9._-]{1,32}$/;
// Arguments are table constants; quote them anyway.
const q = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
const path = (value: string) =>
  value.startsWith("$HOME/") ? `"$HOME"/${q(value.slice(6))}` : q(value);

/**
 * POSIX lines that set `$b` to the harness's executable: on PATH, else the
 * first default location. Readiness and login resolve it the same way.
 */
const resolveExecutable = (spec: HarnessSpec) => [
  `b=$(command -v ${q(spec.binary)} 2>/dev/null)`,
  ...spec.paths.map((p) => `[ -z "$b" ] && [ -x ${path(p)} ] && b=${path(p)}`),
];

/** One POSIX script that probes every kind and marks each section. */
export function readinessScript(kinds: string[]) {
  return kinds
    .map((kind) => {
      const spec = harnessSpec(kind);
      const status = spec.status
        ? `out=$("$b" ${spec.status.args.map(q).join(" ")} 2>&1 </dev/null); code=$?; printf '%s\\n' "$out" | head -c 4000; echo "@@exit $code";`
        : "";
      return [
        `echo "@@kind ${kind}"`,
        ...resolveExecutable(spec),
        `if [ -z "$b" ]; then echo "@@missing"; else echo "@@found"; ${status} fi`,
      ].join("\n");
    })
    .concat("exit 0")
    .join("\n");
}

/** Read the script's output; only the listed fields survive. */
export function readReadiness(kinds: string[], output: string) {
  const sections = new Map<string, string>();
  for (const part of output.split("@@kind ").slice(1)) {
    const newline = part.indexOf("\n");
    sections.set(part.slice(0, newline).trim(), part.slice(newline + 1));
  }
  return kinds.map((kind): HarnessReadiness => {
    const spec = harnessSpec(kind);
    const body = sections.get(kind) ?? "";
    const installed = body.startsWith("@@found");
    const result: HarnessReadiness = {
      kind,
      installed,
      logged_in: null,
      can_log_in: installed && Boolean(spec.login),
    };
    if (!installed || !spec.status) return result;
    const exit = /@@exit (\d+)\s*$/.exec(body);
    const text = body.slice("@@found".length, exit?.index);
    if (spec.status.read === "json") {
      try {
        const json = JSON.parse(text.slice(text.indexOf("{"))) as Record<
          string,
          unknown
        >;
        if (typeof json.loggedIn === "boolean")
          result.logged_in = json.loggedIn;
        if (typeof json.authMethod === "string" && WORD.test(json.authMethod))
          result.method = json.authMethod;
      } catch {
        // Unreadable: unknown.
      }
    } else if (exit) {
      result.logged_in = exit[1] === "0";
      const method = /logged in using (\S+)/i.exec(text)?.[1];
      if (result.logged_in && method && WORD.test(method))
        result.method = method;
    }
    return result;
  });
}

export async function harnessReadiness(options: {
  kinds: string[];
  host?: string;
  windows: boolean;
  run: Run;
  shQuote: (value: string) => string;
}): Promise<HarnessReadiness[]> {
  const kinds = options.kinds.filter((k) => AGENT_KIND.test(k)).slice(0, 40);
  // World's probe is POSIX. Without it nothing is known, so a Windows host
  // reports nothing and every kind its Herdr supports stays available.
  if (options.windows) return [];
  const script = readinessScript(kinds);
  const argv = options.host
    ? sshCommandArgv(options.host, `sh -c ${options.shQuote(script)}`)
    : ["sh", "-c", script];
  const result = await options.run(argv, 20_000);
  return readReadiness(kinds, result.stdout);
}

/**
 * The line typed into the login tab: `sh -c` resolves the executable from the
 * same table as readiness (so a default-location install works when the
 * shell's PATH lacks it) and runs its fixed login command. Nothing comes from
 * the browser but the kind.
 */
export function loginCommand(kind: string) {
  const spec = HARNESS_SPECS[kind];
  if (!spec?.login) return null;
  const script = [
    ...resolveExecutable(spec),
    `[ -z "$b" ] && { echo ${q(`${spec.binary} is not installed here.`)}; exit 127; }`,
    `exec "$b" ${spec.login.map(q).join(" ")}`,
  ].join("; ");
  return `sh -c ${q(script)}`;
}

export type LoginOutcome = {
  /**
   * typed: the login command waits on the tab's command line for the user's
   * Enter. Herdr reports no prompt state, so World never presses Enter itself.
   */
  status: "typed" | "uncertain" | "failed";
  message?: string;
  tab_id: string;
  pane_id: string;
  terminal_id: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * Open a small Herdr tab in the workspace and put the harness's own login
 * command on its command line, without Enter: the user reads it and presses
 * Enter. Herdr does not say whether a shell is at its prompt or a startup
 * script is waiting in `read`, and the same screen fits both, so World never
 * runs the command itself. It still waits for the shell to hold the
 * foreground with a settled screen, so typing doesn't land in a starting
 * shell's output, and checks the host and tab again right before typing.
 * Otherwise nothing is typed and the outcome says so.
 */
export async function openHarnessLogin(
  call: HerdrCall,
  request: {
    workspace_id: string;
    kind: string;
    windows: boolean;
    isCurrent: () => boolean;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    timeoutMs?: number;
  },
): Promise<LoginOutcome> {
  const command = loginCommand(request.kind);
  if (!command) throw new Error("World has no login command for this harness.");
  if (request.windows)
    throw new Error("World cannot run a harness login on a Windows host.");
  if (!request.isCurrent()) throw new Error("The host reconnected. Try again.");
  const now = request.now ?? Date.now;
  const sleep =
    request.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const created = (await call("tab.create", {
    workspace_id: request.workspace_id,
    label: `${request.kind} login`,
  })) as {
    tab?: { tab_id?: string };
    root_pane?: { pane_id?: string; terminal_id?: string };
  };
  const paneId = created?.root_pane?.pane_id;
  const terminalId = created?.root_pane?.terminal_id;
  if (!paneId || !terminalId)
    throw new Error("Herdr did not confirm the login tab.");
  const tab = {
    tab_id: String(created.tab?.tab_id ?? ""),
    pane_id: paneId,
    terminal_id: terminalId,
  };
  /** Why the tab can no longer take the command, or null while it can. */
  const lost = async (): Promise<LoginOutcome | null> => {
    if (!request.isCurrent())
      return {
        status: "failed",
        message: "The host reconnected; nothing was typed in the login tab.",
        ...tab,
      };
    const live = await call("pane.get", { pane_id: paneId }).catch(() => null);
    if (
      !isRecord(live) ||
      !isRecord(live.pane) ||
      live.pane.terminal_id !== terminalId ||
      !request.isCurrent()
    )
      return {
        status: "failed",
        message: "The login tab changed; nothing was typed.",
        ...tab,
      };
    return null;
  };
  const deadline = now() + (request.timeoutMs ?? 15_000);
  let settled: string | null = null;
  while (now() < deadline) {
    const gone = await lost();
    if (gone) return gone;
    const info = await call("pane.process_info", { pane_id: paneId }).catch(
      () => null,
    );
    const process =
      isRecord(info) && isRecord(info.process_info) ? info.process_info : null;
    const shellInFront =
      process !== null &&
      typeof process.shell_pid === "number" &&
      process.shell_pid > 0 &&
      process.foreground_process_group_id === process.shell_pid;
    const read = shellInFront
      ? ((await call("pane.read", { pane_id: paneId, source: "visible" }).catch(
          () => null,
        )) as { read?: { text?: string }; text?: string } | null)
      : null;
    const screen = (read?.read?.text ?? read?.text ?? "").trim();
    if (screen && screen === settled) {
      // The reads above were awaited: check the host and tab again.
      const changed = await lost();
      if (changed) return changed;
      await call("pane.send_text", { pane_id: paneId, text: command });
      return { status: "typed", ...tab };
    }
    settled = screen || null;
    await sleep(250);
  }
  return {
    status: "uncertain",
    message:
      "The login tab's shell did not settle; nothing was typed. Open the tab and run the harness's login there.",
    ...tab,
  };
}
