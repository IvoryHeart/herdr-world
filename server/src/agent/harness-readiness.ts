import { sshCommandArgv } from "../bridge/ssh-command";
import { AGENT_KIND } from "../../../shared/agentProfile";
import type { HerdrCall } from "./launch";
import {
  harnessAuthMethod,
  unknownHarnessReadiness,
  type HarnessReadiness,
} from "../../../shared/harnessReadiness";
export type { HarnessReadiness } from "../../../shared/harnessReadiness";

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
   * `json` reads `loggedIn`; `exit` requires a recognized message and exit.
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

type Run = (
  argv: string[],
  timeoutMs: number,
) => Promise<{ code: number; stdout: string; stderr: string }>;

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

/** One bounded POSIX probe. A section end distinguishes absence from truncation. */
export function readinessScript(kinds: string[]) {
  return kinds
    .map((kind) => {
      const spec = harnessSpec(kind);
      const status = spec.status
        ? `out=$("$b" ${spec.status.args.map(q).join(" ")} 2>&1 </dev/null); code=$?; if [ "$(printf '%s' "$out" | wc -c)" -gt 4000 ]; then echo '@@truncated'; else printf '%s\\n' "$out"; fi; printf '\\n@@exit %s\\n' "$code";`
        : "";
      return [
        `echo "@@kind ${kind}"`,
        ...resolveExecutable(spec),
        `if [ -z "$b" ]; then echo "@@missing"; else echo "@@found"; ${status} fi`,
        `echo "@@end"`,
      ].join("\n");
    })
    .concat("exit 0")
    .join("\n");
}

/** Read only complete, unambiguous records; status errors are not sign-out. */
export function readReadiness(
  kinds: string[],
  output: string,
  observedAt = Date.now(),
): HarnessReadiness[] {
  if (output.length > 200_000)
    return kinds.map((kind) =>
      unknownHarnessReadiness(kind, "malformed-output", observedAt),
    );
  const sections = new Map<string, string[]>();
  for (const part of output
    .replace(/\r\n/g, "\n")
    .split(/^@@kind /m)
    .slice(1)) {
    const newline = part.indexOf("\n");
    if (newline < 0) continue;
    const kind = part.slice(0, newline);
    sections.set(kind, [
      ...(sections.get(kind) ?? []),
      part.slice(newline + 1).replace(/\n+$/, ""),
    ]);
  }
  return kinds.map((kind) => {
    const records = sections.get(kind);
    const result = unknownHarnessReadiness(
      kind,
      records ? "malformed-output" : "missing-section",
      observedAt,
    );
    if (records?.length !== 1) return result;
    const body = records[0]!;
    if (body === "@@missing\n@@end") {
      result.installed = false;
      result.probe.state = "ok";
      result.probe.reason = "complete";
      return result;
    }
    if (!body.startsWith("@@found\n") || !body.endsWith("\n@@end"))
      return result;
    const spec = harnessSpec(kind);
    result.installed = true;
    result.can_log_in = Boolean(spec.login);
    result.probe.reason = spec.status
      ? "unreadable-status"
      : "auth-unsupported";
    if (!spec.status) return result;
    const status = /^@@found\n([\s\S]*)\n@@exit (\d{1,3})\n@@end$/.exec(body);
    if (!status) return result;
    const text = status[1]!.trim();
    const code = Number(status[2]);
    if (spec.status.read === "json") {
      try {
        const json: unknown = JSON.parse(text);
        if (
          json &&
          typeof json === "object" &&
          "loggedIn" in json &&
          typeof json.loggedIn === "boolean" &&
          code === (json.loggedIn ? 0 : 1)
        ) {
          result.logged_in = json.loggedIn;
          const method =
            "authMethod" in json
              ? harnessAuthMethod(json.authMethod)
              : undefined;
          if (result.logged_in && method) result.method = method;
        }
      } catch {
        /* Unreadable status remains unknown. */
      }
    } else if (code === 1 && text === "Not logged in") result.logged_in = false;
    else if (
      code === 0 &&
      /^Logged in using API key(?: - [^\r\n]+)?$/.test(text)
    ) {
      result.logged_in = true;
      result.method = "API-key";
    } else if (code === 0) {
      const methods: Record<string, string> = {
        ChatGPT: "ChatGPT",
        "access token": "access-token",
        "personal access token": "personal-access-token",
        "workload identity": "workload-identity",
        "Amazon Bedrock API key": "bedrock-api-key",
        "Amazon Bedrock AWS access keys": "bedrock-access-keys",
      };
      const method = Object.entries(methods).find(
        ([label]) => text === `Logged in using ${label}`,
      )?.[1];
      if (method) {
        result.logged_in = true;
        result.method = method;
      }
    }
    if (result.logged_in !== null) {
      result.probe.state = "ok";
      result.probe.reason = "complete";
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
  const kinds = [
    ...new Set(options.kinds.filter((k) => AGENT_KIND.test(k))),
  ].slice(0, 40);
  const unknown = (
    reason: "windows-unsupported" | "probe-failed" | "timeout",
  ) => {
    const observedAt = Date.now();
    return kinds.map((kind) =>
      unknownHarnessReadiness(kind, reason, observedAt),
    );
  };
  if (options.windows) return unknown("windows-unsupported");
  const script = readinessScript(kinds);
  const argv = options.host
    ? sshCommandArgv(options.host, `sh -c ${options.shQuote(script)}`)
    : ["sh", "-c", script];
  try {
    const result = await options.run(argv, 20_000);
    return result.code === 0
      ? readReadiness(kinds, result.stdout)
      : unknown("probe-failed");
  } catch (error) {
    return unknown(
      error instanceof Error && / timed out after \d+ms$/.test(error.message)
        ? "timeout"
        : "probe-failed",
    );
  }
}

/**
 * The line the user runs in the login tab: `sh -c` resolves the executable from the
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

export type LoginTab = {
  tab_id: string;
  pane_id: string;
  terminal_id: string;
  /** The line for the user to run there (see loginCommand). */
  command: string;
};

/**
 * Open a small Herdr tab in the workspace for the harness's login, and return
 * its fixed login command for the user to enter there. World types nothing
 * into the tab: Herdr reports no prompt state, and a startup script reading
 * a key (`read -n 1`) would take typed text as its answer.
 */
export async function openHarnessLogin(
  call: HerdrCall,
  request: {
    workspace_id: string;
    kind: string;
    windows: boolean;
    isCurrent: () => boolean;
  },
): Promise<LoginTab> {
  const command = loginCommand(request.kind);
  if (!command) throw new Error("World has no login command for this harness.");
  if (request.windows)
    throw new Error("World cannot run a harness login on a Windows host.");
  if (!request.isCurrent()) throw new Error("The host reconnected. Try again.");
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
  return {
    tab_id: String(created.tab?.tab_id ?? ""),
    pane_id: paneId,
    terminal_id: terminalId,
    command,
  };
}
