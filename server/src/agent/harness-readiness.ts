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
        `b=$(command -v ${q(spec.binary)} 2>/dev/null)`,
        ...spec.paths.map(
          (p) => `[ -z "$b" ] && [ -x ${path(p)} ] && b=${path(p)}`,
        ),
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
  if (options.windows)
    return kinds.map((kind) => ({
      kind,
      installed: false,
      logged_in: null,
      can_log_in: false,
    }));
  const script = readinessScript(kinds);
  const argv = options.host
    ? sshCommandArgv(options.host, `sh -c ${options.shQuote(script)}`)
    : ["sh", "-c", script];
  const result = await options.run(argv, 20_000);
  return readReadiness(kinds, result.stdout);
}

/**
 * Open a small Herdr tab in the workspace running the harness's own login
 * command, once its shell has printed a prompt.
 */
export async function openHarnessLogin(
  call: HerdrCall,
  request: {
    workspace_id: string;
    kind: string;
    sleep?: (ms: number) => Promise<void>;
  },
) {
  const spec = HARNESS_SPECS[request.kind];
  if (!spec?.login)
    throw new Error("World has no login command for this harness.");
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
  if (!paneId) throw new Error("Herdr did not confirm the login tab.");
  for (let tries = 0; tries < 20; tries += 1) {
    const read = (await call("pane.read", {
      pane_id: paneId,
      source: "visible",
    }).catch(() => null)) as { read?: { text?: string }; text?: string } | null;
    if ((read?.read?.text ?? read?.text ?? "").trim()) break;
    await sleep(250);
  }
  await call("pane.send_input", {
    pane_id: paneId,
    text: [spec.binary, ...spec.login].join(" "),
    keys: ["Enter"],
  });
  return {
    tab_id: String(created.tab?.tab_id ?? ""),
    pane_id: paneId,
    terminal_id: String(created.root_pane?.terminal_id ?? ""),
  };
}
